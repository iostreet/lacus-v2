"""
Keyword-phrase summary generator (no subject-verb sentences).
"""

from __future__ import annotations


def _pick(keywords: list[dict], category: str, n: int = 1) -> list[str]:
    matches = [k["normalized_name"] for k in keywords if k.get("category") == category]
    return matches[:n]


def generate_summaries(paper_info: dict, keywords: list[dict], relations: list[dict], metrics: list[dict]) -> list[dict]:
    summaries: list[dict] = []

    materials    = _pick(keywords, "Material", 3)
    structures   = _pick(keywords, "Structure", 2)
    properties   = _pick(keywords, "Property", 2)
    methods      = _pick(keywords, "Method", 2)
    applications = _pick(keywords, "Application", 2)

    # Main: category-tagged keyword phrases, no subject-verb
    parts = []
    if materials:    parts.append(f"Material: {' / '.join(materials[:2])}")
    if structures:   parts.append(f"Structure: {structures[0]}")
    if properties:   parts.append(f"Property: {properties[0]}")
    if methods:      parts.append(f"Method: {methods[0]}")
    if applications: parts.append(f"App: {applications[0]}")

    if parts:
        summaries.append({
            "summary_text": " | ".join(parts),
            "summary_type": "main",
            "confidence": 0.80,
        })

    # Relation-based: concise arrow notation
    high_conf = [r for r in relations if r["confidence"] > 0.60 and r["relation_type"] != "related_to"]
    for rel in high_conf[:6]:
        tag = rel["relation_type"].replace("_", " ")
        s   = f"{rel['source_name']}  →[{tag}]→  {rel['target_name']}"
        summaries.append({"summary_text": s, "summary_type": "relation_based", "confidence": round(rel["confidence"], 3)})

    # Metric-based: "name: value unit (condition)"
    for met in metrics[:5]:
        val = f"{met['value']} {met.get('unit', '')}".strip()
        s   = f"{met['metric_name']}: {val}"
        if met.get("condition"):
            s += f"  ({met['condition']})"
        summaries.append({"summary_text": s, "summary_type": "metric_based", "confidence": round(met.get("confidence", 0.65), 3)})

    return summaries
