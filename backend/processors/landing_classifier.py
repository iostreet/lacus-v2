"""
Landing-map classifier.

This module produces public map labels from paper content. The output is kept
separate from user-editable field/theme/concept values so the landing map stays
program-controlled while personal maps remain user-curated.
"""

from __future__ import annotations

import re
from collections import Counter

from processors.field_classifier import detect_field


_STOP = frozenset({
    "a", "an", "and", "as", "at", "based", "by", "for", "from", "high",
    "highly", "in", "into", "low", "new", "of", "on", "the", "to", "with",
    "using", "via", "study", "effect", "effects", "property", "properties",
    "performance", "material", "materials", "method", "results", "novel",
})

_THEME_ANCHORS = [
    "ferroelectric", "piezoelectric", "flexoelectric", "triboelectric",
    "dielectric", "multiferroic", "pyroelectric", "electrostrictive",
    "memory", "sensor", "actuator", "energy harvesting", "nanogenerator",
    "lead-free", "thin film", "nanomaterial", "polymer", "ceramic",
    "semiconductor", "photonic", "neuromorphic",
]

_CONCEPT_HINTS = [
    "memory", "diode", "sensor", "pressure sensor", "actuator",
    "lead-free", "nanomaterials", "thin film", "porous film",
    "mechanical switching", "polarization switching", "defect dipole",
    "oxygen vacancy", "storage density", "energy harvesting",
    "biosignal detection", "neuromorphic", "self-powered",
]

_MATERIAL_RE = re.compile(
    r"\b(?:AlScN|PVDF[- ]?TrFE|In2Se3|BaTiO3|PbTiO3|PZT|KNN|HfO2|Te|tellurium|"
    r"\(K,Na\)NbO3|barium titanate|aluminum scandium nitride)\b",
    re.IGNORECASE,
)


def _norm_space(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def _clean_label(text: str, *, lower: bool = True) -> str:
    text = _norm_space(re.sub(r"[^A-Za-z0-9+\-/().\s]", " ", text))
    words = [w for w in text.split() if w.lower() not in _STOP]
    text = " ".join(words[:5]).strip(" -/")
    return text.lower() if lower else text


def _keyword_names(keywords: list[dict] | list[str] | None) -> list[str]:
    names: list[str] = []
    for kw in keywords or []:
        if isinstance(kw, dict):
            name = kw.get("normalized_name") or kw.get("keyword_name") or kw.get("name") or ""
        else:
            name = str(kw)
        name = _norm_space(name)
        if name:
            names.append(name)
    return names


def _contains(text: str, phrase: str) -> bool:
    return phrase.lower() in text.lower()


def _pick_theme(title: str, abstract: str, keywords: list[str]) -> tuple[str, float]:
    text = f"{title} {' '.join(keywords)} {abstract}".lower()
    scores: Counter[str] = Counter()

    for anchor in _THEME_ANCHORS:
        if anchor in text:
            scores[anchor] += 5 if anchor in title.lower() else 3

    def boost(label: str, *terms: str) -> None:
        if all(term in text for term in terms):
            scores[label] += 8

    boost("ferroelectric memory", "ferroelectric", "memory")
    boost("ferroelectric sensor", "ferroelectric", "sensor")
    boost("piezoelectric sensor", "piezoelectric", "sensor")
    boost("lead-free piezoceramics", "lead-free", "piezo")
    boost("flexoelectric polarization", "flexoelectric", "polarization")
    boost("mechanical polarization switching", "mechanical", "polarization", "switching")
    boost("ferroelectric diode memory", "ferroelectric", "diode", "memory")

    if scores:
        label, score = scores.most_common(1)[0]
        return label, min(0.95, 0.55 + score / 20)

    for kw in keywords:
        cleaned = _clean_label(kw)
        if cleaned:
            return cleaned, 0.45

    return "general research", 0.25


def _pick_concept(title: str, abstract: str, keywords: list[str], theme: str) -> tuple[str, float]:
    text = f"{title} {' '.join(keywords)} {abstract}".lower()
    title_low = title.lower()
    material = ""
    if match := _MATERIAL_RE.search(f"{title} {' '.join(keywords)}"):
        material = _norm_space(match.group(0))

    hint_scores: Counter[str] = Counter()
    for hint in _CONCEPT_HINTS:
        if hint in text:
            hint_scores[hint] += 5 if hint in title_low else 3

    if material and hint_scores:
        if "diode" in text and "memory" in text:
            return _clean_label(f"{material} diode memory", lower=False), 0.90
        hint = hint_scores.most_common(1)[0][0]
        if hint not in material.lower():
            return _clean_label(f"{material} {hint}", lower=False), 0.86

    if "lead-free" in text:
        return "lead-free", 0.82
    if "nanomaterial" in text or "nanomaterials" in text or "nano" in title_low:
        return "nanomaterials", 0.72
    if hint_scores:
        hint, score = hint_scores.most_common(1)[0]
        return hint, min(0.88, 0.50 + score / 20)

    # Use the most specific keyword that is not merely the theme.
    for kw in sorted(keywords, key=len, reverse=True):
        cleaned = _clean_label(kw)
        if cleaned and cleaned not in theme and theme not in cleaned:
            return cleaned, 0.55

    # Fall back to a compact title phrase.
    title_phrase = _clean_label(title)
    return title_phrase or "general", 0.35


def classify_landing(sections: dict, keywords: list[dict] | list[str] | None = None) -> dict:
    title = _norm_space(sections.get("title") or "")
    abstract = _norm_space(sections.get("abstract") or "")
    author_keywords = _keyword_names(sections.get("author_keywords") or [])
    keyword_names = _keyword_names(keywords) or author_keywords

    field_name, field_conf, field_scores = detect_field({
        "title": title,
        "abstract": abstract,
        "author_keywords": keyword_names,
    })
    if not field_name or field_name == "Unknown":
        field_name = "Other Research"

    theme, theme_conf = _pick_theme(title, abstract, keyword_names)
    concept, concept_conf = _pick_concept(title, abstract, keyword_names, theme)

    return {
        "landing_field": field_name,
        "landing_theme": theme,
        "landing_concept": concept,
        "landing_classification_confidence": {
            "field": field_conf,
            "theme": round(theme_conf, 3),
            "concept": round(concept_conf, 3),
            "field_scores": field_scores,
        },
    }
