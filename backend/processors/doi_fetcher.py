"""
DOI-based paper metadata fetcher.
Primary: Semantic Scholar API → Fallback: CrossRef API.
Returns enriched metadata to supplement PDF extraction.
"""
from __future__ import annotations
import json
import re
import urllib.request
import urllib.parse

_HEADERS = {
    "User-Agent": "Lacus/2.0 (academic paper analysis; contact: research@lacus.io)",
    "Accept": "application/json",
}
_TIMEOUT = 10


def _clean_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _semantic_scholar(doi: str) -> dict:
    url = (
        "https://api.semanticscholar.org/graph/v1/paper/"
        f"DOI:{urllib.parse.quote(doi)}"
        "?fields=title,abstract,authors,year,venue"
    )
    try:
        req = urllib.request.Request(url, headers=_HEADERS)
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            data = json.loads(resp.read())
    except Exception:
        return {}

    out: dict = {}
    if data.get("abstract"):
        out["abstract"] = data["abstract"]
    if data.get("title"):
        out["title"] = data["title"]
    if data.get("authors"):
        out["authors"] = [a["name"] for a in data["authors"] if a.get("name")]
    if data.get("year"):
        out["year"] = str(data["year"])
    if data.get("venue"):
        out["journal"] = data["venue"]
    return out


def _crossref(doi: str) -> dict:
    url = f"https://api.crossref.org/works/{urllib.parse.quote(doi)}"
    try:
        req = urllib.request.Request(url, headers=_HEADERS)
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            data = json.loads(resp.read())
    except Exception:
        return {}

    item = data.get("message", {})
    out: dict = {}

    raw_abstract = item.get("abstract", "")
    if raw_abstract:
        cleaned = _clean_html(raw_abstract)
        if len(cleaned) > 80:
            out["abstract"] = cleaned

    titles = item.get("title", [])
    if titles:
        out["title"] = titles[0]

    authors = item.get("author", [])
    if authors:
        out["authors"] = [
            f"{a.get('given', '')} {a.get('family', '')}".strip()
            for a in authors
        ]

    published = item.get("published-print") or item.get("published-online") or {}
    parts = published.get("date-parts", [[]])
    if parts and parts[0]:
        out["year"] = str(parts[0][0])

    container = item.get("container-title", [])
    if container:
        out["journal"] = container[0]

    return out


def fetch_doi_content(doi: str) -> dict:
    """
    Fetch enriched paper metadata from DOI.
    Tries Semantic Scholar → CrossRef.
    Returns dict with any subset of: abstract, title, authors, year, journal.
    """
    if not doi:
        return {}

    doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", doi.strip())

    result = _semantic_scholar(doi)
    if result.get("abstract"):
        return result

    result2 = _crossref(doi)
    for k, v in result2.items():
        if k not in result or not result[k]:
            result[k] = v

    return result
