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
    document.getElementById('kw-filter-bar').classList.add('hidden');
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
    const canvasData = await apiFetch('/map-canvas');
    MapView.init('papers-map', canvasData, { onNodeClick: showMapNodePanel, onCanvasTap: hideMapNodePanel });
    _renderKwFilterBar(canvasData.keyword_stats || []);
  } catch (e) {
    toast('Failed to load map view: ' + e.message, 'error');
  }
};

const _renderKwFilterBar = (kwStats) => {
  const bar   = document.getElementById('kw-filter-bar');
  const chips = document.getElementById('kw-filter-chips');
  if (!bar || !chips) return;

  bar.classList.remove('hidden');
  chips.innerHTML = '';
  kwStats.forEach(kw => {
    const chip = document.createElement('label');
    chip.className = 'kw-filter-chip';
    chip.innerHTML =
      `<input type="checkbox" value="${escHtml(kw.normalized)}" />` +
      `${escHtml(kw.name)} <span style="color:var(--text-muted);font-size:0.7rem">(${kw.count})</span>`;
    chips.appendChild(chip);
  });

  const getActive = () =>
    Array.from(chips.querySelectorAll('input:checked')).map(cb => cb.value);

  chips.addEventListener('change', () => {
    chips.querySelectorAll('.kw-filter-chip').forEach(chip => {
      chip.classList.toggle('active', chip.querySelector('input').checked);
    });
    MapView.applyKeywordFilter(getActive());
  });

  // Replace Clear button to avoid duplicate listeners across reloads
  const clearBtn = document.getElementById('kw-filter-clear');
  const newClear = clearBtn.cloneNode(true);
  clearBtn.replaceWith(newClear);
  newClear.addEventListener('click', () => {
    chips.querySelectorAll('input').forEach(cb => { cb.checked = false; });
    chips.querySelectorAll('.kw-filter-chip').forEach(chip => chip.classList.remove('active'));
    MapView.applyKeywordFilter([]);
  });

  // Manual keyword input — add/remove custom filter chips
  const customInput = document.getElementById('kw-custom-input');
  const customAdd   = document.getElementById('kw-custom-add');
  if (customInput && customAdd) {
    const addCustomChip = () => {
      const val = (customInput.value || '').trim().toLowerCase();
      if (!val) return;
      // Don't add duplicates
      if (chips.querySelector(`input[value="${val}"]`)) { customInput.value = ''; return; }
      const chip = document.createElement('label');
      chip.className = 'kw-filter-chip active';
      chip.innerHTML = `<input type="checkbox" value="${escHtml(val)}" checked />${escHtml(val)} <span style="color:var(--text-muted);font-size:0.7rem">✎</span>`;
      chips.appendChild(chip);
      chip.querySelector('input').addEventListener('change', () => {
        chip.classList.toggle('active', chip.querySelector('input').checked);
        MapView.applyKeywordFilter(getActive());
      });
      customInput.value = '';
      MapView.applyKeywordFilter(getActive());
    };
    const newAdd = customAdd.cloneNode(true);
    customAdd.replaceWith(newAdd);
    newAdd.addEventListener('click', addCustomChip);
    const newInput = customInput.cloneNode(true);
    customInput.replaceWith(newInput);
    newInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCustomChip(); });
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
        const id  = btn.dataset.id;
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
  await loadFieldPanel();
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
// Story Map tab
// ─────────────────────────────────────────────────────────────────────────────
const loadStoryMap = async () => {
  try {
    const [graph, metrics] = await Promise.all([
      apiFetch(`/papers/${activePaperId}/graph`),
      apiFetch(`/papers/${activePaperId}/metrics`),
    ]);
    graph.paper_id = activePaperId;

    // Auto-link metrics to keyword nodes by name matching when linked_keyword_id is null
    const kwLookup = {}; // numeric_id -> { label, norm }
    (graph.elements || []).forEach(el => {
      if (el.data && !el.data.source && (el.data.id || '').startsWith('kw_')) {
        const nid = parseInt(el.data.id.replace('kw_', ''));
        kwLookup[nid] = (el.data.label || '').toLowerCase().trim();
      }
    });
    metrics.forEach(m => {
      if (m.linked_keyword_id != null) return;
      const mname = (m.metric_name || '').toLowerCase().trim();
      for (const [kidStr, klabel] of Object.entries(kwLookup)) {
        if (!klabel) continue;
        if (mname === klabel || klabel.includes(mname) || mname.includes(klabel)) {
          m.linked_keyword_id = parseInt(kidStr);
          break;
        }
      }
    });

    graph.all_metrics = metrics;
    StoryMap.buildLegend(graph.category_colors, 'storymap-legend');
    StoryMap.init('storymap-container', graph, {
      onNodeEdit: async (nodeData, newLabel) => {
        try {
          if (nodeData.type === 'keyword') {
            const id = nodeData.id.replace('kw_', '');
            await apiFetch(`/keywords/${id}`, {
              method: 'PUT',
              body: JSON.stringify({ keyword_name: newLabel, normalized_name: newLabel }),
            });
          } else if (nodeData.type === 'metric') {
            const id = nodeData.id.replace('met_', '');
            await apiFetch(`/metrics/${id}`, {
              method: 'PUT',
              body: JSON.stringify({ metric_name: newLabel }),
            });
          }
          toast('Saved.', 'ok');
          await loadStoryMap();
        } catch (e) { toast('Save failed: ' + e.message, 'error'); }
      },
      onNodeDelete: async (nodeData) => {
        if (!confirm('Delete this node and all its connections?')) return;
        try {
          if (nodeData.type === 'keyword') {
            const id = nodeData.id.replace('kw_', '');
            await apiFetch(`/keywords/${id}`, { method: 'DELETE' });
          } else if (nodeData.type === 'metric') {
            const id = nodeData.id.replace('met_', '');
            await apiFetch(`/metrics/${id}`, { method: 'DELETE' });
          }
          toast('Deleted.', 'ok');
          await loadStoryMap();
        } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
      },
      onEdgeSave:   async () => { toast('Relation updated.', 'ok');   await loadStoryMap(); },
      onEdgeDelete: async () => { toast('Relation deleted.', 'ok');   await loadStoryMap(); },
    });
  } catch (e) {
    toast('Failed to load story map: ' + e.message, 'error');
  }
};

document.getElementById('fit-graph-btn').addEventListener('click', () => StoryMap.fit());
document.getElementById('reset-layout-btn').addEventListener('click', () => StoryMap.relayout());
document.getElementById('refresh-graph-btn').addEventListener('click', async () => {
  _storymapDirty = false;
  _updateStorymapTabBadge();
  await loadStoryMap();
});

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

// Search
document.getElementById('search-input').addEventListener('input', (e) => {
  filterPapers(e.target.value);
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

  // 대그룹
  const badge = document.getElementById('rv-field-badge');
  badge.textContent = data.field || '—';
  document.getElementById('rv-field-conf').textContent = data.field_confidence != null
    ? `${Math.round(data.field_confidence * 100)}% confidence` : '';
  const altsEl = document.getElementById('rv-field-alts');
  altsEl.innerHTML = '';
  const topKey = (data.field || '').toLowerCase().replace(/\s+/g, '_');
  Object.entries(data.field_scores || {})
    .filter(([k]) => k !== topKey)
    .sort(([,a],[,b]) => b - a).slice(0, 3)
    .forEach(([k, v]) => {
      const s = document.createElement('span');
      s.textContent = `${_fieldKeyToDisplay(k)}: ${Math.round(v * 100)}%`;
      altsEl.appendChild(s);
    });
  const fieldSel = document.getElementById('rv-field-select');
  fieldSel.value = data.field || '';

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

  // 저장
  const saveBtn = document.getElementById('rv-save-btn');
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
      const field = fieldSel.value || data.field;
      await apiFetch(`/papers/${paperId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ field, keywords: kwPayload }),
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
        const nodeId = d.nodeId;
        if (!nodeId) return;
        const label = body.querySelector('#mnp-cn-label').value;
        const category = body.querySelector('#mnp-cn-cat').value;
        const description = body.querySelector('#mnp-cn-desc').value;
        const color = body.querySelector('#mnp-cn-color').value;
        try { await apiFetch(`/map-custom-nodes/${nodeId}`, { method: 'PUT', body: JSON.stringify({ label, category, description, color }) }); toast('Saved', 'ok'); } catch(e) { toast(e.message, 'error'); }
      };
      body.querySelector('#mnp-cn-del').onclick = async () => {
        if (!confirm('Delete this node?')) return;
        const nodeId = d.nodeId;
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
        const groupId = d.groupId;
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
        const groupId = d.groupId;
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

document.getElementById('header-signout-btn')?.addEventListener('click', async () => {
  await window._sb.auth.signOut();
  window.location.href = '/';
});

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────
loadPapers();
setupUpload();
