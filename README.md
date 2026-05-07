# Lacus

**Lacus** is a paper-based knowledge community where researchers upload academic papers and collectively build a living knowledge graph — discovering connections, tracking research fields, and discussing papers together.

> Built by a non-programmer for researchers who feel the lack of academic communication spaces online.

**Live:** [https://lacus-v2-production.up.railway.app](https://lacus-v2-production.up.railway.app)

---

## What It Does

1. **Upload a PDF** → GROBID extracts title, authors, keywords, abstract, and metrics automatically
2. **Review & Save** → AI recommends a research field, theme, and concept; user confirms or edits
3. **Knowledge Map** → Your confirmed papers appear as an interactive graph of keywords and relationships
4. **Community Map** → The landing page shows all members' confirmed papers aggregated into a shared field → theme → concept knowledge graph, with member counts per paper

---

## Features

### Landing Page — Live Knowledge Map
- Public, no login required
- Aggregates all confirmed papers across all members by **Field → Theme → Concept**
- Click a concept node to see its papers; click a paper for metadata and discussion
- Each paper card shows how many members have registered the same paper
- Discussion threads per paper (comments + replies); authors and operators can edit/delete

### Paper Analysis Pipeline
- PDF upload → GROBID parsing → keyword extraction → field detection → metrics → relations → summaries
- **Field detection** — scores paper text against ontology vocabularies (Materials Science, Physics, Chemistry, etc.) and stores the top field with confidence score
- If a paper was uploaded before field detection was added, the field is re-detected on-demand from extracted keywords when the review modal opens

### Review Modal (post-analysis)
- **Research Field** — auto-detected from ontology matching; editable text input with ranked alternative suggestions
- **Theme & Concept** — scored from title + keywords; editable inputs with AI-ranked chips
- **Keywords** — grouped by category (Material, Method, Property, Application, etc.); toggleable and editable
- Only confirmed (saved) papers appear on the public landing map; `pending_review` papers remain private

### Personal Knowledge Map
- Per-user interactive graph (Cytoscape.js) — papers as nodes, keywords as connected nodes
- Multiple layout modes; node position saving
- Custom nodes, cross-paper keyword edges, map groups
- Right-click context menu; keyword filtering

### Member System
- Sign-up / login via Supabase Auth (email + password)
- Each user owns their paper collection; RLS enforced at the database level
- Welcome modal on first login showing the field → theme → concept hierarchy

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python) |
| Frontend | Vanilla JS, HTML/CSS |
| Database | Supabase (PostgreSQL + RLS) |
| Auth | Supabase Auth |
| PDF Parsing | GROBID |
| Graph UI | Cytoscape.js |
| Deployment | Railway |

---

## Project Structure

```
lacus-v2/
├── backend/
│   ├── main.py                  # FastAPI app — all API routes
│   ├── supabase_client.py
│   └── processors/
│       ├── grobid_client.py     # PDF → structured sections
│       ├── keyword_extractor.py
│       ├── metric_extractor.py
│       ├── relation_extractor.py
│       ├── summary_generator.py
│       ├── field_classifier.py  # Ontology-based field detection
│       └── ontology/
│           └── materials_science.json
└── frontend/
    ├── landing.html             # Public landing page + knowledge map
    ├── index.html               # Main app (requires login)
    └── js/
        ├── app.js               # Core app logic + review modal
        ├── mapview.js           # Personal knowledge map
        └── storymap.js
```

---

## Getting Started (Local)

### Requirements

- Python 3.10+
- [GROBID](https://grobid.readthedocs.io/) running on `localhost:8070` (optional — for PDF analysis)
- Supabase project

### Setup

```bash
git clone https://github.com/iostreet/lacus-v2.git
cd lacus-v2

# Install Python dependencies
./setup.sh        # macOS/Linux
setup.bat         # Windows
```

### Environment Variables

Create `backend/.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
```

### Run

```bash
./start.sh        # macOS/Linux
start.bat         # Windows
```

Open [http://localhost:8000](http://localhost:8000)

---

## Deployment (Railway)

1. Fork this repository
2. Create a new Railway project and connect the GitHub repo
3. Set environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`
4. Railway auto-deploys on every push to `main`

---

## Background

This project was created by someone with no formal programming background who noticed a gap in online spaces for academic communication. Lacus is an early-stage attempt to make research more visual, connected, and community-driven.

If you are a researcher, developer, or someone interested in academic tools — collaboration and feedback are very welcome.

**Contact:** lacusnet@gmail.com

---

## License

MIT
