/**
 * Lacus Map View v6 — Research flow tree (story-map style)
 * Overview: zoom/pan canvas, draggable nodes, collapse/expand
 */

window.MapView = (() => {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  let _mode        = 'overview';
  let _data        = null;
  let _container   = null;
  let _onNodeClick = null;
  let _selTheme    = null;
  let _selConcept  = null;
  let _activeKws   = new Set();
  const _collapsed = new Set();

  // ── Canvas transform state ─────────────────────────────────────────────────
  const NS = 'http://www.w3.org/2000/svg';
  let _zoom       = 1;
  let _panX       = 0;
  let _panY       = 0;
  let _didCenter  = false;
  let _panActive  = false;
  let _panOriginX = 0;
  let _panOriginY = 0;
  let _dragNode   = null; // { node, el, sx, sy, ox, oy, moved }
  let _lastDragMoved = false;
  let _wrapEl     = null;
  let _viewEl     = null;
  let _svgEl      = null;
  let _rootsCache = [];

  // ── Layout constants ──────────────────────────────────────────────────────
  const OV_W   = 190;
  const OV_HG  = 14;
  const OV_VG  = 62;
  const OV_TH  = 50;
  const OV_CH  = 50;
  const OV_PH  = 114;
  const OV_PAD = 28;

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

  // ── Transform ─────────────────────────────────────────────────────────────
  const _applyTransform = () => {
    if (_viewEl) _viewEl.style.transform = `translate(${_panX}px,${_panY}px) scale(${_zoom})`;
  };

  // ── Edge drawing ──────────────────────────────────────────────────────────
  const _drawEdgesFrom = node => {
    const nodeH = node.type === 'theme' ? OV_TH : node.type === 'concept' ? OV_CH : OV_PH;
    if (_collapsed.has(node.id)) return;
    node.children.forEach(child => {
      const x1 = node.x  + OV_W / 2, y1 = node.y  + nodeH;
      const x2 = child.x + OV_W / 2, y2 = child.y;
      const my = (y1 + y2) / 2;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${my} ${x2} ${my} ${x2} ${y2}`);
      path.setAttribute('stroke', node.color + '55');
      path.setAttribute('stroke-width', '1.8');
      path.setAttribute('fill', 'none');
      _svgEl.appendChild(path);
      _drawEdgesFrom(child);
    });
  };

  const _redrawEdges = () => {
    if (!_svgEl) return;
    while (_svgEl.firstChild) _svgEl.removeChild(_svgEl.firstChild);
    _rootsCache.forEach(_drawEdgesFrom);
  };

  // ── Document-level mouse handlers (set up once) ───────────────────────────
  document.addEventListener('mousemove', e => {
    if (_panActive) {
      _panX = e.clientX - _panOriginX;
      _panY = e.clientY - _panOriginY;
      _applyTransform();
    } else if (_dragNode) {
      const dx = (e.clientX - _dragNode.sx) / _zoom;
      const dy = (e.clientY - _dragNode.sy) / _zoom;
      if (!_dragNode.moved && Math.sqrt(dx * dx + dy * dy) < 5) return;
      _dragNode.moved = true;
      _dragNode.node.x = _dragNode.ox + dx;
      _dragNode.node.y = _dragNode.oy + dy;
      _dragNode.el.style.left = _dragNode.node.x + 'px';
      _dragNode.el.style.top  = _dragNode.node.y + 'px';
      _redrawEdges();
      document.body.style.cursor = 'grabbing';
    }
  });

  document.addEventListener('mouseup', () => {
    if (_panActive) {
      _panActive = false;
      if (_wrapEl) _wrapEl.classList.remove('mv2-ov-panning');
    }
    if (_dragNode) {
      _lastDragMoved = _dragNode.moved;
      _dragNode = null;
      document.body.style.cursor = '';
    }
  });

  // ── Keyword filter list ───────────────────────────────────────────────────
  const _buildKwList = () => {
    const kwMap = new Map();
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
    return [...kwMap.values()].sort((a, b) => b.count - a.count).slice(0, 30);
  };

  // ── Filter bar ────────────────────────────────────────────────────────────
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

  // ── Mode bar ──────────────────────────────────────────────────────────────
  const _modeBar = () => {
    const bar = document.createElement('div');
    bar.className = 'mv2-bar';
    [{ id: 'overview', label: 'Overview' }, { id: 'hierarchy', label: 'Hierarchy' }]
      .forEach(({ id, label }) => {
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
      body.innerHTML = '<div class="mv2-empty">No papers yet. Import a PDF and assign a Theme &amp; Concept to start.</div>';
      _container.appendChild(body);
      return;
    }
    switch (_mode) {
      case 'overview':  _overview(body, themes); break;
      case 'hierarchy': _hierarchy(body, themes); break;
    }
    _container.appendChild(body);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // OVERVIEW — research flow tree (Theme → Concept → Paper)
  // ══════════════════════════════════════════════════════════════════════════

  const _subtreeW = node => {
    if (_collapsed.has(node.id) || !node.children.length) return OV_W;
    const childrenW = node.children.reduce((s, c) => s + _subtreeW(c), 0)
                    + (node.children.length - 1) * OV_HG;
    return Math.max(OV_W, childrenW);
  };

  const _layoutNode = (node, centerX, y) => {
    const nodeH = node.type === 'theme' ? OV_TH : node.type === 'concept' ? OV_CH : OV_PH;
    node.x = centerX - OV_W / 2;
    node.y = y;
    if (_collapsed.has(node.id) || !node.children.length) return;
    const childY = y + nodeH + OV_VG;
    const totalChildW = node.children.reduce((s, c) => s + _subtreeW(c), 0)
                      + (node.children.length - 1) * OV_HG;
    let cx = centerX - totalChildW / 2;
    node.children.forEach(child => {
      const sw = _subtreeW(child);
      _layoutNode(child, cx + sw / 2, childY);
      cx += sw + OV_HG;
    });
  };

  const _paperMatches = p =>
    !_activeKws.size || (p.keywords || []).some(kw => _activeKws.has(kw.toLowerCase()));

  const _overview = (body, themes) => {
    body.classList.add('mv2-ov-tree');

    // ── Build tree ──────────────────────────────────────────────────────────
    const roots = themes.map(theme => ({
      id: `t:${theme.name}`,
      type: 'theme',
      label: theme.name,
      color: theme.color,
      count: theme.paper_count,
      children: (theme.concepts || []).map(concept => ({
        id: `c:${theme.name}:${concept.name}`,
        type: 'concept',
        label: concept.name,
        color: theme.color,
        count: concept.paper_count,
        children: (concept.papers || []).map(p => ({
          id: `p:${p.id}`,
          type: 'paper',
          label: p.title || 'Untitled',
          color: theme.color,
          paper: p,
          children: [],
          dimmed: !_paperMatches(p),
        })),
      })),
    }));

    // ── Layout ──────────────────────────────────────────────────────────────
    const totalW = roots.reduce((s, r) => s + _subtreeW(r), 0)
                 + (roots.length - 1) * OV_HG;
    const canvasW = Math.max(totalW + OV_PAD * 2, 600);
    const canvasH = OV_PAD + OV_TH + OV_VG + OV_CH + OV_VG + OV_PH + OV_PAD;

    let startX = OV_PAD + (canvasW - OV_PAD * 2 - totalW) / 2;
    roots.forEach(root => {
      const sw = _subtreeW(root);
      _layoutNode(root, startX + sw / 2, OV_PAD);
      startX += sw + OV_HG;
    });

    // ── Store for live edge redraw ──────────────────────────────────────────
    _rootsCache = roots;

    // ── Viewport + canvas ───────────────────────────────────────────────────
    const wrap = document.createElement('div');
    wrap.className = 'mv2-ov-wrap';
    _wrapEl = wrap;

    const viewport = document.createElement('div');
    viewport.className = 'mv2-ov-viewport';
    _viewEl = viewport;

    const canvas = document.createElement('div');
    canvas.className = 'mv2-ov-canvas';
    canvas.style.width  = canvasW + 'px';
    canvas.style.height = canvasH + 'px';

    // SVG edge layer
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width',  canvasW);
    svg.setAttribute('height', canvasH);
    svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;overflow:visible';
    _svgEl = svg;

    // ── Render nodes recursively ─────────────────────────────────────────────
    const renderSubtree = node => {
      const nodeH = node.type === 'theme' ? OV_TH : node.type === 'concept' ? OV_CH : OV_PH;
      const isCollapsed = _collapsed.has(node.id);
      const hasChildren = node.children.length > 0;

      const el = document.createElement('div');
      el.className = `mv2-ov-node mv2-ov-node-${node.type}${node.dimmed ? ' mv2-ov-dimmed' : ''}`;
      el.style.left  = node.x + 'px';
      el.style.top   = node.y + 'px';
      el.style.width = OV_W + 'px';

      if (node.type === 'paper') {
        const p   = node.paper;
        const kws = (p.keywords || []).slice(0, 5);
        el.innerHTML = `
          <div class="mv2-ov-node-hd" style="border-bottom:1px solid ${_e(node.color)}33">
            <span class="mv2-ov-node-label" title="${_e(p.title)}">${_e(_cut(p.title, 56))}</span>
          </div>
          <div class="mv2-ov-node-sub">
            ${p.year ? `<span class="mv2-ov-node-year">${_e(p.year)}</span>` : ''}
          </div>
          ${kws.length ? `<div class="mv2-ov-node-kws">${kws.map(k =>
            `<span class="mv2-ov-node-kw" style="border-color:${_e(node.color)}55">${_e(k)}</span>`
          ).join('')}</div>` : ''}
        `;
        el.addEventListener('click', () => {
          if (_lastDragMoved) { _lastDragMoved = false; return; }
          if (_onNodeClick) _onNodeClick({ type: 'paper', paperId: p.id, nodeData: p });
        });
      } else {
        const collHint = isCollapsed && hasChildren
          ? `<span class="mv2-ov-coll-hint">${node.children.length} hidden ▶</span>` : '';
        el.innerHTML = `
          <div class="mv2-ov-node-hd" style="background:${_e(node.color)}15;border-bottom:1px solid ${_e(node.color)}33">
            <span class="mv2-ov-node-icon" style="color:${_e(node.color)}">${node.type === 'theme' ? '◈' : '⬡'}</span>
            <span class="mv2-ov-node-label">${_e(node.label)}</span>
            <span class="mv2-ov-node-badge" style="background:${_e(node.color)}22;color:${_e(node.color)}">${node.count}</span>
          </div>
          <div class="mv2-ov-node-bd">
            <span class="mv2-ov-node-type-lbl">${node.type}</span>
            ${collHint}
          </div>
        `;
        if (hasChildren) {
          el.title = 'Double-click to collapse / expand';
          el.addEventListener('dblclick', e => {
            e.stopPropagation();
            _lastDragMoved = false;
            if (_collapsed.has(node.id)) _collapsed.delete(node.id);
            else _collapsed.add(node.id);
            _renderAll();
          });
          el.addEventListener('click', () => {
            if (_lastDragMoved) { _lastDragMoved = false; return; }
            if (node.type === 'concept') {
              _selTheme   = themes.find(t => t.concepts?.some(c => c.name === node.label))?.name || _selTheme;
              _selConcept = node.label;
            } else if (node.type === 'theme') {
              _selTheme   = node.label;
              _selConcept = null;
            }
          });
        }
      }

      // Node drag (mousedown)
      el.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        e.stopPropagation();
        _dragNode = { node, el, sx: e.clientX, sy: e.clientY, ox: node.x, oy: node.y, moved: false };
        e.preventDefault();
      });

      if (isCollapsed) el.classList.add('mv2-ov-collapsed');
      canvas.appendChild(el);

      if (!isCollapsed) node.children.forEach(renderSubtree);
    };

    roots.forEach(renderSubtree);

    // Draw initial edges
    _redrawEdges();

    canvas.appendChild(svg);
    viewport.appendChild(canvas);
    wrap.appendChild(viewport);

    // ── Pan (mousedown on background) ───────────────────────────────────────
    wrap.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (e.target.closest('.mv2-ov-node') || e.target.closest('.mv2-ov-zoom-ctrl')) return;
      _panActive  = true;
      _panOriginX = e.clientX - _panX;
      _panOriginY = e.clientY - _panY;
      wrap.classList.add('mv2-ov-panning');
      e.preventDefault();
    });

    // ── Wheel zoom ──────────────────────────────────────────────────────────
    wrap.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const nz = Math.min(4, Math.max(0.1, _zoom * factor));
      _panX = mx - (mx - _panX) * (nz / _zoom);
      _panY = my - (my - _panY) * (nz / _zoom);
      _zoom = nz;
      _applyTransform();
    }, { passive: false });

    // ── Zoom control buttons ─────────────────────────────────────────────────
    const zoomCtrl = document.createElement('div');
    zoomCtrl.className = 'mv2-ov-zoom-ctrl';

    const mkZBtn = (label, fn) => {
      const b = document.createElement('button');
      b.className = 'mv2-ov-zoom-btn';
      b.textContent = label;
      b.title = label === '+' ? 'Zoom in' : label === '−' ? 'Zoom out' : 'Reset view';
      b.addEventListener('click', fn);
      return b;
    };

    zoomCtrl.appendChild(mkZBtn('+', () => {
      _zoom = Math.min(4, _zoom * 1.25);
      _applyTransform();
    }));
    zoomCtrl.appendChild(mkZBtn('−', () => {
      _zoom = Math.max(0.1, _zoom / 1.25);
      _applyTransform();
    }));
    zoomCtrl.appendChild(mkZBtn('↺', () => {
      _zoom = 1;
      _panX = Math.max(20, (wrap.clientWidth  - canvasW)  / 2);
      _panY = Math.max(20, (wrap.clientHeight - canvasH) / 2);
      _applyTransform();
    }));

    wrap.appendChild(zoomCtrl);
    body.appendChild(wrap);

    // ── Apply current transform (preserve zoom/pan across re-renders) ────────
    _applyTransform();

    // ── Center on first load ─────────────────────────────────────────────────
    if (!_didCenter) {
      requestAnimationFrame(() => {
        _didCenter = true;
        _panX = Math.max(20, (wrap.clientWidth  - canvasW)  / 2);
        _panY = Math.max(20, (wrap.clientHeight - canvasH) / 2);
        _applyTransform();
      });
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // HIERARCHY — left tree + right paper grid
  // ══════════════════════════════════════════════════════════════════════════
  const _hierarchy = (body, themes) => {
    body.classList.add('mv2-hierarchy');
    if (!_selTheme && themes.length) _selTheme = themes[0].name;
    const selThemeObj = themes.find(t => t.name === _selTheme);

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
        displayPapers = displayPapers.filter(p => _paperMatches(p));
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
        displayPapers.forEach(p => {
          const card = document.createElement('div');
          card.className = 'mv2-pc';
          const kws  = (p.keywords || []).filter(Boolean).slice(0, 4);
          const mets = (p.metrics  || []).filter(m => m.name).slice(0, 2);
          card.innerHTML = `
            <div class="mv2-pc-title">${_e(_cut(p.title, 80))}</div>
            <div class="mv2-pc-sub">
              ${p.year    ? `<span>${_e(p.year)}</span>` : ''}
              ${p.concept ? `<span class="mv2-pc-concept" style="color:${_e(selThemeObj.color)}">${_e(p.concept)}</span>` : ''}
            </div>
            ${kws.length  ? `<div class="mv2-pc-tags">${kws.map(k => `<span class="mv2-pc-tag">${_e(k)}</span>`).join('')}</div>` : ''}
            ${mets.length ? `<div class="mv2-pc-mets">${mets.map(m => `<span class="mv2-pc-met">${_e(m.name)} = ${_e(m.value)}${m.unit ? ' ' + _e(m.unit) : ''}</span>`).join('')}</div>` : ''}
          `;
          card.addEventListener('click', () => {
            if (_onNodeClick) _onNodeClick({ type: 'paper', paperId: p.id, nodeData: p });
          });
          pgrid.appendChild(card);
        });
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

    // Reset transform state for fresh load
    _zoom = 1; _panX = 0; _panY = 0; _didCenter = false;

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

  return {
    init,
    fit:               () => {},
    applyKeywordFilter: norms => { _activeKws.clear(); (norms || []).forEach(n => _activeKws.add(n)); _renderAll(); },
    enterOverviewMode: () => _setMode('overview'),
    enterFullMode:     () => _setMode('hierarchy'),
    exitFocus:         () => { _activeKws.clear(); _setMode('overview'); },
    refreshGroup:      () => {},
    deleteGroup:       async () => {},
  };
})();
