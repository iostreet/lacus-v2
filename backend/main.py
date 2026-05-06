"""
Lacus V2 — FastAPI backend (Supabase edition)
Run:  uvicorn main:app --reload --port 8000
"""
from __future__ import annotations

import contextlib
import hashlib
import threading
import json
import os
import shutil
import sys
from collections import defaultdict, Counter
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, File, Header, HTTPException, BackgroundTasks, UploadFile, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR     = Path(__file__).parent
PROJECT_DIR  = BASE_DIR.parent
FRONTEND_DIR = PROJECT_DIR / "frontend"
UPLOADS_DIR  = PROJECT_DIR / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)
sys.path.insert(0, str(BASE_DIR))

from supabase_client import SUPABASE_URL, SUPABASE_ANON_KEY, supabase_admin as _sa
from processors.grobid_client     import extract_paper_info, check_grobid
from processors.keyword_extractor import extract_keywords
from processors.metric_extractor  import extract_metrics
from processors.relation_extractor import extract_relations
from processors.summary_generator  import generate_summaries
from processors.field_classifier   import detect_field

# ── In-memory progress tracker ───────────────────────────────────────────────
_progress: dict[int, dict] = {}

# ── Visitor counter (Supabase-backed) ────────────────────────────────────────
_SUPABASE_URL_CONST = "https://pzodkufrnnjkbghyfwth.supabase.co"
_SUPABASE_ANON_CONST = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6b2RrdWZybm5qa2JnaHlmd3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMzg2ODAsImV4cCI6MjA5MjgxNDY4MH0.Z_WF2-VVFKTiGF2V4DEcabZYgdxeW_feO4eqcfu1rqU"
_SUPABASE_HEADERS = {"apikey": _SUPABASE_ANON_CONST, "Content-Type": "application/json"}

# Per-thread user token (set by get_current_user dependency, readable by _sb())
_thread_local = threading.local()

def _sb():
    """Return a postgrest client authenticated with the current thread's user JWT."""
    token = getattr(_thread_local, 'auth_token', '')
    return _sb_with(token)

def _sb_with(token: str):
    """Return a postgrest client authenticated with an explicit token (for background tasks)."""
    from postgrest import SyncPostgrestClient
    return SyncPostgrestClient(
        base_url=f"{_SUPABASE_URL_CONST}/rest/v1",
        headers={
            "apikey": _SUPABASE_ANON_CONST,
            "Authorization": f"Bearer {token}" if token else f"Bearer {_SUPABASE_ANON_CONST}",
        },
    )

def _increment_visitors() -> int:
    try:
        import httpx
        resp = httpx.post(
            f"{_SUPABASE_URL_CONST}/rest/v1/rpc/increment_visitor_count",
            headers=_SUPABASE_HEADERS,
            json={},
            timeout=5,
        )
        if resp.status_code == 200:
            return int(resp.json())
    except Exception:
        pass
    return 0

def _set_progress(paper_id: int, step: str, pct: int, error: str | None = None):
    _progress[paper_id] = {"step": step, "pct": pct, "error": error}

# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(title="Lacus API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/")
def root():
    landing = FRONTEND_DIR / "landing.html"
    if landing.exists():
        return FileResponse(str(landing))
    idx = FRONTEND_DIR / "index.html"
    if idx.exists():
        return FileResponse(str(idx))
    return {"message": "Lacus API running"}


@app.get("/app")
def app_page():
    idx = FRONTEND_DIR / "index.html"
    if idx.exists():
        return FileResponse(str(idx))
    return {"message": "App not found"}


@app.get("/board")
def board_page():
    b = FRONTEND_DIR / "board.html"
    if b.exists():
        return FileResponse(str(b))
    return {"message": "Board not found"}


@app.get("/features")
def features_page():
    f = FRONTEND_DIR / "features.html"
    if f.exists():
        return FileResponse(str(f))
    return {"message": "Features page not found"}


@app.get("/api/status")
def status():
    return {"grobid_available": check_grobid(), "version": "2.0.0"}


@app.get("/api/public/stats")
def public_stats():
    """Public stats for landing page — no auth required."""
    import httpx
    paper_count = 0
    member_count = 0
    try:
        resp = httpx.post(
            f"{_SUPABASE_URL_CONST}/rest/v1/rpc/get_public_stats",
            headers=_SUPABASE_HEADERS,
            json={},
            timeout=5,
        )
        if resp.status_code == 200:
            data = resp.json()
            paper_count = data.get("papers", 0)
            member_count = data.get("members", 0)
    except Exception:
        pass
    visitor_count = _increment_visitors()
    return {"visitors": visitor_count, "papers": paper_count, "members": member_count}


_LANDING_COLORS = ['#7c3aed','#0891b2','#059669','#d97706',
                   '#dc2626','#db2777','#2563eb','#65a30d']

@app.get("/api/public/landing-map")
def public_landing_map():
    """Aggregate all users' papers by field → theme → concept — no auth required."""
    try:
        papers = (_sa.table("papers")
                    .select("id,title,year,doi,journal,authors,field,theme,concept")
                    .execute().data or [])
    except Exception as e:
        return {"fields": [], "error": str(e)}

    def _cap(s: str) -> str:
        s = (s or "").strip()
        return s[0].upper() + s[1:] if s else s

    field_map: dict = {}
    for p in papers:
        fname   = _cap(p.get("field")   or "") or "Other Research"
        tname   = _cap(p.get("theme")   or "") or "General"
        cname   = _cap(p.get("concept") or "") or "General"
        doi     = (p.get("doi") or "").strip()
        field_map.setdefault(fname, {}).setdefault(tname, {}).setdefault(cname, []).append({
            "id":      p.get("id"),
            "title":   _cap(p.get("title") or "") or "Untitled",
            "year":    p.get("year"),
            "doi":     doi,
            "journal": (p.get("journal") or "").strip(),
            "authors": p.get("authors") or [],
        })

    def _count(d):
        return sum(len(v) for v in d.values()) if isinstance(list(d.values() or [{}])[0], list) else sum(_count(v) for v in d.values())

    result = []
    for fi, (fname, themes) in enumerate(sorted(field_map.items(), key=lambda x: -sum(
        sum(len(ps) for ps in t.values()) for t in x[1].values()
    ))):
        theme_list = []
        for tname, concepts in sorted(themes.items(), key=lambda x: -sum(len(ps) for ps in x[1].values())):
            concept_list = [
                {"name": cn, "paper_count": len(ps), "papers": ps[:30]}
                for cn, ps in sorted(concepts.items(), key=lambda x: -len(x[1]))
            ]
            theme_list.append({
                "name":          tname,
                "concept_count": len(concept_list),
                "paper_count":   sum(c["paper_count"] for c in concept_list),
                "concepts":      concept_list,
            })
        result.append({
            "id":          fname.lower().replace(" ", "-"),
            "name":        fname,
            "paper_count": sum(t["paper_count"] for t in theme_list),
            "theme_count": len(theme_list),
            "themes":      theme_list,
            "color":       _LANDING_COLORS[fi % len(_LANDING_COLORS)],
        })
    return {"fields": result}


@app.get("/api/public/doi-comments/{doi:path}")
def get_doi_comments(doi: str):
    """Get comments for a DOI — public."""
    try:
        rows = (_sb_with('').table("doi_comments")
                .select("id,doi,username,content,parent_comment_id,created_at")
                .eq("doi", doi).order("created_at").execute().data or [])
        return {"comments": rows}
    except Exception as e:
        return {"comments": [], "error": str(e)}


@app.get("/api/public/recent-doi-comments")
def recent_doi_comments():
    """Latest 8 DOI comments for landing page."""
    try:
        rows = (_sb_with('').table("doi_comments")
                .select("id,doi,username,content,created_at")
                .order("created_at", desc=True).limit(8).execute().data or [])
        return {"comments": rows}
    except Exception as e:
        return {"comments": [], "error": str(e)}


# ── Auth dependency ──────────────────────────────────────────────────────────
def get_current_user(authorization: str = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization[7:]
    try:
        import httpx
        resp = httpx.get(
            f"{_SUPABASE_URL_CONST}/auth/v1/user",
            headers={"apikey": _SUPABASE_ANON_CONST, "Authorization": f"Bearer {token}"},
            timeout=10,
        )
        if resp.status_code == 200:
            user_id = resp.json().get("id")
            if user_id:
                _thread_local.auth_token = token
                return str(user_id)
    except Exception:
        pass
    raise HTTPException(status_code=401, detail="Invalid or expired token")


class DoiCommentCreate(BaseModel):
    doi:               str
    content:           str
    parent_comment_id: Optional[str] = None


@app.post("/api/doi-comments")
def post_doi_comment(body: DoiCommentCreate, user_id: str = Depends(get_current_user)):
    import httpx as _httpx
    try:
        resp = _httpx.get(
            f"{_SUPABASE_URL_CONST}/auth/v1/user",
            headers={"apikey": _SUPABASE_ANON_CONST,
                     "Authorization": f"Bearer {getattr(_thread_local, 'auth_token', '')}"},
            timeout=8,
        )
        u = resp.json() if resp.status_code == 200 else {}
        meta = u.get("user_metadata") or {}
        username = (meta.get("username") or meta.get("name") or meta.get("full_name")
                   or (u.get("email", "").split("@")[0]) or "Anonymous")
    except Exception:
        username = "Anonymous"

    sb = _sb()
    row = sb.table("doi_comments").insert({
        "doi":               body.doi.strip(),
        "user_id":           user_id,
        "username":          username,
        "content":           body.content.strip(),
        "parent_comment_id": body.parent_comment_id or None,
    }).execute().data
    return {"comment": row[0] if row else {}}


@app.delete("/api/doi-comments/{comment_id}")
def delete_doi_comment(comment_id: str, user_id: str = Depends(get_current_user)):
    _sb().table("doi_comments").delete().eq("id", comment_id).eq("user_id", user_id).execute()
    return {"ok": True}


# ── Pydantic schemas ─────────────────────────────────────────────────────────
class KeywordUpdate(BaseModel):
    keyword_name:    Optional[str]   = None
    normalized_name: Optional[str]   = None
    category:        Optional[str]   = None
    confidence:      Optional[float] = None

class KeywordCreate(BaseModel):
    keyword_name:    str
    normalized_name: Optional[str] = None
    category:        str   = "Other"
    confidence:      float = 0.7

class MetricCreate(BaseModel):
    metric_name: str
    value:       str
    unit:        Optional[str] = ""
    condition:   Optional[str] = ""
    confidence:  float = 0.7

class RelationCreate(BaseModel):
    source_name:    str
    relation_type:  str
    target_name:    str
    confidence:     Optional[float] = 0.5
    evidence_text:  Optional[str]   = None
    source_section: Optional[str]   = None

class RelationUpdate(BaseModel):
    source_name:   Optional[str]   = None
    relation_type: Optional[str]   = None
    target_name:   Optional[str]   = None
    confidence:    Optional[float] = None
    evidence_text: Optional[str]   = None

class MetricUpdate(BaseModel):
    metric_name: Optional[str]   = None
    value:       Optional[str]   = None
    unit:        Optional[str]   = None
    condition:   Optional[str]   = None
    confidence:  Optional[float] = None

class PaperUpdate(BaseModel):
    title:            Optional[str]   = None
    authors:          Optional[str]   = None
    doi:              Optional[str]   = None
    journal:          Optional[str]   = None
    year:             Optional[str]   = None
    abstract:         Optional[str]   = None
    relevance:        Optional[int]   = None
    memo:             Optional[str]   = None
    field:            Optional[str]   = None
    field_confidence: Optional[float] = None

class ReorderItem(BaseModel):
    id:    int
    order: int

class SummaryUpdate(BaseModel):
    summary_text: str

class MapPositionItem(BaseModel):
    node_id:  str
    pos_x:    float
    pos_y:    float
    expanded: int = 0

class CustomNodeCreate(BaseModel):
    label:       str
    category:    str   = "Custom"
    description: str   = ""
    color:       str   = "#94a3b8"
    pos_x:       float = 100.0
    pos_y:       float = 100.0

class CustomNodeUpdate(BaseModel):
    label:       Optional[str]   = None
    category:    Optional[str]   = None
    description: Optional[str]   = None
    color:       Optional[str]   = None
    pos_x:       Optional[float] = None
    pos_y:       Optional[float] = None

class MapEdgeCreate(BaseModel):
    source_id:     str
    target_id:     str
    relation_type: str = "related_to"
    label:         str = ""

class MapEdgeUpdate(BaseModel):
    relation_type: Optional[str] = None
    label:         Optional[str] = None

class ConfirmReviewKw(BaseModel):
    id:       int
    category: str
    include:  bool = True

class ConfirmReview(BaseModel):
    field:    Optional[str] = None
    keywords: list[ConfirmReviewKw] = []
    theme:    Optional[str] = None
    concept:  Optional[str] = None

class ThemeConceptBody(BaseModel):
    theme:   Optional[str] = None
    concept: Optional[str] = None

class MapGroupCreate(BaseModel):
    name:      str
    color:     str        = '#334155'
    paper_ids: list[int]  = []

class MapGroupUpdate(BaseModel):
    name:      Optional[str]       = None
    color:     Optional[str]       = None
    paper_ids: Optional[list[int]] = None


# ── Helpers ───────────────────────────────────────────────────────────────────
def _hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _paper_to_dict(p: dict) -> dict:
    try:
        authors = json.loads(p.get("authors") or "[]")
        if not isinstance(authors, list):
            raise ValueError
    except (json.JSONDecodeError, ValueError):
        authors = [a.strip() for a in (p.get("authors") or "").split(",") if a.strip()]
    return {
        "id":               p["id"],
        "title":            p.get("title")    or "",
        "authors":          authors,
        "doi":              p.get("doi")      or "",
        "journal":          p.get("journal")  or "",
        "year":             p.get("year")     or "",
        "abstract":         p.get("abstract") or "",
        "pdf_path":         p.get("pdf_path") or "",
        "status":           p.get("status", "draft"),
        "created_at":       str(p.get("created_at", "")),
        "relevance":        p.get("relevance") or 0,
        "memo":             p.get("memo")      or "",
        "field":            p.get("field"),
        "field_confidence": p.get("field_confidence"),
        "field_scores":     p.get("field_scores") or {},
    }


def _kw_to_dict(k: dict) -> dict:
    return {
        "id":              k["id"],
        "paper_id":        k["paper_id"],
        "keyword_name":    k.get("keyword_name")    or "",
        "normalized_name": k.get("normalized_name") or "",
        "category":        k.get("category")        or "Other",
        "confidence":      k.get("confidence")      or 0.0,
        "display_order":   k.get("display_order")   or 0,
    }


def _rel_to_dict(r: dict) -> dict:
    return {
        "id":                r["id"],
        "paper_id":          r["paper_id"],
        "source_name":       r.get("source_name")       or "",
        "relation_type":     r.get("relation_type")     or "",
        "target_name":       r.get("target_name")       or "",
        "confidence":        r.get("confidence")        or 0.0,
        "evidence_text":     r.get("evidence_text")     or "",
        "source_section":    r.get("source_section")    or "",
        "source_keyword_id": r.get("source_keyword_id"),
        "target_keyword_id": r.get("target_keyword_id"),
        "display_order":     r.get("display_order")     or 0,
    }


def _met_to_dict(m: dict) -> dict:
    return {
        "id":                m["id"],
        "paper_id":          m["paper_id"],
        "metric_name":       m.get("metric_name")       or "",
        "value":             m.get("value")             or "",
        "unit":              m.get("unit")              or "",
        "condition":         m.get("condition")         or "",
        "confidence":        m.get("confidence")        or 0.0,
        "linked_keyword_id": m.get("linked_keyword_id"),
        "display_order":     m.get("display_order")     or 0,
    }


def _sum_to_dict(s: dict) -> dict:
    return {
        "id":           s["id"],
        "paper_id":     s["paper_id"],
        "summary_text": s.get("summary_text") or "",
        "summary_type": s.get("summary_type") or "",
        "confidence":   s.get("confidence")   or 0.0,
    }


def _find_keyword_id(paper_id: int, name: str) -> Optional[int]:
    res = _sb().table("keywords").select("id").eq("paper_id", paper_id).ilike("normalized_name", name).limit(1).execute()
    return res.data[0]["id"] if res.data else None


def _assert_paper_owner(paper_id: int, user_id: str):
    res = _sb().table("papers").select("id").eq("id", paper_id).eq("user_id", user_id).execute()
    if not res.data:
        raise HTTPException(404, "Paper not found")


# ── Background analysis ───────────────────────────────────────────────────────
def _run_analysis(paper_id: int, user_id: str, pdf_path: str, orig_filename: str, token: str = ""):
    sb = _sb_with(token)
    try:
        _set_progress(paper_id, "Extracting text from PDF…", 10)
        info = extract_paper_info(pdf_path)

        title = (info.get("title") or "").strip() or orig_filename.replace(".pdf", "")
        update = {
            "title":   title,
            "authors": json.dumps(info.get("authors", [])),
            "doi":     info.get("doi", ""),
            "journal": info.get("journal", ""),
            "year":    info.get("year", ""),
        }
        sb.table("papers").update(update).eq("id", paper_id).execute()

        if info.get("doi"):
            _set_progress(paper_id, "Fetching metadata from web…", 20)
            with contextlib.suppress(Exception):
                from processors.doi_fetcher import fetch_doi_content
                web = fetch_doi_content(info["doi"])
                patch = {}
                if web.get("abstract") and len(web["abstract"]) > len(info.get("abstract", "")):
                    info["abstract"] = web["abstract"]
                if web.get("title") and title == orig_filename.replace(".pdf", ""):
                    patch["title"] = web["title"]
                    title = web["title"]
                if web.get("authors") and not json.loads(update["authors"]):
                    patch["authors"] = json.dumps(web["authors"])
                if web.get("journal") and not update["journal"]:
                    patch["journal"] = web["journal"]
                if web.get("year") and not update["year"]:
                    patch["year"] = web["year"]
                if patch:
                    sb.table("papers").update(patch).eq("id", paper_id).execute()

        sections = {
            **info.get("sections", {}),
            "title":           title,
            "abstract":        info.get("abstract", ""),
            "author_keywords": info.get("author_keywords", []),
        }

        # Step 2 — Keywords
        _set_progress(paper_id, "Matching ontology dictionaries…", 30)
        kw_data = [kw for kw in extract_keywords(sections) if kw.get("confidence", 0) > 0.40]
        kw_id_map: dict[str, int] = {}
        for kw in kw_data:
            res = sb.table("keywords").insert({
                "paper_id":        paper_id,
                "keyword_name":    kw["keyword_name"],
                "normalized_name": kw["normalized_name"],
                "category":        kw["category"],
                "confidence":      kw["confidence"],
                "display_order":   0,
            }).execute()
            if res.data:
                kw_id_map[kw["normalized_name"].lower()] = res.data[0]["id"]

        # Step 3b — Field detection
        _set_progress(paper_id, "Detecting research field…", 42)
        try:
            field_name, field_conf, field_scores = detect_field(sections)
            sb.table("papers").update({
                "field":            field_name,
                "field_confidence": field_conf,
                "field_scores":     field_scores,
            }).eq("id", paper_id).execute()
        except Exception:
            pass  # non-critical — don't abort pipeline

        # Step 4 — Metrics
        _set_progress(paper_id, "Extracting metrics & classifying categories…", 52)
        for met in extract_metrics(sections):
            sb.table("metrics").insert({
                "paper_id":    paper_id,
                "metric_name": met["metric_name"],
                "value":       met["value"],
                "unit":        met.get("unit", ""),
                "condition":   met.get("condition", ""),
                "confidence":  met["confidence"],
                "display_order": 0,
            }).execute()

        # Step 5 — Relations
        _set_progress(paper_id, "Calculating confidence scores…", 70)
        for rel in extract_relations(sections, kw_data):
            sb.table("relations").insert({
                "paper_id":          paper_id,
                "source_keyword_id": kw_id_map.get(rel["source_name"].lower()),
                "source_name":       rel["source_name"],
                "relation_type":     rel["relation_type"],
                "target_keyword_id": kw_id_map.get(rel["target_name"].lower()),
                "target_name":       rel["target_name"],
                "confidence":        rel["confidence"],
                "evidence_text":     rel.get("evidence_text", ""),
                "source_section":    rel.get("source_section", ""),
                "display_order":     0,
            }).execute()

        # Step 6 — Summaries
        _set_progress(paper_id, "Generating key findings…", 88)
        kws  = (sb.table("keywords").select("*").eq("paper_id", paper_id).execute().data or [])
        rels = (sb.table("relations").select("*").eq("paper_id", paper_id).execute().data or [])
        mets = (sb.table("metrics").select("*").eq("paper_id", paper_id).execute().data or [])

        for s in generate_summaries(info, kws, rels, mets):
            sb.table("summaries").insert({
                "paper_id":     paper_id,
                "summary_text": s["summary_text"],
                "summary_type": s["summary_type"],
                "confidence":   s["confidence"],
            }).execute()

        # Step 7 — Auto-assign Theme/Concept
        try:
            title_low = title.lower()
            kw_text   = " ".join(
                (kw.get("normalized_name") or kw.get("keyword_name") or "")
                for kw in kw_data
            ).lower()
            # Use spaces between repetitions so multi-word patterns stay intact
            text_low  = f"{title_low} {title_low} {title_low} {kw_text} {kw_text}"
            t_scores: dict[str, int] = {}
            for pattern, theme_name in _THEME_RULES.items():
                if pattern in text_low:
                    loc  = 5 if pattern in title_low else (4 if pattern in kw_text else 1)
                    freq = min(4, text_low.count(pattern))
                    t_scores[theme_name] = t_scores.get(theme_name, 0) + loc + freq
            c_scores: dict[str, float] = {}
            for kw in kw_data:
                name = (kw.get("normalized_name") or kw.get("keyword_name") or "").strip()
                if len(name) >= 4 and not any(g == name.lower() for g in _GENERIC_WORDS):
                    c_scores[name] = max(c_scores.get(name, 0.0), float(kw.get("confidence") or 0.5))
            auto_update: dict = {}
            if t_scores:
                auto_update["theme"]   = max(t_scores, key=t_scores.get)  # type: ignore[arg-type]
            if c_scores:
                auto_update["concept"] = max(c_scores, key=c_scores.get)  # type: ignore[arg-type]
            if auto_update:
                sb.table("papers").update(auto_update).eq("id", paper_id).execute()
        except Exception as step7_err:
            # Log but don't abort — columns may not exist yet in the DB
            print(f"[warn] Step 7 theme/concept auto-assign failed for paper {paper_id}: {step7_err}")

        sb.table("papers").update({"status": "pending_review"}).eq("id", paper_id).execute()
        _set_progress(paper_id, "Ready to review…", 100)

    except Exception as exc:
        with contextlib.suppress(Exception):
            sb.table("papers").update({"status": "error"}).eq("id", paper_id).execute()
        _set_progress(paper_id, f"Error: {exc}", -1, error=str(exc))


# ── Review endpoints ──────────────────────────────────────────────────────────

@app.get("/api/papers/{paper_id}/review")
def get_review(paper_id: int, user_id: str = Depends(get_current_user)):
    """Return field + extracted keywords for the post-analysis review modal."""
    sb = _sb()
    paper = (sb.table("papers")
               .select("*")
               .eq("id", paper_id).execute().data or [None])[0]
    if not paper or paper["user_id"] != user_id:
        raise HTTPException(404)
    kws = (sb.table("keywords").select("*")
             .eq("paper_id", paper_id)
             .order("confidence", desc=True)
             .execute().data or [])
    return {
        "paper_id":         paper_id,
        "title":            paper.get("title") or "",
        "field":            paper.get("field"),
        "field_confidence": paper.get("field_confidence"),
        "field_scores":     paper.get("field_scores") or {},
        "keywords":         [_kw_to_dict(k) for k in kws],
        "theme":            paper.get("theme"),
        "concept":          paper.get("concept"),
    }


@app.post("/api/papers/{paper_id}/confirm")
def confirm_review(paper_id: int, body: ConfirmReview, user_id: str = Depends(get_current_user)):
    """Apply user edits from the review modal and mark paper as confirmed."""
    sb = _sb()
    paper = (sb.table("papers").select("id, user_id")
               .eq("id", paper_id).execute().data or [None])[0]
    if not paper or paper["user_id"] != user_id:
        raise HTTPException(404)

    meta: dict = {}
    if body.field   is not None: meta["field"]   = body.field
    if body.theme   is not None: meta["theme"]   = body.theme
    if body.concept is not None: meta["concept"] = body.concept
    if meta:
        sb.table("papers").update(meta).eq("id", paper_id).execute()

    for kw in body.keywords:
        if not kw.include:
            with contextlib.suppress(Exception):
                sb.table("relations").update({"source_keyword_id": None}).eq("source_keyword_id", kw.id).execute()
            with contextlib.suppress(Exception):
                sb.table("relations").update({"target_keyword_id": None}).eq("target_keyword_id", kw.id).execute()
            with contextlib.suppress(Exception):
                sb.table("keywords").delete().eq("id", kw.id).execute()
        else:
            sb.table("keywords").update({"category": kw.category}).eq("id", kw.id).execute()

    sb.table("papers").update({"status": "confirmed"}).eq("id", paper_id).execute()
    return {"ok": True}


# ── Import (upload) endpoint ──────────────────────────────────────────────────
@app.post("/api/papers/upload")
async def upload_paper(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user),
    authorization: str = Header(None),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted.")

    upload_token = authorization[7:] if authorization and authorization.startswith("Bearer ") else ""
    tmp_path = UPLOADS_DIR / file.filename
    with open(tmp_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    pdf_hash = _hash_file(tmp_path)

    dup = _sb_with(upload_token).table("papers").select("id").eq("user_id", user_id).eq("pdf_hash", pdf_hash).execute()
    if dup.data:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(409, f"This PDF is already in your library (paper id={dup.data[0]['id']}).")

    final_path = UPLOADS_DIR / f"{pdf_hash[:16]}.pdf"
    shutil.move(str(tmp_path), str(final_path))

    res = _sb_with(upload_token).table("papers").insert({
        "user_id":  user_id,
        "title":    file.filename.replace(".pdf", ""),
        "pdf_path": str(final_path),
        "pdf_hash": pdf_hash,
        "status":   "processing",
    }).execute()

    if not res.data:
        final_path.unlink(missing_ok=True)
        raise HTTPException(500, "DB insert failed")

    paper_id = res.data[0]["id"]
    _set_progress(paper_id, "Queued for analysis…", 5)
    background_tasks.add_task(_run_analysis, paper_id, user_id, str(final_path), file.filename, upload_token)
    return {"paper_id": paper_id, "status": "processing"}


@app.get("/api/papers/{paper_id}/progress")
def get_progress(paper_id: int, user_id: str = Depends(get_current_user)):
    prog = _progress.get(paper_id)
    if prog is None:
        res = _sb().table("papers").select("status").eq("id", paper_id).eq("user_id", user_id).execute()
        if res.data:
            s = res.data[0]["status"]
            if s == "confirmed": return {"step": "Analysis complete!", "pct": 100, "error": None}
            if s == "error":     return {"step": "Analysis failed.",   "pct": -1,  "error": "see logs"}
        return {"step": "Waiting…", "pct": 0, "error": None}
    return prog


# ── Papers CRUD ───────────────────────────────────────────────────────────────
@app.get("/api/papers")
def list_papers(user_id: str = Depends(get_current_user)):
    res = _sb().table("papers").select("*, summaries(summary_text, summary_type)").eq("user_id", user_id).order("created_at", desc=True).execute()
    result = []
    for p in (res.data or []):
        d = _paper_to_dict(p)
        sums = p.get("summaries") or []
        main = next((s for s in sums if s["summary_type"] == "main"), None)
        d["one_liner"] = main["summary_text"] if main else ""
        result.append(d)
    return result


@app.get("/api/papers/{paper_id}")
def get_paper(paper_id: int, user_id: str = Depends(get_current_user)):
    res = _sb().table("papers").select("*").eq("id", paper_id).eq("user_id", user_id).execute()
    if not res.data:
        raise HTTPException(404, "Paper not found")
    return _paper_to_dict(res.data[0])


@app.put("/api/papers/{paper_id}")
def update_paper(paper_id: int, data: PaperUpdate, user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    patch = {k: v for k, v in data.model_dump().items() if v is not None}
    if "relevance" in patch:
        patch["relevance"] = max(0, min(5, patch["relevance"]))
    _sb().table("papers").update(patch).eq("id", paper_id).execute()
    return get_paper(paper_id, user_id)


@app.delete("/api/papers/{paper_id}")
def delete_paper(paper_id: int, user_id: str = Depends(get_current_user)):
    res = _sb().table("papers").select("pdf_path").eq("id", paper_id).eq("user_id", user_id).execute()
    if not res.data:
        raise HTTPException(404, "Paper not found")
    pdf_path = res.data[0].get("pdf_path")
    _sb().table("papers").delete().eq("id", paper_id).execute()
    if pdf_path and Path(pdf_path).exists():
        Path(pdf_path).unlink(missing_ok=True)
    return {"deleted": paper_id}


# ── Keywords ──────────────────────────────────────────────────────────────────
@app.get("/api/papers/{paper_id}/keywords")
def get_keywords(paper_id: int, user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    res = _sb().table("keywords").select("*").eq("paper_id", paper_id).order("display_order").order("id").execute()
    return [_kw_to_dict(k) for k in (res.data or [])]


@app.post("/api/papers/{paper_id}/keywords/reorder")
def reorder_keywords(paper_id: int, items: list[ReorderItem], user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    for item in items:
        _sb().table("keywords").update({"display_order": item.order}).eq("id", item.id).eq("paper_id", paper_id).execute()
    return {"ok": True}


@app.post("/api/papers/{paper_id}/keywords")
def create_keyword(paper_id: int, data: KeywordCreate, user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    res = _sb().table("keywords").insert({
        "paper_id":        paper_id,
        "keyword_name":    data.keyword_name,
        "normalized_name": data.normalized_name or data.keyword_name,
        "category":        data.category,
        "confidence":      data.confidence,
    }).execute()
    return _kw_to_dict(res.data[0])


@app.put("/api/keywords/{kw_id}")
def update_keyword(kw_id: int, data: KeywordUpdate, user_id: str = Depends(get_current_user)):
    patch = {k: v for k, v in data.model_dump().items() if v is not None}
    _sb().table("keywords").update(patch).eq("id", kw_id).execute()
    res = _sb().table("keywords").select("*").eq("id", kw_id).execute()
    if not res.data:
        raise HTTPException(404, "Keyword not found")
    return _kw_to_dict(res.data[0])


@app.delete("/api/keywords/{kw_id}")
def delete_keyword(kw_id: int, user_id: str = Depends(get_current_user)):
    _sb().table("keywords").delete().eq("id", kw_id).execute()
    return {"deleted": kw_id}


# ── Relations ─────────────────────────────────────────────────────────────────
@app.get("/api/papers/{paper_id}/relations")
def get_relations(paper_id: int, user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    res = _sb().table("relations").select("*").eq("paper_id", paper_id).order("display_order").order("id").execute()
    return [_rel_to_dict(r) for r in (res.data or [])]


@app.post("/api/papers/{paper_id}/relations/reorder")
def reorder_relations(paper_id: int, items: list[ReorderItem], user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    for item in items:
        _sb().table("relations").update({"display_order": item.order}).eq("id", item.id).eq("paper_id", paper_id).execute()
    return {"ok": True}


@app.post("/api/papers/{paper_id}/relations")
def create_relation(paper_id: int, data: RelationCreate, user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    res = _sb().table("relations").insert({
        "paper_id":          paper_id,
        "source_keyword_id": _find_keyword_id(paper_id, data.source_name),
        "source_name":       data.source_name,
        "relation_type":     data.relation_type,
        "target_keyword_id": _find_keyword_id(paper_id, data.target_name),
        "target_name":       data.target_name,
        "confidence":        data.confidence,
        "evidence_text":     data.evidence_text,
        "source_section":    data.source_section,
    }).execute()
    return _rel_to_dict(res.data[0])


@app.put("/api/relations/{rel_id}")
def update_relation(rel_id: int, data: RelationUpdate, user_id: str = Depends(get_current_user)):
    res_cur = _sb().table("relations").select("paper_id").eq("id", rel_id).execute()
    if not res_cur.data:
        raise HTTPException(404, "Relation not found")
    paper_id = res_cur.data[0]["paper_id"]
    patch: dict = {}
    if data.source_name is not None:
        patch["source_name"]       = data.source_name
        patch["source_keyword_id"] = _find_keyword_id(paper_id, data.source_name)
    if data.target_name is not None:
        patch["target_name"]       = data.target_name
        patch["target_keyword_id"] = _find_keyword_id(paper_id, data.target_name)
    if data.relation_type is not None: patch["relation_type"] = data.relation_type
    if data.confidence    is not None: patch["confidence"]    = data.confidence
    if data.evidence_text is not None: patch["evidence_text"] = data.evidence_text
    _sb().table("relations").update(patch).eq("id", rel_id).execute()
    res = _sb().table("relations").select("*").eq("id", rel_id).execute()
    return _rel_to_dict(res.data[0])


@app.delete("/api/relations/{rel_id}")
def delete_relation(rel_id: int, user_id: str = Depends(get_current_user)):
    _sb().table("relations").delete().eq("id", rel_id).execute()
    return {"deleted": rel_id}


# ── Metrics ───────────────────────────────────────────────────────────────────
@app.get("/api/papers/{paper_id}/metrics")
def get_metrics(paper_id: int, user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    res = _sb().table("metrics").select("*").eq("paper_id", paper_id).order("display_order").order("id").execute()
    return [_met_to_dict(m) for m in (res.data or [])]


@app.post("/api/papers/{paper_id}/metrics/reorder")
def reorder_metrics(paper_id: int, items: list[ReorderItem], user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    for item in items:
        _sb().table("metrics").update({"display_order": item.order}).eq("id", item.id).eq("paper_id", paper_id).execute()
    return {"ok": True}


@app.post("/api/papers/{paper_id}/metrics")
def create_metric(paper_id: int, data: MetricCreate, user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    res = _sb().table("metrics").insert({
        "paper_id":    paper_id,
        "metric_name": data.metric_name,
        "value":       data.value,
        "unit":        data.unit or "",
        "condition":   data.condition or "",
        "confidence":  data.confidence,
    }).execute()
    return _met_to_dict(res.data[0])


@app.put("/api/metrics/{met_id}")
def update_metric(met_id: int, data: MetricUpdate, user_id: str = Depends(get_current_user)):
    patch = {k: v for k, v in data.model_dump().items() if v is not None}
    _sb().table("metrics").update(patch).eq("id", met_id).execute()
    res = _sb().table("metrics").select("*").eq("id", met_id).execute()
    if not res.data:
        raise HTTPException(404, "Metric not found")
    return _met_to_dict(res.data[0])


@app.delete("/api/metrics/{met_id}")
def delete_metric(met_id: int, user_id: str = Depends(get_current_user)):
    _sb().table("metrics").delete().eq("id", met_id).execute()
    return {"deleted": met_id}


# ── Summaries ─────────────────────────────────────────────────────────────────
@app.get("/api/papers/{paper_id}/summaries")
def get_summaries(paper_id: int, user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    res = _sb().table("summaries").select("*").eq("paper_id", paper_id).execute()
    return [_sum_to_dict(s) for s in (res.data or [])]


@app.put("/api/summaries/{sum_id}")
def update_summary(sum_id: int, data: SummaryUpdate, user_id: str = Depends(get_current_user)):
    _sb().table("summaries").update({"summary_text": data.summary_text}).eq("id", sum_id).execute()
    res = _sb().table("summaries").select("*").eq("id", sum_id).execute()
    if not res.data:
        raise HTTPException(404, "Summary not found")
    return _sum_to_dict(res.data[0])


# ── Admin ─────────────────────────────────────────────────────────────────────
@app.get("/api/admin/papers/{paper_id}")
def admin_paper(paper_id: int, user_id: str = Depends(get_current_user)):
    res = _sb().table("papers").select("*").eq("id", paper_id).eq("user_id", user_id).execute()
    if not res.data:
        raise HTTPException(404, "Paper not found")
    p = res.data[0]
    kws  = (_sb().table("keywords").select("*").eq("paper_id", paper_id).order("display_order").order("id").execute().data or [])
    rels = (_sb().table("relations").select("*").eq("paper_id", paper_id).order("display_order").order("id").execute().data or [])
    mets = (_sb().table("metrics").select("*").eq("paper_id", paper_id).order("display_order").order("id").execute().data or [])
    sums = (_sb().table("summaries").select("*").eq("paper_id", paper_id).execute().data or [])
    paper_d = _paper_to_dict(p)
    paper_d["abstract"] = p.get("abstract") or ""
    return {"paper": paper_d, "keywords": kws, "relations": rels, "metrics": mets, "summaries": sums}


# ── Graph (Cytoscape.js format) ───────────────────────────────────────────────
CATEGORY_COLORS = {
    "Material":    "#eab308",
    "Structure":   "#10b981",
    "Property":    "#8b5cf6",
    "Method":      "#3b82f6",
    "Application": "#ec4899",
    "Metric":      "#14b8a6",
    "Other":       "#94a3b8",
}
RELATION_COLORS = {
    "equivalent":    "#94a3b8",
    "subtype_of":    "#60a5fa",
    "has_structure": "#34d399",
    "has_property":  "#a78bfa",
    "affects":       "#f97316",
    "increases":     "#22c55e",
    "decreases":     "#ef4444",
    "fabricated_by": "#fbbf24",
    "measured_by":   "#c084fc",
    "used_for":      "#fb7185",
    "has_value":     "#2dd4bf",
    "related_to":    "#64748b",
}


@app.get("/api/papers/{paper_id}/graph")
def get_graph(paper_id: int, user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    keywords  = (_sb().table("keywords").select("*").eq("paper_id", paper_id).execute().data or [])
    relations = (_sb().table("relations").select("*").eq("paper_id", paper_id).execute().data or [])
    metrics   = (_sb().table("metrics").select("*").eq("paper_id", paper_id).execute().data or [])

    kw_id_set = {kw["id"] for kw in keywords}

    elements = [
        {"data": {
            "id":         f"kw_{kw['id']}",
            "label":      (kw.get("keyword_name") or kw.get("normalized_name") or "(unnamed)").strip(),
            "category":   kw.get("category", "Other"),
            "confidence": kw.get("confidence", 0.5),
            "color":      CATEGORY_COLORS.get(kw.get("category", "Other"), "#94a3b8"),
            "type":       "keyword",
        }}
        for kw in keywords
    ]

    for met in metrics:
        node_id = f"met_{met['id']}"
        label = f"{met.get('metric_name','')}\n{met.get('value','')} {met.get('unit','') or ''}".strip()
        elements.append({"data": {
            "id": node_id, "label": label, "category": "Metric",
            "confidence": met.get("confidence", 0.5),
            "color": CATEGORY_COLORS["Metric"], "type": "metric",
        }})
        anchor = None
        if met.get("linked_keyword_id"):
            anchor = next((k for k in keywords if k["id"] == met["linked_keyword_id"]), None)
        if not anchor:
            mname = (met.get("metric_name") or "").lower()
            anchor = next((k for k in keywords if (k.get("normalized_name") or "").lower() in mname or mname in (k.get("normalized_name") or "").lower()), None)
        if not anchor:
            for cat in ("Property", "Material", "Structure"):
                anchor = next((k for k in keywords if k.get("category") == cat), None)
                if anchor: break
        if anchor:
            elements.append({"data": {
                "id": f"met_edge_{met['id']}", "source": f"kw_{anchor['id']}", "target": node_id,
                "relation": "has_value", "confidence": met.get("confidence", 0.5),
                "evidence": "", "color": RELATION_COLORS["has_value"], "width": 1, "dashed": False,
            }})

    for rel in relations:
        src_id = f"kw_{rel['source_keyword_id']}" if rel.get("source_keyword_id") and rel["source_keyword_id"] in kw_id_set else None
        tgt_id = f"kw_{rel['target_keyword_id']}" if rel.get("target_keyword_id") and rel["target_keyword_id"] in kw_id_set else None
        if not src_id or not tgt_id:
            src_kw = next((k for k in keywords if (k.get("normalized_name") or "").lower() == (rel.get("source_name") or "").lower()), None)
            tgt_kw = next((k for k in keywords if (k.get("normalized_name") or "").lower() == (rel.get("target_name") or "").lower()), None)
            if not src_kw or not tgt_kw: continue
            src_id, tgt_id = f"kw_{src_kw['id']}", f"kw_{tgt_kw['id']}"
        width  = max(1, round((rel.get("confidence") or 0.5) * 5))
        dashed = (rel.get("confidence") or 0.5) < 0.55 or rel.get("relation_type") == "related_to"
        elements.append({"data": {
            "id": f"rel_{rel['id']}", "source": src_id, "target": tgt_id,
            "relation":   rel.get("relation_type", "related_to"),
            "confidence": rel.get("confidence", 0.5),
            "evidence":   rel.get("evidence_text") or "",
            "color":      RELATION_COLORS.get(rel.get("relation_type", ""), "#64748b"),
            "width": width, "dashed": dashed,
        }})

    material_kws = [k for k in keywords if k.get("category") == "Material"]
    primary_node_id = None
    if material_kws:
        edge_count: dict[int, int] = defaultdict(int)
        for r in relations:
            if r.get("source_keyword_id"): edge_count[r["source_keyword_id"]] += 1
            if r.get("target_keyword_id"): edge_count[r["target_keyword_id"]] += 1
        for m in metrics:
            if m.get("linked_keyword_id"): edge_count[m["linked_keyword_id"]] += 1
        primary = max(material_kws, key=lambda k: edge_count[k["id"]])
        primary_node_id = f"kw_{primary['id']}"

    return {"elements": elements, "relation_colors": RELATION_COLORS, "category_colors": CATEGORY_COLORS, "primary_node_id": primary_node_id}


# ── Map Canvas ────────────────────────────────────────────────────────────────
@app.get("/api/map-canvas")
def get_map_canvas(user_id: str = Depends(get_current_user)):
    papers       = (_sb().table("papers").select("*").eq("user_id", user_id).execute().data or [])
    positions_r  = (_sb().table("map_positions").select("*").eq("user_id", user_id).execute().data or [])
    custom_nodes = (_sb().table("map_custom_nodes").select("*").eq("user_id", user_id).execute().data or [])
    map_edges    = (_sb().table("map_edges").select("*").eq("user_id", user_id).execute().data or [])
    try:
        map_groups = (_sb().table("map_groups").select("*").eq("user_id", user_id).execute().data or [])
    except Exception:
        map_groups = []

    positions = {p["node_id"]: p for p in positions_r}

    # Keyword stats across user's papers
    paper_ids = [p["id"] for p in papers]
    all_kws: list[dict] = []
    if paper_ids:
        all_kws = (_sb().table("keywords").select("normalized_name, keyword_name, category, paper_id").in_("paper_id", paper_ids).execute().data or [])

    norm_map: dict[str, dict] = defaultdict(lambda: {"paper_ids": set(), "name": "", "category": "Other"})
    for kw in all_kws:
        nm = kw.get("normalized_name") or ""
        norm_map[nm]["paper_ids"].add(kw["paper_id"])
        norm_map[nm]["name"]     = kw.get("keyword_name") or nm
        norm_map[nm]["category"] = kw.get("category") or "Other"
    keyword_stats = [
        {"normalized": nm, "name": v["name"], "category": v["category"], "count": len(v["paper_ids"])}
        for nm, v in norm_map.items() if len(v["paper_ids"]) >= 2
    ]

    # Per-paper keyword norms map + category map
    paper_kw_norms: dict[int, list[str]] = defaultdict(list)
    paper_kw_cats:  dict[int, dict[str, str]] = defaultdict(dict)
    for kw in all_kws:
        norm = (kw.get("normalized_name") or "").lower()
        paper_kw_norms[kw["paper_id"]].append(norm)
        if norm:
            paper_kw_cats[kw["paper_id"]][norm] = kw.get("category") or "Other"

    result_papers = []
    for paper in papers:
        nid = f"p_{paper['id']}"
        pos = positions.get(nid)
        expanded = pos["expanded"] if pos else 0

        p_kws = [k for k in all_kws if k["paper_id"] == paper["id"]]
        materials = [(k.get("keyword_name") or k.get("normalized_name") or "").strip() for k in p_kws if k.get("category") in ("Material", "Structure")][:3]
        top_kws   = [(k.get("keyword_name") or k.get("normalized_name") or "").strip() for k in p_kws if k.get("category") not in ("Material", "Structure", "Metric")][:2]

        paper_data: dict = {
            "id":           paper["id"],
            "title":        (paper.get("title") or "Untitled").strip(),
            "year":         paper.get("year"),
            "materials":    materials,
            "top_keywords": top_kws,
            "keyword_norms":      paper_kw_norms[paper["id"]],
            "keyword_categories": dict(paper_kw_cats[paper["id"]]),
            "pos_x":        pos["pos_x"] if pos else None,
            "pos_y":        pos["pos_y"] if pos else None,
            "expanded":     expanded,
            "field":        paper.get("field"),
        }
        if expanded:
            full_kws = (_sb().table("keywords").select("*").eq("paper_id", paper["id"]).execute().data or [])
            paper_data["keywords"] = [
                {
                    "id":         k["id"],
                    "name":       (k.get("keyword_name") or k.get("normalized_name") or "(unnamed)").strip(),
                    "normalized": (k.get("normalized_name") or "").lower(),
                    "category":   k.get("category") or "Other",
                    "confidence": k.get("confidence") or 0.0,
                    "pos_x":      positions[f"kw_{k['id']}"]["pos_x"] if f"kw_{k['id']}" in positions else None,
                    "pos_y":      positions[f"kw_{k['id']}"]["pos_y"] if f"kw_{k['id']}" in positions else None,
                }
                for k in full_kws
            ]
        result_papers.append(paper_data)

    return {
        "papers":        result_papers,
        "custom_nodes":  [{"id": cn["id"], "label": cn["label"], "category": cn["category"],
                           "description": cn["description"], "color": cn["color"],
                           "pos_x": cn["pos_x"], "pos_y": cn["pos_y"]} for cn in custom_nodes],
        "edges":         [{"id": e["id"], "source_id": e["source_id"], "target_id": e["target_id"],
                           "relation_type": e["relation_type"], "label": e["label"]} for e in map_edges],
        "groups":        [{"id": str(g["id"]), "name": g["name"], "color": g["color"],
                           "paper_ids": g.get("paper_ids") or []} for g in map_groups],
        "keyword_stats": keyword_stats,
        "category_colors": CATEGORY_COLORS,
    }


@app.post("/api/map-positions")
def save_map_positions(items: list[MapPositionItem], user_id: str = Depends(get_current_user)):
    for item in items:
        existing = _sb().table("map_positions").select("node_id").eq("node_id", item.node_id).eq("user_id", user_id).execute()
        if existing.data:
            _sb().table("map_positions").update({"pos_x": item.pos_x, "pos_y": item.pos_y, "expanded": item.expanded}).eq("node_id", item.node_id).eq("user_id", user_id).execute()
        else:
            _sb().table("map_positions").insert({"node_id": item.node_id, "user_id": user_id, "pos_x": item.pos_x, "pos_y": item.pos_y, "expanded": item.expanded}).execute()
    return {"ok": True}


@app.post("/api/map-custom-nodes")
def create_custom_node(data: CustomNodeCreate, user_id: str = Depends(get_current_user)):
    res = _sb().table("map_custom_nodes").insert({
        "user_id": user_id, "label": data.label, "category": data.category,
        "description": data.description, "color": data.color, "pos_x": data.pos_x, "pos_y": data.pos_y,
    }).execute()
    return res.data[0]


@app.put("/api/map-custom-nodes/{node_id}")
def update_custom_node(node_id: int, data: CustomNodeUpdate, user_id: str = Depends(get_current_user)):
    patch = {k: v for k, v in data.model_dump().items() if v is not None}
    _sb().table("map_custom_nodes").update(patch).eq("id", node_id).eq("user_id", user_id).execute()
    return {"ok": True}


@app.delete("/api/map-custom-nodes/{node_id}")
def delete_custom_node(node_id: int, user_id: str = Depends(get_current_user)):
    nid_str = f"cn_{node_id}"
    _sb().table("map_edges").delete().eq("user_id", user_id).or_(f"source_id.eq.{nid_str},target_id.eq.{nid_str}").execute()
    _sb().table("map_custom_nodes").delete().eq("id", node_id).eq("user_id", user_id).execute()
    return {"deleted": node_id}


@app.post("/api/map-edges")
def create_map_edge(data: MapEdgeCreate, user_id: str = Depends(get_current_user)):
    res = _sb().table("map_edges").insert({
        "user_id": user_id, "source_id": data.source_id, "target_id": data.target_id,
        "relation_type": data.relation_type, "label": data.label,
    }).execute()
    return res.data[0]


@app.put("/api/map-edges/{edge_id}")
def update_map_edge(edge_id: int, data: MapEdgeUpdate, user_id: str = Depends(get_current_user)):
    patch = {k: v for k, v in data.model_dump().items() if v is not None}
    _sb().table("map_edges").update(patch).eq("id", edge_id).eq("user_id", user_id).execute()
    return {"ok": True}


@app.delete("/api/map-edges/{edge_id}")
def delete_map_edge(edge_id: int, user_id: str = Depends(get_current_user)):
    _sb().table("map_edges").delete().eq("id", edge_id).eq("user_id", user_id).execute()
    return {"deleted": edge_id}


# ── Map Overview (Theme → Concept hierarchy) ─────────────────────────────────
# Supabase migration required:
#   ALTER TABLE papers ADD COLUMN IF NOT EXISTS theme text;
#   ALTER TABLE papers ADD COLUMN IF NOT EXISTS concept text;

_THEME_COLORS = [
    "#8b5cf6", "#3b82f6", "#06b6d4", "#22c55e",
    "#f59e0b", "#f97316", "#ec4899", "#14b8a6",
    "#a855f7", "#84cc16",
]

_THEME_RULES: dict[str, str] = {
    "ferroelectric":       "Ferroelectric Materials",
    "piezoelectric":       "Piezoelectric Materials",
    "nanogenerator":       "Energy Harvesting",
    "triboelectric":       "Energy Harvesting",
    "energy harvesting":   "Energy Harvesting",
    "energy storage":      "Energy Storage",
    "li-ion":              "Energy Storage",
    "lithium ion":         "Energy Storage",
    "battery":             "Energy Storage",
    "supercapacitor":      "Energy Storage",
    "sensor":              "Sensors & Actuators",
    "actuator":            "Sensors & Actuators",
    "photovoltaic":        "Solar Energy",
    "solar cell":          "Solar Energy",
    "perovskite solar":    "Solar Energy",
    "catalyst":            "Catalysis",
    "photocatalyst":       "Catalysis",
    "electrocatalyst":     "Catalysis",
    "graphene":            "Carbon-based Materials",
    "carbon nanotube":     "Carbon-based Materials",
    "nanomaterial":        "Nanomaterials",
    "nanoparticle":        "Nanomaterials",
    "quantum dot":         "Quantum Materials",
    "quantum well":        "Quantum Materials",
    "superconductor":      "Superconductivity",
    "superconducting":     "Superconductivity",
    "ferromagnetic":       "Magnetic Materials",
    "magnetic material":   "Magnetic Materials",
    "spintronic":          "Spintronics",
    "spin transport":      "Spintronics",
    "dielectric":          "Dielectrics",
    "polymer":             "Polymer Materials",
    "composite material":  "Composite Materials",
    "interface engineering": "Interface Physics",
    "heterointerface":     "Interface Physics",
    "thin film":           "Thin Film Technology",
    "two-dimensional":     "2D Materials",
    "2d material":         "2D Materials",
    "heterostructure":     "2D Materials",
    "photonic":            "Photonics",
    "optical waveguide":   "Photonics",
    "drug delivery":       "Biomedical Applications",
    "bioimaging":          "Biomedical Applications",
    "semiconductor":       "Semiconductor Devices",
    "transistor":          "Semiconductor Devices",
    "neuromorphic":        "Neuromorphic Computing",
    "memristor":           "Neuromorphic Computing",
}

_GENERIC_WORDS = frozenset({
    "study", "effect", "property", "properties", "performance", "material",
    "materials", "method", "methods", "result", "results", "analysis",
    "investigation", "behavior", "structure", "structures", "based", "using",
    "novel", "high", "new", "improved", "enhanced", "synthesis", "fabrication",
    "preparation", "characterization", "measurement", "experimental",
    "theoretical", "review", "recent", "advanced", "via", "toward", "highly",
    "efficient", "large", "small", "first", "various", "different", "application",
})

@app.get("/api/map-overview")
def get_map_overview(user_id: str = Depends(get_current_user)):
    sb = _sb()
    papers = (sb.table("papers")
                .select("id,title,year,field,theme,concept")
                .eq("user_id", user_id).execute().data or [])
    if not papers:
        return {"themes": []}

    paper_ids = [p["id"] for p in papers]
    all_kws = (sb.table("keywords")
                 .select("paper_id,keyword_name,normalized_name,confidence")
                 .in_("paper_id", paper_ids).execute().data or [])
    all_mets = (sb.table("metrics")
                  .select("paper_id,metric_name,value,unit")
                  .in_("paper_id", paper_ids).execute().data or [])

    kws_by: dict = defaultdict(list)
    for kw in all_kws:
        kws_by[kw["paper_id"]].append(kw)
    mets_by: dict = defaultdict(list)
    for m in all_mets:
        mets_by[m["paper_id"]].append(m)

    def _cap(s: str) -> str:
        s = (s or "").strip()
        return s[0].upper() + s[1:] if s else s

    theme_map: dict[str, dict] = {}
    for paper in papers:
        # Use lowercase key so "ferroelectric" and "Ferroelectric" merge into one node
        theme_raw   = (paper.get("theme")   or "").strip()
        concept_raw = (paper.get("concept") or "").strip()
        theme_key   = theme_raw.lower()   or "uncategorized"
        concept_key = concept_raw.lower() or "general"
        theme_name  = _cap(theme_raw)   or "Uncategorized"
        concept_name = _cap(concept_raw) or "General"

        if theme_key not in theme_map:
            theme_map[theme_key] = {"name": theme_name, "papers": [], "conceptMap": {}}

        kws  = kws_by[paper["id"]]
        mets = mets_by[paper["id"]]
        top_kws = [_cap((kw.get("keyword_name") or kw.get("normalized_name") or "").strip())
                   for kw in sorted(kws, key=lambda k: -(k.get("confidence") or 0))
                   if kw.get("normalized_name") or kw.get("keyword_name")][:6]
        top_mets = [{"name": m.get("metric_name", ""), "value": m.get("value", ""), "unit": m.get("unit", "")}
                    for m in mets if m.get("metric_name")][:4]

        entry = {
            "id":      paper["id"],
            "title":   (paper.get("title") or "Untitled").strip(),
            "year":    paper.get("year"),
            "field":   paper.get("field"),
            "theme":   theme_name,
            "concept": concept_name,
            "keywords": top_kws,
            "metrics":  top_mets,
        }
        theme_map[theme_key]["papers"].append(entry)
        theme_map[theme_key]["conceptMap"].setdefault(concept_key, {"name": concept_name, "papers": []})["papers"].append(entry)

    result = []
    for i, (theme_name, td) in enumerate(sorted(theme_map.items(), key=lambda x: -len(x[1]["papers"]))):
        concepts = [
            {"name": cn, "paper_count": len(cd["papers"]), "papers": cd["papers"]}
            for cn, cd in sorted(td["conceptMap"].items(), key=lambda x: -len(x[1]["papers"]))
        ]
        result.append({
            "name":        theme_name,
            "color":       _THEME_COLORS[i % len(_THEME_COLORS)],
            "paper_count": len(td["papers"]),
            "concepts":    concepts,
        })
    return {"themes": result}


@app.get("/api/papers/{paper_id}/recommend-theme-concept")
def recommend_theme_concept(paper_id: int, user_id: str = Depends(get_current_user)):
    """Score theme and concept candidates based on title + extracted keywords."""
    sb = _sb()
    # Use only columns guaranteed to exist (no theme/concept — avoids missing-column errors)
    paper = (sb.table("papers").select("id,title,user_id")
               .eq("id", paper_id).execute().data or [None])[0]
    if not paper or paper["user_id"] != user_id:
        raise HTTPException(404)

    kws = (sb.table("keywords")
             .select("keyword_name,normalized_name,category,confidence")
             .eq("paper_id", paper_id)
             .order("confidence", desc=True)
             .execute().data or [])

    if not kws and not paper.get("title"):
        return {"paper_id": paper_id, "themes": [], "concepts": []}

    title    = (paper.get("title") or "").strip()
    title_low = title.lower()
    kw_names = [
        (kw.get("normalized_name") or kw.get("keyword_name") or "").strip()
        for kw in kws
    ]
    kw_text  = " ".join(kw_names).lower()

    # Spaces between repetitions so multi-word patterns aren't broken
    text_low = f"{title_low} {title_low} {title_low} {kw_text} {kw_text}"

    # ── Score themes ──────────────────────────────────────────────────────────
    theme_scores: dict[str, float] = {}
    for pattern, theme_name in _THEME_RULES.items():
        if pattern in text_low:
            loc  = 5 if pattern in title_low else (4 if pattern in kw_text else 1)
            freq = min(4, text_low.count(pattern))
            theme_scores[theme_name] = theme_scores.get(theme_name, 0) + loc + freq

    # ── Score concepts from extracted keywords ────────────────────────────────
    concept_scores: dict[str, float] = {}
    for kw in kws:
        name = (kw.get("normalized_name") or kw.get("keyword_name") or "").strip()
        if not name or len(name) < 4:
            continue
        name_low = name.lower()
        # Skip pure generic words
        if name_low in _GENERIC_WORDS:
            continue
        # Skip names that start with a generic word and are only 1 token
        words = name_low.split()
        if len(words) == 1 and words[0] in _GENERIC_WORDS:
            continue
        conf = float(kw.get("confidence") or 0.5)
        concept_scores[name] = max(concept_scores.get(name, 0.0), conf)

    def _normalize(scores: dict, top: int) -> list[dict]:
        if not scores:
            return []
        mv = max(scores.values()) or 1.0
        ranked = sorted(scores.items(), key=lambda x: -x[1])
        return [{"name": k, "score": min(99, round(v / mv * 100))} for k, v in ranked][:top]

    return {
        "paper_id": paper_id,
        "themes":   _normalize(theme_scores, 3),
        "concepts": _normalize(concept_scores, 5),
    }


@app.put("/api/papers/{paper_id}/theme-concept")
def set_theme_concept(paper_id: int, body: ThemeConceptBody, user_id: str = Depends(get_current_user)):
    paper = (_sb().table("papers").select("id,user_id")
               .eq("id", paper_id).execute().data or [None])[0]
    if not paper or paper["user_id"] != user_id:
        raise HTTPException(404)
    update: dict = {}
    if body.theme   is not None: update["theme"]   = body.theme
    if body.concept is not None: update["concept"] = body.concept
    if update:
        _sb().table("papers").update(update).eq("id", paper_id).execute()
    return {"ok": True}


# ── Map Groups ────────────────────────────────────────────────────────────────

@app.get("/api/map-groups")
def list_map_groups(user_id: str = Depends(get_current_user)):
    rows = (_sb().table("map_groups").select("*").eq("user_id", user_id).execute().data or [])
    return [{"id": str(r["id"]), "name": r["name"], "color": r["color"],
             "paper_ids": r.get("paper_ids") or []} for r in rows]


@app.post("/api/map-groups")
def create_map_group(data: MapGroupCreate, user_id: str = Depends(get_current_user)):
    res = _sb().table("map_groups").insert({
        "user_id": user_id, "name": data.name,
        "color": data.color, "paper_ids": data.paper_ids,
    }).execute()
    r = res.data[0]
    return {"id": str(r["id"]), "name": r["name"], "color": r["color"],
            "paper_ids": r.get("paper_ids") or []}


@app.put("/api/map-groups/{group_id}")
def update_map_group(group_id: str, data: MapGroupUpdate, user_id: str = Depends(get_current_user)):
    patch = {k: v for k, v in data.model_dump().items() if v is not None}
    _sb().table("map_groups").update(patch).eq("id", group_id).eq("user_id", user_id).execute()
    return {"ok": True}


@app.delete("/api/map-groups/{group_id}")
def delete_map_group(group_id: str, user_id: str = Depends(get_current_user)):
    _sb().table("map_groups").delete().eq("id", group_id).eq("user_id", user_id).execute()
    return {"deleted": group_id}
