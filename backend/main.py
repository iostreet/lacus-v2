"""
Lacus V2 — FastAPI backend (Supabase edition)
Run:  uvicorn main:app --reload --port 8000
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
import shutil
import sys
from collections import defaultdict
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

from supabase_client import supabase_admin, SUPABASE_URL, SUPABASE_ANON_KEY
from processors.grobid_client     import extract_paper_info, check_grobid
from processors.keyword_extractor import extract_keywords
from processors.metric_extractor  import extract_metrics
from processors.relation_extractor import extract_relations
from processors.summary_generator  import generate_summaries

# ── In-memory progress tracker ───────────────────────────────────────────────
_progress: dict[int, dict] = {}

# ── Visitor counter (file-backed) ─────────────────────────────────────────────
_VISITOR_FILE = BASE_DIR / "visitor_count.json"

def _get_visitors() -> int:
    if _VISITOR_FILE.exists():
        try:
            return json.loads(_VISITOR_FILE.read_text())["count"]
        except Exception:
            pass
    return 0

def _increment_visitors() -> int:
    count = _get_visitors() + 1
    _VISITOR_FILE.write_text(json.dumps({"count": count}))
    return count

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


@app.get("/api/status")
def status():
    return {"grobid_available": check_grobid(), "version": "2.0.0"}


@app.get("/api/public/stats")
def public_stats():
    """Public stats for landing page — no auth required."""
    import httpx
    from supabase_client import SUPABASE_URL, SUPABASE_ANON_KEY
    paper_count = 0
    member_count = 0
    try:
        resp = httpx.post(
            f"{SUPABASE_URL}/rest/v1/rpc/get_public_stats",
            headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
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


# ── Auth dependency ──────────────────────────────────────────────────────────
def get_current_user(authorization: str = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization[7:]
    try:
        user_resp = supabase_admin.auth.get_user(token)
        if not user_resp or not user_resp.user:
            raise HTTPException(status_code=401, detail="Invalid token")
        return str(user_resp.user.id)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


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
    title:     Optional[str] = None
    authors:   Optional[str] = None
    doi:       Optional[str] = None
    journal:   Optional[str] = None
    year:      Optional[str] = None
    abstract:  Optional[str] = None
    relevance: Optional[int] = None
    memo:      Optional[str] = None

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
        "id":         p["id"],
        "title":      p.get("title")    or "",
        "authors":    authors,
        "doi":        p.get("doi")      or "",
        "journal":    p.get("journal")  or "",
        "year":       p.get("year")     or "",
        "abstract":   p.get("abstract") or "",
        "pdf_path":   p.get("pdf_path") or "",
        "status":     p.get("status", "draft"),
        "created_at": str(p.get("created_at", "")),
        "relevance":  p.get("relevance") or 0,
        "memo":       p.get("memo")      or "",
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
    res = supabase_admin.table("keywords").select("id").eq("paper_id", paper_id).ilike("normalized_name", name).limit(1).execute()
    return res.data[0]["id"] if res.data else None


def _assert_paper_owner(paper_id: int, user_id: str):
    res = supabase_admin.table("papers").select("id").eq("id", paper_id).eq("user_id", user_id).execute()
    if not res.data:
        raise HTTPException(404, "Paper not found")


# ── Background analysis ───────────────────────────────────────────────────────
def _run_analysis(paper_id: int, user_id: str, pdf_path: str, orig_filename: str):
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
        supabase_admin.table("papers").update(update).eq("id", paper_id).execute()

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
                    supabase_admin.table("papers").update(patch).eq("id", paper_id).execute()

        sections = {
            "title":           title,
            "abstract":        info.get("abstract", ""),
            "author_keywords": info.get("author_keywords", []),
        }

        # Step 2 — Keywords
        _set_progress(paper_id, "Extracting keywords…", 30)
        kw_data = extract_keywords(sections)
        kw_id_map: dict[str, int] = {}
        for kw in kw_data:
            res = supabase_admin.table("keywords").insert({
                "paper_id":        paper_id,
                "keyword_name":    kw["keyword_name"],
                "normalized_name": kw["normalized_name"],
                "category":        kw["category"],
                "confidence":      kw["confidence"],
                "display_order":   0,
            }).execute()
            if res.data:
                kw_id_map[kw["normalized_name"].lower()] = res.data[0]["id"]

        # Step 3 — Metrics
        _set_progress(paper_id, "Extracting performance metrics…", 52)
        for met in extract_metrics(sections):
            supabase_admin.table("metrics").insert({
                "paper_id":    paper_id,
                "metric_name": met["metric_name"],
                "value":       met["value"],
                "unit":        met.get("unit", ""),
                "condition":   met.get("condition", ""),
                "confidence":  met["confidence"],
                "display_order": 0,
            }).execute()

        # Step 4 — Relations
        _set_progress(paper_id, "Building keyword relations…", 70)
        for rel in extract_relations(sections, kw_data):
            supabase_admin.table("relations").insert({
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

        # Step 5 — Summaries
        _set_progress(paper_id, "Generating key findings…", 88)
        kws  = (supabase_admin.table("keywords").select("*").eq("paper_id", paper_id).execute().data or [])
        rels = (supabase_admin.table("relations").select("*").eq("paper_id", paper_id).execute().data or [])
        mets = (supabase_admin.table("metrics").select("*").eq("paper_id", paper_id).execute().data or [])

        for s in generate_summaries(info, kws, rels, mets):
            supabase_admin.table("summaries").insert({
                "paper_id":     paper_id,
                "summary_text": s["summary_text"],
                "summary_type": s["summary_type"],
                "confidence":   s["confidence"],
            }).execute()

        supabase_admin.table("papers").update({"status": "confirmed"}).eq("id", paper_id).execute()
        _set_progress(paper_id, "Analysis complete!", 100)

    except Exception as exc:
        with contextlib.suppress(Exception):
            supabase_admin.table("papers").update({"status": "error"}).eq("id", paper_id).execute()
        _set_progress(paper_id, f"Error: {exc}", -1, error=str(exc))


# ── Import (upload) endpoint ──────────────────────────────────────────────────
@app.post("/api/papers/upload")
async def upload_paper(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted.")

    tmp_path = UPLOADS_DIR / file.filename
    with open(tmp_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    pdf_hash = _hash_file(tmp_path)

    dup = supabase_admin.table("papers").select("id").eq("user_id", user_id).eq("pdf_hash", pdf_hash).execute()
    if dup.data:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(409, f"This PDF is already in your library (paper id={dup.data[0]['id']}).")

    final_path = UPLOADS_DIR / f"{pdf_hash[:16]}.pdf"
    shutil.move(str(tmp_path), str(final_path))

    res = supabase_admin.table("papers").insert({
        "user_id":  user_id,
        "title":    file.filename.replace(".pdf", ""),
        "pdf_path": str(final_path),
        "pdf_hash": pdf_hash,
        "status":   "processing",
    }).execute()

    if not res.data:
        final_path.unlink(missing_ok=True)
        raise HTTPException(500, "DB insert failed — SUPABASE_SERVICE_KEY may not be set in backend/.env")

    paper_id = res.data[0]["id"]
    _set_progress(paper_id, "Queued for analysis…", 5)
    background_tasks.add_task(_run_analysis, paper_id, user_id, str(final_path), file.filename)
    return {"paper_id": paper_id, "status": "processing"}


@app.get("/api/papers/{paper_id}/progress")
def get_progress(paper_id: int, user_id: str = Depends(get_current_user)):
    prog = _progress.get(paper_id)
    if prog is None:
        res = supabase_admin.table("papers").select("status").eq("id", paper_id).eq("user_id", user_id).execute()
        if res.data:
            s = res.data[0]["status"]
            if s == "confirmed": return {"step": "Analysis complete!", "pct": 100, "error": None}
            if s == "error":     return {"step": "Analysis failed.",   "pct": -1,  "error": "see logs"}
        return {"step": "Waiting…", "pct": 0, "error": None}
    return prog


# ── Papers CRUD ───────────────────────────────────────────────────────────────
@app.get("/api/papers")
def list_papers(user_id: str = Depends(get_current_user)):
    res = supabase_admin.table("papers").select("*, summaries(summary_text, summary_type)").eq("user_id", user_id).order("created_at", desc=True).execute()
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
    res = supabase_admin.table("papers").select("*").eq("id", paper_id).eq("user_id", user_id).execute()
    if not res.data:
        raise HTTPException(404, "Paper not found")
    return _paper_to_dict(res.data[0])


@app.put("/api/papers/{paper_id}")
def update_paper(paper_id: int, data: PaperUpdate, user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    patch = {k: v for k, v in data.model_dump().items() if v is not None}
    if "relevance" in patch:
        patch["relevance"] = max(0, min(5, patch["relevance"]))
    supabase_admin.table("papers").update(patch).eq("id", paper_id).execute()
    return get_paper(paper_id, user_id)


@app.delete("/api/papers/{paper_id}")
def delete_paper(paper_id: int, user_id: str = Depends(get_current_user)):
    res = supabase_admin.table("papers").select("pdf_path").eq("id", paper_id).eq("user_id", user_id).execute()
    if not res.data:
        raise HTTPException(404, "Paper not found")
    pdf_path = res.data[0].get("pdf_path")
    supabase_admin.table("papers").delete().eq("id", paper_id).execute()
    if pdf_path and Path(pdf_path).exists():
        Path(pdf_path).unlink(missing_ok=True)
    return {"deleted": paper_id}


# ── Keywords ──────────────────────────────────────────────────────────────────
@app.get("/api/papers/{paper_id}/keywords")
def get_keywords(paper_id: int, user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    res = supabase_admin.table("keywords").select("*").eq("paper_id", paper_id).order("display_order").order("id").execute()
    return [_kw_to_dict(k) for k in (res.data or [])]


@app.post("/api/papers/{paper_id}/keywords/reorder")
def reorder_keywords(paper_id: int, items: list[ReorderItem], user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    for item in items:
        supabase_admin.table("keywords").update({"display_order": item.order}).eq("id", item.id).eq("paper_id", paper_id).execute()
    return {"ok": True}


@app.post("/api/papers/{paper_id}/keywords")
def create_keyword(paper_id: int, data: KeywordCreate, user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    res = supabase_admin.table("keywords").insert({
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
    supabase_admin.table("keywords").update(patch).eq("id", kw_id).execute()
    res = supabase_admin.table("keywords").select("*").eq("id", kw_id).execute()
    if not res.data:
        raise HTTPException(404, "Keyword not found")
    return _kw_to_dict(res.data[0])


@app.delete("/api/keywords/{kw_id}")
def delete_keyword(kw_id: int, user_id: str = Depends(get_current_user)):
    supabase_admin.table("keywords").delete().eq("id", kw_id).execute()
    return {"deleted": kw_id}


# ── Relations ─────────────────────────────────────────────────────────────────
@app.get("/api/papers/{paper_id}/relations")
def get_relations(paper_id: int, user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    res = supabase_admin.table("relations").select("*").eq("paper_id", paper_id).order("display_order").order("id").execute()
    return [_rel_to_dict(r) for r in (res.data or [])]


@app.post("/api/papers/{paper_id}/relations/reorder")
def reorder_relations(paper_id: int, items: list[ReorderItem], user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    for item in items:
        supabase_admin.table("relations").update({"display_order": item.order}).eq("id", item.id).eq("paper_id", paper_id).execute()
    return {"ok": True}


@app.post("/api/papers/{paper_id}/relations")
def create_relation(paper_id: int, data: RelationCreate, user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    res = supabase_admin.table("relations").insert({
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
    res_cur = supabase_admin.table("relations").select("paper_id").eq("id", rel_id).execute()
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
    supabase_admin.table("relations").update(patch).eq("id", rel_id).execute()
    res = supabase_admin.table("relations").select("*").eq("id", rel_id).execute()
    return _rel_to_dict(res.data[0])


@app.delete("/api/relations/{rel_id}")
def delete_relation(rel_id: int, user_id: str = Depends(get_current_user)):
    supabase_admin.table("relations").delete().eq("id", rel_id).execute()
    return {"deleted": rel_id}


# ── Metrics ───────────────────────────────────────────────────────────────────
@app.get("/api/papers/{paper_id}/metrics")
def get_metrics(paper_id: int, user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    res = supabase_admin.table("metrics").select("*").eq("paper_id", paper_id).order("display_order").order("id").execute()
    return [_met_to_dict(m) for m in (res.data or [])]


@app.post("/api/papers/{paper_id}/metrics/reorder")
def reorder_metrics(paper_id: int, items: list[ReorderItem], user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    for item in items:
        supabase_admin.table("metrics").update({"display_order": item.order}).eq("id", item.id).eq("paper_id", paper_id).execute()
    return {"ok": True}


@app.post("/api/papers/{paper_id}/metrics")
def create_metric(paper_id: int, data: MetricCreate, user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    res = supabase_admin.table("metrics").insert({
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
    supabase_admin.table("metrics").update(patch).eq("id", met_id).execute()
    res = supabase_admin.table("metrics").select("*").eq("id", met_id).execute()
    if not res.data:
        raise HTTPException(404, "Metric not found")
    return _met_to_dict(res.data[0])


@app.delete("/api/metrics/{met_id}")
def delete_metric(met_id: int, user_id: str = Depends(get_current_user)):
    supabase_admin.table("metrics").delete().eq("id", met_id).execute()
    return {"deleted": met_id}


# ── Summaries ─────────────────────────────────────────────────────────────────
@app.get("/api/papers/{paper_id}/summaries")
def get_summaries(paper_id: int, user_id: str = Depends(get_current_user)):
    _assert_paper_owner(paper_id, user_id)
    res = supabase_admin.table("summaries").select("*").eq("paper_id", paper_id).execute()
    return [_sum_to_dict(s) for s in (res.data or [])]


@app.put("/api/summaries/{sum_id}")
def update_summary(sum_id: int, data: SummaryUpdate, user_id: str = Depends(get_current_user)):
    supabase_admin.table("summaries").update({"summary_text": data.summary_text}).eq("id", sum_id).execute()
    res = supabase_admin.table("summaries").select("*").eq("id", sum_id).execute()
    if not res.data:
        raise HTTPException(404, "Summary not found")
    return _sum_to_dict(res.data[0])


# ── Admin ─────────────────────────────────────────────────────────────────────
@app.get("/api/admin/papers/{paper_id}")
def admin_paper(paper_id: int, user_id: str = Depends(get_current_user)):
    res = supabase_admin.table("papers").select("*").eq("id", paper_id).eq("user_id", user_id).execute()
    if not res.data:
        raise HTTPException(404, "Paper not found")
    p = res.data[0]
    kws  = (supabase_admin.table("keywords").select("*").eq("paper_id", paper_id).order("display_order").order("id").execute().data or [])
    rels = (supabase_admin.table("relations").select("*").eq("paper_id", paper_id).order("display_order").order("id").execute().data or [])
    mets = (supabase_admin.table("metrics").select("*").eq("paper_id", paper_id).order("display_order").order("id").execute().data or [])
    sums = (supabase_admin.table("summaries").select("*").eq("paper_id", paper_id).execute().data or [])
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
    keywords  = (supabase_admin.table("keywords").select("*").eq("paper_id", paper_id).execute().data or [])
    relations = (supabase_admin.table("relations").select("*").eq("paper_id", paper_id).execute().data or [])
    metrics   = (supabase_admin.table("metrics").select("*").eq("paper_id", paper_id).execute().data or [])

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
    papers       = (supabase_admin.table("papers").select("*").eq("user_id", user_id).execute().data or [])
    positions_r  = (supabase_admin.table("map_positions").select("*").eq("user_id", user_id).execute().data or [])
    custom_nodes = (supabase_admin.table("map_custom_nodes").select("*").eq("user_id", user_id).execute().data or [])
    map_edges    = (supabase_admin.table("map_edges").select("*").eq("user_id", user_id).execute().data or [])

    positions = {p["node_id"]: p for p in positions_r}

    # Keyword stats across user's papers
    paper_ids = [p["id"] for p in papers]
    all_kws: list[dict] = []
    if paper_ids:
        all_kws = (supabase_admin.table("keywords").select("normalized_name, keyword_name, category, paper_id").in_("paper_id", paper_ids).execute().data or [])

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

    # Per-paper keyword norms map
    paper_kw_norms: dict[int, list[str]] = defaultdict(list)
    for kw in all_kws:
        paper_kw_norms[kw["paper_id"]].append((kw.get("normalized_name") or "").lower())

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
            "keyword_norms": paper_kw_norms[paper["id"]],
            "pos_x":        pos["pos_x"] if pos else None,
            "pos_y":        pos["pos_y"] if pos else None,
            "expanded":     expanded,
        }
        if expanded:
            full_kws = (supabase_admin.table("keywords").select("*").eq("paper_id", paper["id"]).execute().data or [])
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
        "keyword_stats": keyword_stats,
        "category_colors": CATEGORY_COLORS,
    }


@app.post("/api/map-positions")
def save_map_positions(items: list[MapPositionItem], user_id: str = Depends(get_current_user)):
    for item in items:
        existing = supabase_admin.table("map_positions").select("node_id").eq("node_id", item.node_id).eq("user_id", user_id).execute()
        if existing.data:
            supabase_admin.table("map_positions").update({"pos_x": item.pos_x, "pos_y": item.pos_y, "expanded": item.expanded}).eq("node_id", item.node_id).eq("user_id", user_id).execute()
        else:
            supabase_admin.table("map_positions").insert({"node_id": item.node_id, "user_id": user_id, "pos_x": item.pos_x, "pos_y": item.pos_y, "expanded": item.expanded}).execute()
    return {"ok": True}


@app.post("/api/map-custom-nodes")
def create_custom_node(data: CustomNodeCreate, user_id: str = Depends(get_current_user)):
    res = supabase_admin.table("map_custom_nodes").insert({
        "user_id": user_id, "label": data.label, "category": data.category,
        "description": data.description, "color": data.color, "pos_x": data.pos_x, "pos_y": data.pos_y,
    }).execute()
    return res.data[0]


@app.put("/api/map-custom-nodes/{node_id}")
def update_custom_node(node_id: int, data: CustomNodeUpdate, user_id: str = Depends(get_current_user)):
    patch = {k: v for k, v in data.model_dump().items() if v is not None}
    supabase_admin.table("map_custom_nodes").update(patch).eq("id", node_id).eq("user_id", user_id).execute()
    return {"ok": True}


@app.delete("/api/map-custom-nodes/{node_id}")
def delete_custom_node(node_id: int, user_id: str = Depends(get_current_user)):
    nid_str = f"cn_{node_id}"
    supabase_admin.table("map_edges").delete().eq("user_id", user_id).or_(f"source_id.eq.{nid_str},target_id.eq.{nid_str}").execute()
    supabase_admin.table("map_custom_nodes").delete().eq("id", node_id).eq("user_id", user_id).execute()
    return {"deleted": node_id}


@app.post("/api/map-edges")
def create_map_edge(data: MapEdgeCreate, user_id: str = Depends(get_current_user)):
    res = supabase_admin.table("map_edges").insert({
        "user_id": user_id, "source_id": data.source_id, "target_id": data.target_id,
        "relation_type": data.relation_type, "label": data.label,
    }).execute()
    return res.data[0]


@app.put("/api/map-edges/{edge_id}")
def update_map_edge(edge_id: int, data: MapEdgeUpdate, user_id: str = Depends(get_current_user)):
    patch = {k: v for k, v in data.model_dump().items() if v is not None}
    supabase_admin.table("map_edges").update(patch).eq("id", edge_id).eq("user_id", user_id).execute()
    return {"ok": True}


@app.delete("/api/map-edges/{edge_id}")
def delete_map_edge(edge_id: int, user_id: str = Depends(get_current_user)):
    supabase_admin.table("map_edges").delete().eq("id", edge_id).eq("user_id", user_id).execute()
    return {"deleted": edge_id}
