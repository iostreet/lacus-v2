/**
 * Lacus Map View v4 — Palantir-style concept cards
 * Modes: Overview (card grid) · Hierarchy (tree + papers)
 */

window.MapView = (() => {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  let _mode        = 'overview'; // 'overview' | 'hierarchy'
  let _data        = null;       // { themes: [{name,color,paper_count,concepts:[...]}] }
  let _container   = null;
  let _onNodeClick = null;
  let _selTheme    = null;
  let _selConcept  = null;
  let _activeKws   = new Set(); // active filter keyword norms

  // ── Utils ─────────────────────────────────────────────────────────────────
  const _e   = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const _cut = (s, n) => s && s.length > n ? s.slice(0, n - 1) + '…' : (s || '');

  const _apiFetch = async path => {
    const res = await fetch('/api' + path, {
      headers: { 'Authorization': 'Bearer ' + (window._authToken || ''), 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  };

  // ── Build deduplicated keyword list for filter bar ────────────────────────
  const _buildKwList = () => {
    const kwMap = new Map(); // norm → { name, count }
    (_data?.themes || []).forEach(t =>
      (t.concepts || []).forEach(c =>
        (c.papers || []).forEach(p =>
          (p.keywords || []).forEach(kw => {
            const norm = kw.toLowerCase();
            if (!kwMap.has(norm)) kwMap.set(norm, { name: kw, count: 0 });
            kwMap.get(norm).count++;
          })
        )
      )
    );
    return [...kwMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);
  };

  // ── Filter bar (rendered above mode content) ──────────────────────────────
  const _filterBar = () => {
    const bar = document.createElement('div');
    bar.className = 'mv2-filter';

    const kwList = _buildKwList();
    if (!kwList.length) return bar;

    const label = document.createElement('span');
    label.className = 'mv2-filter-label';
    label.textContent = 'Filter:';
    bar.appendChild(label);

    kwList.forEach(({ name, count }) => {
      const norm = name.toLowerCase();
      const chip = document.createElement('span');
      chip.className = 'mv2-fchip' + (_activeKws.has(norm) ? ' active' : '');
      chip.title = `${count} paper${count !== 1 ? 's' : ''}`;
      chip.textContent = name;
      chip.addEventListener('click', () => {
        if (_activeKws.has(norm)) _activeKws.delete(norm);
        else _activeKws.add(norm);
        _renderAll();
      });
      bar.appendChild(chip);
    });

    if (_activeKws.size) {
      const clr = document.createElement('button');
      clr.className = 'mv2-fclear';
      clr.textContent = 'Clear';
      clr.addEventListener('click', () => { _activeKws.clear(); _renderAll(); });
      bar.appendChild(clr);
    }
    return bar;
  };

  // ── Paper card (for hierarchy mode) ──────────────────────────────────────
  const _paperCard = (p, color) => {
    const card = document.createElement('div');
    card.className = 'mv2-pc';
    const kws  = (p.keywords || []).filter(Boolean).slice(0, 4);
    const mets = (p.metrics  || []).filter(m => m.name).slice(0, 2);
    card.innerHTML = `
      <div class="mv2-pc-title">${_e(_cut(p.title, 80))}</div>
      <div class="mv2-pc-sub">
        ${p.year    ? `<span>${_e(p.year)}</span>` : ''}
        ${p.concept ? `<span class="mv2-pc-concept" style="color:${_e(color || '#8b5cf6')}">${_e(p.concept)}</span>` : ''}
      </div>
      ${kws.length  ? `<div class="mv2-pc-tags">${kws.map(k => `<span class="mv2-pc-tag">${_e(k)}</span>`).join('')}</div>` : ''}
      ${mets.length ? `<div class="mv2-pc-mets">${mets.map(m => `<span class="mv2-pc-met">${_e(m.name)} = ${_e(m.value)}${m.unit ? ' ' + _e(m.unit) : ''}</span>`).join('')}</div>` : ''}
    `;
    card.addEventListener('click', () => {
      if (_onNodeClick) _onNodeClick({ type: 'paper', paperId: p.id, nodeData: p });
    });
    return card;
  };

  // ── Mode bar (Overview / Hierarchy) ──────────────────────────────────────
  const _modeBar = () => {
    const bar = document.createElement('div');
    bar.className = 'mv2-bar';
    [
      { id: 'overview',  label: 'Overview' },
      { id: 'hierarchy', label: 'Hierarchy' },
    ].forEach(({ id, label }) => {
      const btn = document.createElement('button');
      btn.className = 'mv2-bar-btn' + (id === _mode ? ' active' : '');
      btn.textContent = label;
      btn.addEventListener('click', () => _setMode(id));
      bar.appendChild(btn);
    });
    return bar;
  };

  const _setMode = mode => { _mode = mode; _renderAll(); };

  // ── Main render ───────────────────────────────────────────────────────────
  const _renderAll = () => {
    if (!_container) return;
    _container.innerHTML = '';
    const themes = _data?.themes || [];

    _container.appendChild(_modeBar());
    _container.appendChild(_filterBar());

    const body = document.createElement('div');
    body.className = 'mv2-body';

    if (!themes.length) {
      body.innerHTML = '<div class="mv2-empty">No papers yet. Import a PDF and assign a Theme &amp; Concept to start building your research map.</div>';
      _container.appendChild(body);
      return;
    }

    switch (_mode) {
      case 'overview':  _overview(body,  themes); break;
      case 'hierarchy': _hierarchy(body, themes); break;
    }
    _container.appendChild(body);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // OVERVIEW — Palantir-style concept card grid
  // ══════════════════════════════════════════════════════════════════════════
  const _overview = (body, themes) => {
    body.classList.add('mv2-ov-sections');

    themes.forEach(theme => {
      const sec = document.createElement('div');
      sec.className = 'mv2-ov-theme-sec';

      // Theme header
      const thd = document.createElement('div');
      thd.className = 'mv2-ov-theme-hd';
      thd.style.borderBottomColor = theme.color + '55';
      thd.innerHTML = `
        <span class="mv2-ov-theme-dot" style="background:${_e(theme.color)}"></span>
        <span style="color:${_e(theme.color)};font-weight:700;font-size:.82rem">${_e(theme.name)}</span>
        <span class="mv2-ov-theme-cnt">${theme.paper_count} paper${theme.paper_count !== 1 ? 's' : ''}</span>
      `;
      sec.appendChild(thd);

      // Concept card row
      const cRow = document.createElement('div');
      cRow.className = 'mv2-ov-concepts';

      (theme.concepts || []).forEach(concept => {
        const matchPapers = _activeKws.size === 0
          ? concept.papers || []
          : (concept.papers || []).filter(p =>
              (p.keywords || []).some(kw => _activeKws.has(kw.toLowerCase()))
            );
        const isDimmed = _activeKws.size > 0 && matchPapers.length === 0;

        const card = document.createElement('div');
        card.className = 'mv2-ov-cc' + (isDimmed ? ' dimmed' : '');

        // Collect top keywords across this concept's papers
        const kwFreq = new Map();
        (concept.papers || []).forEach(p =>
          (p.keywords || []).forEach(kw => {
            const k = kw.toLowerCase();
            if (!kwFreq.has(k)) kwFreq.set(k, { name: kw, count: 0 });
            kwFreq.get(k).count++;
          })
        );
        const topKws = [...kwFreq.values()]
          .sort((a, b) => b.count - a.count)
          .slice(0, 7)
          .map(v => v.name);

        // Card header
        const chd = document.createElement('div');
        chd.className = 'mv2-ov-cc-hd';
        chd.innerHTML = `
          <span class="mv2-ov-cc-dot" style="background:${_e(theme.color)}"></span>
          <span class="mv2-ov-cc-name">${_e(concept.name)}</span>
          <span class="mv2-ov-cc-badge">${concept.paper_count}</span>
        `;
        chd.style.cursor = 'pointer';
        chd.addEventListener('click', () => {
          _selTheme = theme.name;
          _selConcept = concept.name;
          _setMode('hierarchy');
        });
        card.appendChild(chd);

        // Keyword chips — act as the concept's description
        if (topKws.length) {
          const kwRow = document.createElement('div');
          kwRow.className = 'mv2-ov-cc-kws';
          topKws.forEach(kw => {
            const chip = document.createElement('span');
            const isActive = _activeKws.has(kw.toLowerCase());
            chip.className = 'mv2-ov-cc-kw' + (isActive ? ' active' : '');
            chip.textContent = kw;
            kwRow.appendChild(chip);
          });
          card.appendChild(kwRow);
        }

        // Paper rows (filtered or all, max 5)
        const displayPapers = _activeKws.size > 0 ? matchPapers : (concept.papers || []);
        const showPapers = displayPapers.slice(0, 5);
        const moreCnt   = displayPapers.length - showPapers.length;

        if (showPapers.length) {
          const pList = document.createElement('div');
          pList.className = 'mv2-ov-cc-papers';
          showPapers.forEach(p => {
            const row = document.createElement('div');
            row.className = 'mv2-ov-cp';
            row.innerHTML = `
              <span class="mv2-ov-cp-title">${_e(_cut(p.title, 62))}</span>
              ${p.year ? `<span class="mv2-ov-cp-year">${_e(p.year)}</span>` : ''}
            `;
            row.addEventListener('click', () => {
              if (_onNodeClick) _onNodeClick({ type: 'paper', paperId: p.id, nodeData: p });
            });
            pList.appendChild(row);
          });
          if (moreCnt > 0) {
            const more = document.createElement('div');
            more.className = 'mv2-ov-cc-more';
            more.textContent = `+ ${moreCnt} more`;
            more.addEventListener('click', () => {
              _selTheme = theme.name;
              _selConcept = concept.name;
              _setMode('hierarchy');
            });
            pList.appendChild(more);
          }
          card.appendChild(pList);
        }

        cRow.appendChild(card);
      });

      sec.appendChild(cRow);
      body.appendChild(sec);
    });
  };

  // ══════════════════════════════════════════════════════════════════════════
  // HIERARCHY — left tree + right paper grid
  // ══════════════════════════════════════════════════════════════════════════
  const _hierarchy = (body, themes) => {
    body.classList.add('mv2-hierarchy');

    if (!_selTheme && themes.length) _selTheme = themes[0].name;
    const selThemeObj = themes.find(t => t.name === _selTheme);

    // Left tree
    const tree = document.createElement('div');
    tree.className = 'mv2-tree';

    themes.forEach(t => {
      const isOpen = t.name === _selTheme;
      const wrap = document.createElement('div');
      wrap.className = 'mv2-tlg' + (isOpen ? ' open' : '');

      const row = document.createElement('div');
      row.className = 'mv2-tlg-row' + (isOpen && !_selConcept ? ' sel' : '');
      row.innerHTML = `
        <span class="mv2-tarrow">${isOpen ? '▼' : '▶'}</span>
        <span class="mv2-tdot" style="background:${_e(t.color)}"></span>
        <span class="mv2-tname">${_e(t.name)}</span>
        <span class="mv2-tcnt">${t.paper_count}</span>
      `;
      row.addEventListener('click', () => { _selTheme = t.name; _selConcept = null; _renderAll(); });
      wrap.appendChild(row);

      if (isOpen) {
        const kids = document.createElement('div');
        kids.className = 'mv2-tmg-list';
        (t.concepts || []).forEach(c => {
          const isSel = c.name === _selConcept;
          const cRow = document.createElement('div');
          cRow.className = 'mv2-tmg' + (isSel ? ' sel' : '');
          cRow.innerHTML = `
            <span class="mv2-tmg-icon">└─</span>
            <span class="mv2-tname">${_e(c.name)}</span>
            <span class="mv2-tcnt">${c.paper_count}</span>
          `;
          cRow.addEventListener('click', e => { e.stopPropagation(); _selConcept = c.name; _renderAll(); });
          kids.appendChild(cRow);
        });
        wrap.appendChild(kids);
      }
      tree.appendChild(wrap);
    });

    // Right paper area
    const main = document.createElement('div');
    main.className = 'mv2-papers';

    if (selThemeObj) {
      let displayPapers;
      if (_selConcept) {
        const conc = (selThemeObj.concepts || []).find(c => c.name === _selConcept);
        displayPapers = conc?.papers || [];
      } else {
        const seen = new Set();
        displayPapers = [];
        (selThemeObj.concepts || []).forEach(c =>
          (c.papers || []).forEach(p => { if (!seen.has(p.id)) { seen.add(p.id); displayPapers.push(p); } })
        );
      }

      if (_activeKws.size) {
        displayPapers = displayPapers.filter(p =>
          (p.keywords || []).some(kw => _activeKws.has(kw.toLowerCase()))
        );
      }

      const bc = document.createElement('div');
      bc.className = 'mv2-breadcrumb';
      bc.innerHTML = [
        `<span class="mv2-bc-lg" style="color:${_e(selThemeObj.color)}">${_e(selThemeObj.name)}</span>`,
        _selConcept ? `<span class="mv2-bc-sep">›</span><span class="mv2-bc-mg">${_e(_selConcept)}</span>` : '',
        `<span class="mv2-bc-count">${displayPapers.length} paper${displayPapers.length !== 1 ? 's' : ''}</span>`,
      ].join('');
      main.appendChild(bc);

      const pgrid = document.createElement('div');
      pgrid.className = 'mv2-pgrid';
      if (!displayPapers.length) {
        pgrid.innerHTML = '<div class="mv2-empty">No papers match the current filter.</div>';
      } else {
        displayPapers.forEach(p => pgrid.appendChild(_paperCard(p, selThemeObj.color)));
      }
      main.appendChild(pgrid);
    }

    body.appendChild(tree);
    body.appendChild(main);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════════════════════
  const init = async (containerId, _canvasData, opts = {}) => {
    _onNodeClick = opts.onNodeClick || null;
    _container   = document.getElementById(containerId);
    if (!_container) return;

    _container.style.position = 'relative';
    _container.innerHTML = '<div class="mv2-loading"><span class="mv2-loading-dot"></span> Building research map…</div>';

    try {
      _data = await _apiFetch('/map-overview');
    } catch (_) {
      _data = { themes: [] };
    }

    if (!_data || Array.isArray(_data)) _data = { themes: [] };
    if (_data.groups && !_data.themes)  _data = { themes: [] };

    _selTheme = (_data.themes || []).length ? _data.themes[0].name : null;
    _mode     = 'overview';
    _activeKws.clear();
    _renderAll();
  };

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    init,
    fit: () => {},
    applyKeywordFilter: norms => {
      _activeKws.clear();
      (norms || []).forEach(n => _activeKws.add(n));
      _renderAll();
    },
    enterOverviewMode: () => _setMode('overview'),
    enterFullMode:     () => _setMode('hierarchy'),
    exitFocus:         () => { _activeKws.clear(); _setMode('overview'); },
    refreshGroup:      () => {},
    deleteGroup:       async () => {},
  };
})();
