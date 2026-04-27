"""
Rule-based keyword relation extractor.
"""

from __future__ import annotations
import contextlib
import re
from processors.domain_dict import SENTENCE_PATTERNS

SECTION_CONFIDENCE = {
    "title":       0.90,
    "abstract":    0.82,
    "conclusion":  0.85,
    "results":     0.75,
    "introduction":0.65,
    "methods":     0.60,
    "body":        0.58,
}

MAX_RELATIONS     = 60  # cap to avoid explosion
MAX_PER_SOURCE    =  1  # max relations where the same keyword is the source

# Sections where co-occurrence (no explicit pattern) is still meaningful
_COOCCUR_SECTIONS = {"title", "abstract", "conclusion"}
_COOCCUR_CONF = {"title": 0.72, "abstract": 0.55, "conclusion": 0.60}


def _split_sentences(text: str) -> list[str]:
    return re.split(r"(?<=[.!?])\s+", text)


def _keyword_in_sentence(kw: str, sentence: str) -> bool:
    pattern = re.compile(re.escape(kw), re.IGNORECASE)
    return bool(pattern.search(sentence))


def _match_patterns(sentence: str, a: str, b: str) -> list[tuple[str, float]]:
    """Return list of (relation_type, confidence) for patterns matching a and b in sentence."""
    matches = []
    a_esc = re.escape(a)
    b_esc = re.escape(b)
    for template, rel_type, base_conf in SENTENCE_PATTERNS:
        # Try A→B
        pat_str = template.replace("{A}", a_esc).replace("{B}", b_esc)
        with contextlib.suppress(re.error):
            if re.search(pat_str, sentence, re.IGNORECASE):
                matches.append((rel_type, base_conf))
                continue
        # Try B→A (symmetric relation types only)
        pat_str2 = template.replace("{A}", b_esc).replace("{B}", a_esc)
        with contextlib.suppress(re.error):
            if re.search(pat_str2, sentence, re.IGNORECASE) and rel_type in ("equivalent", "related_to", "affects"):
                matches.append((rel_type, base_conf))
    return matches


def extract_relations(sections: dict, keywords: list[dict]) -> list[dict]:
    """
    Return list of {source_name, relation_type, target_name, confidence, evidence_text, source_section}.
    """
    if len(keywords) < 2:
        return []

    kw_names = [k["normalized_name"] for k in keywords]
    results: list[dict] = []
    seen: set[tuple] = set()

    # --- Title-level co-occurrence (fast structural check) ---
    title = sections.get("title", "")
    if title:
        title_kws = [kw for kw in kw_names if _keyword_in_sentence(kw, title)]
        for i, a in enumerate(title_kws):
            for b in title_kws[i + 1:]:
                matches = _match_patterns(title, a, b) or [("related_to", _COOCCUR_CONF["title"])]
                for rel, conf in matches:
                    key = (a.lower(), rel, b.lower())
                    if key not in seen:
                        seen.add(key)
                        results.append({
                            "source_name": a, "relation_type": rel,
                            "target_name": b,
                            "confidence": round(conf * SECTION_CONFIDENCE.get("title", 0.9), 3),
                            "evidence_text": title, "source_section": "title",
                        })

    # --- Process each section ---
    for section_name, text in sections.items():
        if section_name in ("title", "author_keywords") or not text:
            continue
        base_conf = SECTION_CONFIDENCE.get(section_name, 0.60)
        sentences = _split_sentences(str(text))

        for sentence in sentences:
            if len(sentence) < 15:
                continue
            # Find which keywords appear in this sentence
            present = [kw for kw in kw_names if _keyword_in_sentence(kw, sentence)]
            if len(present) < 2:
                continue

            for i, a in enumerate(present):
                for b in present[i + 1:]:
                    if a.lower() == b.lower():
                        continue
                    matches = _match_patterns(sentence, a, b)
                    if not matches:
                        # Co-occurrence fallback only for high-value sections
                        if section_name not in _COOCCUR_SECTIONS:
                            continue
                        matches = [("related_to", _COOCCUR_CONF.get(section_name, 0.45))]

                    for rel, conf in matches:
                        key = (a.lower(), rel, b.lower())
                        if key in seen:
                            continue
                        seen.add(key)
                        final_conf = round(conf * base_conf, 3)
                        results.append({
                            "source_name": a,
                            "relation_type": rel,
                            "target_name": b,
                            "confidence": final_conf,
                            "evidence_text": sentence.strip()[:400],
                            "source_section": section_name,
                        })

                    if len(results) >= MAX_RELATIONS:
                        return _sort_and_trim(results)

    return _sort_and_trim(results)


def _sort_and_trim(relations: list[dict]) -> list[dict]:
    # Sort: specific relations first, then by confidence descending
    relations.sort(key=lambda r: (r["relation_type"] == "related_to", -r["confidence"]))

    # Apply per-source cap (keep top MAX_PER_SOURCE by confidence for each source)
    source_count: dict[str, int] = {}
    filtered = []
    for r in relations:
        src = r["source_name"].lower()
        if source_count.get(src, 0) < MAX_PER_SOURCE:
            filtered.append(r)
            source_count[src] = source_count.get(src, 0) + 1

    return filtered[:MAX_RELATIONS]
