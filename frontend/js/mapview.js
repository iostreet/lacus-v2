/**
 * Lacus Map View v3 — Theme → Concept hierarchy (Field hidden)
 * Modes: Overview (SVG graph) · Hierarchy · Focus
 */

window.MapView = (() => {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  let _mode         = 'overview'; // 'overview' | 'hierarchy' | 'focus'
  let _data         = null;       // { themes: [{name,color,paper_count,concepts:[{name,paper_count,papers}]}] }
  let _container    = null;
  let _onNodeClick  = null;
  let _selTheme     = null;       // selected theme name (hierarchy)
  let _selConcept   = null;       // selected concept name (hierarchy)
  let _focusConcept = null;       // focused concept name (focus mode)

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

  const _allPapers = () => {
    const seen = new Set(), out = [];
    (_data?.themes || []).forEach(t =>
      (t.concepts || []).forEach(c =>
        (c.papers || []).forEach(p => { if (!seen.has(p.id)) { seen.add(p.id); out.push(p); } })
      )
    );
    return out;
  };

  // ── Paper card ────────────────────────────────────────────────────────────
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
      ${kws.length  ? `<div class="mv2-pc-tags">${kws.map(k  => `<span class="mv2-pc-tag">${_e(k)}</span>`).join('')}</div>` : ''}
      ${mets.length ? `<div class="mv2-pc-mets">${mets.map(m => `<span class="mv2-pc-met">${_e(m.name)} = ${_e(m.value)}${m.unit ? ' ' + _e(m.unit) : ''}</span>`).join('')}</div>` : ''}
    `;
    card.addEventListener('click', () => {
      if (_onNodeClick) _onNodeClick({ type: 'paper', paperId: p.id, nodeData: p });
    });
    return card;
  };

  // ── Mode bar (3 modes, no Edit) ───────────────────────────────────────────
  const _modeBar = () => {
    const bar = document.createElement('div');
    bar.className = 'mv2-bar';
    [
      { id: 'overview',   label: 'Overview' },
      { id: 'hierarchy',  label: 'Hierarchy' },
      { id: 'focus',      label: 'Focus' },
    ].forEach(({ id, label }) => {
      const btn = document.createElement('button');
      btn.className = 'mv2-bar-btn' + (id === _mode ? ' active' : '');
      btn.textContent = label;
      btn.onclick = () => _setMode(id);
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
      case 'focus':     _focus(body,     themes); break;
    }
    _container.appendChild(body);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // OVERVIEW — Palantir-style SVG node graph (Theme → Concept)
  // ══════════════════════════════════════════════════════════════════════════
  const _overview = (body, themes) => {
    body.classList.add('mv2-overview', 'mv2-ov-graph');

    const wrap = document.createElement('div');
    wrap.className = 'mv2-ov-svg-wrap';
    body.appendChild(wrap);

    requestAnimationFrame(() => {
      const W = wrap.clientWidth  || 900;
      const H = Math.max(wrap.clientHeight || 500, 480);
      const T_R = 36, C_R = 22;

      const tCount  = themes.length;
      const tSlotW  = Math.max(170, W / Math.max(tCount, 1));
      const svgW    = Math.max(W, tCount * tSlotW);
      const tyBase  = H * 0.36;

      const tNodes = []; // {name, color, paperCount, x, y}
      const cNodes = []; // {name, color, paperCount, theme, papers, x, y}
      const edges  = []; // {tx, ty, cx, cy, color}

      themes.forEach((t, ti) => {
        const tx = (ti + 0.5) * tSlotW;
        const ty = tyBase;
        tNodes.push({ name: t.name, color: t.color, paperCount: t.paper_count, x: tx, y: ty });

        const cCount = (t.concepts || []).length;
        (t.concepts || []).forEach((c, ci) => {
          const fan = Math.min(Math.PI * 0.65, cCount * 0.42);
          const a   = cCount === 1
            ? Math.PI / 2
            : Math.PI / 2 - fan / 2 + (ci / (cCount - 1)) * fan;
          const dist = 130;
          const cx = Math.max(C_R + 12, Math.min(svgW - C_R - 12, tx + Math.cos(a) * dist * 0.72));
          const cy = Math.min(H - C_R - 36, ty + Math.sin(a) * dist);
          cNodes.push({ name: c.name, color: t.color, paperCount: c.paper_count, theme: t.name, papers: c.papers, x: cx, y: cy });
          edges.push({ tx, ty, cx, cy, color: t.color });
        });
      });

      const NS  = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width',  svgW);
      svg.setAttribute('height', H);
      svg.style.display = 'block';

      // Edges (drawn first, behind nodes)
      edges.forEach(e => {
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', e.tx); line.setAttribute('y1', e.ty);
        line.setAttribute('x2', e.cx); line.setAttribute('y2', e.cy);
        line.setAttribute('stroke', e.color + '50');
        line.setAttribute('stroke-width', '1.5');
        svg.appendChild(line);
      });

      // Concept nodes
      cNodes.forEach(cn => {
        const g = document.createElementNS(NS, 'g');
        g.setAttribute('cursor', 'pointer');

        const circle = document.createElementNS(NS, 'circle');
        circle.setAttribute('cx', cn.x); circle.setAttribute('cy', cn.y); circle.setAttribute('r', C_R);
        circle.setAttribute('fill', '#151d2e');
        circle.setAttribute('stroke', cn.color + 'cc');
        circle.setAttribute('stroke-width', '1.5');
        g.appendChild(circle);

        const countTxt = document.createElementNS(NS, 'text');
        countTxt.setAttribute('x', cn.x); countTxt.setAttribute('y', cn.y + 5);
        countTxt.setAttribute('text-anchor', 'middle');
        countTxt.setAttribute('fill', cn.color);
        countTxt.setAttribute('font-size', '12');
        countTxt.setAttribute('font-weight', '600');
        countTxt.textContent = cn.paperCount;
        g.appendChild(countTxt);

        const lbl = document.createElementNS(NS, 'text');
        lbl.setAttribute('x', cn.x); lbl.setAttribute('y', cn.y + C_R + 14);
        lbl.setAttribute('text-anchor', 'middle');
        lbl.setAttribute('fill', '#94a3b8');
        lbl.setAttribute('font-size', '10.5');
        lbl.textContent = _cut(cn.name, 18);
        g.appendChild(lbl);

        g.addEventListener('mouseenter', () => { circle.setAttribute('fill', cn.color + '28'); circle.setAttribute('stroke-width', '2'); });
        g.addEventListener('mouseleave', () => { circle.setAttribute('fill', '#151d2e');       circle.setAttribute('stroke-width', '1.5'); });
        g.addEventListener('click', () => { _focusConcept = cn.name; _selTheme = cn.theme; _setMode('focus'); });

        svg.appendChild(g);
      });

      // Theme nodes (on top)
      tNodes.forEach(tn => {
        const g = document.createElementNS(NS, 'g');
        g.setAttribute('cursor', 'pointer');

        const glow = document.createElementNS(NS, 'circle');
        glow.setAttribute('cx', tn.x); glow.setAttribute('cy', tn.y); glow.setAttribute('r', T_R + 7);
        glow.setAttribute('fill', tn.color + '18');
        g.appendChild(glow);

        const circle = document.createElementNS(NS, 'circle');
        circle.setAttribute('cx', tn.x); circle.setAttribute('cy', tn.y); circle.setAttribute('r', T_R);
        circle.setAttribute('fill', '#151d2e');
        circle.setAttribute('stroke', tn.color);
        circle.setAttribute('stroke-width', '2.5');
        g.appendChild(circle);

        const countTxt = document.createElementNS(NS, 'text');
        countTxt.setAttribute('x', tn.x); countTxt.setAttribute('y', tn.y + 6);
        countTxt.setAttribute('text-anchor', 'middle');
        countTxt.setAttribute('fill', tn.color);
        countTxt.setAttribute('font-size', '15');
        countTxt.setAttribute('font-weight', '700');
        countTxt.textContent = tn.paperCount;
        g.appendChild(countTxt);

        const lbl = document.createElementNS(NS, 'text');
        lbl.setAttribute('x', tn.x); lbl.setAttribute('y', tn.y + T_R + 18);
        lbl.setAttribute('text-anchor', 'middle');
        lbl.setAttribute('fill', '#e2e8f0');
        lbl.setAttribute('font-size', '11.5');
        lbl.setAttribute('font-weight', '600');
        lbl.textContent = _cut(tn.name, 20);
        g.appendChild(lbl);

        g.addEventListener('mouseenter', () => circle.setAttribute('stroke-width', '3.5'));
        g.addEventListener('mouseleave', () => circle.setAttribute('stroke-width', '2.5'));
        g.addEventListener('click', () => { _selTheme = tn.name; _selConcept = null; _setMode('hierarchy'); });

        svg.appendChild(g);
      });

      if (svgW > W) wrap.style.overflowX = 'auto';
      wrap.appendChild(svg);
    });
  };

  // ══════════════════════════════════════════════════════════════════════════
  // HIERARCHY MODE — Left tree (Theme → Concept) + Right paper grid
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
      const displayPapers = _selConcept
        ? ((selThemeObj.concepts || []).find(c => c.name === _selConcept)?.papers || [])
        : (() => {
            const seen = new Set(), out = [];
            (selThemeObj.concepts || []).forEach(c =>
              (c.papers || []).forEach(p => { if (!seen.has(p.id)) { seen.add(p.id); out.push(p); } })
            );
            return out;
          })();

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
        pgrid.innerHTML = '<div class="mv2-empty">No papers in this group.</div>';
      } else {
        displayPapers.forEach(p => pgrid.appendChild(_paperCard(p, selThemeObj.color)));
      }
      main.appendChild(pgrid);
    }

    body.appendChild(tree);
    body.appendChild(main);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // FOCUS MODE — Concept-centered view with related concepts + papers
  // ══════════════════════════════════════════════════════════════════════════
  const _focus = (body, themes) => {
    body.classList.add('mv2-focus');

    // Find the focused concept object
    let focusConceptObj = null, focusThemeObj = null;
    themes.forEach(t => (t.concepts || []).forEach(c => {
      if (c.name === _focusConcept) { focusConceptObj = c; focusThemeObj = t; }
    }));

    if (!_focusConcept || !focusConceptObj) {
      // Concept selection cloud
      const hd = document.createElement('div');
      hd.className = 'mv2-focus-hd';
      hd.innerHTML = 'Select a <strong>Concept</strong> to explore:';
      body.appendChild(hd);

      const allConcepts = [];
      themes.forEach(t => (t.concepts || []).forEach(c => allConcepts.push({ ...c, themeColor: t.color })));

      const cloud = document.createElement('div');
      cloud.className = 'mv2-focus-cloud';
      allConcepts.sort((a, b) => b.paper_count - a.paper_count).forEach(c => {
        const chip = document.createElement('span');
        chip.className = 'mv2-focus-kw';
        chip.style.borderColor = c.themeColor + '80';
        chip.style.color       = c.themeColor;
        chip.textContent = c.name;
        chip.title = `${c.paper_count} paper${c.paper_count !== 1 ? 's' : ''}`;
        chip.addEventListener('click', () => { _focusConcept = c.name; _renderAll(); });
        cloud.appendChild(chip);
      });
      body.appendChild(cloud);
      return;
    }

    // Focus header with back button
    const focusHd = document.createElement('div');
    focusHd.className = 'mv2-focus-concept-hd';
    focusHd.innerHTML = `
      <button class="mv2-fc-back" title="Back">←</button>
      <span class="mv2-fc-theme" style="color:${_e(focusThemeObj.color)}">${_e(focusThemeObj.name)}</span>
      <span class="mv2-bc-sep">›</span>
      <span class="mv2-fc-name">${_e(_focusConcept)}</span>
      <span class="mv2-bc-count">${focusConceptObj.paper_count} paper${focusConceptObj.paper_count !== 1 ? 's' : ''}</span>
    `;
    focusHd.querySelector('.mv2-fc-back').addEventListener('click', () => { _focusConcept = null; _renderAll(); });
    body.appendChild(focusHd);

    // Related concepts (share at least one paper)
    const focusPaperIds = new Set((focusConceptObj.papers || []).map(p => p.id));
    const relMap = new Map();
    themes.forEach(t => (t.concepts || []).forEach(c => {
      if (c.name === _focusConcept) return;
      const shared = (c.papers || []).filter(p => focusPaperIds.has(p.id)).length;
      if (shared > 0) relMap.set(c.name, { name: c.name, shared, color: t.color });
    }));

    if (relMap.size > 0) {
      const relSec = document.createElement('div');
      relSec.className = 'mv2-focus-related';
      const relHd = document.createElement('div');
      relHd.className = 'mv2-focus-rel-hd';
      relHd.textContent = 'Related Concepts';
      relSec.appendChild(relHd);

      const cloud = document.createElement('div');
      cloud.className = 'mv2-focus-cloud';
      [...relMap.values()].sort((a, b) => b.shared - a.shared).forEach(rc => {
        const chip = document.createElement('span');
        chip.className = 'mv2-focus-kw';
        chip.style.borderColor = rc.color + '80';
        chip.style.color       = rc.color;
        chip.textContent = `${rc.name} (${rc.shared})`;
        chip.addEventListener('click', () => { _focusConcept = rc.name; _renderAll(); });
        cloud.appendChild(chip);
      });
      relSec.appendChild(cloud);
      body.appendChild(relSec);
    }

    // Evidence (papers)
    const papersHd = document.createElement('div');
    papersHd.className = 'mv2-focus-papers-hd';
    papersHd.textContent = 'Evidence';
    body.appendChild(papersHd);

    const pgrid = document.createElement('div');
    pgrid.className = 'mv2-pgrid';
    (focusConceptObj.papers || []).forEach(p => pgrid.appendChild(_paperCard(p, focusThemeObj.color)));
    body.appendChild(pgrid);
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
    } catch (e) {
      _data = { themes: [] };
    }

    if (!_data || Array.isArray(_data)) _data = { themes: [] };
    if (_data.groups && !_data.themes)  _data = { themes: [] }; // old format fallback

    _selTheme = (_data.themes || []).length ? _data.themes[0].name : null;
    _mode     = 'overview';
    _renderAll();
  };

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    init,
    fit:               () => {},
    applyKeywordFilter: norms => {
      if (norms && norms.length) { _focusConcept = norms[0]; _setMode('focus'); }
      else { _focusConcept = null; if (_mode === 'focus') _setMode('overview'); }
    },
    enterOverviewMode:  () => _setMode('overview'),
    enterFullMode:      () => _setMode('hierarchy'),
    exitFocus:          () => { _focusConcept = null; _setMode('overview'); },
    refreshGroup:       () => {},
    deleteGroup:        async () => {},
  };
})();
