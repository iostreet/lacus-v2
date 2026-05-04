/**
 * Lacus Map View v2 — Hierarchical Research Map
 * Modes: Overview · Hierarchy · Focus · Edit
 */

window.MapView = (() => {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  let _mode       = 'overview';   // 'overview'|'hierarchy'|'focus'|'edit'
  let _data       = null;         // { groups: [{name,color,paper_count,children:[{name,paper_count,papers:[...]}]}] }
  let _container  = null;
  let _onNodeClick = null;
  let _selPath    = [];           // [largeName, mediumName?]
  let _focusKw    = '';

  // ── Utils ─────────────────────────────────────────────────────────────────
  const _e   = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const _cut = (s, n) => (s && s.length > n) ? s.slice(0, n-1) + '…' : (s || '');

  const _apiFetch = async path => {
    const token = window._authToken;
    const res = await fetch('/api' + path, {
      headers: { 'Authorization': 'Bearer ' + (token || ''), 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  };

  const _toast = (msg, type = 'ok') => {
    const el = document.getElementById('toast-container');
    if (!el) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    el.appendChild(t);
    setTimeout(() => t.remove(), 3400);
  };

  // ── All papers (deduplicated) ─────────────────────────────────────────────
  const _allPapers = () => {
    const seen = new Set(), out = [];
    (_data?.groups || []).forEach(lg =>
      (lg.children || []).forEach(mg =>
        (mg.papers || []).forEach(p => { if (!seen.has(p.id)) { seen.add(p.id); out.push(p); } })
      )
    );
    return out;
  };

  // Papers for a given large (+optional medium) group
  const _papersFor = (lgName, mgName) => {
    const lg = (_data?.groups || []).find(g => g.name === lgName);
    if (!lg) return [];
    if (!mgName) {
      const seen = new Set(), out = [];
      (lg.children || []).forEach(mg =>
        (mg.papers || []).forEach(p => { if (!seen.has(p.id)) { seen.add(p.id); out.push(p); } })
      );
      return out;
    }
    return (lg.children || []).find(m => m.name === mgName)?.papers || [];
  };

  // ── Paper card (inline, for grids) ────────────────────────────────────────
  const _paperCard = (p, lgColor) => {
    const card = document.createElement('div');
    card.className = 'mv2-pc';
    const kws  = (p.keywords || []).filter(Boolean).slice(0, 4);
    const mets = (p.metrics  || []).filter(m => m.name).slice(0, 2);
    card.innerHTML = `
      <div class="mv2-pc-title">${_e(_cut(p.title, 80))}</div>
      <div class="mv2-pc-sub">
        ${p.year  ? `<span>${_e(p.year)}</span>` : ''}
        ${p.field ? `<span class="mv2-pc-field" style="color:${_e(lgColor||'#64748b')}">${_e(p.field)}</span>` : ''}
      </div>
      ${kws.length  ? `<div class="mv2-pc-tags">${kws.map(k=>`<span class="mv2-pc-tag">${_e(k)}</span>`).join('')}</div>` : ''}
      ${mets.length ? `<div class="mv2-pc-mets">${mets.map(m=>`<span class="mv2-pc-met">${_e(m.name)} = ${_e(m.value)}${m.unit?' '+_e(m.unit):''}</span>`).join('')}</div>` : ''}
    `;
    card.addEventListener('click', () => {
      if (_onNodeClick) _onNodeClick({ type: 'paper', paperId: p.id, nodeData: p });
    });
    return card;
  };

  // ── Mode bar ──────────────────────────────────────────────────────────────
  const _modeBar = () => {
    const bar = document.createElement('div');
    bar.className = 'mv2-bar';
    const MODES = [
      { id:'overview',   label:'Overview' },
      { id:'hierarchy',  label:'Hierarchy' },
      { id:'focus',      label:'Focus' },
      { id:'edit',       label:'Edit' },
    ];
    MODES.forEach(({ id, label }) => {
      const btn = document.createElement('button');
      btn.className = 'mv2-bar-btn' + (id === _mode ? ' active' : '');
      btn.textContent = label;
      btn.onclick = () => _setMode(id);
      bar.appendChild(btn);
    });
    return bar;
  };

  // ── Set mode ──────────────────────────────────────────────────────────────
  const _setMode = mode => { _mode = mode; _renderAll(); };

  // ── Main render ───────────────────────────────────────────────────────────
  const _renderAll = () => {
    if (!_container) return;
    _container.innerHTML = '';

    const groups = _data?.groups || [];
    _container.appendChild(_modeBar());

    const body = document.createElement('div');
    body.className = 'mv2-body';

    if (!groups.length) {
      body.innerHTML = '<div class="mv2-empty">No papers yet. Import a PDF to build your research map.</div>';
      _container.appendChild(body);
      return;
    }

    switch (_mode) {
      case 'overview':  _overview(body,  groups); break;
      case 'hierarchy': _hierarchy(body, groups); break;
      case 'focus':     _focus(body);             break;
      case 'edit':      _edit(body,      groups); break;
    }
    _container.appendChild(body);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // OVERVIEW MODE
  // ══════════════════════════════════════════════════════════════════════════
  const _overview = (body, groups) => {
    body.classList.add('mv2-overview');

    const hint = document.createElement('div');
    hint.className = 'mv2-ov-hint';
    hint.textContent = 'Click a group to explore papers · Use Hierarchy for detailed navigation';
    body.appendChild(hint);

    const grid = document.createElement('div');
    grid.className = 'mv2-ov-grid';

    groups.forEach(lg => {
      const card = document.createElement('div');
      card.className = 'mv2-ov-lg';
      card.style.setProperty('--lg', lg.color || '#64748b');
      card.style.borderColor = (lg.color || '#64748b') + '55';

      // Header
      const hd = document.createElement('div');
      hd.className = 'mv2-ov-hd';
      hd.innerHTML = `
        <span class="mv2-ov-dot"></span>
        <span class="mv2-ov-name">${_e(lg.name)}</span>
        <span class="mv2-ov-badge">${lg.paper_count}</span>
      `;
      hd.title = 'View all papers in ' + lg.name;
      hd.addEventListener('click', () => { _selPath = [lg.name]; _setMode('hierarchy'); });
      card.appendChild(hd);

      // Medium group chips
      const chips = document.createElement('div');
      chips.className = 'mv2-ov-chips';
      (lg.children || []).forEach(mg => {
        const chip = document.createElement('div');
        chip.className = 'mv2-ov-chip';
        chip.innerHTML = `<span class="mv2-ov-chip-name">${_e(mg.name)}</span><span class="mv2-ov-chip-cnt">${mg.paper_count}</span>`;
        chip.title = 'View ' + mg.name + ' papers';
        chip.addEventListener('click', e => {
          e.stopPropagation();
          _selPath = [lg.name, mg.name];
          _setMode('hierarchy');
        });
        chips.appendChild(chip);
      });
      card.appendChild(chips);
      grid.appendChild(card);
    });

    body.appendChild(grid);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // HIERARCHY MODE
  // ══════════════════════════════════════════════════════════════════════════
  const _hierarchy = (body, groups) => {
    body.classList.add('mv2-hierarchy');

    if (!_selPath.length && groups.length) _selPath = [groups[0].name];
    const [selLg, selMg] = _selPath;

    // Left tree
    const tree = document.createElement('div');
    tree.className = 'mv2-tree';

    // Right paper area
    const main = document.createElement('div');
    main.className = 'mv2-papers';

    groups.forEach(lg => {
      const isOpen = lg.name === selLg;

      const lgWrap = document.createElement('div');
      lgWrap.className = 'mv2-tlg' + (isOpen ? ' open' : '');

      const lgRow = document.createElement('div');
      lgRow.className = 'mv2-tlg-row' + (isOpen && !selMg ? ' sel' : '');
      lgRow.innerHTML = `
        <span class="mv2-tarrow">${isOpen ? '▼' : '▶'}</span>
        <span class="mv2-tdot" style="background:${_e(lg.color)}"></span>
        <span class="mv2-tname">${_e(lg.name)}</span>
        <span class="mv2-tcnt">${lg.paper_count}</span>
      `;
      lgRow.addEventListener('click', () => { _selPath = [lg.name]; _renderAll(); });
      lgWrap.appendChild(lgRow);

      if (isOpen) {
        const kids = document.createElement('div');
        kids.className = 'mv2-tmg-list';
        (lg.children || []).forEach(mg => {
          const isSel = mg.name === selMg;
          const mgRow = document.createElement('div');
          mgRow.className = 'mv2-tmg' + (isSel ? ' sel' : '');
          mgRow.innerHTML = `
            <span class="mv2-tmg-icon">└─</span>
            <span class="mv2-tname">${_e(mg.name)}</span>
            <span class="mv2-tcnt">${mg.paper_count}</span>
          `;
          mgRow.addEventListener('click', e => {
            e.stopPropagation();
            _selPath = [lg.name, mg.name];
            _renderAll();
          });
          kids.appendChild(mgRow);
        });
        lgWrap.appendChild(kids);

        // Paper area
        const displayPapers = selMg
          ? ((lg.children || []).find(m => m.name === selMg)?.papers || [])
          : _papersFor(lg.name);

        const bc = document.createElement('div');
        bc.className = 'mv2-breadcrumb';
        bc.innerHTML = [
          `<span class="mv2-bc-lg" style="color:${_e(lg.color)}">${_e(lg.name)}</span>`,
          selMg ? `<span class="mv2-bc-sep">›</span><span class="mv2-bc-mg">${_e(selMg)}</span>` : '',
          `<span class="mv2-bc-count">${displayPapers.length} paper${displayPapers.length !== 1 ? 's' : ''}</span>`,
        ].join('');
        main.appendChild(bc);

        const pgrid = document.createElement('div');
        pgrid.className = 'mv2-pgrid';
        if (!displayPapers.length) {
          pgrid.innerHTML = '<div class="mv2-empty">No papers in this group.</div>';
        } else {
          displayPapers.forEach(p => pgrid.appendChild(_paperCard(p, lg.color)));
        }
        main.appendChild(pgrid);
      }

      tree.appendChild(lgWrap);
    });

    body.appendChild(tree);
    body.appendChild(main);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // FOCUS MODE
  // ══════════════════════════════════════════════════════════════════════════
  const _focus = body => {
    body.classList.add('mv2-focus');

    const allPapers = _allPapers();
    const kwCounts = new Map();
    allPapers.forEach(p => (p.keywords || []).forEach(k => {
      if (k) kwCounts.set(k, (kwCounts.get(k) || 0) + 1);
    }));

    // Search bar
    const bar = document.createElement('div');
    bar.className = 'mv2-focus-bar';
    bar.innerHTML = `<input class="mv2-focus-input" id="mv2-fi" placeholder="Search keyword, title, or concept…" value="${_e(_focusKw)}" autocomplete="off" />`;
    body.appendChild(bar);

    // Keyword cloud
    const cloud = document.createElement('div');
    cloud.className = 'mv2-focus-cloud';
    [...kwCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50).forEach(([kw, cnt]) => {
      const chip = document.createElement('span');
      chip.className = 'mv2-focus-kw';
      chip.textContent = kw;
      chip.title = cnt + ' paper' + (cnt > 1 ? 's' : '');
      chip.style.fontSize = Math.min(1.1, 0.75 + cnt * 0.04) + 'rem';
      chip.addEventListener('click', () => {
        body.querySelector('#mv2-fi').value = kw;
        _focusKw = kw;
        _doSearch(kw, allPapers, results, cloud);
      });
      cloud.appendChild(chip);
    });
    body.appendChild(cloud);

    // Results area
    const results = document.createElement('div');
    results.className = 'mv2-focus-results';
    body.appendChild(results);

    if (_focusKw) _doSearch(_focusKw, allPapers, results, cloud);

    const input = body.querySelector('#mv2-fi');
    let debounce;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        _focusKw = input.value;
        _doSearch(input.value, allPapers, results, cloud);
      }, 200);
    });
    requestAnimationFrame(() => input.focus());
  };

  const _doSearch = (term, allPapers, results, cloud) => {
    results.innerHTML = '';
    if (!term.trim()) { cloud.style.opacity = '1'; return; }
    cloud.style.opacity = '0.4';
    const t = term.toLowerCase();
    const matched = allPapers.filter(p =>
      (p.title || '').toLowerCase().includes(t) ||
      (p.keywords || []).some(k => (k || '').toLowerCase().includes(t)) ||
      (p.field || '').toLowerCase().includes(t)
    );
    const hd = document.createElement('div');
    hd.className = 'mv2-focus-hd';
    hd.innerHTML = matched.length
      ? `Found <strong>${matched.length}</strong> paper${matched.length > 1 ? 's' : ''} matching <em>"${_e(term)}"</em>`
      : `No papers match <em>"${_e(term)}"</em>`;
    results.appendChild(hd);
    const grid = document.createElement('div');
    grid.className = 'mv2-pgrid';
    const lgs = _data?.groups || [];
    matched.forEach(p => {
      const lg = lgs.find(g => g.name === p.field);
      grid.appendChild(_paperCard(p, lg?.color));
    });
    results.appendChild(grid);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // EDIT MODE
  // ══════════════════════════════════════════════════════════════════════════
  const _edit = (body, groups) => {
    body.classList.add('mv2-edit');

    const note = document.createElement('div');
    note.className = 'mv2-edit-note';
    note.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      Edit Mode: groups are automatically derived from paper research fields and keyword categories. To change a paper's group, edit its field or keywords in the paper detail view.
    `;
    body.appendChild(note);

    // Show hierarchy view below the note
    const sub = document.createElement('div');
    sub.className = 'mv2-edit-sub';
    body.appendChild(sub);
    _hierarchy(sub, groups);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════════════════════
  const init = async (containerId, canvasData, opts = {}) => {
    _onNodeClick = opts.onNodeClick || null;
    _container   = document.getElementById(containerId);
    if (!_container) return;

    _container.style.position = 'relative';
    _container.innerHTML = '<div class="mv2-loading"><span class="mv2-loading-dot"></span> Building research map…</div>';

    try {
      _data = await _apiFetch('/map-overview');
    } catch (e) {
      _data = _deriveFromCanvas(canvasData);
    }

    if (!_data) _data = { groups: [] };
    _selPath = _data.groups.length ? [_data.groups[0].name] : [];
    _mode    = 'overview';
    _renderAll();
  };

  // Fallback: derive hierarchy from old canvasData format
  const _deriveFromCanvas = cd => {
    const FC = {
      "Materials Science":"#22c55e","Physics":"#3b82f6","Chemistry":"#a855f7",
      "Electrical Engineering":"#f59e0b","Unknown":"#64748b",
    };
    const C2M = {
      Material:"Materials & Compositions",Structure:"Structures & Architecture",
      Method:"Synthesis & Methods",Property:"Properties & Performance",Application:"Applications & Devices",
    };
    const lgMap = {};
    (cd?.papers || []).forEach(p => {
      const f = p.field || "Unknown";
      if (!lgMap[f]) lgMap[f] = { name:f, color:FC[f]||"#64748b", papers:[], medMap:{} };
      const cats = Object.values(p.keyword_categories || {});
      const meds = [...new Set(cats.map(c => C2M[c]).filter(Boolean))];
      const entry = { id:p.id, title:p.title||"Untitled", year:p.year, field:f,
                      keywords:(p.keyword_norms||[]), metrics:[], mediums:meds };
      lgMap[f].papers.push(entry);
      meds.forEach(m => {
        lgMap[f].medMap[m] = lgMap[f].medMap[m] || { name:m, papers:[] };
        lgMap[f].medMap[m].papers.push(entry);
      });
    });
    const groups = Object.values(lgMap)
      .sort((a,b) => b.papers.length - a.papers.length)
      .map(lg => {
        const children = Object.values(lg.medMap)
          .sort((a,b) => b.papers.length - a.papers.length)
          .map(mg => ({ ...mg, paper_count: mg.papers.length }));
        if (!children.length)
          children.push({ name:"General", paper_count:lg.papers.length, papers:lg.papers });
        return { name:lg.name, color:lg.color, paper_count:lg.papers.length, children };
      });
    return { groups };
  };

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    init,
    fit:               () => {},
    applyKeywordFilter: norms => {
      if (norms && norms.length) { _focusKw = norms[0]; _setMode('focus'); }
      else { _focusKw = ''; if (_mode === 'focus') _setMode('overview'); }
    },
    enterOverviewMode:  () => _setMode('overview'),
    enterFullMode:      () => _setMode('hierarchy'),
    exitFocus:          () => _setMode('overview'),
    refreshGroup:       () => {},
    deleteGroup:        async () => {},
  };
})();
