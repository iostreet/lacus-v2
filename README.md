# Lacus

**Lacus** is a research intelligence tool that transforms academic papers (PDF) into an interactive knowledge graph — helping researchers discover connections, keywords, and patterns across their literature.

> Built by a non-programmer for researchers who feel the lack of academic communication spaces online.

---

## Features

- **PDF Upload & Analysis** — Upload academic papers and automatically extract titles, authors, keywords, abstracts, and metrics via GROBID
- **Map View** — Visualize papers and their keyword relationships as an interactive node graph (Cytoscape.js)
- **Story Map** — Create narrative sequences linking papers into a research story
- **Board View** — Kanban-style board for organizing papers by status
- **Member System** — Sign up, log in, and manage your own paper collection (Supabase Auth)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI (Python) |
| Frontend | Vanilla JS, HTML/CSS |
| Database | Supabase (PostgreSQL) |
| PDF Parsing | GROBID |
| Graph UI | Cytoscape.js |
| Deployment | Railway |

---

## Live Demo

[https://lacus-v2-production.up.railway.app](https://lacus-v2-production.up.railway.app)

---

## Getting Started (Local)

### Requirements

- Python 3.10+
- [GROBID](https://grobid.readthedocs.io/) running on `localhost:8070` (optional — for PDF analysis)
- Supabase account

### Setup

```bash
# Clone the repository
git clone https://github.com/iostreet/lacus-v2.git
cd lacus-v2

# Run setup (installs Python dependencies)
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

## Project Background

This project was created by someone with no formal programming background who noticed a gap in online spaces for academic communication. Lacus is an early-stage attempt to make research more visual, connected, and accessible.

If you are a researcher, developer, or someone interested in academic tools — collaboration and feedback are very welcome.

**Contact:** lacusnet@gmail.com

---
