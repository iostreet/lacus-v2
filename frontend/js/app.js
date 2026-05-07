/**
 * Lacus V2 — Main frontend logic
 */

const API = '/api';

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
let papers = [];
let activePaperId = null;
let activeTab = 'overview';
let selectedPaperIds = new Set();
let selectedRelIds    = new Set();
let selectedMetIds    = new Set();
let selectedKwIds     = new Set();
let _storymapDirty = false;
let _viewMode = 'card'; // 'card' | 'map'

// ─────────────────────────────────────────────────────────────────────────────
// Toast utility
// ─────────────────────────────────────────────────────────────────────────────
const toast = (msg, type = 'ok') => {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3400);
};

// ─────────────────────────────────────────────────────────────────────────────
// Auth helpers
// ─────────────────────────────────────────────────────────────────────────────
const getAuthToken = async () => {
  if (window._authToken) return window._authToken;
  const { data: { session } } = await window._sb.auth.getSession();
  if (session) { window._authToken = session.access_token; return session.access_token; }
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────
const apiFetch = async (path, opts = {}) => {
  const token = await getAuthToken();
  const authHeader = token ? { 'Authorization': `Bearer ${token}` } : {};
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json', ...authHeader, ...opts.headers },
    ...opts,
  });
  if (res.status === 401) {
    window.location.href = '/?signin=1';
    throw new Error('Not authenticated');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
};

// ─────────────────────────────────────────────────────────────────────────────
// Papers list
// ─────────────────────────────────────────────────────────────────────────────
const loadPapers = async () => {
  try {
    papers = await apiFetch('/papers');
    if (_viewMode === 'card') {
      renderPaperCards(papers);
    } else {
      renderPaperCards(papers); // update count badge
      await loadMapView();
    }
  } catch (e) {
    toast('Failed to load papers: ' + e.message, 'error');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// View toggle (Card ↔ Map)
// ─────────────────────────────────────────────────────────────────────────────
const _setViewMode = async (mode) => {
  if (_viewMode === mode) return;
  _viewMode = mode;
  document.getElementById('view-card-btn').classList.toggle('active', mode === 'card');
  document.getElementById('view-map-btn').classList.toggle('active', mode === 'map');
  document.getElementById('papers-grid').classList.toggle('hidden', mode === 'map');
  document.getElementById('papers-map').classList.toggle('hidden', mode === 'card');
  document.getElementById('empty-state').classList.toggle('hidden', true);
  if (mode === 'map') {
    await loadMapView();
  } else {
    renderPaperCards(papers);
  }
};

document.getElementById('view-card-btn').addEventListener('click', () => _setViewMode('card'));
document.getElementById('view-map-btn').addEventListener('click', () => _setViewMode('map'));

// ─────────────────────────────────────────────────────────────────────────────
// Map View loader
// ─────────────────────────────────────────────────────────────────────────────
const loadMapView = async () => {
  try {
    MapView.init('papers-map', null, { onNodeClick: showMapNodePanel, onCanvasTap: hideMapNodePanel });
  } catch (e) {
    toast('Failed to load map view: ' + e.message, 'error');
  }
};


const escHtml = (str) =>
  String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const updateBulkBar = () => {
  const bar   = document.getElementById('bulk-bar');
  const count = document.getElementById('bulk-count');
  if (selectedPaperIds.size > 0) {
    bar.classList.remove('hidden');
    count.textContent = `${selectedPaperIds.size} selected`;
  } else {
    bar.classList.add('hidden');
  }
};

const renderPaperCards = (list) => {
  const grid       = document.getElementById('papers-grid');
  const empty      = document.getElementById('empty-state');
  const countBadge = document.getElementById('paper-count-badge');
  const sectionTitle = document.getElementById('section-title');

  countBadge.textContent = `${list.length} paper${list.length !== 1 ? 's' : ''}`;
  sectionTitle.textContent = `Papers (${list.length})`;

  if (_viewMode === 'map') {
    // In map mode: only update count badge, don't touch grid/empty-state
    return;
  }

  grid.innerHTML = '';

  if (list.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.forEach(paper => {
    const authors = Array.isArray(paper.authors)
      ? paper.authors.join(', ')
      : (paper.authors || '—');
    const shortAuthors = authors.length > 60 ? authors.substring(0, 60) + '…' : authors;
    const checked = selectedPaperIds.has(paper.id) ? 'checked' : '';

    const card = document.createElement('div');
    card.className = 'paper-card';
    card.innerHTML = `
      <div class="paper-card-checkbox">
        <input type="checkbox" class="paper-checkbox" data-id="${paper.id}" ${checked} />
        <div class="card-title">${escHtml(paper.title || 'Untitled')}</div>
      </div>
      <div class="card-authors">${escHtml(shortAuthors)}</div>
      <div class="card-meta">
        ${paper.year    ? `<span class="card-tag tag-year">${escHtml(paper.year)}</span>` : ''}
        ${paper.journal ? `<span class="card-tag tag-journal">${escHtml(paper.journal)}</span>` : ''}
        <span class="card-tag tag-status-${paper.status}">${paper.status}</span>
        ${paper.field   ? `<span class="card-field-badge">${escHtml(paper.field)}</span>` : ''}
      </div>
      <div class="card-one-liner">${escHtml(paper.one_liner || '')}</div>
      <div class="card-footer">
        <button class="btn btn-sm btn-primary view-btn" data-id="${paper.id}">View Details →</button>
        <button class="btn btn-sm btn-danger del-btn" data-id="${paper.id}" title="Delete paper">✕</button>
      </div>
    `;
    grid.appendChild(card);
  });

  // Checkbox events
  grid.querySelectorAll('.paper-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = parseInt(cb.dataset.id);
      if (cb.checked) selectedPaperIds.add(id);
      else selectedPaperIds.delete(id);
      updateBulkBar();
    });
  });

  // View / delete button events
  grid.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => openDetail(parseInt(btn.dataset.id)));
  });
  grid.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', () => deletePaper(parseInt(btn.dataset.id)));
  });
};

const filterPapers = (query) => {
  if (_viewMode === 'map') return; // map view shows all papers
  const q = query.toLowerCase();
  const filtered = papers.filter(p =>
    (p.title || '').toLowerCase().includes(q) ||
    (Array.isArray(p.authors) ? p.authors.join(' ') : (p.authors || '')).toLowerCase().includes(q) ||
    (p.doi || '').toLowerCase().includes(q)
  );
  renderPaperCards(filtered);
};

// ─────────────────────────────────────────────────────────────────────────────
// Bulk delete
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('bulk-delete-btn').addEventListener('click', async () => {
  if (selectedPaperIds.size === 0) return;
  if (!confirm(`Delete ${selectedPaperIds.size} paper(s) and all their analysis data?`)) return;
  for (const id of selectedPaperIds) {
    try { await apiFetch(`/papers/${id}`, { method: 'DELETE' }); } catch (_) {}
  }
  selectedPaperIds.clear();
  updateBulkBar();
  toast('Papers deleted.', 'ok');
  await loadPapers();
});

document.getElementById('bulk-clear-btn').addEventListener('click', () => {
  selectedPaperIds.clear();
  document.querySelectorAll('.paper-checkbox').forEach(cb => { cb.checked = false; });
  document.getElementById('select-all-checkbox').checked = false;
  updateBulkBar();
});

document.getElementById('select-all-checkbox').addEventListener('change', ({ target: { checked } }) => {
  document.querySelectorAll('.paper-checkbox').forEach(cb => {
    cb.checked = checked;
    const id = parseInt(cb.dataset.id);
    if (checked) selectedPaperIds.add(id);
    else selectedPaperIds.delete(id);
  });
  updateBulkBar();
});

// ─────────────────────────────────────────────────────────────────────────────
// Upload  (header button + full-page drag-drop)
// ─────────────────────────────────────────────────────────────────────────────
const setupUpload = () => {
  const headerBtn    = document.getElementById('upload-header-btn');
  const fileInput    = document.getElementById('file-input');
  const progressWrap = document.getElementById('upload-progress');
  const progressBar  = document.getElementById('progress-bar');
  const progressLabel = document.getElementById('progress-label');
  const progressPct   = document.getElementById('progress-pct');
  const dropOverlay  = document.getElementById('drop-overlay');

  // Header button click → open file picker
  headerBtn.addEventListener('click', () => fileInput.click());

  // Full-page drag-and-drop
  let _dragCounter = 0;
  document.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    _dragCounter++;
    dropOverlay.classList.remove('hidden');
  });
  document.addEventListener('dragleave', () => {
    _dragCounter = Math.max(0, _dragCounter - 1);
    if (_dragCounter === 0) dropOverlay.classList.add('hidden');
  });
  document.addEventListener('dragover', (e) => { e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    _dragCounter = 0;
    dropOverlay.classList.add('hidden');
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) uploadFile(fileInput.files[0]);
    fileInput.value = '';
  });

  const uploadFile = async (file) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast('Please select a PDF file.', 'error');
      return;
    }

    progressWrap.classList.remove('hidden');
    progressBar.style.width = '5%';
    progressLabel.textContent = `Importing ${file.name}…`;
    progressPct.textContent = '5%';

    const fd = new FormData();
    fd.append('file', file);

    let pollTimer = null;
    const stopPoll = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };
    const resetProgress = () => {
      progressWrap.classList.add('hidden');
      progressBar.style.width = '0%';
      progressPct.textContent = '0%';
    };

    try {
      const token = await getAuthToken();
      const authH = token ? { 'Authorization': `Bearer ${token}` } : {};
      const result = await fetch(`${API}/papers/upload`, { method: 'POST', body: fd, headers: authH });
      const data   = await result.json();
      if (!result.ok) throw new Error(data.detail || 'Import failed');

      const paperId = data.paper_id;
      let lastPct = 5;
      let lastChange = Date.now();
      const STALL_MS = 60000;

      pollTimer = setInterval(async () => {
        try {
          const prog = await apiFetch(`/papers/${paperId}/progress`);
          const pct  = prog.pct ?? 0;

          // Stall detection
          if (pct !== lastPct) {
            lastPct = pct;
            lastChange = Date.now();
          } else if (pct < 100 && pct !== -1 && Date.now() - lastChange > STALL_MS) {
            stopPoll();
            resetProgress();
            toast('Analysis stalled (>60 s). Please try a different paper.', 'warn');
            await loadPapers();
            return;
          }

          progressBar.style.width = Math.max(pct, 0) + '%';
          progressLabel.textContent = prog.step || 'Processing…';
          progressPct.textContent = pct >= 0 ? pct + '%' : '';

          if (pct === 100) {
            stopPoll();
            resetProgress();
            await loadPapers();
            showReviewModal(paperId);
          } else if (pct === -1) {
            stopPoll();
            resetProgress();
            toast('Analysis failed: ' + (prog.error || prog.step), 'error');
            await loadPapers();
          }
        } catch (_) { /* ignore transient poll errors */ }
      }, 500);

    } catch (err) {
      stopPoll();
      resetProgress();
      toast(err.message, 'error');
    }
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Delete single paper
// ─────────────────────────────────────────────────────────────────────────────
const deletePaper = async (id) => {
  if (!confirm('Delete this paper and all its analysis data?')) return;
  try {
    await apiFetch(`/papers/${id}`, { method: 'DELETE' });
    selectedPaperIds.delete(id);
    updateBulkBar();
    toast('Paper deleted.', 'ok');
    await loadPapers();
  } catch (e) {
    toast('Delete failed: ' + e.message, 'error');
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// Detail modal
// ─────────────────────────────────────────────────────────────────────────────
const openDetail = async (paperId) => {
  activePaperId = paperId;
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  try {
    const paper = await apiFetch(`/papers/${paperId}`);
    renderModalHeader(paper);
  } catch (e) { toast('Failed to load paper: ' + e.message, 'error'); }

  switchTab('overview');
};

const closeDetail = () => {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
  activePaperId = null;
};

const renderModalHeader = (paper) => {
  document.getElementById('modal-title').textContent = paper.title || 'Untitled';
  const authors = Array.isArray(paper.authors) ? paper.authors.join(', ') : (paper.authors || '—');
  document.getElementById('modal-authors').textContent = authors;

  const yearEl    = document.getElementById('modal-year');
  const journalEl = document.getElementById('modal-journal');
  const doiEl     = document.getElementById('modal-doi');

  yearEl.textContent    = paper.year    || '';
  journalEl.textContent = paper.journal || '';
  if (paper.doi) {
    doiEl.textContent = 'DOI: ' + paper.doi;
    doiEl.href = `https://doi.org/${paper.doi}`;
    doiEl.classList.remove('hidden');
  } else {
    doiEl.classList.add('hidden');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────────────────────────────────────
const switchTab = (tabName) => {
  activeTab = tabName;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${tabName}`));
  if (tabName === 'storymap') {
    _storymapDirty = false;
    _updateStorymapTabBadge();
  }
  loadTabContent(tabName);
};

const loadTabContent = async (tab) => {
  if (!activePaperId) return;
  switch (tab) {
    case 'overview':  await loadOverview();  break;
    case 'keywords':  await loadKeywords();  break;
    case 'relations': await loadRelations(); break;
    case 'metrics':   await loadMetrics();   break;
    case 'storymap':  await loadStoryMap();  break;
    case 'summary':   await loadSummary();   break;
  }
};

// Mark storymap as needing refresh; reload immediately if already visible
const refreshStorymapIfActive = async () => {
  _storymapDirty = true;
  _updateStorymapTabBadge();
  if (activeTab === 'storymap') {
    _storymapDirty = false;
    _updateStorymapTabBadge();
    await loadStoryMap();
  }
};

const _updateStorymapTabBadge = () => {
  const btn = document.querySelector('.tab-btn[data-tab="storymap"]');
  if (!btn) return;
  btn.classList.toggle('tab-dirty', _storymapDirty);
};

// ─────────────────────────────────────────────────────────────────────────────
// Overview tab
// ─────────────────────────────────────────────────────────────────────────────
const loadOverview = async () => {
  const [paper, keywords, relations, metrics, summaries] = await Promise.all([
    apiFetch(`/papers/${activePaperId}`),
    apiFetch(`/papers/${activePaperId}/keywords`),
    apiFetch(`/papers/${activePaperId}/relations`),
    apiFetch(`/papers/${activePaperId}/metrics`),
    apiFetch(`/papers/${activePaperId}/summaries`),
  ]);

  // Editable info table
  const fields = [
    { label: 'Title',   key: 'title',   value: paper.title },
    { label: 'Authors', key: 'authors', value: Array.isArray(paper.authors) ? paper.authors.join('; ') : paper.authors },
    { label: 'DOI',     key: 'doi',     value: paper.doi },
    { label: 'Journal', key: 'journal', value: paper.journal },
    { label: 'Year',    key: 'year',    value: paper.year },
  ];
  const tbody = document.querySelector('#overview-info-table tbody');
  tbody.innerHTML = '';
  fields.forEach(f => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color:var(--text-muted);white-space:nowrap">${f.label}</td>
      <td><input class="info-input" value="${escHtml(f.value || '')}" data-field="${f.key}" /></td>
      <td><button class="btn btn-sm save-field-btn" data-field="${f.key}">Save</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('.save-field-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { field } = btn.dataset;
      const input = tbody.querySelector(`input[data-field="${field}"]`);
      try {
        await apiFetch(`/papers/${activePaperId}`, {
          method: 'PUT',
          body: JSON.stringify({ [field]: input.value }),
        });
        const updated = await apiFetch(`/papers/${activePaperId}`);
        renderModalHeader(updated);
        toast('Saved.', 'ok');
        await loadPapers();
      } catch (e) { toast('Save failed: ' + e.message, 'error'); }
    });
  });

  // Stats chips
  const statsRow = document.getElementById('stats-row');
  statsRow.innerHTML = `
    <div class="stat-chip"><span class="stat-num">${keywords.length}</span><span class="stat-label">Keywords</span></div>
    <div class="stat-chip"><span class="stat-num">${relations.length}</span><span class="stat-label">Relations</span></div>
    <div class="stat-chip"><span class="stat-num">${metrics.length}</span><span class="stat-label">Metrics</span></div>
    <div class="stat-chip"><span class="stat-num">${summaries.length}</span><span class="stat-label">Summaries</span></div>
  `;

  // Relevance stars — add as last row of basic info table
  const relevanceRow = document.createElement('tr');
  relevanceRow.innerHTML = `
    <td style="color:var(--text-muted);white-space:nowrap">Relevance</td>
    <td colspan="2">
      <div class="star-rating" id="star-rating" data-value="${paper.relevance || 0}">
        ${[1,2,3,4,5].map(n =>
          `<span class="star${(paper.relevance||0) >= n ? ' filled' : ''}" data-val="${n}">★</span>`
        ).join('')}
        <span class="star-label">${paper.relevance || 0} / 5</span>
      </div>
    </td>
  `;
  tbody.appendChild(relevanceRow);
  document.getElementById('star-rating')?.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', async () => {
      const val = parseInt(star.dataset.val);
      try {
        await apiFetch(`/papers/${activePaperId}`, {
          method: 'PUT', body: JSON.stringify({ relevance: val }),
        });
        const ratingEl = document.getElementById('star-rating');
        if (ratingEl) {
          ratingEl.dataset.value = val;
          ratingEl.querySelectorAll('.star').forEach(s => {
            s.classList.toggle('filled', parseInt(s.dataset.val) <= val);
          });
          const lbl = ratingEl.querySelector('.star-label');
          if (lbl) lbl.textContent = `${val} / 5`;
        }
        toast('Relevance saved.', 'ok');
      } catch (e) { toast('Save failed: ' + e.message, 'error'); }
    });
  });

  // Key findings — editable
  const findingsList = document.getElementById('overview-key-findings');
  if (findingsList) {
    const main  = summaries.find(s => s.summary_type === 'main');
    const extra = summaries.filter(s => s.summary_type !== 'main').slice(0, 4);
    const all   = main ? [main, ...extra] : extra;
    findingsList.innerHTML = all.length
      ? all.map(s => `
          <li class="finding-item" data-id="${s.id}">
            <textarea class="finding-input">${escHtml(s.summary_text)}</textarea>
            <button class="btn btn-sm save-finding-btn" data-id="${s.id}">Save</button>
          </li>`).join('')
      : '<li style="color:var(--text-muted);font-size:0.82rem;padding:4px 0">No findings generated yet.</li>';
    findingsList.querySelectorAll('.save-finding-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { id } = btn.dataset;
        const txt = btn.closest('li').querySelector('.finding-input').value;
        try {
          await apiFetch(`/summaries/${id}`, { method: 'PUT', body: JSON.stringify({ summary_text: txt }) });
          toast('Finding saved.', 'ok');
        } catch (e) { toast('Save failed: ' + e.message, 'error'); }
      });
    });
  }

  // Memo
  const memoEl = document.getElementById('overview-memo');
  if (memoEl) memoEl.value = paper.memo || '';
  document.getElementById('save-memo-btn')?.addEventListener('click', async () => {
    const memo = document.getElementById('overview-memo')?.value || '';
    try {
      await apiFetch(`/papers/${activePaperId}`, { method: 'PUT', body: JSON.stringify({ memo }) });
      toast('Memo saved.', 'ok');
    } catch (e) { toast('Save failed: ' + e.message, 'error'); }
  });

  // Share Thoughts (DOI-based community discussion)
  if (paper.doi) {
    loadOverviewDoiComments(paper.doi);
  } else {
    const c = document.getElementById('ov-doi-comments');
    if (c) c.innerHTML = '<div style="color:var(--text-muted);font-size:.82rem">No DOI — discussions unavailable.</div>';
    document.getElementById('share-thoughts-card')?.style && (document.getElementById('share-thoughts-card').style.display = 'none');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Share Thoughts — DOI comment section in Overview tab
// ─────────────────────────────────────────────────────────────────────────────
const _e = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

const _OPERATOR_EMAIL = 'iostreet7@gmail.com';

const loadOverviewDoiComments = async (doi) => {
  const container = document.getElementById('ov-doi-comments');
  const inputEl   = document.getElementById('ov-doi-input');
  if (!container) return;

  const me = window._authUser;
  const myId = me?.id;
  const myEmail = me?.email;
  const isOperator = (myEmail === _OPERATOR_EMAIL);

  // Comment input form
  if (inputEl) {
    inputEl.innerHTML = `
      <textarea id="ov-dcp-ta" rows="2" style="width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text-primary);font-family:inherit;font-size:.82rem;padding:8px 10px;resize:none;outline:none" placeholder="Share your thoughts…"></textarea>
      <div style="display:flex;gap:8px;margin-top:6px;align-items:center">
        <button class="btn btn-sm btn-primary" id="ov-dcp-send">Post</button>
        <span id="ov-dcp-msg" style="font-size:.75rem;color:var(--text-muted)"></span>
      </div>`;
    document.getElementById('ov-dcp-send')?.addEventListener('click', async () => {
      const ta = document.getElementById('ov-dcp-ta');
      const content = ta?.value?.trim();
      if (!content) return;
      const btn = document.getElementById('ov-dcp-send');
      btn.disabled = true;
      try {
        const token = await getAuthToken();
        const res = await fetch('/api/doi-comments', {
          method: 'POST',
          headers: {'Content-Type':'application/json','Authorization':'Bearer '+token},
          body: JSON.stringify({ doi, content }),
        });
        if (res.ok) { ta.value=''; document.getElementById('ov-dcp-msg').textContent='Posted!'; loadOverviewDoiComments(doi); }
        else document.getElementById('ov-dcp-msg').textContent='Failed.';
      } catch { document.getElementById('ov-dcp-msg').textContent='Error.'; }
      btn.disabled = false;
    });
  }

  const renderComment = (c, num, numStr, isReply) => {
    const d = new Date(c.created_at);
    const dateStr = d.toLocaleDateString('en', {month:'short',day:'numeric'});
    const canEdit   = myId && c.user_id === myId;
    const canDelete = myId && (c.user_id === myId || isOperator);

    const wrap = document.createElement('div');
    wrap.style.cssText = isReply
      ? 'padding:4px 0 4px 10px;border-left:2px solid rgba(168,85,247,0.2);'
      : 'border-bottom:1px solid rgba(255,255,255,0.05);padding:6px 0;';

    const editBtnHtml   = canEdit   ? `<button class="btn btn-sm ov-edit-btn"   style="padding:1px 6px;font-size:.68rem;margin-left:4px">Edit</button>` : '';
    const deleteBtnHtml = canDelete ? `<button class="btn btn-sm ov-delete-btn" style="padding:1px 6px;font-size:.68rem;color:#f87171;margin-left:2px">Del</button>` : '';
    const replyBtnHtml  = isReply   ? '' : `<button class="ov-reply-btn btn btn-sm" style="padding:1px 6px;font-size:.68rem;margin-left:4px">↩</button>`;

    wrap.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;line-height:1.6">
        <span style="font-size:.68rem;color:var(--accent);font-weight:700;flex-shrink:0">#${numStr}</span>
        <span style="font-size:.75rem;font-weight:600;color:#c4b5fd;flex-shrink:0">${_e(c.username||'Anonymous')}</span>
        <span class="ov-cmt-body" style="font-size:.82rem;color:var(--text-muted);flex:1;min-width:0">${_e(c.content)}</span>
        <span style="font-size:.65rem;color:#334155;flex-shrink:0;white-space:nowrap">${dateStr}${replyBtnHtml}${editBtnHtml}${deleteBtnHtml}</span>
      </div>
      <div class="ov-edit-area" style="display:none;margin-top:5px"></div>
      ${isReply ? '' : `<div class="ov-reply-form" style="display:none;margin-top:5px"></div>`}
      ${isReply ? '' : `<div class="ov-reply-list" style="display:flex;flex-direction:column;gap:2px;margin-top:4px"></div>`}`;

    // Edit
    wrap.querySelector('.ov-edit-btn')?.addEventListener('click', () => {
      const bodyEl = wrap.querySelector('.ov-cmt-body');
      const editArea = wrap.querySelector('.ov-edit-area');
      if (editArea.style.display !== 'none') { editArea.style.display='none'; bodyEl.style.display=''; return; }
      bodyEl.style.display = 'none';
      editArea.style.display = 'block';
      editArea.innerHTML = `
        <textarea style="width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text-primary);font-family:inherit;font-size:.82rem;padding:7px 10px;resize:none;outline:none" rows="3">${_e(c.content)}</textarea>
        <div style="display:flex;gap:6px;margin-top:4px">
          <button class="btn btn-sm btn-primary ov-save-edit">Save</button>
          <button class="btn btn-sm ov-cancel-edit">Cancel</button>
        </div>`;
      editArea.querySelector('.ov-cancel-edit').addEventListener('click', () => { editArea.style.display='none'; bodyEl.style.display=''; });
      editArea.querySelector('.ov-save-edit').addEventListener('click', async () => {
        const newContent = editArea.querySelector('textarea').value.trim();
        if (!newContent) return;
        try {
          const token = await getAuthToken();
          const r = await fetch(`/api/doi-comments/${c.id}`, {
            method: 'PUT',
            headers: {'Content-Type':'application/json','Authorization':'Bearer '+token},
            body: JSON.stringify({ content: newContent }),
          });
          if (r.ok) { c.content = newContent; bodyEl.textContent = newContent; editArea.style.display='none'; bodyEl.style.display=''; }
          else toast('Edit failed', 'err');
        } catch { toast('Edit error', 'err'); }
      });
    });

    // Delete
    wrap.querySelector('.ov-delete-btn')?.addEventListener('click', async () => {
      if (!confirm('Delete this comment?')) return;
      try {
        const token = await getAuthToken();
        await fetch(`/api/doi-comments/${c.id}`, { method: 'DELETE', headers: {'Authorization':'Bearer '+token} });
        loadOverviewDoiComments(doi);
      } catch { toast('Delete error', 'err'); }
    });

    return wrap;
  };

  try {
    const res = await fetch('/api/public/doi-comments/'+encodeURIComponent(doi));
    const data = await res.json();
    const all = data.comments || [];
    if (!all.length) { container.innerHTML='<div style="color:var(--text-muted);font-size:.82rem">No comments yet.</div>'; return; }

    const topLevel = all.filter(c => !c.parent_comment_id);
    const byParent = {};
    all.filter(c => c.parent_comment_id).forEach(r => {
      (byParent[r.parent_comment_id] = byParent[r.parent_comment_id] || []).push(r);
    });

    container.innerHTML = '';
    topLevel.forEach((c, idx) => {
      const num = idx + 1;
      const replies = byParent[c.id] || [];
      const wrap = renderComment(c, num, String(num), false);

      // render replies immediately
      const rList = wrap.querySelector('.ov-reply-list');
      if (rList) {
        replies.forEach((r, ri) => {
          rList.appendChild(renderComment(r, num, `${num}.${ri+1}`, true));
        });
      }

      // reply button
      const replyForm = wrap.querySelector('.ov-reply-form');
      wrap.querySelector('.ov-reply-btn')?.addEventListener('click', () => {
        if (!replyForm) return;
        if (replyForm.style.display !== 'none') { replyForm.style.display='none'; return; }
        replyForm.style.display = 'block';
        replyForm.innerHTML = `
          <textarea rows="2" style="width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--text-primary);font-family:inherit;font-size:.8rem;padding:7px 10px;resize:none;outline:none" placeholder="Write a reply…"></textarea>
          <div style="display:flex;gap:6px;margin-top:4px">
            <button class="btn btn-sm btn-primary ov-post-reply">Post Reply</button>
            <button class="btn btn-sm ov-cancel-reply">Cancel</button>
          </div>`;
        replyForm.querySelector('.ov-cancel-reply').addEventListener('click', () => { replyForm.style.display='none'; });
        replyForm.querySelector('.ov-post-reply').addEventListener('click', async () => {
          const ta = replyForm.querySelector('textarea');
          const content = ta?.value?.trim();
          if (!content) return;
          try {
            const token = await getAuthToken();
            await fetch('/api/doi-comments', {method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({doi,content,parent_comment_id:c.id})});
            replyForm.style.display = 'none';
            loadOverviewDoiComments(doi);
          } catch {}
        });
      });

      container.appendChild(wrap);
    });
  } catch {
    const c2 = document.getElementById('ov-doi-comments');
    if (c2) c2.innerHTML = '<div style="color:var(--text-muted);font-size:.82rem">Could not load.</div>';
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Drag-to-reorder helper
// ─────────────────────────────────────────────────────────────────────────────
const _setupDragReorder = (tbody, reorderEndpoint) => {
  let dragging = null;

  tbody.querySelectorAll('tr').forEach(tr => {
    const handle = tr.querySelector('.drag-handle');
    if (!handle) return;
    handle.addEventListener('mousedown', () => { tr.draggable = true; });
    handle.addEventListener('mouseup',   () => { tr.draggable = false; });
  });

  tbody.addEventListener('dragstart', e => {
    dragging = e.target.closest('tr');
    if (!dragging) return;
    dragging.classList.add('row-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  tbody.addEventListener('dragover', e => {
    e.preventDefault();
    const target = e.target.closest('tr');
    if (!target || target === dragging || !tbody.contains(target)) return;
    const mid = target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
    if (e.clientY < mid) tbody.insertBefore(dragging, target);
    else tbody.insertBefore(dragging, target.nextSibling);
  });

  tbody.addEventListener('dragend', async () => {
    dragging?.classList.remove('row-dragging');
    dragging?.setAttribute('draggable', 'false');
    dragging = null;
    // Collect new order
    const items = [...tbody.querySelectorAll('tr[data-id]')].map((tr, i) => ({
      id: parseInt(tr.dataset.id), order: i,
    }));
    if (items.length && reorderEndpoint) {
      try {
        await apiFetch(reorderEndpoint, { method: 'POST', body: JSON.stringify(items) });
      } catch (_) {}
    }
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Keywords tab
// ─────────────────────────────────────────────────────────────────────────────
const CATEGORIES = ['Material','Structure','Property','Method','Application','Metric','Other'];

const _updateKwBulkBar = () => {
  const bar = document.getElementById('kw-bulk-bar');
  if (!bar) return;
  if (selectedKwIds.size > 0) {
    bar.classList.remove('hidden');
    document.getElementById('kw-bulk-count').textContent = `${selectedKwIds.size} selected`;
  } else {
    bar.classList.add('hidden');
  }
};

// ── Field classification panel ────────────────────────────────────────────────
const _fieldKeyToDisplay = (key) =>
  (key || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const loadFieldPanel = async () => {
  const panel      = document.getElementById('field-panel');
  const badgeName  = document.getElementById('field-badge-name');
  const confText   = document.getElementById('field-confidence-text');
  const altScores  = document.getElementById('field-alt-scores');
  const overrideSel = document.getElementById('field-override-select');
  const confirmBtn = document.getElementById('field-confirm-btn');
  if (!panel) return;

  let paper;
  try { paper = await apiFetch(`/papers/${activePaperId}`); }
  catch (_) { return; }

  if (!paper.field) { panel.classList.add('hidden'); return; }

  panel.classList.remove('hidden');
  badgeName.textContent = paper.field;
  confText.textContent  = paper.field_confidence != null
    ? `${Math.round(paper.field_confidence * 100)}% confidence` : '';

  altScores.innerHTML = '';
  const scores = paper.field_scores || {};
  const topKey = paper.field.toLowerCase().replace(/\s+/g, '_');
  Object.entries(scores)
    .filter(([k]) => k !== topKey)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .forEach(([k, v]) => {
      const span = document.createElement('span');
      span.textContent = `${_fieldKeyToDisplay(k)}: ${Math.round(v * 100)}%`;
      altScores.appendChild(span);
    });

  overrideSel.value = paper.field;

  const newBtn = confirmBtn.cloneNode(true);
  confirmBtn.replaceWith(newBtn);
  newBtn.addEventListener('click', async () => {
    const chosen = overrideSel.value || paper.field;
    try {
      await apiFetch(`/papers/${activePaperId}`, {
        method: 'PUT',
        body: JSON.stringify({ field: chosen }),
      });
      badgeName.textContent = chosen;
      paper.field = chosen;
      toast('Research field confirmed.', 'ok');
      await loadPapers();
    } catch (e) { toast('Save failed: ' + e.message, 'error'); }
  });
};

const loadKeywords = async () => {
  const rrBtn = document.getElementById('kw-rereview-btn');
  if (rrBtn) {
    const newBtn = rrBtn.cloneNode(true);
    rrBtn.replaceWith(newBtn);
    newBtn.addEventListener('click', () => showReviewModal(activePaperId));
  }
  const keywords = await apiFetch(`/papers/${activePaperId}/keywords`);
  document.getElementById('kw-count-label').textContent = `${keywords.length} keywords`;
  selectedKwIds.clear();
  _updateKwBulkBar();

  const tbody = document.getElementById('keywords-tbody');
  tbody.innerHTML = '';
  keywords.forEach(kw => {
    const confPct = Math.round((kw.confidence || 0) * 100);
    const tr = document.createElement('tr');
    tr.dataset.id = kw.id;
    tr.innerHTML = `
      <td class="drag-handle" title="Drag to reorder">⠿</td>
      <td style="width:28px;text-align:center">
        <input type="checkbox" class="row-cb kw-cb" data-id="${kw.id}" style="accent-color:var(--accent);cursor:pointer" />
      </td>
      <td><input class="cell-input" value="${escHtml(kw.keyword_name)}" data-id="${kw.id}" data-field="keyword_name" style="min-width:120px"/></td>
      <td><input class="cell-input" value="${escHtml(kw.normalized_name)}" data-id="${kw.id}" data-field="normalized_name" style="min-width:120px"/></td>
      <td>
        <select class="cat-select" data-id="${kw.id}" data-field="category">
          ${CATEGORIES.map(c => `<option${c === kw.category ? ' selected' : ''}>${c}</option>`).join('')}
        </select>
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          <div class="conf-bar-wrap"><div class="conf-bar" style="width:${confPct}%"></div></div>
          <span class="conf-pct-label" style="font-size:0.75rem">${confPct}%</span>
        </div>
      </td>
      <td>
        <div class="action-btns">
          <button class="btn btn-sm save-kw-btn" data-id="${kw.id}">Save</button>
          <button class="icon-btn del del-kw-btn" data-id="${kw.id}" title="Delete">✕</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Checkbox tracking
  tbody.querySelectorAll('.kw-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = parseInt(cb.dataset.id);
      if (cb.checked) selectedKwIds.add(id); else selectedKwIds.delete(id);
      _updateKwBulkBar();
    });
  });

  const selAll = document.getElementById('kw-select-all');
  if (selAll) {
    selAll.checked = false;
    selAll.onchange = () => {
      tbody.querySelectorAll('.kw-cb').forEach(cb => {
        cb.checked = selAll.checked;
        const id = parseInt(cb.dataset.id);
        if (selAll.checked) selectedKwIds.add(id); else selectedKwIds.delete(id);
      });
      _updateKwBulkBar();
    };
  }

  tbody.querySelectorAll('.save-kw-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { id } = btn.dataset;
      const row = btn.closest('tr');
      const payload = { confidence: 1.0 };
      row.querySelectorAll('[data-field]').forEach(el => { payload[el.dataset.field] = el.value; });
      try {
        await apiFetch(`/keywords/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        // Update bar to 100%
        const bar = row.querySelector('.conf-bar');
        if (bar) bar.style.width = '100%';
        const lbl = row.querySelector('.conf-pct-label');
        if (lbl) lbl.textContent = '100%';
        toast('Keyword saved.', 'ok');
        await refreshStorymapIfActive();
      } catch (e) { toast('Save failed: ' + e.message, 'error'); }
    });
  });

  tbody.querySelectorAll('.del-kw-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this keyword?')) return;
      try {
        await apiFetch(`/keywords/${btn.dataset.id}`, { method: 'DELETE' });
        selectedKwIds.delete(parseInt(btn.dataset.id));
        toast('Keyword deleted.', 'ok');
        await loadKeywords();
        await refreshStorymapIfActive();
      } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
    });
  });

  _setupDragReorder(tbody, `/papers/${activePaperId}/keywords/reorder`);
};

// ─────────────────────────────────────────────────────────────────────────────
// Relations tab
// ─────────────────────────────────────────────────────────────────────────────
const RELATION_TYPES = [
  'related_to','has_structure','has_property','affects','increases','decreases',
  'fabricated_by','measured_by','used_for','subtype_of','equivalent','has_value',
];

// Custom relation types added by the user during this session
const _customRelTypes = [];

const _relTypeOptions = (current) =>
  [...RELATION_TYPES, ..._customRelTypes]
    .map(t => `<option${t === current ? ' selected' : ''}>${t}</option>`)
    .join('') +
  '<option value="__custom__">✚ Add custom type…</option>';

const _updateRelBulkBar = () => {
  const bar = document.getElementById('rel-bulk-bar');
  if (!bar) return;
  if (selectedRelIds.size > 0) {
    bar.classList.remove('hidden');
    document.getElementById('rel-bulk-count').textContent = `${selectedRelIds.size} selected`;
  } else {
    bar.classList.add('hidden');
  }
};

const loadRelations = async () => {
  const relations = await apiFetch(`/papers/${activePaperId}/relations`);
  document.getElementById('rel-count-label').textContent = `${relations.length} relations`;
  selectedRelIds.clear();
  _updateRelBulkBar();

  const tbody = document.getElementById('relations-tbody');
  tbody.innerHTML = '';
  relations.forEach(rel => {
    const confPct = Math.round(rel.confidence * 100);
    const tr = document.createElement('tr');
    tr.dataset.id = rel.id;
    tr.innerHTML = `
      <td class="drag-handle" title="Drag to reorder">⠿</td>
      <td style="width:28px;text-align:center">
        <input type="checkbox" class="row-cb rel-cb" data-id="${rel.id}" style="accent-color:var(--accent);cursor:pointer" />
      </td>
      <td><input class="cell-input" value="${escHtml(rel.source_name)}" data-id="${rel.id}" data-field="source_name" style="min-width:100px"/></td>
      <td>
        <select class="cat-select rel-type-sel" data-id="${rel.id}" data-field="relation_type">
          ${_relTypeOptions(rel.relation_type)}
        </select>
      </td>
      <td><input class="cell-input" value="${escHtml(rel.target_name)}" data-id="${rel.id}" data-field="target_name" style="min-width:100px"/></td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          <div class="conf-bar-wrap"><div class="conf-bar" style="width:${confPct}%"></div></div>
          <span class="text-dim" style="font-size:0.75rem">${confPct}%</span>
        </div>
      </td>
      <td style="font-size:0.75rem;color:var(--text-muted)">${escHtml(rel.source_section || '')}</td>
      <td>
        <div class="action-btns">
          <button class="btn btn-sm save-rel-btn" data-id="${rel.id}">Save</button>
          <button class="icon-btn del del-rel-btn" data-id="${rel.id}" title="Delete">✕</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Checkbox tracking
  tbody.querySelectorAll('.rel-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = parseInt(cb.dataset.id);
      if (cb.checked) selectedRelIds.add(id); else selectedRelIds.delete(id);
      _updateRelBulkBar();
    });
  });

  // Select-all
  const selAll = document.getElementById('rel-select-all');
  if (selAll) {
    selAll.checked = false;
    selAll.onchange = () => {
      tbody.querySelectorAll('.rel-cb').forEach(cb => {
        cb.checked = selAll.checked;
        const id = parseInt(cb.dataset.id);
        if (selAll.checked) selectedRelIds.add(id); else selectedRelIds.delete(id);
      });
      _updateRelBulkBar();
    };
  }

  // Custom relation type in inline selects
  tbody.querySelectorAll('.rel-type-sel').forEach(sel => {
    sel.addEventListener('change', () => {
      if (sel.value !== '__custom__') return;
      const name = prompt('New relation type name:');
      if (name && name.trim()) {
        const t = name.trim();
        if (!RELATION_TYPES.includes(t) && !_customRelTypes.includes(t)) _customRelTypes.push(t);
        const opt = document.createElement('option');
        opt.value = t; opt.text = t; opt.selected = true;
        sel.insertBefore(opt, sel.querySelector('[value="__custom__"]'));
        sel.value = t;
      } else {
        // revert
        const prevVal = sel.querySelector('option[selected]')?.value || RELATION_TYPES[0];
        sel.value = prevVal;
      }
    });
  });

  tbody.querySelectorAll('.save-rel-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { id } = btn.dataset;
      const row = btn.closest('tr');
      const payload = { confidence: 1.0 };
      row.querySelectorAll('[data-field]').forEach(el => { payload[el.dataset.field] = el.value; });
      try {
        await apiFetch(`/relations/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        const bar = row.querySelector('.conf-bar');
        if (bar) bar.style.width = '100%';
        const lbl = row.querySelector('.text-dim');
        if (lbl) lbl.textContent = '100%';
        toast('Relation saved.', 'ok');
        await refreshStorymapIfActive();
      } catch (e) { toast('Save failed: ' + e.message, 'error'); }
    });
  });

  tbody.querySelectorAll('.del-rel-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this relation?')) return;
      try {
        await apiFetch(`/relations/${btn.dataset.id}`, { method: 'DELETE' });
        selectedRelIds.delete(parseInt(btn.dataset.id));
        toast('Relation deleted.', 'ok');
        await loadRelations();
        await refreshStorymapIfActive();
      } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
    });
  });

  _setupDragReorder(tbody, `/papers/${activePaperId}/relations/reorder`);
};

// Relation bulk-delete
document.getElementById('rel-bulk-delete-btn')?.addEventListener('click', async () => {
  if (selectedRelIds.size === 0) return;
  if (!confirm(`Delete ${selectedRelIds.size} relation(s)?`)) return;
  for (const id of selectedRelIds) {
    try { await apiFetch(`/relations/${id}`, { method: 'DELETE' }); } catch (_) {}
  }
  selectedRelIds.clear();
  toast('Relations deleted.', 'ok');
  await loadRelations();
  await refreshStorymapIfActive();
});
document.getElementById('rel-bulk-clear-btn')?.addEventListener('click', () => {
  selectedRelIds.clear();
  document.querySelectorAll('.rel-cb').forEach(cb => { cb.checked = false; });
  const sa = document.getElementById('rel-select-all');
  if (sa) sa.checked = false;
  _updateRelBulkBar();
});

// Keyword bulk-delete
document.getElementById('kw-bulk-delete-btn')?.addEventListener('click', async () => {
  if (selectedKwIds.size === 0) return;
  if (!confirm(`Delete ${selectedKwIds.size} keyword(s)?`)) return;
  for (const id of selectedKwIds) {
    try { await apiFetch(`/keywords/${id}`, { method: 'DELETE' }); } catch (_) {}
  }
  selectedKwIds.clear();
  toast('Keywords deleted.', 'ok');
  await loadKeywords();
  await refreshStorymapIfActive();
});
document.getElementById('kw-bulk-clear-btn')?.addEventListener('click', () => {
  selectedKwIds.clear();
  document.querySelectorAll('.kw-cb').forEach(cb => { cb.checked = false; });
  const sa = document.getElementById('kw-select-all');
  if (sa) sa.checked = false;
  _updateKwBulkBar();
});

// Add relation modal
document.getElementById('add-relation-btn').addEventListener('click', () => {
  document.getElementById('add-rel-modal').classList.remove('hidden');
});
document.getElementById('arel-cancel').addEventListener('click', () => {
  document.getElementById('add-rel-modal').classList.add('hidden');
});
document.getElementById('arel-type').addEventListener('change', (e) => {
  const wrap = document.getElementById('arel-custom-wrap');
  if (e.target.value === '__custom__') {
    wrap.style.display = 'block';
    document.getElementById('arel-custom-type').focus();
  } else {
    wrap.style.display = 'none';
  }
});
document.getElementById('arel-save').addEventListener('click', async () => {
  const src = document.getElementById('arel-source').value.trim();
  const selVal = document.getElementById('arel-type').value;
  let rel = selVal;
  if (selVal === '__custom__') {
    const custom = document.getElementById('arel-custom-type').value.trim();
    if (!custom) { toast('Enter a custom relation type.', 'warn'); return; }
    rel = custom;
    if (!RELATION_TYPES.includes(rel) && !_customRelTypes.includes(rel)) _customRelTypes.push(rel);
  }
  const tgt = document.getElementById('arel-target').value.trim();
  const ev  = document.getElementById('arel-evidence').value.trim();
  if (!src || !tgt) { toast('Source and Target are required.', 'warn'); return; }
  try {
    await apiFetch(`/papers/${activePaperId}/relations`, {
      method: 'POST',
      body: JSON.stringify({ source_name: src, relation_type: rel, target_name: tgt, evidence_text: ev }),
    });
    document.getElementById('add-rel-modal').classList.add('hidden');
    ['arel-source','arel-target','arel-evidence'].forEach(id => { document.getElementById(id).value = ''; });
    toast('Relation added.', 'ok');
    await loadRelations();
    await refreshStorymapIfActive();
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
});


// ─────────────────────────────────────────────────────────────────────────────
// Metrics tab
// ─────────────────────────────────────────────────────────────────────────────
const _updateMetBulkBar = () => {
  const bar = document.getElementById('met-bulk-bar');
  if (!bar) return;
  if (selectedMetIds.size > 0) {
    bar.classList.remove('hidden');
    document.getElementById('met-bulk-count').textContent = `${selectedMetIds.size} selected`;
  } else {
    bar.classList.add('hidden');
  }
};

const loadMetrics = async () => {
  let metrics;
  try {
    metrics = await apiFetch(`/papers/${activePaperId}/metrics`);
  } catch (e) {
    toast('Failed to load metrics: ' + e.message, 'error');
    return;
  }

  document.getElementById('met-count-label').textContent = `${metrics.length} metrics`;
  selectedMetIds.clear();
  _updateMetBulkBar();

  const tbody = document.getElementById('metrics-tbody');
  tbody.innerHTML = '';

  if (metrics.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">No metrics extracted. Use "+ Add Metric" to add manually.</td></tr>';
    return;
  }

  metrics.forEach(met => {
    const conf = met.confidence != null ? met.confidence : 0;
    const tr = document.createElement('tr');
    tr.dataset.id = met.id;
    tr.innerHTML = `
      <td class="drag-handle" title="Drag to reorder">⠿</td>
      <td style="width:28px;text-align:center">
        <input type="checkbox" class="row-cb met-cb" data-id="${met.id}" style="accent-color:var(--accent);cursor:pointer" />
      </td>
      <td><input class="cell-input" value="${escHtml(met.metric_name)}" data-id="${met.id}" data-field="metric_name" style="min-width:120px"/></td>
      <td><input class="cell-input" value="${escHtml(met.value)}"        data-id="${met.id}" data-field="value"        style="min-width:60px"/></td>
      <td><input class="cell-input" value="${escHtml(met.unit || '')}"   data-id="${met.id}" data-field="unit"         style="min-width:60px"/></td>
      <td><input class="cell-input" value="${escHtml(met.condition || '')}" data-id="${met.id}" data-field="condition" style="min-width:100px"/></td>
      <td style="font-size:0.75rem;color:var(--text-dim)">${(conf*100).toFixed(0)}%</td>
      <td>
        <div class="action-btns">
          <button class="btn btn-sm save-met-btn" data-id="${met.id}">Save</button>
          <button class="icon-btn del del-met-btn" data-id="${met.id}" title="Delete">✕</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Checkbox tracking
  tbody.querySelectorAll('.met-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = parseInt(cb.dataset.id);
      if (cb.checked) selectedMetIds.add(id); else selectedMetIds.delete(id);
      _updateMetBulkBar();
    });
  });

  // Select-all
  const selAll = document.getElementById('met-select-all');
  if (selAll) {
    selAll.checked = false;
    selAll.onchange = () => {
      tbody.querySelectorAll('.met-cb').forEach(cb => {
        cb.checked = selAll.checked;
        const id = parseInt(cb.dataset.id);
        if (selAll.checked) selectedMetIds.add(id); else selectedMetIds.delete(id);
      });
      _updateMetBulkBar();
    };
  }

  tbody.querySelectorAll('.save-met-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { id } = btn.dataset;
      const row = btn.closest('tr');
      const payload = { confidence: 1.0 };
      row.querySelectorAll('[data-field]').forEach(el => { payload[el.dataset.field] = el.value; });
      try {
        await apiFetch(`/metrics/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        const lbl = row.querySelector('td:nth-child(7)');
        if (lbl) lbl.textContent = '100%';
        toast('Metric saved.', 'ok');
        await refreshStorymapIfActive();
      } catch (e) { toast('Save failed: ' + e.message, 'error'); }
    });
  });

  tbody.querySelectorAll('.del-met-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this metric?')) return;
      try {
        await apiFetch(`/metrics/${btn.dataset.id}`, { method: 'DELETE' });
        selectedMetIds.delete(parseInt(btn.dataset.id));
        toast('Metric deleted.', 'ok');
        await loadMetrics();
        await refreshStorymapIfActive();
      } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
    });
  });

  _setupDragReorder(tbody, `/papers/${activePaperId}/metrics/reorder`);
};

// Metric bulk-delete
document.getElementById('met-bulk-delete-btn')?.addEventListener('click', async () => {
  if (selectedMetIds.size === 0) return;
  if (!confirm(`Delete ${selectedMetIds.size} metric(s)?`)) return;
  for (const id of selectedMetIds) {
    try { await apiFetch(`/metrics/${id}`, { method: 'DELETE' }); } catch (_) {}
  }
  selectedMetIds.clear();
  toast('Metrics deleted.', 'ok');
  await loadMetrics();
  await refreshStorymapIfActive();
});
document.getElementById('met-bulk-clear-btn')?.addEventListener('click', () => {
  selectedMetIds.clear();
  document.querySelectorAll('.met-cb').forEach(cb => { cb.checked = false; });
  const sa = document.getElementById('met-select-all');
  if (sa) sa.checked = false;
  _updateMetBulkBar();
});

// ── Add-metric modal ─────────────────────────────────────────────────────────
document.getElementById('add-metric-btn').addEventListener('click', () => {
  document.getElementById('add-met-modal').classList.remove('hidden');
});
document.getElementById('amet-cancel').addEventListener('click', () => {
  document.getElementById('add-met-modal').classList.add('hidden');
});
document.getElementById('amet-save').addEventListener('click', async () => {
  const name  = document.getElementById('amet-name').value.trim();
  const value = document.getElementById('amet-value').value.trim();
  const unit  = document.getElementById('amet-unit').value.trim();
  const cond  = document.getElementById('amet-cond').value.trim();
  if (!name || !value) { toast('Metric name and value are required.', 'warn'); return; }
  try {
    await apiFetch(`/papers/${activePaperId}/metrics`, {
      method: 'POST',
      body: JSON.stringify({ metric_name: name, value, unit, condition: cond }),
    });
    document.getElementById('add-met-modal').classList.add('hidden');
    ['amet-name','amet-value','amet-unit','amet-cond'].forEach(id => { document.getElementById(id).value = ''; });
    toast('Metric added.', 'ok');
    await loadMetrics();
    await refreshStorymapIfActive();
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Story Map tab — Flow View
// ─────────────────────────────────────────────────────────────────────────────

let _smFlowSlots   = {};
let _smKeywords    = [];
let _smRelations   = [];
let _smMetrics     = [];
let _smHighlightId = null;
let _smGraph       = { nodes: new Map(), edges: [] };
let _pgScale       = 1;
let _pgOffsetX     = 0;
let _pgOffsetY     = 0;
let _pgDragging    = false;
let _pgDragX       = 0;
let _pgDragY       = 0;
let _pgCanvasReady = false;

const _SM_FLOW_ORDER = ['Material', 'Structure', 'Property', 'Application'];
const _SM_CAT_COLORS = {
  Material: '#22c55e', Structure: '#3b82f6', Property: '#f59e0b',
  Method: '#a855f7', Application: '#06b6d4', Metric: '#f472b6', Other: '#64748b',
};
const _SM_CONCEPT_GROUPS = [
  { label: 'Object',      cats: ['Material', 'Structure'] },
  { label: 'Method',      cats: ['Method'] },
  { label: 'Property',    cats: ['Property'] },
  { label: 'Metric',      cats: ['Metric'] },
  { label: 'Application', cats: ['Application'] },
  { label: 'Other',       cats: ['Other'] },
];

const loadStoryMap = async () => {
  try {
    const [keywords, relations, metrics] = await Promise.all([
      apiFetch(`/papers/${activePaperId}/keywords`),
      apiFetch(`/papers/${activePaperId}/relations`),
      apiFetch(`/papers/${activePaperId}/metrics`),
    ]);
    _smKeywords  = keywords;
    _smRelations = relations;
    _smMetrics   = metrics;
    _smHighlightId = null;

    _smRenderConceptPanel();
    _smRenderRelationsPanel();
  } catch (e) {
    toast('Failed to load story map: ' + e.message, 'error');
  }
};


const _smRenderConceptPanel = () => {
  const scroll = document.getElementById('sm-concept-scroll');
  if (!scroll) return;
  let html = '';
  for (const group of _SM_CONCEPT_GROUPS) {
    const kws = _smKeywords.filter(k => group.cats.includes(k.category));
    if (!kws.length) continue;
    const dotColor = _SM_CAT_COLORS[group.cats[0]] || '#64748b';
    html += `<div class="sm-concept-section">
      <div class="sm-concept-section-title">
        <span class="sm-concept-section-dot" style="background:${dotColor}"></span>
        ${escHtml(group.label)}
      </div>
      <div class="sm-concept-chips">
        ${kws.map(kw => {
          const pct = Math.round((kw.confidence || 0) * 100);
          const col = _SM_CAT_COLORS[kw.category] || '#64748b';
          return `<span class="sm-kw-chip" data-kwid="${kw.id}" style="--kw-color:${col}" title="Click to highlight · Double-click to edit">${escHtml(kw.normalized_name || kw.keyword_name)}<span class="sm-kw-chip-conf">${pct}%</span></span>`;
        }).join('')}
      </div>
    </div>`;
  }
  scroll.innerHTML = html || '<div class="sm-empty-msg">No keywords yet.</div>';
  scroll.querySelectorAll('.sm-kw-chip').forEach(chip => {
    chip.addEventListener('click', e => { e.stopPropagation(); _smHighlight(parseInt(chip.dataset.kwid)); });
    chip.addEventListener('dblclick', e => { e.stopPropagation(); _smOpenKwEdit(chip); });
  });
};

const _smHighlight = (kwId) => {
  const same = _smHighlightId === kwId;
  _smHighlightId = same ? null : kwId;

  document.querySelectorAll('.sm-kw-chip').forEach(c =>
    c.classList.toggle('sm-highlighted', !same && parseInt(c.dataset.kwid) === kwId));

  const canvas = document.getElementById('sm-pg-canvas');
  const svgEl  = document.getElementById('sm-pg-svg');
  if (!canvas || !svgEl) return;

  if (_smHighlightId === null) {
    canvas.querySelectorAll('.pg-node').forEach(n => n.classList.remove('pg-dim', 'pg-lit'));
    svgEl.querySelectorAll('.pg-edge').forEach(e => e.classList.remove('pg-dim', 'pg-edge-active'));
    return;
  }

  // BFS from selected keyword node — collect connected subgraph
  const rootNid   = `kw_${kwId}`;
  const connected = new Set([rootNid]);
  const activeEids = new Set();
  let frontier = [rootNid];
  while (frontier.length) {
    const next = [];
    frontier.forEach(nid => {
      svgEl.querySelectorAll('.pg-edge').forEach(edgeEl => {
        const f = edgeEl.dataset.fromNid, t = edgeEl.dataset.toNid;
        if (f === nid && !connected.has(t)) { connected.add(t); next.push(t); activeEids.add(edgeEl.dataset.eid); }
        if (t === nid && !connected.has(f)) { connected.add(f); next.push(f); activeEids.add(edgeEl.dataset.eid); }
      });
    });
    frontier = next;
  }
  canvas.querySelectorAll('.pg-node').forEach(n => {
    const lit = connected.has(n.dataset.nid);
    n.classList.toggle('pg-dim', !lit);
    n.classList.toggle('pg-lit',  lit);
  });
  svgEl.querySelectorAll('.pg-edge').forEach(e => {
    const active = activeEids.has(e.dataset.eid);
    e.classList.toggle('pg-dim',         !active);
    e.classList.toggle('pg-edge-active',  active);
  });
};

const _smOpenKwEdit = (chip) => {
  document.querySelectorAll('.sm-kw-edit-popup').forEach(p => p.remove());
  const kwId = parseInt(chip.dataset.kwid);
  const kw = _smKeywords.find(k => k.id === kwId);
  if (!kw) return;
  const CATS = ['Material','Structure','Method','Property','Application','Metric','Other'];
  const popup = document.createElement('div');
  popup.className = 'sm-kw-edit-popup';
  popup.innerHTML = `
    <input type="text" class="sm-kw-edit-name" value="${escHtml(kw.keyword_name)}" />
    <select class="sm-kw-edit-cat">${CATS.map(c => `<option${c === kw.category ? ' selected' : ''}>${c}</option>`).join('')}</select>
    <div class="sm-kw-edit-actions">
      <button class="btn btn-sm btn-primary sm-kw-save">Save</button>
      <button class="btn btn-sm btn-danger sm-kw-del">Delete</button>
      <button class="btn btn-sm sm-kw-cancel">Cancel</button>
    </div>`;
  chip.appendChild(popup);
  popup.querySelector('.sm-kw-save').addEventListener('click', async e => {
    e.stopPropagation();
    const name = popup.querySelector('.sm-kw-edit-name').value.trim();
    const cat  = popup.querySelector('.sm-kw-edit-cat').value;
    if (!name) return;
    try {
      await apiFetch(`/keywords/${kwId}`, { method: 'PUT', body: JSON.stringify({ keyword_name: name, normalized_name: name, category: cat }) });
      toast('Keyword updated.', 'ok'); popup.remove(); await loadStoryMap();
    } catch (err) { toast('Save failed: ' + err.message, 'error'); }
  });
  popup.querySelector('.sm-kw-del').addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm('Delete this keyword?')) return;
    try {
      await apiFetch(`/keywords/${kwId}`, { method: 'DELETE' });
      toast('Deleted.', 'ok'); popup.remove(); await loadStoryMap();
    } catch (err) { toast('Failed: ' + err.message, 'error'); }
  });
  popup.querySelector('.sm-kw-cancel').addEventListener('click', e => { e.stopPropagation(); popup.remove(); });
  const close = e => { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
};

// ─── Pipeline graph constants ─────────────────────────────────────────────
const _PG_CAT_COLORS = {
  Material: '#22c55e', Structure: '#3b82f6', Property: '#f59e0b',
  Method: '#a855f7', Application: '#06b6d4', Metric: '#14b8a6',
  Transform: '#818cf8', Other: '#64748b',
};
const _PG_W    = 152;
const _PG_KH   = 64;
const _PG_COL_X = [24, 222, 420, 618];
const _PG_VGAP  = 14;

const _pgNodeH = n => _PG_KH + ((n.metrics||[]).length * 19);

const _smFindKw = name => {
  const n = (name || '').toLowerCase().trim();
  return _smKeywords.find(k => {
    const kn = (k.normalized_name || k.keyword_name || '').toLowerCase();
    return kn === n || kn.includes(n) || n.includes(kn);
  });
};

const _smBuildPipelineGraph = () => {
  const nodes = new Map();
  const edges = [];
  const CAT_COL = { Material:0, Structure:1, Method:1, Other:1, Property:2, Metric:2, Application:3 };

  const kwMetrics = {};
  _smMetrics.forEach(m => {
    if (m.linked_keyword_id) {
      if (!kwMetrics[m.linked_keyword_id]) kwMetrics[m.linked_keyword_id] = [];
      kwMetrics[m.linked_keyword_id].push(m);
    }
  });

  _smKeywords.forEach(kw => {
    const nid = `kw_${kw.id}`;
    const col = CAT_COL[kw.category] ?? 1;
    const metrics = kwMetrics[kw.id] || [];
    nodes.set(nid, { nid, kind:'kw', type: kw.category||'Other',
                     label: kw.normalized_name||kw.keyword_name,
                     kwId: kw.id, confidence: kw.confidence, col, metrics, x:0, y:0 });
  });

  _smRelations.forEach(rel => {
    const srcKw = _smFindKw(rel.source_name);
    const tgtKw = _smFindKw(rel.target_name);
    if (srcKw && tgtKw && srcKw.id !== tgtKw.id) {
      edges.push({ id:`er_${rel.id}`, fromNid:`kw_${srcKw.id}`, toNid:`kw_${tgtKw.id}`,
                   relType: rel.relation_type||'related_to' });
    }
  });

  return { nodes, edges };
};

const _smLayoutPipelineGraph = graph => {
  const cols = [[],[],[],[]];
  graph.nodes.forEach(n => { if (n.col >= 0 && n.col <= 3) cols[n.col].push(n); });
  const rank = { Material:0, Structure:1, Method:2, Other:3, Property:4, Application:5, Metric:6, Transform:7 };
  cols.forEach(col => col.sort((a,b) => {
    const ar = rank[a.type]??99, br = rank[b.type]??99;
    return ar !== br ? ar-br : (b.confidence||0)-(a.confidence||0);
  }));
  cols.forEach((col, ci) => {
    let y = 20;
    col.forEach(n => { n.x = _PG_COL_X[ci]; n.y = y; y += _pgNodeH(n) + _PG_VGAP; });
  });
};

const _smCreateNodeEl = node => {
  const el  = document.createElement('div');
  const col = _PG_CAT_COLORS[node.type] || '#64748b';
  el.className = 'pg-node';
  el.dataset.nid  = node.nid;
  el.dataset.kwid = node.kwId;
  el.style.cssText = `left:${node.x}px;top:${node.y}px;width:${_PG_W}px;border-color:${col}55;cursor:grab`;

  const metricsHtml = (node.metrics||[]).map(m => {
    const val = (m.value||'') + (m.unit ? ' '+m.unit : '');
    return `<div class="pg-met-row"><span class="pg-met-name">${escHtml(m.metric_name||'')}</span><span class="pg-met-val">${escHtml(val)}</span></div>`;
  }).join('');

  el.innerHTML = `
    <div class="pg-node-hd" style="background:${col}18;border-bottom:1px solid ${col}44">
      <span class="pg-icon" style="color:${col}">⬡</span>
      <span class="pg-label">${escHtml(node.label)}</span>
    </div>
    <div class="pg-node-bd">
      <span class="pg-cat" style="color:${col}">${escHtml(node.type)}</span>
      <span class="pg-conf">${Math.round((node.confidence||0)*100)}%</span>
    </div>
    ${metricsHtml}`;
  return el;
};

const _smShowTxPopup = (node, anchorEl) => {
  document.querySelectorAll('.pg-tx-popup').forEach(p => p.remove());
  const popup = document.createElement('div');
  popup.className = 'pg-tx-popup';
  popup.innerHTML = `
    <div class="pg-tx-popup-header">
      <span title="${escHtml(node.srcName||'')} → ${escHtml(node.tgtName||'')}">${escHtml(node.srcName||'?')} → ${escHtml(node.tgtName||'?')}</span>
      <button class="icon-btn pg-tx-close" style="flex-shrink:0">✕</button>
    </div>
    <div style="padding:7px 12px 3px;font-size:.7rem;color:var(--text-muted)">Relation type</div>
    <select class="mini-input" style="margin:0 12px;width:calc(100% - 24px)" id="pg-tx-sel">
      ${[...RELATION_TYPES,..._customRelTypes].map(t=>`<option${t===node.label?' selected':''}>${t}</option>`).join('')}
    </select>
    <div class="pg-tx-popup-actions">
      <button class="btn btn-sm btn-primary pg-tx-save">Save</button>
      <button class="btn btn-sm btn-danger pg-tx-del">Delete</button>
    </div>`;
  document.body.appendChild(popup);
  const rect = anchorEl.getBoundingClientRect();
  popup.style.left = Math.min(rect.left, window.innerWidth - 250) + 'px';
  popup.style.top  = (rect.bottom + 4) + 'px';

  popup.querySelector('.pg-tx-close').addEventListener('click', () => popup.remove());
  popup.querySelector('.pg-tx-save').addEventListener('click', async () => {
    const relType = popup.querySelector('#pg-tx-sel').value;
    try {
      await apiFetch(`/relations/${node.relId}`, { method:'PUT', body: JSON.stringify({ relation_type: relType }) });
      toast('Updated.', 'ok'); popup.remove(); await loadStoryMap();
    } catch (err) { toast('Failed: ' + err.message, 'error'); }
  });
  popup.querySelector('.pg-tx-del').addEventListener('click', async () => {
    if (!confirm('Delete this relation?')) return;
    try {
      await apiFetch(`/relations/${node.relId}`, { method:'DELETE' });
      toast('Deleted.', 'ok'); popup.remove(); await loadStoryMap();
    } catch (err) { toast('Failed: ' + err.message, 'error'); }
  });
  const close = e => { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
};

// ─── Pan / zoom helpers ───────────────────────────────────────────────────
const _pgApplyTransform = () => {
  const vp = document.getElementById('sm-pg-viewport');
  if (vp) vp.style.transform = `translate(${_pgOffsetX}px,${_pgOffsetY}px) scale(${_pgScale})`;
};

const _pgFit = () => {
  const canvas = document.getElementById('sm-pg-canvas');
  if (!canvas || !_smGraph.nodes.size) return;
  let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
  _smGraph.nodes.forEach(n => {
    const h = _pgNodeH(n);
    if (n.x           < minX) minX = n.x;
    if (n.y           < minY) minY = n.y;
    if (n.x + _PG_W   > maxX) maxX = n.x + _PG_W;
    if (n.y + h       > maxY) maxY = n.y + h;
  });
  const pad = 24;
  const cw = canvas.clientWidth || 400;
  const ch = canvas.clientHeight || 400;
  const gw = maxX - minX + pad * 2;
  const gh = maxY - minY + pad * 2;
  _pgScale   = Math.min(1, (cw - pad) / gw, (ch - pad) / gh);
  _pgOffsetX = (cw - gw * _pgScale) / 2 + (pad - minX) * _pgScale;
  _pgOffsetY = (ch - gh * _pgScale) / 2 + (pad - minY) * _pgScale;
  _pgApplyTransform();
};

const _pgRedrawAllEdges = () => {
  const svgEl = document.getElementById('sm-pg-svg');
  if (!svgEl) return;
  svgEl.querySelectorAll('.pg-edge').forEach(path => {
    const from = _smGraph.nodes.get(path.dataset.fromNid);
    const to   = _smGraph.nodes.get(path.dataset.toNid);
    if (!from || !to) return;
    const x1 = from.x + _PG_W, y1 = from.y + _pgNodeH(from) / 2;
    const x2 = to.x,           y2 = to.y   + _pgNodeH(to)   / 2;
    const cx = (x1 + x2) / 2;
    path.setAttribute('d', `M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`);
  });
};

const _pgInitCanvas = (canvas) => {
  if (_pgCanvasReady) return;
  _pgCanvasReady = true;

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.85 : 1.18;
    const ns = Math.max(0.1, Math.min(4, _pgScale * factor));
    _pgOffsetX = mx + (_pgOffsetX - mx) * (ns / _pgScale);
    _pgOffsetY = my + (_pgOffsetY - my) * (ns / _pgScale);
    _pgScale = ns;
    _pgApplyTransform();
  }, { passive: false });

  const onMove = e => {
    _pgOffsetX = e.clientX - _pgDragX;
    _pgOffsetY = e.clientY - _pgDragY;
    _pgApplyTransform();
  };
  const onUp = () => {
    _pgDragging = false;
    canvas.style.cursor = 'grab';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('.pg-node,.pg-ctrl-btn')) return;
    e.preventDefault();
    _pgDragging = true;
    _pgDragX = e.clientX - _pgOffsetX;
    _pgDragY = e.clientY - _pgOffsetY;
    canvas.style.cursor = 'grabbing';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
};

const _smRenderRelationsPanel = () => {
  const canvas   = document.getElementById('sm-pg-canvas');
  const svgEl    = document.getElementById('sm-pg-svg');
  const viewport = document.getElementById('sm-pg-viewport');
  if (!canvas || !svgEl || !viewport) return;

  _pgInitCanvas(canvas);
  viewport.querySelectorAll('.pg-node').forEach(n => n.remove());
  canvas.querySelectorAll('.sm-empty-msg').forEach(n => n.remove());
  svgEl.innerHTML = '';

  _smGraph = _smBuildPipelineGraph();
  _smLayoutPipelineGraph(_smGraph);
  const { nodes, edges } = _smGraph;

  if (!nodes.size) {
    const msg = document.createElement('div');
    msg.className = 'sm-empty-msg';
    msg.style.cssText = 'padding:20px;position:absolute;top:0;left:0';
    msg.textContent = 'No relations yet.';
    canvas.appendChild(msg); return;
  }

  // Size SVG large enough to cover all node positions
  let maxX = 0, maxY = 0;
  nodes.forEach(n => {
    maxX = Math.max(maxX, n.x + _PG_W + 24);
    maxY = Math.max(maxY, n.y + _pgNodeH(n) + 24);
  });
  svgEl.setAttribute('width', maxX);
  svgEl.setAttribute('height', maxY);

  // Edges (rendered first — behind nodes)
  edges.forEach(edge => {
    const from = nodes.get(edge.fromNid);
    const to   = nodes.get(edge.toNid);
    if (!from || !to) return;
    const x1 = from.x + _PG_W, y1 = from.y + _pgNodeH(from) / 2;
    const x2 = to.x,           y2 = to.y   + _pgNodeH(to)   / 2;
    const cx = (x1 + x2) / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`);
    path.setAttribute('class', 'pg-edge');
    path.dataset.fromNid = edge.fromNid;
    path.dataset.toNid   = edge.toNid;
    path.dataset.eid     = edge.id;
    svgEl.appendChild(path);
  });

  // Nodes — drag to reposition, click to highlight
  nodes.forEach(node => {
    const el = _smCreateNodeEl(node);
    let _nDragX = 0, _nDragY = 0, _nDragged = false;
    el.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      _nDragX = e.clientX; _nDragY = e.clientY; _nDragged = false;
      const onMove = ev => {
        const dx = (ev.clientX - _nDragX) / _pgScale;
        const dy = (ev.clientY - _nDragY) / _pgScale;
        if (!_nDragged && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) _nDragged = true;
        if (_nDragged) {
          node.x += dx; node.y += dy;
          el.style.left = node.x + 'px'; el.style.top = node.y + 'px';
          _nDragX = ev.clientX; _nDragY = ev.clientY;
          _pgRedrawAllEdges();
        }
      };
      const onUp = () => {
        if (!_nDragged) _smHighlight(node.kwId);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    viewport.appendChild(el);
  });

  // Auto-fit after layout paint
  setTimeout(_pgFit, 0);
};

document.getElementById('refresh-graph-btn').addEventListener('click', async () => {
  _storymapDirty = false;
  _updateStorymapTabBadge();
  await loadStoryMap();
});
document.getElementById('sm-add-rel-btn').addEventListener('click', () => {
  document.getElementById('add-rel-modal').classList.remove('hidden');
});
document.getElementById('pg-zoom-in').addEventListener('click', () => {
  const canvas = document.getElementById('sm-pg-canvas');
  if (!canvas) return;
  const { width: cw, height: ch } = canvas.getBoundingClientRect();
  const mx = cw / 2, my = ch / 2;
  const ns = Math.min(4, _pgScale * 1.25);
  _pgOffsetX = mx + (_pgOffsetX - mx) * (ns / _pgScale);
  _pgOffsetY = my + (_pgOffsetY - my) * (ns / _pgScale);
  _pgScale = ns; _pgApplyTransform();
});
document.getElementById('pg-zoom-out').addEventListener('click', () => {
  const canvas = document.getElementById('sm-pg-canvas');
  if (!canvas) return;
  const { width: cw, height: ch } = canvas.getBoundingClientRect();
  const mx = cw / 2, my = ch / 2;
  const ns = Math.max(0.1, _pgScale * 0.8);
  _pgOffsetX = mx + (_pgOffsetX - mx) * (ns / _pgScale);
  _pgOffsetY = my + (_pgOffsetY - my) * (ns / _pgScale);
  _pgScale = ns; _pgApplyTransform();
});
document.getElementById('pg-fit-btn').addEventListener('click', _pgFit);

// ─────────────────────────────────────────────────────────────────────────────
// Summary tab
// ─────────────────────────────────────────────────────────────────────────────
const loadSummary = async () => {
  const summaries = await apiFetch(`/papers/${activePaperId}/summaries`);
  const main     = summaries.find(s => s.summary_type === 'main');
  const relBased = summaries.filter(s => s.summary_type === 'relation_based');
  const metBased = summaries.filter(s => s.summary_type === 'metric_based');

  document.getElementById('main-summary').textContent = main ? main.summary_text : '—';

  const relList = document.getElementById('rel-summaries');
  relList.innerHTML = relBased.map(s => `
    <li class="summary-item">
      <svg class="summary-item-icon" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2">
        <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3"/>
      </svg>
      ${escHtml(s.summary_text)}
    </li>
  `).join('') || '<li style="color:var(--text-muted);font-size:0.82rem">No relation-based summaries.</li>';

  const metList = document.getElementById('met-summaries');
  metList.innerHTML = metBased.map(s => `
    <li class="summary-item">
      <svg class="summary-item-icon" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" stroke-width="2">
        <path d="M3 12h18M12 3v18"/>
      </svg>
      ${escHtml(s.summary_text)}
    </li>
  `).join('') || '<li style="color:var(--text-muted);font-size:0.82rem">No metric-based summaries.</li>';
};

// ─────────────────────────────────────────────────────────────────────────────
// Modal close
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('modal-close').addEventListener('click', closeDetail);

document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeDetail();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });

// Tab navigation
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});


// ─────────────────────────────────────────────────────────────────────────────
// Map view — node summary panel
// ─────────────────────────────────────────────────────────────────────────────
const _CAT_COLORS = {
  Material: '#22c55e', Structure: '#3b82f6', Property: '#f59e0b',
  Method: '#a855f7', Application: '#06b6d4', Metric: '#f472b6', Other: '#64748b',
};

// ── Review Modal ──────────────────────────────────────────────────────────────
const _rvKwState = new Map(); // id → {category, include}

const showReviewModal = async (paperId) => {
  let data;
  try { data = await apiFetch(`/papers/${paperId}/review`); }
  catch (e) {
    console.error('Review fetch failed:', e);
    toast('Failed to load analysis results: ' + (e.message || e), 'error');
    return;
  }

  _rvKwState.clear();
  data.keywords.forEach(kw => _rvKwState.set(kw.id, { category: kw.category, include: true }));

  const overlay = document.getElementById('rv-overlay');
  document.getElementById('rv-paper-title').textContent = data.title || '';

  // Pre-fill Field selector
  _rvInitFieldSelect(data.field, data.field_confidence, data.field_scores);

  // Pre-fill Theme & Concept with auto-assigned values, then load recommendations
  document.getElementById('rv-tc-theme-input').value   = data.theme   || '';
  document.getElementById('rv-tc-concept-input').value = data.concept || '';
  document.getElementById('rv-tc-theme-alts').innerHTML   = '';
  document.getElementById('rv-tc-concept-alts').innerHTML = '';
  _rvLoadRecommendations(paperId);

  _rvRenderGroups(data.keywords);

  // footer hint
  const total = data.keywords.length;
  document.getElementById('rv-footer-hint').textContent = `${total} keywords extracted`;

  overlay.classList.remove('hidden');

  // + 추가 버튼
  const addBtn = document.getElementById('rv-add-kw-btn');
  const newAddBtn = addBtn.cloneNode(true);
  addBtn.replaceWith(newAddBtn);
  newAddBtn.addEventListener('click', () => {
    const inp = document.getElementById('rv-new-kw-input');
    const cat = document.getElementById('rv-new-kw-cat').value;
    const name = inp.value.trim();
    if (!name) return;
    const fakeId = `new_${Date.now()}`;
    _rvKwState.set(fakeId, { category: cat, include: true, isNew: true, name });
    data.keywords.push({ id: fakeId, keyword_name: name, normalized_name: name.toLowerCase(), category: cat, confidence: 1.0 });
    _rvRenderGroups(data.keywords);
    inp.value = '';
  });

  // 닫기
  const closeOverlay = () => overlay.classList.add('hidden');
  document.getElementById('rv-close-btn').onclick = closeOverlay;
  document.getElementById('rv-later-btn').onclick  = closeOverlay;

  // Save button — reset state first so re-opening modal never shows a stuck "Saving…" clone
  const saveBtn = document.getElementById('rv-save-btn');
  saveBtn.disabled = false;
  saveBtn.textContent = 'Save to DB →';
  const newSave = saveBtn.cloneNode(true);
  saveBtn.replaceWith(newSave);
  newSave.addEventListener('click', async () => {
    newSave.disabled = true;
    newSave.textContent = 'Saving…';
    try {
      const kwPayload = [];
      for (const [id, st] of _rvKwState.entries()) {
        if (st.isNew && st.include) {
          // new keyword: insert first
          try {
            await apiFetch(`/papers/${paperId}/keywords`, {
              method: 'POST',
              body: JSON.stringify({ keyword_name: st.name, normalized_name: st.name.toLowerCase(), category: st.category, confidence: 1.0 }),
            });
          } catch (_) {}
        } else if (!st.isNew) {
          kwPayload.push({ id, category: st.category, include: st.include });
        }
      }
      const field   = document.getElementById('rv-field-input')?.value.trim() || null;
      const theme   = (document.getElementById('rv-tc-theme-input')?.value.trim())   || null;
      const concept = (document.getElementById('rv-tc-concept-input')?.value.trim()) || null;
      await apiFetch(`/papers/${paperId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ field, keywords: kwPayload, theme, concept }),
      });
      closeOverlay();
      await loadPapers();
      toast('Saved successfully!', 'ok');
    } catch (e) {
      toast('Save failed: ' + e.message, 'error');
      newSave.disabled = false;
      newSave.textContent = 'Save to DB →';
    }
  });
};

const _RV_FIELDS = [
  'Materials Science',
  'Physics',
  'Chemistry',
  'Biology',
  'Biomedical Engineering',
  'Computer Science',
  'Environmental Science',
  'Earth Science',
  'Electrical Engineering',
  'Chemical Engineering',
  'Mechanical Engineering',
  'Mathematics',
  'Astronomy',
  'Neuroscience',
  'Psychology',
  'Economics',
  'Other',
];

// Pack key → canonical display name (for field_scores ranking)
const _FIELD_PACK_MAP = {
  materials_science:       'Materials Science',
  physics:                 'Physics',
  chemistry:               'Chemistry',
  biology:                 'Biology',
  biomedical_engineering:  'Biomedical Engineering',
  computer_science:        'Computer Science',
  environmental_science:   'Environmental Science',
  earth_science:           'Earth Science',
  electrical_engineering:  'Electrical Engineering',
  chemical_engineering:    'Chemical Engineering',
  mechanical_engineering:  'Mechanical Engineering',
  mathematics:             'Mathematics',
  astronomy:               'Astronomy',
  neuroscience:            'Neuroscience',
  psychology:              'Psychology',
  economics:               'Economics',
};

const _rvInitFieldSelect = (currentField, fieldConf, fieldScores) => {
  const input = document.getElementById('rv-field-input');
  const alts  = document.getElementById('rv-field-alts');
  if (!input) return;

  // Pre-fill with AI-detected field; fall back to top of field_scores
  let topField = currentField;
  if (!topField && fieldScores) {
    const topKey = Object.entries(fieldScores).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topKey) topField = _FIELD_PACK_MAP[topKey] || null;
  }
  input.value = topField || '';

  // Build ranked alternatives from field_scores, then fill remaining from canonical list
  const scored = Object.entries(fieldScores || {})
    .map(([k, v]) => ({ name: _FIELD_PACK_MAP[k] || null, score: Math.round(v * 100) }))
    .filter(r => r.name)
    .sort((a, b) => b.score - a.score);

  const scoredNames = scored.map(r => r.name);
  const remaining = _RV_FIELDS.filter(f => !scoredNames.includes(f) && f !== 'Other');
  const allRanked = [
    ...scored,
    ...remaining.map(f => ({ name: f, score: null })),
  ];

  const renderFieldAlts = () => {
    if (!alts) return;
    alts.innerHTML = '';
    const current = input.value.trim().toLowerCase();
    const suggestions = allRanked.filter(r => r.name.toLowerCase() !== current).slice(0, 5);
    if (!suggestions.length) return;
    const label = document.createElement('span');
    label.className = 'rv-tc-alts-label';
    label.textContent = 'Other suggestions:';
    alts.appendChild(label);
    suggestions.forEach(r => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'rv-tc-alt-chip';
      chip.innerHTML = r.score != null
        ? `${escHtml(r.name)} <span class="rv-tc-alt-pct">${r.score}%</span>`
        : escHtml(r.name);
      chip.addEventListener('click', () => {
        input.value = r.name;
        renderFieldAlts();
      });
      alts.appendChild(chip);
    });
  };

  renderFieldAlts();
  input.addEventListener('input', renderFieldAlts);
};

const _rvLoadRecommendations = async (paperId) => {
  const loadingEl = document.getElementById('rv-tc-loading');
  if (loadingEl) loadingEl.classList.remove('hidden');

  try {
    const rec = await apiFetch(`/papers/${paperId}/recommend-theme-concept`);
    if (loadingEl) loadingEl.classList.add('hidden');

    const themeInput   = document.getElementById('rv-tc-theme-input');
    const conceptInput = document.getElementById('rv-tc-concept-input');
    const themeAlts    = document.getElementById('rv-tc-theme-alts');
    const conceptAlts  = document.getElementById('rv-tc-concept-alts');
    if (!themeInput || !conceptInput) return;

    // Pre-fill field input if still empty (async detection from keywords)
    const fieldInput = document.getElementById('rv-field-input');
    if (fieldInput && !fieldInput.value && rec.field) {
      fieldInput.value = rec.field;
      // Re-initialize field alts with the now-available field_scores
      _rvInitFieldSelect(rec.field, null, rec.field_scores || {});
    }

    // Pre-fill with top recommendation if input is still empty
    const topTheme   = rec.themes?.[0];
    const topConcept = rec.concepts?.[0];
    if (topTheme   && !themeInput.value)   themeInput.value   = topTheme.name;
    if (topConcept && !conceptInput.value) conceptInput.value = topConcept.name;

    // Render alternatives (skip the one already in the input)
    const renderAlts = (recs, container, inputEl) => {
      if (!container) return;
      container.innerHTML = '';
      const current = inputEl.value.trim().toLowerCase();
      const alts = (recs || []).filter(r => r.name.toLowerCase() !== current).slice(0, 3);
      if (!alts.length) return;
      const label = document.createElement('span');
      label.className = 'rv-tc-alts-label';
      label.textContent = 'Other suggestions:';
      container.appendChild(label);
      alts.forEach(r => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'rv-tc-alt-chip';
        chip.innerHTML = `${escHtml(r.name)} <span class="rv-tc-alt-pct">${r.score}%</span>`;
        chip.addEventListener('click', () => {
          inputEl.value = r.name;
          renderAlts(recs, container, inputEl); // refresh alts excluding new value
        });
        container.appendChild(chip);
      });
    };

    renderAlts(rec.themes,   themeAlts,   themeInput);
    renderAlts(rec.concepts, conceptAlts, conceptInput);

    // Re-render alts when user manually edits the inputs
    themeInput.addEventListener('input',   () => renderAlts(rec.themes,   themeAlts,   themeInput), { once: true });
    conceptInput.addEventListener('input', () => renderAlts(rec.concepts, conceptAlts, conceptInput), { once: true });

  } catch (err) {
    console.error('Recommendation API failed:', err);
    if (loadingEl) {
      loadingEl.classList.remove('hidden');
      loadingEl.textContent = 'Could not load recommendations';
    }
  }
};

const _rvRenderGroups = (keywords) => {
  const container = document.getElementById('rv-kw-groups');
  container.innerHTML = '';
  const CAT_ORDER = ['Material','Structure','Method','Property','Application','Metric','Other'];
  const groups = {};
  CAT_ORDER.forEach(c => { groups[c] = []; });
  keywords.forEach(kw => {
    const state = _rvKwState.get(kw.id);
    const cat = state ? state.category : kw.category;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(kw);
  });

  CAT_ORDER.forEach(cat => {
    const kws = groups[cat];
    if (!kws || kws.length === 0) return;
    const block = document.createElement('div');
    block.className = 'rv-cat-block';
    const color = _CAT_COLORS[cat] || '#64748b';
    block.innerHTML = `<div class="rv-cat-title">
      <span class="rv-cat-dot" style="background:${color}"></span>
      ${cat} <span class="rv-cat-count">(${kws.length})</span>
    </div>`;
    kws.forEach(kw => {
      const state = _rvKwState.get(kw.id);
      const included = state ? state.include : true;
      const confPct = Math.round((kw.confidence || 0) * 100);
      const row = document.createElement('div');
      row.className = 'rv-kw-row' + (included ? '' : ' rv-kw-unchecked');
      row.innerHTML = `
        <input type="checkbox" class="rv-kw-cb" ${included ? 'checked' : ''} style="accent-color:var(--accent)" />
        <span class="rv-kw-name" title="${escHtml(kw.keyword_name)}">${escHtml(kw.keyword_name)}</span>
        <div class="rv-kw-bar-wrap"><div class="rv-kw-bar" style="width:${confPct}%;background:${color}"></div></div>
        <span class="rv-kw-pct">${confPct}%</span>
        <select class="mini-input rv-kw-cat-select">
          ${['Material','Structure','Property','Method','Application','Metric','Other'].map(c => `<option value="${c}" ${c === (state?.category || kw.category) ? 'selected' : ''}>${c}</option>`).join('')}
        </select>`;
      const cb  = row.querySelector('.rv-kw-cb');
      const sel = row.querySelector('.rv-kw-cat-select');
      cb.addEventListener('change', () => {
        const s = _rvKwState.get(kw.id) || { category: kw.category, include: true };
        s.include = cb.checked;
        _rvKwState.set(kw.id, s);
        row.className = 'rv-kw-row' + (cb.checked ? '' : ' rv-kw-unchecked');
      });
      sel.addEventListener('change', () => {
        const s = _rvKwState.get(kw.id) || { category: kw.category, include: true };
        s.category = sel.value;
        _rvKwState.set(kw.id, s);
      });
      block.appendChild(row);
    });
    container.appendChild(block);
  });
};

let _mnpPaperId = null;

const hideMapNodePanel = () => {
  document.getElementById('map-node-panel')?.classList.add('hidden');
  _mnpPaperId = null;
};

const showMapNodePanel = async ({ type, paperId, kwId, nodeData }) => {
  const panel = document.getElementById('map-node-panel');
  const body  = document.getElementById('map-node-panel-body');
  const lbl   = document.getElementById('mnp-type-label');
  const footer = document.getElementById('map-node-panel-footer');
  if (!panel || !body) return;

  panel.classList.remove('hidden');
  body.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;padding:4px 0">Loading…</div>';
  _mnpPaperId = paperId || null;

  // Update footer visibility
  const openBtn = document.getElementById('map-node-panel-open');

  try {
    if (type === 'paper') {
      if (lbl) lbl.textContent = 'Paper';
      if (openBtn) openBtn.style.display = '';

      // New Map View passes pre-fetched data in nodeData (has keywords[], metrics[], summary, mediums[])
      const nd = nodeData || {};
      const isNewFormat = Array.isArray(nd.keywords) && nd.keywords.length > 0 && typeof nd.keywords[0] === 'string';

      if (isNewFormat) {
        // ── New Map View layout (theme → concept) ─────────────────────────
        const pathHtml = (nd.theme || nd.concept)
          ? `<div class="mnp-group-path">
              ${nd.theme   ? `<span class="mnp-gp-lg">${escHtml(nd.theme)}</span>` : ''}
              ${nd.concept ? `<span class="mnp-gp-sep">›</span><span class="mnp-gp-med">${escHtml(nd.concept)}</span>` : ''}
            </div>`
          : '';
        const kwHtml = (nd.keywords || []).filter(Boolean).slice(0, 6)
          .map(k => `<span class="mnp-kw-name-chip">${escHtml(k)}</span>`).join('');
        const metHtml = (nd.metrics || []).filter(m => m.name).slice(0, 4)
          .map(m => `<div class="mnp-met-row"><span class="mnp-met-row-name">${escHtml(m.name)}</span><span class="mnp-met-row-val">${escHtml(m.value||'')}${m.unit?' '+escHtml(m.unit):''}</span></div>`).join('');
        const sumHtml = nd.summary
          ? `<div class="mnp-section-label">Core Summary</div><div class="mnp-summary-text">${escHtml(nd.summary)}</div>` : '';

        body.innerHTML = `
          <div class="mnp-title">${escHtml(nd.title || 'Untitled')}</div>
          <div class="mnp-meta">${nd.year ? escHtml(nd.year) : ''}</div>
          ${pathHtml}
          ${kwHtml ? `<div class="mnp-section-label">Key Concepts</div><div class="mnp-kw-names">${kwHtml}</div>` : ''}
          ${metHtml ? `<div class="mnp-section-label">Metrics</div><div class="mnp-met-list">${metHtml}</div>` : ''}
          ${sumHtml}
        `;
      } else {
        // ── Legacy layout (old Map View / Cytoscape) ──────────────────────
        const p = papers.find(x => x.id === paperId) || await apiFetch(`/papers/${paperId}`);
        const kwCats = { Material:0, Structure:0, Method:0, Property:0, Application:0, Metric:0, Other:0 };
        (await apiFetch(`/papers/${paperId}/keywords`)).forEach(k => { if (kwCats[k.category] !== undefined) kwCats[k.category]++; });
        body.innerHTML = `
          <div class="mnp-title">${escHtml(p.title || 'Untitled')}</div>
          <div class="mnp-meta">${[p.year, p.journal].filter(Boolean).map(escHtml).join(' · ')}</div>
          ${p.authors ? `<div class="mnp-meta" style="margin-bottom:8px">${escHtml((p.authors || []).slice(0,3).join(', '))}</div>` : ''}
          <div class="mnp-kw-chips" style="margin-bottom:10px">
            ${Object.entries(kwCats).filter(([,v])=>v>0).map(([cat,cnt])=>{
              const col=_CAT_COLORS[cat]||'#64748b';
              return `<span class="mnp-kw-chip" style="color:${col};border-color:${col}44">${escHtml(cat)} ${cnt}</span>`;
            }).join('')}
          </div>
          <hr class="mnp-divider">
          <div class="mnp-section-label">Relevance</div>
          <div id="mnp-stars" style="display:flex;gap:6px;margin-bottom:10px">
            ${[1,2,3,4,5].map(n=>`<span class="mnp-star" data-v="${n}" style="cursor:pointer;font-size:1.2rem;color:${(p.relevance||0)>=n?'#eab308':'#334155'}" title="${n}">★</span>`).join('')}
          </div>
          <div class="mnp-section-label">Memo</div>
          <textarea id="mnp-memo" class="mv-nd-textarea" rows="4" style="margin-bottom:8px">${escHtml(p.memo||'')}</textarea>
          <button class="btn btn-sm btn-primary" id="mnp-paper-save" style="width:100%">Save Memo</button>
        `;
        let selRel = p.relevance || 0;
        body.querySelectorAll('.mnp-star').forEach(s => {
          s.onclick = () => {
            selRel = parseInt(s.dataset.v);
            body.querySelectorAll('.mnp-star').forEach(x => { x.style.color = parseInt(x.dataset.v) <= selRel ? '#eab308' : '#334155'; });
          };
        });
        body.querySelector('#mnp-paper-save').onclick = async () => {
          const memo = body.querySelector('#mnp-memo').value;
          try { await apiFetch(`/papers/${paperId}`, { method: 'PUT', body: JSON.stringify({ memo, relevance: selRel }) }); toast('Saved', 'ok'); } catch(e) { toast(e.message, 'error'); }
        };
      }

    } else if (type === 'keyword') {
      if (lbl) lbl.textContent = 'Keyword';
      if (openBtn) openBtn.style.display = 'none';
      const d = nodeData || {};
      const col = _CAT_COLORS[d.category] || '#94a3b8';
      const pct = Math.round((d.confidence || 0) * 100);
      const CATS = ['Material','Structure','Method','Property','Application','Metric','Other'];
      body.innerHTML = `
        <span class="mnp-badge" style="background:${col}22;color:${col};border:1px solid ${col}44">${escHtml(d.category||'')}</span>
        <div class="mnp-kw-name">${escHtml(d.label||d.normalized||'')}</div>
        <div class="mnp-conf-wrap">
          <div class="mnp-conf-track"><div class="mnp-conf-bar" style="width:${pct}%;background:${col}"></div></div>
          <span class="mnp-conf-pct">${pct}%</span>
        </div>
        <hr class="mnp-divider">
        <div class="mnp-section-label">Category</div>
        <select class="mv-nd-select" id="mnp-kw-cat" style="margin-bottom:10px">
          ${CATS.map(c=>`<option value="${c}"${c===d.category?' selected':''}>${c}</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-primary" id="mnp-kw-save" style="width:100%">Save Category</button>
      `;
      body.querySelector('#mnp-kw-save').onclick = async () => {
        if (!kwId) return;
        const cat = body.querySelector('#mnp-kw-cat').value;
        try {
          await apiFetch(`/keywords/${kwId}`, { method: 'PUT', body: JSON.stringify({ category: cat }) });
          toast('Category saved', 'ok');
        } catch(e) { toast(e.message, 'error'); }
      };

    } else if (type === 'custom') {
      if (lbl) lbl.textContent = 'Custom Node';
      if (openBtn) openBtn.style.display = 'none';
      const d = nodeData || {};
      const CATS = ['Material','Structure','Method','Property','Application','Metric','Custom','Other'];
      body.innerHTML = `
        <div class="mnp-section-label">Label</div>
        <input class="mv-nd-input" id="mnp-cn-label" value="${escHtml(d.label||'')}" style="margin-bottom:8px" />
        <div class="mnp-section-label">Type</div>
        <select class="mv-nd-select" id="mnp-cn-cat" style="margin-bottom:8px">
          ${CATS.map(c=>`<option value="${c}"${c===d.category?' selected':''}>${c}</option>`).join('')}
        </select>
        <div class="mnp-section-label">Description</div>
        <textarea class="mv-nd-textarea" id="mnp-cn-desc" rows="3" style="margin-bottom:8px">${escHtml(d.description||'')}</textarea>
        <div class="mnp-section-label">Color</div>
        <input type="color" id="mnp-cn-color" value="${escHtml(d.color||'#64748b')}" style="width:100%;height:30px;border:none;border-radius:4px;cursor:pointer;margin-bottom:10px" />
        <button class="btn btn-sm btn-primary" id="mnp-cn-save" style="width:100%;margin-bottom:6px">Save</button>
        <button class="btn btn-sm btn-danger" id="mnp-cn-del" style="width:100%">Delete</button>
      `;
      body.querySelector('#mnp-cn-save').onclick = async () => {
        const { nodeId } = d;
        if (!nodeId) return;
        const label = body.querySelector('#mnp-cn-label').value;
        const category = body.querySelector('#mnp-cn-cat').value;
        const description = body.querySelector('#mnp-cn-desc').value;
        const color = body.querySelector('#mnp-cn-color').value;
        try { await apiFetch(`/map-custom-nodes/${nodeId}`, { method: 'PUT', body: JSON.stringify({ label, category, description, color }) }); toast('Saved', 'ok'); } catch(e) { toast(e.message, 'error'); }
      };
      body.querySelector('#mnp-cn-del').onclick = async () => {
        if (!confirm('Delete this node?')) return;
        const { nodeId } = d;
        if (!nodeId) return;
        try { await apiFetch(`/map-custom-nodes/${nodeId}`, { method: 'DELETE' }); hideMapNodePanel(); loadMapView(); } catch(e) { toast(e.message, 'error'); }
      };

    } else if (type === 'group') {
      if (lbl) lbl.textContent = 'Group';
      if (openBtn) openBtn.style.display = 'none';
      const d = nodeData || {};
      body.innerHTML = `
        <div class="mnp-section-label">Group Name</div>
        <input class="mv-nd-input" id="mnp-grp-name" value="${escHtml(d.label||'')}" style="margin-bottom:8px" />
        <div class="mnp-section-label">Color</div>
        <input type="color" id="mnp-grp-color" value="${escHtml(d.color||'#334155')}" style="width:100%;height:30px;border:none;border-radius:4px;cursor:pointer;margin-bottom:10px" />
        <div class="mnp-section-label">Papers (${(d.paper_ids||[]).length})</div>
        <div style="margin-bottom:10px">
          ${(d.paper_ids||[]).map(pid => {
            const p = papers.find(x=>x.id===pid);
            return `<div style="font-size:0.75rem;color:var(--text-dim);padding:2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">• ${escHtml(p?p.title:'Paper '+pid)}</div>`;
          }).join('')}
        </div>
        <button class="btn btn-sm btn-primary" id="mnp-grp-save" style="width:100%;margin-bottom:6px">Save</button>
        <button class="btn btn-sm btn-danger" id="mnp-grp-del" style="width:100%">Dissolve Group</button>
      `;
      body.querySelector('#mnp-grp-save').onclick = async () => {
        const { groupId } = d;
        if (!groupId) return;
        const name  = body.querySelector('#mnp-grp-name').value;
        const color = body.querySelector('#mnp-grp-color').value;
        try {
          await apiFetch(`/map-groups/${groupId}`, { method: 'PUT', body: JSON.stringify({ name, color }) });
          toast('Saved', 'ok');
          if (window.MapView) MapView.refreshGroup({ id: groupId, name, color, paper_ids: d.paper_ids || [] });
        } catch(e) { toast(e.message, 'error'); }
      };
      body.querySelector('#mnp-grp-del').onclick = async () => {
        if (!confirm('Dissolve this group?')) return;
        const { groupId } = d;
        if (!groupId) return;
        hideMapNodePanel();
        if (window.MapView) await MapView.deleteGroup(groupId);
      };

    } else {
      // Legacy: Metric type (backward compat)
      if (lbl) lbl.textContent = 'Metric';
      if (openBtn) openBtn.style.display = '';
      const metrics = await apiFetch(`/papers/${paperId}/metrics`);
      const kwName  = (nodeData.label || '').toLowerCase().trim();
      const matched = metrics.filter(m => {
        if (kwId && m.linked_keyword_id === kwId) return true;
        const mname = (m.metric_name || '').toLowerCase().trim();
        return mname === kwName || kwName.includes(mname) || mname.includes(kwName);
      });
      if (matched.length === 0) { hideMapNodePanel(); return; }
      const col = _CAT_COLORS['Metric'];
      body.innerHTML = `
        <span class="mnp-badge" style="background:${col}22;color:${col};border:1px solid ${col}44">Metric</span>
        <div class="mnp-kw-name">${escHtml(nodeData.label)}</div>
        <hr class="mnp-divider">
        ${matched.map(m => `
          <div style="margin-bottom:10px">
            <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:2px">
              <span style="font-size:1.4rem;font-weight:700;color:${col}">${escHtml(m.value)}</span>
              ${m.unit?`<span style="font-size:0.85rem;color:var(--text-dim)">${escHtml(m.unit)}</span>`:''}
            </div>
            ${m.condition?`<div class="mnp-meta" style="margin-bottom:0">조건: ${escHtml(m.condition)}</div>`:''}
          </div>
        `).join('<hr class="mnp-divider">')}
      `;
    }
  } catch (e) {
    body.innerHTML = `<div style="color:var(--danger);font-size:0.78rem">${escHtml(e.message)}</div>`;
  }
};

document.getElementById('map-node-panel-close')?.addEventListener('click', hideMapNodePanel);
document.getElementById('map-node-panel-open')?.addEventListener('click', () => {
  if (_mnpPaperId) openDetail(_mnpPaperId);
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin panel
// ─────────────────────────────────────────────────────────────────────────────
const openAdmin = async () => {
  document.getElementById('admin-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Populate paper selector
  const sel = document.getElementById('admin-paper-select');
  sel.innerHTML = papers.map(p =>
    `<option value="${p.id}">${escHtml(p.title || `Paper #${p.id}`)}</option>`
  ).join('');

  const loadAdminPaper = async (id) => {
    const body = document.getElementById('admin-body');
    body.innerHTML = '<p style="color:var(--text-muted)">Loading…</p>';
    try {
      const d = await apiFetch(`/admin/papers/${id}`);
      const p = d.paper;
      body.innerHTML = `
        <div class="admin-section">
          <h3>Paper Info</h3>
          <table class="admin-table">
            <tr><th>Title</th><td>${escHtml(p.title)}</td></tr>
            <tr><th>Authors</th><td>${escHtml(Array.isArray(p.authors) ? p.authors.join('; ') : p.authors)}</td></tr>
            <tr><th>Year</th><td>${escHtml(p.year)}</td></tr>
            <tr><th>Journal</th><td>${escHtml(p.journal)}</td></tr>
            <tr><th>DOI</th><td>${escHtml(p.doi)}</td></tr>
            <tr><th>PDF path</th><td style="font-size:0.75rem;word-break:break-all">${escHtml(p.pdf_path)}</td></tr>
          </table>
        </div>
        <div class="admin-section">
          <h3>Abstract</h3>
          <pre class="admin-pre">${escHtml(p.abstract || '—')}</pre>
        </div>
        <div class="admin-section">
          <h3>Keywords (${d.keywords.length})</h3>
          <table class="admin-table">
            <thead><tr><th>ID</th><th>Name</th><th>Normalized</th><th>Category</th><th>Confidence</th></tr></thead>
            <tbody>${d.keywords.map(k => `
              <tr>
                <td>${k.id}</td>
                <td>${escHtml(k.keyword_name)}</td>
                <td>${escHtml(k.normalized_name)}</td>
                <td><span class="cat-badge cat-${k.category}">${k.category}</span></td>
                <td>${(k.confidence*100).toFixed(0)}%</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="admin-section">
          <h3>Relations (${d.relations.length})</h3>
          <table class="admin-table">
            <thead><tr><th>ID</th><th>Source</th><th>Relation</th><th>Target</th><th>Conf.</th><th>Section</th><th>Evidence</th></tr></thead>
            <tbody>${d.relations.map(r => `
              <tr>
                <td>${r.id}</td>
                <td>${escHtml(r.source_name)}</td>
                <td><span class="rel-badge">${escHtml(r.relation_type)}</span></td>
                <td>${escHtml(r.target_name)}</td>
                <td>${(r.confidence*100).toFixed(0)}%</td>
                <td>${escHtml(r.source_section)}</td>
                <td style="font-size:0.72rem;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(r.evidence_text)}">${escHtml(r.evidence_text)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="admin-section">
          <h3>Metrics (${d.metrics.length})</h3>
          <table class="admin-table">
            <thead><tr><th>ID</th><th>Metric</th><th>Value</th><th>Unit</th><th>Condition</th><th>Conf.</th></tr></thead>
            <tbody>${d.metrics.map(m => `
              <tr>
                <td>${m.id}</td>
                <td>${escHtml(m.metric_name)}</td>
                <td>${escHtml(m.value)}</td>
                <td>${escHtml(m.unit)}</td>
                <td>${escHtml(m.condition)}</td>
                <td>${(m.confidence*100).toFixed(0)}%</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (e) {
      document.getElementById('admin-body').innerHTML = `<p style="color:var(--danger)">Error: ${escHtml(e.message)}</p>`;
    }
  };

  sel.onchange = () => loadAdminPaper(parseInt(sel.value));
  if (papers.length) await loadAdminPaper(parseInt(sel.value));
};

document.getElementById('admin-btn')?.addEventListener('click', openAdmin);
document.getElementById('admin-close')?.addEventListener('click', () => {
  document.getElementById('admin-overlay').classList.add('hidden');
  document.body.style.overflow = '';
});

// ─────────────────────────────────────────────────────────────────────────────
// Profile Modal
// ─────────────────────────────────────────────────────────────────────────────
const _getUserDisplayName = u =>
  u?.user_metadata?.username
  || u?.user_metadata?.name
  || u?.user_metadata?.full_name
  || (u?.email ? u.email.split('@')[0] : 'Account');

const openProfileModal = () => {
  const user = window._authUser;
  if (!user) return;

  const name = _getUserDisplayName(user);

  document.getElementById('prof-avatar').textContent      = name.charAt(0).toUpperCase();
  document.getElementById('prof-display-name').textContent = name;
  document.getElementById('prof-email-label').textContent  = user.email || '';
  document.getElementById('prof-username-input').value     = name;
  document.getElementById('prof-email-input').value        = '';
  document.getElementById('prof-pw-input').value           = '';
  document.getElementById('prof-username-msg').textContent = '';
  document.getElementById('prof-email-msg').textContent    = '';
  document.getElementById('prof-pw-msg').textContent       = '';

  document.getElementById('prof-overlay').classList.remove('hidden');
};

const closeProfileModal = () =>
  document.getElementById('prof-overlay').classList.add('hidden');

const _profMsg = (id, text, type) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className   = 'prof-hint' + (type ? ' ' + type : '');
};

document.getElementById('header-username-btn')?.addEventListener('click', openProfileModal);
document.getElementById('prof-close-btn')?.addEventListener('click', closeProfileModal);
document.getElementById('prof-overlay')?.addEventListener('click', e => {
  if (e.target === document.getElementById('prof-overlay')) closeProfileModal();
});

document.getElementById('prof-save-username')?.addEventListener('click', async () => {
  const val = document.getElementById('prof-username-input').value.trim();
  if (!val) return _profMsg('prof-username-msg', 'Username cannot be empty.', 'error');
  try {
    const { error } = await window._sb.auth.updateUser({ data: { username: val } });
    if (error) throw error;
    window._authUser = (await window._sb.auth.getUser()).data.user;
    document.getElementById('prof-display-name').textContent = val;
    document.getElementById('prof-avatar').textContent       = val.charAt(0).toUpperCase();
    const btn = document.getElementById('header-username-btn');
    if (btn) btn.textContent = val;
    _profMsg('prof-username-msg', 'Username updated.', 'ok');
  } catch (e) {
    _profMsg('prof-username-msg', e.message || 'Failed to update.', 'error');
  }
});

document.getElementById('prof-save-email')?.addEventListener('click', async () => {
  const val = document.getElementById('prof-email-input').value.trim();
  if (!val || !val.includes('@')) return _profMsg('prof-email-msg', 'Enter a valid email.', 'error');
  try {
    const { error } = await window._sb.auth.updateUser({ email: val });
    if (error) throw error;
    _profMsg('prof-email-msg', 'Confirmation email sent. Check your inbox.', 'ok');
  } catch (e) {
    _profMsg('prof-email-msg', e.message || 'Failed to update.', 'error');
  }
});

document.getElementById('prof-save-pw')?.addEventListener('click', async () => {
  const val = document.getElementById('prof-pw-input').value;
  if (val.length < 8) return _profMsg('prof-pw-msg', 'Password must be at least 8 characters.', 'error');
  try {
    const { error } = await window._sb.auth.updateUser({ password: val });
    if (error) throw error;
    document.getElementById('prof-pw-input').value = '';
    _profMsg('prof-pw-msg', 'Password changed successfully.', 'ok');
  } catch (e) {
    _profMsg('prof-pw-msg', e.message || 'Failed to change password.', 'error');
  }
});

document.getElementById('prof-signout-btn')?.addEventListener('click', async () => {
  await window._sb.auth.signOut();
  window.location.href = '/';
});

document.getElementById('header-signout-btn')?.addEventListener('click', async () => {
  await window._sb.auth.signOut();
  window.location.href = '/';
});

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────
loadPapers();
setupUpload();
