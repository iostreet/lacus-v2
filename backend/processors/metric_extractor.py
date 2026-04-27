"""
Performance metric extraction.
Primary: quantulum3 (number-span detection) + domain regex (unit + metric-name matching).
Fallback: pure regex patterns for well-known abbreviations.
Both extractors run; results are deduped by (normalised_metric_name, value).
"""

from __future__ import annotations
import contextlib
import re
from processors.domain_dict import METRIC_NAMES

# ---------------------------------------------------------------------------
# Unit patterns — single-char units use (?!\w) boundary to avoid mid-word hits
# ---------------------------------------------------------------------------
GENERIC_UNITS = (
    # Piezo / ferroelectric
    r"pm/V|pC/N|nC/N|[μu]C/m²|[μu]C/m2|C/m²|C/m2|V·m/N|mV/g|"
    r"[μu]C/cm²|[μu]C/cm2|C/cm2|"
    # Temperature — multi-char before bare K
    r"°C|degC|℃|°F|"
    # Frequency — multi-char before bare voltage letters
    r"kHz|MHz|GHz|Hz|"
    # Voltage — longest first
    r"[μu]V|mV|kV|MV|V(?!\w)|"
    # Current density (compound before bare current)
    r"[μu]A/cm²|[μu]A/cm2|mA/cm²|mA/cm2|nA/cm²|nA/cm2|A/cm²|A/cm2|"
    r"[μu]A|mA|kA|nA|pA|A(?!\w)|"
    # Power density (compound before bare watt)
    r"[μu]W/cm²|[μu]W/cm2|mW/cm²|mW/cm2|W/cm²|W/cm2|[μu]W|mW|kW|nW|W(?!\w)|"
    # Pressure
    r"GPa|MPa|kPa|Pa(?!\w)|"
    # Length
    r"[μu]m|nm|mm|cm|km|m(?!\w)|"
    # Time
    r"[μu]s|ms|ns|ps|s(?!\w)|"
    # Capacitance
    r"pF|nF|[μu]F|mF|F(?!\w)|"
    # Conductance / resistivity
    r"S/m|S/cm|Ω·cm|Ω·m|"
    # Energy density
    r"J/cm³|J/cm3|J/m³|J/m3|[μu]J/cm³|[μu]J/cm3|"
    # Electric field
    r"kV/cm|kV/mm|MV/m|V/m|V/[μu]m|"
    # Mass density
    r"g/cm³|g/cm3|kg/m³|kg/m3|"
    # Temperature — Kelvin (single char, late to avoid clobbering kHz/kV/kPa)
    r"K(?!\w)|"
    # Dimensionless
    r"%|ppm|ppb"
)

NUMBER_RE = r"[-+]?\d+(?:[.,]\d+)?(?:\s*[×xX]\s*10[-+]?\d+)?"

_UNIT_RE   = re.compile(f"(?:{GENERIC_UNITS})", re.IGNORECASE)
_NUMBER_RE = re.compile(NUMBER_RE)

# Longest metric names first so specific matches beat sub-string matches
_SORTED_METRICS = sorted(METRIC_NAMES, key=len, reverse=True)

SECTION_CONFIDENCE = {
    "abstract":     0.82,
    "conclusion":   0.85,
    "results":      0.77,
    "introduction": 0.62,
    "methods":      0.55,
    "body":         0.60,
}

# Aliases used in dedup to prevent (Tc, 350) and (Curie temperature, 350) both surviving
_METRIC_ALIASES: dict[str, str] = {
    "tc":                   "curie temperature",
    "pr":                   "remnant polarization",
    "remanent polarization":"remnant polarization",
    "ec":                   "coercive field",
    "qm":                   "mechanical quality factor",
    "voc":                  "output voltage",
    "open-circuit voltage": "output voltage",
    "isc":                  "short-circuit current",
}

# Condition-keyword prefixes — a number span preceded by one of these is a
# measurement condition, not the primary metric value (e.g. "at 1 kHz").
_COND_PREFIX_RE = re.compile(
    r"\b(?:at|under|above|below|upon)\s*$", re.IGNORECASE
)


def _norm_metric(name: str) -> str:
    return _METRIC_ALIASES.get(name.lower(), name.lower())


# ---------------------------------------------------------------------------
# Sentence splitter (returns list of (start, end, text) tuples)
# ---------------------------------------------------------------------------
def _sentence_spans(text: str) -> list[tuple[int, int, str]]:
    spans: list[tuple[int, int, str]] = []
    pos = 0
    for sent in re.split(r"(?<=[.!?])\s+", text):
        idx = text.find(sent, pos)
        if idx == -1:
            idx = pos
        spans.append((idx, idx + len(sent), sent))
        pos = idx + len(sent)
    return spans


# ---------------------------------------------------------------------------
# Per-sentence helpers
# ---------------------------------------------------------------------------
def _extract_unit(sentence: str, span_start: int, span_end: int) -> str:
    """Find domain unit inside or immediately after the quantity span."""
    surface = sentence[span_start:span_end]
    if num_m := _NUMBER_RE.search(surface):
        tail = surface[num_m.end():].lstrip()
        if um := _UNIT_RE.match(tail):
            return um[0]
    tail = sentence[span_end:span_end + 20].lstrip()
    um = _UNIT_RE.match(tail)
    return um[0] if um else ""


def _find_metric_name_in_sentence(sentence: str, span_start: int, span_end: int) -> str:
    """Find nearest metric name in the same sentence. Prefer closest before span."""
    best      = ""
    best_dist = float("inf")
    for metric in _SORTED_METRICS:
        pat = re.compile(r"\b" + re.escape(metric) + r"\b", re.IGNORECASE)
        for m in pat.finditer(sentence[:span_start + 20]):
            dist = span_start - m.start()
            if 0 <= dist < best_dist:
                best_dist = dist
                best = metric
        if not best:
            for m in pat.finditer(sentence[span_end:]):
                dist = m.start()
                if dist < best_dist:
                    best_dist = dist
                    best = metric
    return best


def _find_condition(sentence: str, span_end: int) -> str:
    tail = sentence[span_end: span_end + 180]
    m = re.search(
        r"\b((?:at|under|for|in|with|during|upon|above|below)\s+[^.;\n]{3,80}?)(?=[.;\n]|$)",
        tail,
        re.IGNORECASE,
    )
    return m[1].strip() if m else ""


# ---------------------------------------------------------------------------
# Primary extractor: quantulum3 — processes text sentence by sentence
# ---------------------------------------------------------------------------
def _extract_with_quantulum(text: str, section_name: str) -> list[dict]:
    try:
        from quantulum3 import parser as qparser
    except ImportError:
        return []

    results   = []
    base_conf = SECTION_CONFIDENCE.get(section_name, 0.62)

    for sent_start, _sent_end, sentence in _sentence_spans(text):
        try:
            quantities = qparser.parse(sentence)
        except Exception:
            continue

        for q in quantities:
            s_start, s_end = q.span

            # Skip condition values ("at 1 kHz", "under 0.5 MPa", …)
            before = sentence[max(0, s_start - 25):s_start]
            if _COND_PREFIX_RE.search(before):
                continue

            num_m = _NUMBER_RE.search(sentence[s_start:s_end])
            if not num_m:
                continue
            value_str = num_m[0].replace(",", ".").strip()

            with contextlib.suppress(ValueError):
                fv = float(value_str.split("×")[0].split("X")[0].split("x")[0])
                if 1900 <= fv <= 2100 and q.unit.name in ("dimensionless", ""):
                    continue
                if fv == 1.0 and (s_end - s_start) <= 4:
                    continue          # quantulum3 misparses "A d33" → 1.0

            unit        = _extract_unit(sentence, s_start, s_end)
            metric_name = _find_metric_name_in_sentence(sentence, s_start, s_end)
            if not metric_name:
                continue

            condition = _find_condition(sentence, s_end)
            abs_start = sent_start + s_start
            abs_end   = sent_start + s_end
            ctx_s     = max(0, abs_start - 100)
            ctx_e     = min(len(text), abs_end + 100)

            results.append({
                "metric_name": metric_name,
                "value":       value_str,
                "unit":        unit,
                "condition":   condition,
                "confidence":  round(base_conf, 3),
                "evidence":    text[ctx_s:ctx_e].replace("\n", " "),
            })

    return results


# ---------------------------------------------------------------------------
# Abbreviation patterns for the regex fallback
# ---------------------------------------------------------------------------
_CONNECTOR = (
    r"\s*(?:of|=|~|≈|about|around|approximately|reaches?|reached?|is|was|were|:)?\s*"
    r"(?:about|~)?\s*"
)

_ABBREV_PATTERNS: list[tuple] = [
    (re.compile(f"\\bd33\\b{_CONNECTOR}({NUMBER_RE})\\s*({GENERIC_UNITS})?", re.IGNORECASE), "d33"),
    (re.compile(f"\\bd31\\b{_CONNECTOR}({NUMBER_RE})\\s*({GENERIC_UNITS})?", re.IGNORECASE), "d31"),
    (re.compile(f"\\bd15\\b{_CONNECTOR}({NUMBER_RE})\\s*({GENERIC_UNITS})?", re.IGNORECASE), "d15"),
    (re.compile(f"\\bTc\\b{_CONNECTOR}({NUMBER_RE})\\s*({GENERIC_UNITS})?"),                "Curie temperature"),
    (re.compile(f"\\bVoc\\b{_CONNECTOR}({NUMBER_RE})\\s*({GENERIC_UNITS})?", re.IGNORECASE), "output voltage"),
    (re.compile(f"\\bQm\\b{_CONNECTOR}({NUMBER_RE})\\s*({GENERIC_UNITS})?", re.IGNORECASE), "mechanical quality factor"),
    (re.compile(f"\\bPr\\b{_CONNECTOR}({NUMBER_RE})\\s*({GENERIC_UNITS})?"),                "remnant polarization"),
    (re.compile(f"\\bEc\\b{_CONNECTOR}({NUMBER_RE})\\s*({GENERIC_UNITS})?"),                "coercive field"),
    (re.compile(f"\\bg33\\b{_CONNECTOR}({NUMBER_RE})\\s*({GENERIC_UNITS})?", re.IGNORECASE), "g33"),
    (re.compile(f"\\bk33\\b{_CONNECTOR}({NUMBER_RE})\\s*({GENERIC_UNITS})?", re.IGNORECASE), "k33"),
    (re.compile(f"\\bkt\\b{_CONNECTOR}({NUMBER_RE})\\s*({GENERIC_UNITS})?", re.IGNORECASE), "kt"),
    (re.compile(f"\\bkp\\b{_CONNECTOR}({NUMBER_RE})\\s*({GENERIC_UNITS})?", re.IGNORECASE), "kp"),
]


# ---------------------------------------------------------------------------
# Fallback extractor: pure regex on named metric terms
# ---------------------------------------------------------------------------
def _extract_with_regex(text: str, section_name: str) -> list[dict]:
    results   = []
    base_conf = SECTION_CONFIDENCE.get(section_name, 0.62)

    for metric in _SORTED_METRICS:
        pat = re.compile(
            f"\\b{re.escape(metric)}\\b{_CONNECTOR}({NUMBER_RE})\\s*({GENERIC_UNITS})?",
            re.IGNORECASE,
        )
        for m in pat.finditer(text):
            value = m[1].replace(",", ".").strip()
            unit  = (m[2] or "").strip()
            if not value:
                continue
            with contextlib.suppress(ValueError):
                fv = float(value.split("×")[0].split("x")[0])
                if 1900 <= fv <= 2100 and not unit:
                    continue
            condition = _find_condition(text, m.end())
            ctx_s     = max(0, m.start() - 150)
            ctx_e     = min(len(text), m.end() + 150)
            results.append({
                "metric_name": metric,
                "value":       value,
                "unit":        unit,
                "condition":   condition,
                "confidence":  round(base_conf, 3),
                "evidence":    text[ctx_s:ctx_e].replace("\n", " "),
            })

    for pat, metric_name in _ABBREV_PATTERNS:
        for m in pat.finditer(text):
            value = (m[1] or "").replace(",", ".").strip()
            unit  = (m[2] or "").strip()
            if not value:
                continue
            condition = _find_condition(text, m.end())
            ctx_s     = max(0, m.start() - 150)
            ctx_e     = min(len(text), m.end() + 150)
            results.append({
                "metric_name": metric_name,
                "value":       value,
                "unit":        unit,
                "condition":   condition,
                "confidence":  round(base_conf, 3),
                "evidence":    text[ctx_s:ctx_e].replace("\n", " "),
            })

    return results


# ---------------------------------------------------------------------------
# Deduplication — prefer entries with unit/condition; normalise alias names
# ---------------------------------------------------------------------------
def _deduplicate(metrics: list[dict]) -> list[dict]:
    seen: set[tuple] = set()
    out  = []
    # Sort: highest confidence first, then prefer unit present, condition present,
    # and longer (more descriptive) metric name so "Curie temperature" beats "Tc".
    key_fn = lambda x: (-x["confidence"], -bool(x["unit"]), -bool(x["condition"]), -len(x["metric_name"]))
    for m in sorted(metrics, key=key_fn):
        key = (_norm_metric(m["metric_name"]), m["value"])
        if key not in seen:
            seen.add(key)
            out.append(m)
    return out


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def extract_metrics(sections: dict) -> list[dict]:
    """
    Return list of {metric_name, value, unit, condition, confidence, evidence}.
    Uses quantulum3 (sentence-level span detection) + domain regex (named patterns).
    Both run; dedup merges results keeping the richest entry per (metric, value).
    """
    all_metrics: list[dict] = []

    for section_name, text in sections.items():
        if not text:
            continue
        text = str(text)
        all_metrics.extend(_extract_with_quantulum(text, section_name))
        all_metrics.extend(_extract_with_regex(text, section_name))

    return _deduplicate(all_metrics)
