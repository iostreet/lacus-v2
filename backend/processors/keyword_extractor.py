"""
Keyword extraction using KeyBERT + spaCy (with graceful fallbacks).
"""

from __future__ import annotations
import re
from typing import Optional
from processors.domain_dict import CATEGORY_MAP, NORMALIZATION_MAP

_SCIENTIFIC_STOP_WORDS = [
    # generic academic / writing words
    "study", "research", "paper", "work", "method", "approach", "result",
    "results", "show", "shows", "showed", "shown", "found", "find",
    "investigated", "used", "using", "based", "due",
    "proposed", "present", "presented", "reported",
    "sample", "samples", "fig", "figure", "table", "et", "al", "author",
    "authors", "abstract", "introduction", "conclusion", "however",
    "therefore", "thus", "also", "well", "high", "low", "large", "small",
    "good", "better", "best", "new", "novel", "various", "different",
    "several", "many", "two", "three", "one", "first", "second", "third",
    "significantly", "relatively", "respectively",
    "approximately", "compared", "obtained", "achieved",
    # prepositions / connectors that slip through as "keywords"
    "through", "via", "using", "with", "from", "for", "into", "onto",
    "upon", "toward", "towards", "between", "among", "across", "along",
    "within", "without", "during", "under", "over", "before", "after",
    "while", "when", "where", "which", "that", "this", "these", "those",
    "both", "such", "each", "other", "than", "then", "there", "here",
    "been", "being", "have", "having", "could", "would", "should",
    # vague action words
    "enable", "enables", "enabled", "enhance", "enhances", "enhanced",
    "improve", "improves", "improved", "increase", "increases", "increased",
    "decrease", "decreases", "decreased", "exhibit", "exhibits", "exhibited",
    "demonstrate", "demonstrates", "demonstrated", "indicate", "indicates",
    "suggest", "suggests", "reveal", "reveals", "provide", "provides",
    "achieve", "achieves", "observed", "observe", "utilize", "utilizes",
]

# ---------------------------------------------------------------------------
# Lazy-load heavy NLP models
# ---------------------------------------------------------------------------
_keybert_model: Optional[object] = None
_spacy_nlp: Optional[object] = None
_spacy_available = False


def _get_keybert():
    global _keybert_model
    if _keybert_model is None:
        try:
            from keybert import KeyBERT
            _keybert_model = KeyBERT(model="allenai-specter")
        except Exception:
            _keybert_model = None
    return _keybert_model


def _get_spacy():
    global _spacy_nlp, _spacy_available
    if _spacy_nlp is None and not _spacy_available:
        for model_name in ("en_core_sci_sm", "en_core_web_sm", "en_core_web_md"):
            try:
                import spacy
                _spacy_nlp = spacy.load(model_name)
                _spacy_available = True
                break
            except Exception:
                continue
    return _spacy_nlp


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _normalize(text: str) -> str:
    lower = text.lower().strip()
    return NORMALIZATION_MAP.get(lower, text.strip())


def _classify(keyword: str) -> str:
    lower = keyword.lower()
    for key, cat in CATEGORY_MAP.items():
        if key in lower or lower in key:
            return cat
    return "Other"


# Words that make a keyword meaningless if it starts or ends with them
_BOUNDARY_WORDS = {
    "a", "an", "the", "and", "or", "but", "nor", "so", "yet",
    "in", "on", "at", "to", "of", "by", "as", "is", "be",
    "it", "its", "for", "up", "do", "if", "no", "not",
    "via", "with", "from", "into", "onto", "upon", "over",
    "that", "this", "which", "than", "then", "when",
}

_BOUNDARY_RE = re.compile(
    r"^(?:" + "|".join(re.escape(w) for w in sorted(_BOUNDARY_WORDS, key=len, reverse=True)) + r")\s+"
    r"|"
    r"\s+(?:" + "|".join(re.escape(w) for w in sorted(_BOUNDARY_WORDS, key=len, reverse=True)) + r")$",
    re.IGNORECASE,
)


def _clean_phrase(phrase: str) -> str:
    phrase = re.sub(r"[^\w\s\-/()°μ]", "", phrase)
    phrase = phrase.strip()
    # Repeatedly strip leading/trailing boundary words
    while True:
        stripped = _BOUNDARY_RE.sub("", phrase).strip()
        if stripped == phrase:
            break
        phrase = stripped
    return phrase


# ---------------------------------------------------------------------------
# KeyBERT extraction
# ---------------------------------------------------------------------------
def _keybert_keywords(text: str, top_n: int = 20) -> list[dict]:
    kw_model = _get_keybert()
    if kw_model is None:
        return []
    try:
        results = kw_model.extract_keywords(
            text,
            keyphrase_ngram_range=(1, 3),
            stop_words=_SCIENTIFIC_STOP_WORDS,
            top_n=top_n,
            use_mmr=True,
            diversity=0.6,
        )
        return [{"keyword": kw, "confidence": float(score)} for kw, score in results]
    except Exception:
        return []


# ---------------------------------------------------------------------------
# spaCy noun-phrase extraction
# ---------------------------------------------------------------------------
def _spacy_keywords(text: str) -> list[dict]:
    nlp = _get_spacy()
    if nlp is None:
        return []
    try:
        doc = nlp(text[:100_000])  # guard against huge texts
        phrases: dict[str, int] = {}
        for chunk in doc.noun_chunks:
            t = chunk.text.lower().strip()
            if 2 < len(t) < 60:
                phrases[t] = phrases.get(t, 0) + 1
        total = max(sum(phrases.values()), 1)
        return [
            {"keyword": k, "confidence": round(min(cnt / total * 5, 0.9), 2)}
            for k, cnt in sorted(phrases.items(), key=lambda x: -x[1])[:30]
        ]
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Regex fallback: simple multi-word capitalised phrase extraction
# ---------------------------------------------------------------------------
def _regex_keywords(text: str) -> list[dict]:
    found: dict[str, int] = {}
    # Capitalised multi-word terms
    for m in re.finditer(r"\b([A-Z][a-zA-Z\-]+(?:\s+[a-zA-Z\-]+){0,3})\b", text):
        t = m.group(1).strip()
        if 3 < len(t) < 60 and not t.isupper():
            found[t] = found.get(t, 0) + 1
    # Known domain terms
    for key in CATEGORY_MAP:
        if re.search(re.escape(key), text, re.IGNORECASE):
            found[key] = found.get(key, 0) + 3
    total = max(sum(found.values()), 1)
    return [
        {"keyword": k, "confidence": round(min(cnt / total * 4, 0.85), 2)}
        for k, cnt in sorted(found.items(), key=lambda x: -x[1])[:25]
    ]


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def extract_keywords(sections: dict) -> list[dict]:
    """
    Return list of {keyword_name, normalized_name, category, confidence}.
    sections: dict with keys like 'abstract', 'title', 'conclusion', etc.
    """
    # Build weighted text blocks
    priority_text = " ".join(filter(None, [
        sections.get("title", ""),
        sections.get("abstract", ""),
        " ".join(sections.get("author_keywords", []) if isinstance(sections.get("author_keywords"), list) else []),
        sections.get("conclusion", ""),
    ]))
    body_text = " ".join(filter(None, [
        sections.get("introduction", ""),
        sections.get("results", ""),
        sections.get("methods", ""),
    ]))
    full_text = (priority_text + " " + body_text).strip()

    # Collect candidates from all sources
    candidates: dict[str, float] = {}

    # Title-specific extraction: run KeyBERT on title alone and boost confidence.
    # The title is the most information-dense sentence but contributes ~1% of the
    # total text mass, so its keyphrases would otherwise be under-weighted.
    title = sections.get("title", "")
    if title:
        for item in _keybert_keywords(title, top_n=10):
            kw = _clean_phrase(item["keyword"])
            if kw:
                boosted = min(item["confidence"] + 0.20, 0.95)
                candidates[kw.lower()] = max(candidates.get(kw.lower(), 0), boosted)

    for item in _keybert_keywords(priority_text or full_text):
        kw = _clean_phrase(item["keyword"])
        if kw:
            candidates[kw.lower()] = max(candidates.get(kw.lower(), 0), item["confidence"])

    for item in _spacy_keywords(priority_text or full_text):
        kw = _clean_phrase(item["keyword"])
        if kw:
            candidates[kw.lower()] = max(candidates.get(kw.lower(), 0), item["confidence"] * 0.85)

    # Ensure author-supplied keywords are included with high confidence
    for kw in (sections.get("author_keywords") or []):
        cl = kw.lower().strip()
        candidates[cl] = max(candidates.get(cl, 0), 0.90)

    # Fallback: regex only — normalize so best term reaches 0.72,
    # keeping all results above the 0.40 confidence filter in main.py
    if not candidates:
        regex_items = [(c := _clean_phrase(item["keyword"]), item["confidence"])
                       for item in _regex_keywords(priority_text or full_text)
                       if _clean_phrase(item["keyword"])]
        if regex_items:
            max_conf = max(c for _, c in regex_items) or 1
            for kw, conf in regex_items:
                candidates[kw.lower()] = 0.45 + (conf / max_conf) * 0.27

    # Build output list
    seen_normalized: set[str] = set()
    results = []
    for raw_kw, conf in sorted(candidates.items(), key=lambda x: -x[1])[:30]:
        display = _normalize(raw_kw)
        norm = display.lower()
        if norm in seen_normalized:
            continue
        seen_normalized.add(norm)
        cat = _classify(display)
        results.append({
            "keyword_name": display,
            "normalized_name": display,
            "category": cat,
            "confidence": round(conf, 3),
        })

    return results
