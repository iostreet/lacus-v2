"""
PDF text extraction via GROBID (primary) or pdfminer.six (fallback).
"""

import contextlib
import re
import xml.etree.ElementTree as ET

import requests

import os
GROBID_URL = os.environ.get("GROBID_URL", "http://localhost:8070")
TEI_NS = {"tei": "http://www.tei-c.org/ns/1.0"}

DOI_RE  = re.compile(r"\b(10\.\d{4,}/[^\s\"'<>]+)", re.IGNORECASE)
YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")


def _fix_garbled_text(text: str) -> str:
    """Collapse space-separated characters produced by some PDF renderers.
    e.g. 'S c i e n c e  A d v a n c e s' → 'Science Advances'
    Only triggers when >40 % of whitespace-delimited tokens are single chars.
    """
    words = text.split()
    if not words or sum(1 for w in words if len(w) == 1) / len(words) < 0.40:
        return text
    result: list[str] = []
    i = 0
    while i < len(words):
        if len(words[i]) == 1:
            run = [words[i]]
            j = i + 1
            while j < len(words) and len(words[j]) == 1:
                run.append(words[j])
                j += 1
            result.append("".join(run))
            i = j
        else:
            result.append(words[i])
            i += 1
    return " ".join(result)


# ---------------------------------------------------------------------------
# GROBID availability check
# ---------------------------------------------------------------------------
def check_grobid() -> bool:
    with contextlib.suppress(Exception):
        r = requests.get(f"{GROBID_URL}/api/isalive", timeout=10)
        return r.status_code == 200
    return False


# ---------------------------------------------------------------------------
# GROBID extraction
# ---------------------------------------------------------------------------
def _tei_text(elem) -> str:
    return "" if elem is None else " ".join(elem.itertext()).strip()


def extract_with_grobid(pdf_path: str) -> dict:
    with open(pdf_path, "rb") as f:
        resp = requests.post(
            f"{GROBID_URL}/api/processHeaderDocument",
            files={"input": f},
            data={"consolidateHeader": "1"},
            timeout=120,
        )
    resp.raise_for_status()
    return _parse_tei(resp.text)


def _parse_tei(xml_text: str) -> dict:
    root = ET.fromstring(xml_text)

    title = _tei_text(root.find(".//tei:titleStmt/tei:title", TEI_NS))

    authors = [
        name for author in root.findall(".//tei:analytic/tei:author", TEI_NS)
        if (name := f"{_tei_text(author.find('.//tei:forename', TEI_NS))} "
                    f"{_tei_text(author.find('.//tei:surname', TEI_NS))}".strip())
    ]

    doi = next(
        ((id_el.text or "").strip()
         for id_el in root.findall(".//tei:idno", TEI_NS)
         if id_el.get("type", "").lower() == "doi"),
        "",
    )
    if not doi:
        full_xml = ET.tostring(root, encoding="unicode")
        doi = m[1] if (m := DOI_RE.search(full_xml)) else ""

    journal = _tei_text(j_el) if (j_el := root.find(".//tei:monogr/tei:title", TEI_NS)) is not None else ""

    year = ""
    if (date_el := root.find(".//tei:publicationStmt/tei:date", TEI_NS)) is not None:
        year = m[0] if (m := YEAR_RE.search(date_el.get("when", ""))) else ""
    if not year:
        year = m[0] if (m := YEAR_RE.search(ET.tostring(root, encoding="unicode"))) else ""

    abstract = (
        " ".join(abs_el.itertext()).strip()
        if (abs_el := root.find(".//tei:profileDesc/tei:abstract", TEI_NS)) is not None
        else ""
    )
    abstract = _fix_garbled_text(abstract)

    sections: dict[str, str] = {}
    for div in root.findall(".//tei:body/tei:div", TEI_NS):
        head_el = div.find("tei:head", TEI_NS)
        head = _tei_text(head_el).lower() if head_el is not None else ""
        content = _fix_garbled_text(
            " ".join(_tei_text(p) for p in div.findall("tei:p", TEI_NS)).strip()
        )
        if "introduction" in head:
            sections["introduction"] = content
        elif "conclusion" in head or "summary" in head:
            sections["conclusion"] = content
        elif "result" in head or "discussion" in head:
            sections["results"] = content
        elif "method" in head or "experiment" in head or "material" in head:
            sections["methods"] = content

    keywords_listed = [
        t for kw in root.findall(".//tei:textClass/tei:keywords/tei:term", TEI_NS)
        if (t := _tei_text(kw))
    ]

    return {
        "title": title,
        "authors": authors,
        "doi": doi,
        "journal": journal,
        "year": year,
        "abstract": abstract,
        "sections": sections,
        "author_keywords": keywords_listed,
    }


# ---------------------------------------------------------------------------
# pdfminer fallback
# ---------------------------------------------------------------------------
def extract_with_fallback(pdf_path: str) -> dict:
    try:
        from pdfminer.high_level import extract_text
    except ImportError:
        return _empty_result()

    try:
        text = extract_text(pdf_path, page_numbers=[0, 1, 2])
    except Exception:
        try:
            text = extract_text(pdf_path)
        except Exception:
            return _empty_result()

    return _parse_plain_text(_fix_garbled_text(text))


def _empty_result() -> dict:
    return {
        "title": "", "authors": [], "doi": "", "journal": "",
        "year": "", "abstract": "", "sections": {}, "author_keywords": [],
    }


_META_SKIP = [
    re.compile(r'^\s*(vol\.?\s*\d|volume\s+\d|issue\s*\d|no\.?\s*\d|pp\.?\s*\d)', re.I),
    re.compile(r'\bdoi\s*:\s*10\.', re.I),
    re.compile(r'[©®]|copyright|all rights reserved|open access|license', re.I),
    re.compile(r'^\s*(received|accepted|published|available online|submitted|revised):?', re.I),
    re.compile(r'^\s*\d{1,5}\s*$'),
    re.compile(r'page\s+\d+\s+of\s+\d+', re.I),
    re.compile(r'@[a-zA-Z0-9._%+\-]+\.[a-zA-Z]{2,}'),
    re.compile(r'https?://', re.I),
    re.compile(r'^\s*(abstract|keywords?|index\s+terms?|introduction)\s*[:.]?\s*$', re.I),
    re.compile(r'^\s*\d+\s*\||\|\s*\d+\s*$'),
    re.compile(r'^\s*\d{4}\s*[-–]\s*\d{4}\s*$'),
]

_JOURNAL_HINTS = [
    re.compile(r'\bjournal\s+of\b', re.I),
    re.compile(r'\b(ACS\s+\w+|IEEE\s+\w+|RSC\s+\w+)\b'),
    re.compile(r'\b(Elsevier|Springer|Wiley|MDPI|Nature\s+\w+|Science\s+Advances)\b', re.I),
    re.compile(r'\b(Nano\s+Energy|Nano\s+Letters|Nanoscale|Nano\s+Today)\b', re.I),
    re.compile(r'\b(Advanced\s+Materials|Advanced\s+Energy|Small|Langmuir)\b', re.I),
    re.compile(r'\b(Physical\s+Review|Applied\s+Physics|Applied\s+Surface|Acta\s+Materialia)\b', re.I),
    re.compile(r'\b(Chemistry\s+of\s+Materials|Inorganic\s+Chemistry|Organic\s+Letters)\b', re.I),
    re.compile(r'\b(transactions|proceedings|letters|communications)\b.*\b(IEEE|ACS|RSC|Elsevier)\b', re.I),
]

_HEADER_END = re.compile(
    r'^\s*(abstract|1\.?\s*introduction|keywords?|index\s+terms?)\b', re.I
)


def _is_meta_line(line: str) -> bool:
    return any(p.search(line) for p in _META_SKIP)


def _looks_like_journal(line: str) -> bool:
    return len(line) < 120 and any(p.search(line) for p in _JOURNAL_HINTS)


def _has_weird_midword_caps(line: str) -> bool:
    """Detect Science-journal category headers with mid-word uppercase like 'ReseaRch aRticles'."""
    words = [w for w in line.split() if len(w) > 3]
    if not words:
        return False
    weird = sum(any(c.isupper() for c in w[1:]) and not w.isupper() for w in words)
    return weird / len(words) >= 0.5


def _parse_plain_text(text: str) -> dict:
    raw_lines = text.splitlines()
    lines = [l.strip() for l in raw_lines if l.strip()]
    header_lines = lines[:40]

    doi  = m[1].rstrip(".") if (m := DOI_RE.search(text)) else ""
    year = m[0] if (m := YEAR_RE.search(text[:3000])) else ""

    journal = ""
    title   = ""
    title_last_idx = -1
    for idx, line in enumerate(header_lines):
        if len(line) < 5:
            continue
        if _HEADER_END.match(line):
            break
        if _is_meta_line(line):
            continue
        if _looks_like_journal(line):
            journal = journal or line
            continue
        if _has_weird_midword_caps(line):
            continue
        if 15 <= len(line) <= 350:
            if line.isupper() and len(line) < 25:
                continue
            # Skip author lines (name + digit superscript)
            if re.search(r'[A-Za-z]\d[†*,]', line):
                if title:
                    break
                continue
            in_continuation = title_last_idx >= 0 and idx <= title_last_idx + 3
            if line[0].islower() and not in_continuation:
                continue
            if not title:
                title = line
                title_last_idx = idx
            elif in_continuation and line[-1] not in '.?!':
                title += " " + line
                # Do NOT update title_last_idx — window is fixed from first line
            else:
                break  # hit something after the title block, stop

    if m := re.search(
        r"(?:abstract|summary)[:\s]*\n?\s*(.+?)(?=\n\s*(?:1\s*\.?\s*introduction|keywords?|index\s+terms|graphical))",
        text, re.IGNORECASE | re.DOTALL,
    ):
        abstract = m[1].strip().replace("\n", " ")
    elif m := re.search(r'abstract\s*\n(.{100,2000})', text, re.IGNORECASE | re.DOTALL):
        abstract = m[1].strip().replace("\n", " ")[:2000]
    else:
        abstract = ""

    # Fallback: unlabeled abstract (Science/Nature format — paragraph right after author block)
    if not abstract:
        # Find the first author line (name + digit superscript within first 30 raw lines)
        first_author_line = -1
        for i, raw_line in enumerate(raw_lines[:30]):
            if re.search(r'[A-Z][a-z]+\s+[A-Z][a-z]+\d[\u2020*,]', raw_line):
                first_author_line = i
                break
        if first_author_line >= 0:
            # Find the first blank line after the author block
            blank_after_authors = -1
            for i in range(first_author_line, min(first_author_line + 20, len(raw_lines))):
                if not raw_lines[i].strip():
                    blank_after_authors = i
                    break
            if blank_after_authors >= 0:
                para: list[str] = []
                for raw_line in raw_lines[blank_after_authors + 1: blank_after_authors + 40]:
                    stripped = raw_line.strip()
                    if not stripped:
                        if para:
                            break
                        continue
                    if re.search(r'^\d+\w|\bCenter\b|\bDepartment\b|\bInstitute\b|\bUniversity\b|\bLaboratory\b', stripped):
                        continue
                    para.append(stripped)
                candidate = " ".join(para)
                if len(candidate) > 150:
                    abstract = candidate[:2000]

    # Editor’s summary fallback (Science journals)
    if not abstract:
        if m := re.search(r"Editor[‘’]s\s+summary\s*\n(.{100,1500})", text, re.IGNORECASE | re.DOTALL):
            abstract = m[1].strip().replace("\n", " ")[:2000]

    intro = (
        m[1].strip().replace("\n", " ")[:1500]
        if (m := re.search(
            r'(?:1\s*\.?\s*introduction|introduction)\s*\n(.+?)(?=\n\s*(?:2\s*\.|\bmethods?\b|\bmaterials?\b|\bexperiment))',
            text, re.IGNORECASE | re.DOTALL,
        )) else ""
    )

    conclusion = (
        m[1].strip().replace("\n", " ")[:3000]
        if (m := re.search(
            r'(?:conclusion[s]?|concluding\s+remarks?)[:\s\n]+(.+?)(?=\n\s*(?:references|bibliography|acknowledge|\d+\.\s*[A-Z]))',
            text, re.IGNORECASE | re.DOTALL,
        )) else ""
    )

    results = (
        m[1].strip().replace("\n", " ")[:2000]
        if (m := re.search(
            r'(?:results?\s+and\s+discussion|results?|discussion)[:\s\n]+(.+?)(?=\n\s*(?:conclusion|\d+\.\s*[A-Z]|discussion|references|bibliography))',
            text, re.IGNORECASE | re.DOTALL,
        )) else ""
    )

    authors: list[str] = []
    for line in header_lines:
        if _is_meta_line(line) or _looks_like_journal(line) or line == title:
            continue
        if (
            len(line) < 300
            and (re.search(r'\band\b', line, re.I) or line.count(',') >= 1)
            and not re.search(r'\d{4,}|\bUniversity\b|\bInstitute\b|\bDepartment\b|\bLaboratory\b', line, re.I)
        ):
            parts = [a.strip() for a in re.split(r',\s*|\s+and\s+', line, flags=re.I) if a.strip()]
            valid = [p for p in parts if re.match(r'^[A-Z][a-zA-Z.\-]+(\s+[A-Z][a-zA-Z.\-]+){0,3}$', p)]
            if valid:
                authors = valid
                break

    sections: dict[str, str] = {}
    if abstract:   sections["abstract"]     = abstract
    if intro:      sections["introduction"] = intro
    if results:    sections["results"]      = results
    if conclusion: sections["conclusion"]   = conclusion

    return {
        "title":    title,
        "authors":  authors,
        "doi":      doi,
        "journal":  journal,
        "year":     year,
        "abstract": abstract,
        "sections": sections,
        "author_keywords": [],
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def extract_paper_info(pdf_path: str) -> dict:
    if check_grobid():
        with contextlib.suppress(Exception):
            return extract_with_grobid(pdf_path)
    return extract_with_fallback(pdf_path)
