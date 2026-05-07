"""
Research field detection via vocabulary scoring against ontology packs.
Packs are loaded from processors/ontology/*.json — drop a new JSON file to
add a new field without touching this module.
"""
from __future__ import annotations
import json
from pathlib import Path

_PACK_DIR = Path(__file__).parent / "ontology"
_CACHE: dict[str, dict] = {}

SECTION_WEIGHTS: dict[str, int] = {
    "title":           5,
    "author_keywords": 4,
    "abstract":        3,
    "conclusion":      3,
    "introduction":    1,
    "results":         1,
    "methods":         1,
}


def _packs() -> dict[str, dict]:
    if not _CACHE:
        for p in _PACK_DIR.glob("*.json"):
            try:
                _CACHE[p.stem] = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                pass
    return _CACHE


def _vocab(pack: dict) -> set[str]:
    v: set[str] = set()
    for lst in pack.get("terms", {}).values():
        v.update(t.lower() for t in lst)
    v.update(a.lower() for a in pack.get("aliases", {}).keys())
    return v


def _text(sections: dict, key: str) -> str:
    val = sections.get(key) or ""
    return " ".join(str(x) for x in val) if isinstance(val, list) else str(val)


def detect_field(sections: dict) -> tuple[str, float, dict]:
    """
    Score a paper's text sections against each ontology pack.

    Args:
        sections: dict with keys title, abstract, author_keywords,
                  introduction, results, methods, conclusion.
                  author_keywords may be a list of strings.

    Returns:
        (display_name, confidence 0–1, normalised_scores)
        e.g. ("Materials Science", 0.91, {"materials_science": 1.0, "physics": 0.34})
    """
    packs = _packs()
    if not packs:
        return ("Unknown", 0.0, {})

    raw: dict[str, float] = {}
    for pack_key, pack in packs.items():
        vocab = _vocab(pack)
        score: float = 0.0
        for sec_key, weight in SECTION_WEIGHTS.items():
            text = _text(sections, sec_key).lower()
            for term in vocab:
                if term in text:
                    score += weight
        raw[pack_key] = score

    top_key = max(raw, key=raw.__getitem__)
    mx = raw[top_key]

    if mx == 0:
        return ("Unknown", 0.0, {k: 0.0 for k in raw})

    sorted_v = sorted(raw.values(), reverse=True)
    second = sorted_v[1] if len(sorted_v) > 1 else 0.0
    conf = round(mx / (mx + second + 1e-9), 3)

    norm = {k: round(v / mx, 3) for k, v in raw.items()}
    display = packs[top_key].get("field", top_key.replace("_", " ").title())
    return (display, min(conf, 1.0), norm)
