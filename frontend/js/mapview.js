/**
 * Lacus Map View — Editable multi-paper knowledge map
 */

window.MapView = (() => {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────────
  let cy            = null;
  let _eh           = null;
  let _posTimer     = null;
  let _createPos    = null;
  let _paperKwMap   = {};   // { paperId: [normalized_name, ...] } — filter index
  let _connectMode  = false;
  let _connectSrcId = null;
  let _suppressCtx  = false;
  let _onNodeClick  = null;
  let _tapTimer     = null;
  let _papersCache  = [];   // paper data for preview restoration

  const API = '/api';
  const _getToken = async () => {
    if (window._authToken) return window._authToken;
    if (window._sb) {
      const { data: { session } } = await window._sb.auth.getSession();
      if (session) { window._authToken = session.access_token; return session.access_token; }
    }
    return null;
  };

  const _fetch = async (path, opts = {}) => {
    const token = await _getToken();
    const res = await fetch(API + path, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
        ...opts.headers,
      },
      ...opts,
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || res.statusText || `HTTP ${res.status}`); }
    return res.json();
  };

  const _e   = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const _cut = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
  const _uri = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

  const CAT_COLORS = {
    Material:    '#eab308',
    Structure:   '#10b981',
    Method:      '#3b82f6',
    Property:    '#8b5cf6',
    Application: '#ec4899',
    Metric:      '#14b8a6',
    Other:       '#94a3b8',
    Custom:      '#64748b',
  };

  const CAT_LAYER = { Material: 0, Structure: 0, Method: 1, Property: 2, Other: 2, Application: 3 };

  // ── SVG generators ────────────────────────────────────────────────────────

  const PW = 300, PH = 92, PR = 8, PTB = 24;

  const _paperSvg = (title, year, materials, expanded) => {
    const matStr = materials.length ? _cut(materials.join('  ·  '), 36) : '';
    const ind = expanded ? '▼' : '▶';
    return _uri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}">` +
      `<rect x="1" y="1" width="${PW-2}" height="${PH-2}" rx="${PR}" ry="${PR}" fill="#13111e" stroke="#7c3aed" stroke-width="1.5"/>` +
      `<rect x="1" y="1" width="${PW-2}" height="${PTB}" rx="${PR}" ry="${PR}" fill="#7c3aed"/>` +
      `<rect x="1" y="${PTB-PR+1}" width="${PW-2}" height="${PR}" fill="#7c3aed"/>` +
      `<text x="10" y="${PTB/2+5}" font-family="'Inter','Segoe UI',sans-serif" font-size="9" font-weight="700" fill="#ddd6fe" letter-spacing="1">PAPER</text>` +
      (year ? `<text x="${PW-10}" y="${PTB/2+5}" font-family="'Inter','Segoe UI',sans-serif" font-size="9" fill="#e0e7ff" text-anchor="end">${_e(year)}</text>` : '') +
      `<text x="10" y="${PTB+21}" font-family="'Inter','Segoe UI',sans-serif" font-size="15" font-weight="700" fill="#f8fafc">${_e(_cut(title, 28))}</text>` +
      (matStr ? `<text x="10" y="${PTB+41}" font-family="'Inter','Segoe UI',sans-serif" font-size="12" fill="#fcd34d">◆ ${_e(matStr)}</text>` : '') +
      `<text x="${PW-10}" y="${PH-7}" font-family="'Inter','Segoe UI',sans-serif" font-size="9" fill="#a78bfa" text-anchor="end">${ind} keywords</text>` +
      `</svg>`
    );
  };

  const KW = 200, KH = 62, KR = 7, KTB = 20;
  const _kwSvg = (label, category) => {
    const col = CAT_COLORS[category] || '#94a3b8';
    return _uri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${KW}" height="${KH}">` +
      `<rect x="1" y="1" width="${KW-2}" height="${KH-2}" rx="${KR}" ry="${KR}" fill="#0f1729" stroke="${col}" stroke-width="1.5" stroke-opacity=".75"/>` +
      `<rect x="1" y="1" width="${KW-2}" height="${KTB}" rx="${KR}" ry="${KR}" fill="${col}"/>` +
      `<rect x="1" y="${KTB-KR+1}" width="${KW-2}" height="${KR}" fill="${col}"/>` +
      `<text x="${KW/2}" y="${KTB/2+5}" font-family="'Inter','Segoe UI',sans-serif" font-size="10" font-weight="700" fill="#050d1a" text-anchor="middle">${_e(category||'')}</text>` +
      `<text x="9" y="${KTB+26}" font-family="'Inter','Segoe UI',sans-serif" font-size="14" font-weight="700" fill="#f1f5f9">${_e(_cut(label, 20))}</text>` +
      `</svg>`
    );
  };

  const CN_W = 200, CN_H = 68, CN_R = 7, CN_TB = 22;
  const _customSvg = (label, category, color) => {
    const col = color || CAT_COLORS[category] || '#64748b';
    return _uri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${CN_W}" height="${CN_H}">` +
      `<rect x="1" y="1" width="${CN_W-2}" height="${CN_H-2}" rx="${CN_R}" ry="${CN_R}" fill="#0a0a12" stroke="${col}" stroke-width="1.5"/>` +
      `<rect x="1" y="1" width="${CN_W-2}" height="${CN_TB}" rx="${CN_R}" ry="${CN_R}" fill="${col}"/>` +
      `<rect x="1" y="${CN_TB-CN_R+1}" width="${CN_W-2}" height="${CN_R}" fill="${col}"/>` +
      `<text x="${CN_W/2}" y="${CN_TB/2+5}" font-family="'Inter','Segoe UI',sans-serif" font-size="10" font-weight="700" fill="#050d1a" text-anchor="middle">${_e(category||'Custom')}</text>` +
      `<text x="9" y="${CN_TB+26}" font-family="'Inter','Segoe UI',sans-serif" font-size="14" font-weight="700" fill="#f1f5f9">${_e(_cut(label, 20))}</text>` +
      `</svg>`
    );
  };

  // ── Layout helpers ────────────────────────────────────────────────────────

  const LAYER_Y_OFF   = [148, 272, 400, 528];
  const KW_GAP        = 224;
  const MAX_PER_LAYER = 4;

  const _kwDefaultPos = (paperNode, keywords) => {
    const px = paperNode.position('x');
    const py = paperNode.position('y');
    const layers = [[], [], [], []];
    keywords
      .slice()
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      .forEach(kw => {
        const li = CAT_LAYER[kw.category] !== undefined ? CAT_LAYER[kw.category] : 2;
        if (li < 4 && layers[li].length < MAX_PER_LAYER) layers[li].push(kw);
      });
    const posMap = {};
    layers.forEach((kwArr, li) => {
      const totalW = (kwArr.length - 1) * KW_GAP;
      const startX = px - totalW / 2;
      kwArr.forEach((kw, i) => {
        posMap[`kw_${kw.id}`] = {
          x: kw.pos_x != null ? kw.pos_x : startX + i * KW_GAP,
          y: kw.pos_y != null ? kw.pos_y : py + LAYER_Y_OFF[li],
        };
      });
    });
    return { layers, posMap };
  };

  // ── Stylesheet ────────────────────────────────────────────────────────────

  const STYLESHEET = [
    {
      selector: 'node[type="paper"]',
      style: {
        'background-opacity': 0,
        'background-image': (ele) => _paperSvg(
          ele.data('title'), ele.data('year'),
          ele.data('materials') || [], ele.data('expanded')
        ),
        'background-fit': 'contain', 'background-clip': 'node', 'background-image-opacity': 1,
        'border-width': 0, 'label': '', 'width': PW, 'height': PH,
        'shape': 'round-rectangle', 'cursor': 'pointer',
      }
    },
    {
      selector: 'node[type="keyword"]',
      style: {
        'background-opacity': 0,
        'background-image': (ele) => _kwSvg(ele.data('label'), ele.data('category')),
        'background-fit': 'contain', 'background-clip': 'node', 'background-image-opacity': 1,
        'border-width': 0, 'label': '', 'width': KW, 'height': KH, 'shape': 'round-rectangle',
      }
    },
    {
      selector: 'node[type="custom"]',
      style: {
        'background-opacity': 0,
        'background-image': (ele) => _customSvg(ele.data('label'), ele.data('category'), ele.data('color')),
        'background-fit': 'contain', 'background-clip': 'node', 'background-image-opacity': 1,
        'border-width': 0, 'label': '', 'width': CN_W, 'height': CN_H, 'shape': 'round-rectangle',
      }
    },
    { selector: 'node:selected',    style: { 'overlay-color': '#c084fc', 'overlay-opacity': 0.22, 'overlay-padding': 6 } },
    { selector: 'node.faded',       style: { 'opacity': 0.12 } },
    { selector: 'node.highlighted', style: { 'overlay-color': '#f97316', 'overlay-opacity': 0.35, 'overlay-padding': 8 } },
    // Paper → Material/Structure edges
    {
      selector: 'edge[edgeType="parent"]',
      style: {
        'width': 1.5, 'line-color': '#eab308', 'target-arrow-color': '#eab308',
        'target-arrow-shape': 'triangle', 'arrow-scale': 0.7,
        'curve-style': 'bezier', 'opacity': 0.55, 'label': '',
      }
    },
    // Story-flow edges
    {
      selector: 'edge[edgeType="story"]',
      style: {
        'width': 1.5, 'line-color': '#2d4a72', 'target-arrow-color': '#2d4a72',
        'target-arrow-shape': 'triangle', 'arrow-scale': 0.8,
        'curve-style': 'bezier',
        'label': 'data(relation)', 'font-size': '9px', 'color': '#475569',
        'font-family': '"Inter","Segoe UI",sans-serif',
        'text-rotation': 'autorotate', 'text-margin-y': -7,
        'line-style': 'dashed', 'line-dash-pattern': [5, 4], 'opacity': 0.6,
      }
    },
    // User-drawn edges
    {
      selector: 'edge[edgeType="user"]',
      style: {
        'width': 2.5, 'line-color': '#a855f7', 'target-arrow-color': '#a855f7',
        'target-arrow-shape': 'triangle', 'arrow-scale': 1.0,
        'curve-style': 'bezier',
        'label': 'data(relation)', 'font-size': '10px', 'color': '#a5b4fc',
        'font-family': '"Inter","Segoe UI",sans-serif',
        'text-rotation': 'autorotate', 'text-margin-y': -9, 'opacity': 0.9,
      }
    },
    // Cross-paper shared-keyword edges
    {
      selector: 'edge[edgeType="cross_paper"]',
      style: {
        'width': 1.5, 'line-color': '#334155',
        'line-style': 'dashed', 'line-dash-pattern': [6, 4],
        'curve-style': 'bezier', 'opacity': 0.55,
        'label': 'data(relation)',
        'font-size': '8px', 'color': '#64748b',
        'font-family': '"Inter","Segoe UI",sans-serif',
        'text-rotation': 'autorotate', 'text-margin-y': -6,
        'text-opacity': 0.75,
        'target-arrow-shape': 'none',
      }
    },
    { selector: 'edge:selected', style: { 'overlay-color': '#c084fc', 'overlay-opacity': 0.3, 'overlay-padding': 4, 'width': 4 } },
    { selector: 'edge.faded',    style: { 'opacity': 0.05 } },
    // Edge-handles
    { selector: '.eh-handle', style: { 'background-color': '#a855f7', 'width': 18, 'height': 18, 'shape': 'ellipse', 'border-color': '#fff', 'border-width': 2, 'label': '+', 'color': '#fff', 'font-size': 16, 'font-weight': '900', 'text-valign': 'center', 'text-halign': 'center' } },
    { selector: '.eh-hover',   style: { 'background-color': '#c084fc' } },
    { selector: '.eh-source',  style: { 'border-color': '#a855f7', 'border-width': 3, 'border-opacity': 1 } },
    { selector: '.eh-target',  style: { 'border-color': '#22c55e', 'border-width': 3, 'border-opacity': 1 } },
    { selector: '.eh-preview, .eh-ghost-edge', style: { 'line-color': '#a855f7', 'target-arrow-color': '#a855f7', 'source-arrow-color': '#a855f7', 'target-arrow-shape': 'triangle', 'line-style': 'dashed', 'opacity': 0.7 } },
  ];

  // ── Screen → canvas coords ────────────────────────────────────────────────

  const _toCy = (container, clientX, clientY) => {
    const rect = container.getBoundingClientRect();
    const pan = cy.pan(), zoom = cy.zoom();
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top  - pan.y) / zoom,
    };
  };

  // ── Position saving ───────────────────────────────────────────────────────

  const _schedSave = () => {
    clearTimeout(_posTimer);
    _posTimer = setTimeout(_savePositions, 1200);
  };

  const _savePositions = async () => {
    if (!cy) return;
    const items = cy.nodes().map(n => ({
      node_id:  n.id(),
      pos_x:    Math.round(n.position('x') * 10) / 10,
      pos_y:    Math.round(n.position('y') * 10) / 10,
      expanded: n.data('expanded') ? 1 : 0,
    }));
    if (items.length === 0) return;
    try { await _fetch('/map-positions', { method: 'POST', body: JSON.stringify(items) }); }
    catch (_) {}
  };

  // ── Expand / collapse ─────────────────────────────────────────────────────

  const _expandPaper = async (paperNode) => {
    const paperId   = paperNode.data('paperId');
    const papNodeId = `p_${paperId}`;
    // Remove preview (1차) nodes before loading full keywords
    cy.nodes(`[type="keyword"][paperId="${paperId}"]`).remove();
    cy.edges(`[edgeType="parent"][paperId="${paperId}"]`).remove();
    try {
      const keywords = await _fetch(`/papers/${paperId}/keywords`);
      if (keywords.length === 0) { _showToast('No keywords found for this paper.', 'warn'); return; }

      // Update filter index from live data
      _paperKwMap[paperId] = keywords.map(kw => (kw.normalized_name || '').toLowerCase());

      const { layers, posMap } = _kwDefaultPos(paperNode, keywords);

      layers.flat().forEach(kw => {
        const kwId = `kw_${kw.id}`;
        if (cy.getElementById(kwId).length > 0) return;
        cy.add([{ data: {
          id: kwId, type: 'keyword',
          label:      kw.keyword_name || kw.normalized_name || '(unnamed)',
          normalized: (kw.normalized_name || '').toLowerCase(),
          category:   kw.category || 'Other',
          confidence: kw.confidence || 0,
          paperId,
        }, position: posMap[kwId] || { x: paperNode.position('x'), y: paperNode.position('y') + 200 } }]);
      });

      const byCat = {};
      layers.flat().forEach(kw => {
        if (!byCat[kw.category]) byCat[kw.category] = [];
        byCat[kw.category].push(`kw_${kw.id}`);
      });

      // Paper → Material / Structure edges
      (byCat.Material || []).forEach((kwId, i) => {
        const eid = `pe_${paperId}_m${i}`;
        if (cy.getElementById(eid).length === 0)
          cy.add([{ data: { id: eid, source: papNodeId, target: kwId, relation: '', edgeType: 'parent', paperId } }]);
      });
      (byCat.Structure || []).forEach((kwId, i) => {
        const eid = `pe_${paperId}_s${i}`;
        if (cy.getElementById(eid).length === 0)
          cy.add([{ data: { id: eid, source: papNodeId, target: kwId, relation: '', edgeType: 'parent', paperId } }]);
      });

      // Story-flow edges
      const methods = [...(byCat.Method || []), ...(byCat.Structure || [])];
      const props   = [...(byCat.Property || []), ...(byCat.Other || [])];
      let si = 0;
      const addStory = (src, tgt, rel) => {
        const eid = `se_${paperId}_${si++}`;
        if (cy.getElementById(eid).length === 0)
          cy.add([{ data: { id: eid, source: src, target: tgt, relation: rel, edgeType: 'story', paperId } }]);
      };
      (byCat.Material || []).forEach(m => methods.forEach(n => addStory(m, n, 'made by')));
      methods.forEach(n => props.forEach(p => addStory(n, p, 'yields')));
      props.forEach(p => (byCat.Application || []).forEach(a => addStory(p, a, 'enables')));

      paperNode.data('expanded', true);
      _refreshPaperSvg(paperNode);
      _schedSave();
    } catch (e) { _showToast('Failed to load keywords: ' + e.message, 'error'); }
  };

  const _collapsePaper = (paperNode) => {
    const paperId = paperNode.data('paperId');
    cy.nodes(`[type="keyword"][paperId="${paperId}"]`).remove();
    cy.edges(`[edgeType="story"][paperId="${paperId}"]`).remove();
    cy.edges(`[edgeType="parent"][paperId="${paperId}"]`).remove();
    paperNode.data('expanded', false);
    _refreshPaperSvg(paperNode);
    // Restore preview nodes (1차 노드)
    const paper = _papersCache.find(p => p.id === paperId);
    if (paper) {
      const pos = paperNode.position();
      _addPreviewNodes({ ...paper, pos_x: pos.x, pos_y: pos.y }, el => cy.add([el]));
    }
    _schedSave();
  };

  // Add top keyword "preview" nodes (1차 노드) around a paper node
  const _addPreviewNodes = (paper, addFn) => {
    const previewKws = [...(paper.materials || []), ...(paper.top_keywords || [])].filter(Boolean).slice(0, 5);
    if (!previewKws.length) return;
    const papNodeId = `p_${paper.id}`;
    const px = paper.pos_x || 0;
    const py = paper.pos_y || 0;
    const radius = 230;
    previewKws.forEach((kwName, i) => {
      const angle = -Math.PI / 2 + (i / previewKws.length) * 2 * Math.PI;
      const nodeId = `pw_${paper.id}_${i}`;
      const ismat  = i < (paper.materials || []).length;
      addFn({ data: {
        id: nodeId, type: 'keyword',
        label: kwName, normalized: kwName.toLowerCase(),
        category: ismat ? 'Material' : 'Other',
        paperId: paper.id, preview: true,
      }, position: { x: px + Math.cos(angle) * radius, y: py + Math.sin(angle) * radius } });
      addFn({ data: { id: `pwe_${paper.id}_${i}`, source: papNodeId, target: nodeId, edgeType: 'parent', paperId: paper.id } });
    });
  };

  const _refreshPaperSvg = (node) => {
    node.style('background-image', _paperSvg(
      node.data('title'), node.data('year'),
      node.data('materials') || [], node.data('expanded')
    ));
  };

  // ── Connect mode ──────────────────────────────────────────────────────────

  const _startConnectMode = (sourceId) => {
    _connectMode  = true;
    _connectSrcId = sourceId;
    cy.getElementById(sourceId).addClass('highlighted');
    const c = cy.container();
    if (c) c.style.cursor = 'crosshair';
    _showToast('Click a node to connect · Esc to cancel', 'ok');
  };

  const _cancelConnectMode = () => {
    if (_connectSrcId) { const n = cy && cy.getElementById(_connectSrcId); if (n) n.removeClass('highlighted'); }
    _connectMode  = false;
    _connectSrcId = null;
    const c = cy && cy.container();
    if (c) c.style.cursor = '';
  };

  // ── Canvas context menu ───────────────────────────────────────────────────

  let _ctxEl = null;

  const _initContextMenu = (container) => {
    _ctxEl = document.createElement('div');
    _ctxEl.className = 'mv-ctx-menu hidden';
    _ctxEl.innerHTML = `
      <div class="mv-ctx-item" id="mv-ctx-new">＋  New Object</div>
      <div class="mv-ctx-item" id="mv-ctx-fit">⊡  Fit View</div>
    `;
    container.appendChild(_ctxEl);
    _ctxEl.querySelector('#mv-ctx-new').onclick = () => { _hideAllMenus(); _showNewNodeDialog(_createPos); };
    _ctxEl.querySelector('#mv-ctx-fit').onclick = () => { _hideAllMenus(); cy && cy.fit(undefined, 50); };
    document.addEventListener('click', _hideAllMenus, { passive: true });
  };

  const _showCtx = (clientX, clientY, cyPos) => {
    _createPos = cyPos;
    const c = _ctxEl.parentElement;
    const rect = c.getBoundingClientRect();
    _ctxEl.style.left = Math.min(clientX - rect.left + 4, c.offsetWidth  - 180) + 'px';
    _ctxEl.style.top  = Math.min(clientY - rect.top  + 4, c.offsetHeight - 100) + 'px';
    _ctxEl.classList.remove('hidden');
  };

  const _hideAllMenus = () => {
    if (_ctxEl)     _ctxEl.classList.add('hidden');
    if (_nodeCtxEl) _nodeCtxEl.classList.add('hidden');
  };

  // ── Node context menu (custom nodes) ─────────────────────────────────────

  let _nodeCtxEl     = null;
  let _nodeCtxTarget = null;

  const _initNodeContextMenu = (container) => {
    _nodeCtxEl = document.createElement('div');
    _nodeCtxEl.className = 'mv-ctx-menu hidden';
    _nodeCtxEl.innerHTML = `
      <div class="mv-ctx-item" id="mv-nctx-edit">✏  Edit</div>
      <div class="mv-ctx-item" id="mv-nctx-connect">⟶  Connect to…</div>
      <div class="mv-ctx-item mv-ctx-danger" id="mv-nctx-delete">✕  Delete</div>
    `;
    container.appendChild(_nodeCtxEl);

    _nodeCtxEl.querySelector('#mv-nctx-edit').onclick = () => {
      _hideAllMenus();
      if (_nodeCtxTarget) _showEditDialog(_nodeCtxTarget);
    };
    _nodeCtxEl.querySelector('#mv-nctx-connect').onclick = () => {
      _hideAllMenus();
      if (_nodeCtxTarget) _startConnectMode(_nodeCtxTarget.id());
    };
    _nodeCtxEl.querySelector('#mv-nctx-delete').onclick = async () => {
      _hideAllMenus();
      if (_nodeCtxTarget) await _deleteNode(_nodeCtxTarget);
    };
  };

  const _showNodeCtx = (clientX, clientY, node) => {
    _nodeCtxTarget = node;
    const c = _nodeCtxEl.parentElement;
    const rect = c.getBoundingClientRect();
    _nodeCtxEl.style.left = Math.min(clientX - rect.left + 4, c.offsetWidth  - 200) + 'px';
    _nodeCtxEl.style.top  = Math.min(clientY - rect.top  + 4, c.offsetHeight - 120) + 'px';
    _nodeCtxEl.classList.remove('hidden');
    if (_ctxEl) _ctxEl.classList.add('hidden');
  };

  // ── New node dialog ───────────────────────────────────────────────────────

  let _ndEl  = null;
  let _ndPos = null;

  const _initNewNodeDialog = (container) => {
    _ndEl = document.createElement('div');
    _ndEl.className = 'mv-nd-dialog hidden';
    _ndEl.innerHTML = `
      <div class="mv-nd-header">New Object</div>
      <label class="mv-nd-label">Name</label>
      <input class="mv-nd-input" id="mv-nd-name" type="text" placeholder="Object name…" />
      <label class="mv-nd-label">Type</label>
      <select class="mv-nd-select" id="mv-nd-cat">
        <option>Material</option><option>Structure</option><option>Method</option>
        <option>Property</option><option>Application</option><option>Metric</option>
        <option selected>Custom</option>
      </select>
      <label class="mv-nd-label">Description</label>
      <textarea class="mv-nd-textarea" id="mv-nd-desc" rows="2" placeholder="Optional…"></textarea>
      <div class="mv-nd-actions">
        <button class="btn btn-sm btn-primary" id="mv-nd-save">Create</button>
        <button class="btn btn-sm" id="mv-nd-cancel">Cancel</button>
      </div>
    `;
    container.appendChild(_ndEl);
    _ndEl.querySelector('#mv-nd-cancel').onclick = () => _ndEl.classList.add('hidden');
    _ndEl.querySelector('#mv-nd-save').onclick   = _saveNewNode;
    _ndEl.querySelector('#mv-nd-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  _saveNewNode();
      if (e.key === 'Escape') _ndEl.classList.add('hidden');
    });
  };

  const _showNewNodeDialog = (cyPos) => {
    _ndPos = cyPos;
    const c = _ndEl.parentElement;
    _ndEl.style.left = Math.min(c.offsetWidth  / 2 - 120, c.offsetWidth  - 260) + 'px';
    _ndEl.style.top  = Math.min(c.offsetHeight / 2 - 140, c.offsetHeight - 320) + 'px';
    _ndEl.classList.remove('hidden');
    _ndEl.querySelector('#mv-nd-name').value = '';
    _ndEl.querySelector('#mv-nd-desc').value = '';
    _ndEl.querySelector('#mv-nd-name').focus();
  };

  const _saveNewNode = async () => {
    const label    = (_ndEl.querySelector('#mv-nd-name').value || '').trim();
    const category = _ndEl.querySelector('#mv-nd-cat').value;
    const desc     = (_ndEl.querySelector('#mv-nd-desc').value || '').trim();
    if (!label) { _ndEl.querySelector('#mv-nd-name').focus(); return; }
    const color = CAT_COLORS[category] || '#64748b';
    const pos   = _ndPos || { x: 300, y: 300 };
    try {
      const node = await _fetch('/map-custom-nodes', {
        method: 'POST',
        body: JSON.stringify({ label, category, description: desc, color, pos_x: pos.x, pos_y: pos.y }),
      });
      cy.add([{ data: {
        id: `cn_${node.id}`, type: 'custom',
        label: node.label, category: node.category,
        description: node.description, color: node.color,
        nodeId: node.id,
      }, position: { x: pos.x, y: pos.y } }]);
      _ndEl.classList.add('hidden');
    } catch (e) { _showToast('Failed to create node: ' + e.message, 'error'); }
  };

  // ── Edit node dialog ──────────────────────────────────────────────────────

  let _editEl     = null;
  let _editTarget = null;

  const _initEditDialog = (container) => {
    _editEl = document.createElement('div');
    _editEl.className = 'mv-nd-dialog hidden';
    _editEl.innerHTML = `
      <div class="mv-nd-header">Edit Object</div>
      <label class="mv-nd-label">Name</label>
      <input class="mv-nd-input" id="mv-edit-name" type="text" />
      <label class="mv-nd-label">Type</label>
      <select class="mv-nd-select" id="mv-edit-cat">
        <option>Material</option><option>Structure</option><option>Method</option>
        <option>Property</option><option>Application</option><option>Metric</option>
        <option>Custom</option>
      </select>
      <label class="mv-nd-label">Description</label>
      <textarea class="mv-nd-textarea" id="mv-edit-desc" rows="2"></textarea>
      <div class="mv-nd-actions">
        <button class="btn btn-sm btn-primary" id="mv-edit-save">Save</button>
        <button class="btn btn-sm" id="mv-edit-cancel">Cancel</button>
      </div>
    `;
    container.appendChild(_editEl);
    _editEl.querySelector('#mv-edit-cancel').onclick = () => { _editTarget = null; _editEl.classList.add('hidden'); };
    _editEl.querySelector('#mv-edit-save').onclick   = _saveEdit;
    _editEl.querySelector('#mv-edit-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  _saveEdit();
      if (e.key === 'Escape') _editEl.classList.add('hidden');
    });
  };

  const _showEditDialog = (node) => {
    _editTarget = node;
    const c = _editEl.parentElement;
    _editEl.style.left = Math.min(c.offsetWidth  / 2 - 120, c.offsetWidth  - 260) + 'px';
    _editEl.style.top  = Math.min(c.offsetHeight / 2 - 140, c.offsetHeight - 320) + 'px';
    _editEl.querySelector('#mv-edit-name').value = node.data('label') || '';
    _editEl.querySelector('#mv-edit-cat').value  = node.data('category') || 'Custom';
    _editEl.querySelector('#mv-edit-desc').value = node.data('description') || '';
    _editEl.classList.remove('hidden');
    _editEl.querySelector('#mv-edit-name').focus();
    _editEl.querySelector('#mv-edit-name').select();
  };

  const _saveEdit = async () => {
    if (!_editTarget) return;
    const label    = (_editEl.querySelector('#mv-edit-name').value || '').trim();
    const category = _editEl.querySelector('#mv-edit-cat').value;
    const desc     = (_editEl.querySelector('#mv-edit-desc').value || '').trim();
    if (!label) { _editEl.querySelector('#mv-edit-name').focus(); return; }
    const color  = CAT_COLORS[category] || '#64748b';
    const nodeId = _editTarget.data('nodeId');
    try {
      await _fetch(`/map-custom-nodes/${nodeId}`, {
        method: 'PUT',
        body: JSON.stringify({ label, category, description: desc, color }),
      });
      _editTarget.data({ label, category, description: desc, color });
      _editTarget.style('background-image', _customSvg(label, category, color));
      _editTarget = null;
      _editEl.classList.add('hidden');
    } catch (e) { _showToast('Failed to save: ' + e.message, 'error'); }
  };

  // ── Relation dialog (edge-handle drop or connect mode) ────────────────────

  let _relEl   = null;
  let _relData = null;

  const _initRelDialog = (container) => {
    _relEl = document.createElement('div');
    _relEl.className = 'mv-rel-dialog hidden';
    _relEl.innerHTML = `
      <div class="mv-nd-header">Connection Type</div>
      <input class="mv-nd-input" id="mv-rel-type" list="mv-rel-list" value="related_to" placeholder="Relation type…" />
      <datalist id="mv-rel-list">
        <option value="related_to"></option><option value="subtype_of"></option>
        <option value="is_a"></option><option value="has_property"></option>
        <option value="fabricated_by"></option><option value="used_for"></option>
        <option value="part_of"></option><option value="improves"></option>
        <option value="enables"></option><option value="made_by"></option>
        <option value="compared_to"></option>
      </datalist>
      <div class="mv-nd-actions">
        <button class="btn btn-sm btn-primary" id="mv-rel-save">Connect</button>
        <button class="btn btn-sm btn-danger"  id="mv-rel-cancel">Cancel</button>
      </div>
    `;
    container.appendChild(_relEl);
    _relEl.querySelector('#mv-rel-cancel').onclick = () => {
      if (_relData && _relData.edge && _relData.edge.inside()) cy.remove(_relData.edge);
      _relData = null;
      _relEl.classList.add('hidden');
    };
    _relEl.querySelector('#mv-rel-save').onclick = _saveRelation;
    _relEl.querySelector('#mv-rel-type').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') _saveRelation();
    });
  };

  const _showRelDialog = (edge, sourceNode, targetNode) => {
    _relData = { edge, sourceId: sourceNode.id(), targetId: targetNode.id() };
    const c = _relEl.parentElement;
    _relEl.style.left = Math.min(c.offsetWidth  / 2 - 110, c.offsetWidth  - 240) + 'px';
    _relEl.style.top  = Math.min(c.offsetHeight / 2 - 80,  c.offsetHeight - 200) + 'px';
    _relEl.classList.remove('hidden');
    _relEl.querySelector('#mv-rel-type').value = 'related_to';
    _relEl.querySelector('#mv-rel-type').focus();
    _relEl.querySelector('#mv-rel-type').select();
  };

  const _saveRelation = async () => {
    if (!_relData) return;
    const relType = (_relEl.querySelector('#mv-rel-type').value || '').trim() || 'related_to';
    try {
      const saved = await _fetch('/map-edges', {
        method: 'POST',
        body: JSON.stringify({ source_id: _relData.sourceId, target_id: _relData.targetId, relation_type: relType }),
      });
      _relData.edge.data({ id: `me_${saved.id}`, edgeType: 'user', relation: relType, edgeDbId: saved.id });
      _relData = null;
      _relEl.classList.add('hidden');
    } catch (e) { _showToast('Failed to save connection: ' + e.message, 'error'); }
  };

  // ── Delete helpers ────────────────────────────────────────────────────────

  const _deleteEdge = async (edge) => {
    const dbId = edge.data('edgeDbId');
    if (!dbId) { cy.remove(edge); return; }
    try { await _fetch(`/map-edges/${dbId}`, { method: 'DELETE' }); cy.remove(edge); }
    catch (e) { _showToast('Failed to delete edge: ' + e.message, 'error'); }
  };

  const _deleteNode = async (node) => {
    const type   = node.data('type');
    const nodeId = node.data('nodeId');
    try {
      if (type === 'custom' && nodeId)
        await _fetch(`/map-custom-nodes/${nodeId}`, { method: 'DELETE' });
      cy.remove(node.connectedEdges('[edgeType="user"]'));
      cy.remove(node);
      _schedSave();
    } catch (e) { _showToast('Failed to delete: ' + e.message, 'error'); }
  };

  // ── Zoom controls ─────────────────────────────────────────────────────────

  const _addZoomControls = (container) => {
    const div = document.createElement('div');
    div.className = 'storymap-zoom-controls';
    div.innerHTML = `
      <button class="zoom-btn" id="mv-zi" title="Zoom in">+</button>
      <button class="zoom-btn" id="mv-zf" title="Fit">⊡</button>
      <button class="zoom-btn" id="mv-zo" title="Zoom out">−</button>
    `;
    container.appendChild(div);
    const cx_ = () => container.offsetWidth  / 2;
    const cy_ = () => container.offsetHeight / 2;
    div.querySelector('#mv-zi').onclick = (e) => { e.stopPropagation(); cy && cy.zoom({ level: cy.zoom() * 1.25, renderedPosition: { x: cx_(), y: cy_() } }); };
    div.querySelector('#mv-zo').onclick = (e) => { e.stopPropagation(); cy && cy.zoom({ level: cy.zoom() * 0.80,  renderedPosition: { x: cx_(), y: cy_() } }); };
    div.querySelector('#mv-zf').onclick = (e) => { e.stopPropagation(); cy && cy.fit(undefined, 50); };
  };

  // ── Toast ─────────────────────────────────────────────────────────────────

  const _showToast = (msg, type = 'ok') => {
    const el = document.getElementById('toast-container');
    if (!el) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    el.appendChild(t);
    setTimeout(() => t.remove(), 3400);
  };

  // ── Keyword filter ────────────────────────────────────────────────────────

  const _applyFilter = (activeNorms) => {
    if (!cy) return;
    if (!activeNorms || activeNorms.length === 0) {
      cy.nodes().removeClass('faded');
      cy.edges().removeClass('faded');
      return;
    }
    const normSet = activeNorms.map(n => n.toLowerCase());
    const visiblePaperIds = new Set();
    // Use _paperKwMap so filter works even for unexpanded papers
    Object.entries(_paperKwMap).forEach(([pid, norms]) => {
      if (norms.some(n => normSet.includes(n))) visiblePaperIds.add(parseInt(pid));
    });
    cy.nodes('[type="paper"]').forEach(n => {
      n.toggleClass('faded', !visiblePaperIds.has(n.data('paperId')));
    });
    cy.nodes('[type="keyword"]').forEach(n => {
      n.toggleClass('faded', !visiblePaperIds.has(n.data('paperId')));
    });
    cy.nodes('[type="custom"]').removeClass('faded');
    cy.edges().forEach(e => {
      e.toggleClass('faded', e.source().hasClass('faded') || e.target().hasClass('faded'));
    });
  };

  // ── Public: init ─────────────────────────────────────────────────────────

  const init = (containerId, canvasData, opts = {}) => {
    _onNodeClick = opts.onNodeClick || null;
    const container = document.getElementById(containerId);
    if (!container) return;

    if (cy) { cy.destroy(); cy = null; }
    _eh = null;
    _cancelConnectMode();
    container.querySelectorAll(
      '.mv-ctx-menu,.mv-nd-dialog,.mv-rel-dialog,.storymap-zoom-controls,.mv-legend'
    ).forEach(el => el.remove());

    const papers      = canvasData.papers      || [];
    const customNodes = canvasData.custom_nodes || [];
    const edges       = canvasData.edges        || [];

    _papersCache = papers;

    // Build keyword filter index (works for unexpanded papers too)
    _paperKwMap = {};
    papers.forEach(p => {
      _paperKwMap[p.id] = (p.keyword_norms || []).map(n => n.toLowerCase());
    });

    if (papers.length === 0 && customNodes.length === 0) {
      container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#64748b;font-size:0.9rem;">No papers yet. Upload a PDF to get started.</div>';
      return;
    }

    container.style.position = 'relative';
    container.style.overflow = 'hidden';

    // Auto-arrange with enough vertical space so expanded keywords don't overlap next row
    papers.forEach((p, i) => {
      if (p.pos_x == null || p.pos_y == null) {
        const cols = Math.max(1, Math.min(3, papers.length));
        p.pos_x = (i % cols) * 500 + 200;
        p.pos_y = Math.floor(i / cols) * 700 + 80;
      }
    });

    const elements = [];

    papers.forEach(p => {
      elements.push({ data: {
        id: `p_${p.id}`, type: 'paper',
        title: p.title, year: p.year,
        materials: p.materials || [],
        expanded: !!p.expanded,
        paperId: p.id,
      }, position: { x: p.pos_x, y: p.pos_y } });

      // Restore expanded state
      if (p.expanded && p.keywords) {
        const papNodeId = `p_${p.id}`;
        p.keywords.forEach(kw => {
          elements.push({ data: {
            id: `kw_${kw.id}`, type: 'keyword',
            label: kw.name, normalized: kw.normalized,
            category: kw.category, confidence: kw.confidence,
            paperId: p.id,
          }, position: { x: kw.pos_x || p.pos_x, y: kw.pos_y || (p.pos_y + 200) } });
        });

        const byCat = {};
        (p.keywords || []).forEach(kw => {
          if (!byCat[kw.category]) byCat[kw.category] = [];
          byCat[kw.category].push(`kw_${kw.id}`);
        });

        // Paper → Material/Structure edges
        (byCat.Material || []).forEach((kwId, i2) => {
          elements.push({ data: { id: `pe_${p.id}_m${i2}`, source: papNodeId, target: kwId, relation: '', edgeType: 'parent', paperId: p.id } });
        });
        (byCat.Structure || []).forEach((kwId, i2) => {
          elements.push({ data: { id: `pe_${p.id}_s${i2}`, source: papNodeId, target: kwId, relation: '', edgeType: 'parent', paperId: p.id } });
        });

        // Story-flow edges
        const methods = [...(byCat.Method || []), ...(byCat.Structure || [])];
        const props   = [...(byCat.Property || []), ...(byCat.Other || [])];
        let si = 0;
        const addS = (src, tgt, rel) => elements.push({ data: {
          id: `se_${p.id}_${si++}`, source: src, target: tgt,
          relation: rel, edgeType: 'story', paperId: p.id,
        }});
        (byCat.Material || []).forEach(m => methods.forEach(n => addS(m, n, 'made by')));
        methods.forEach(n => props.forEach(pp => addS(n, pp, 'yields')));
        props.forEach(pp => (byCat.Application || []).forEach(a => addS(pp, a, 'enables')));
      } else {
        // Not expanded → show preview (1차) keyword nodes
        _addPreviewNodes(p, el => elements.push(el));
      }
    });

    // Cross-paper edges: connect papers sharing the same keyword
    const kwToPaperIds = {};
    papers.forEach(p => {
      (p.keyword_norms || []).forEach(norm => {
        if (!norm) return;
        if (!kwToPaperIds[norm]) kwToPaperIds[norm] = [];
        if (!kwToPaperIds[norm].includes(p.id)) kwToPaperIds[norm].push(p.id);
      });
    });
    const addedPairs = new Set();
    Object.entries(kwToPaperIds).forEach(([norm, pids]) => {
      if (pids.length < 2) return;
      for (let i = 0; i < pids.length; i++) {
        for (let j = i + 1; j < pids.length; j++) {
          const key = `${Math.min(pids[i], pids[j])}_${Math.max(pids[i], pids[j])}`;
          if (addedPairs.has(key)) continue;
          addedPairs.add(key);
          elements.push({ data: {
            id: `cp_${key}`,
            source: `p_${pids[i]}`, target: `p_${pids[j]}`,
            edgeType: 'cross_paper', relation: norm,
          }});
        }
      }
    });

    customNodes.forEach(cn => {
      elements.push({ data: {
        id: `cn_${cn.id}`, type: 'custom',
        label: cn.label, category: cn.category,
        description: cn.description, color: cn.color,
        nodeId: cn.id,
      }, position: { x: cn.pos_x, y: cn.pos_y } });
    });

    edges.forEach(me => {
      elements.push({ data: {
        id: `me_${me.id}`,
        source: me.source_id, target: me.target_id,
        relation: me.relation_type, edgeType: 'user',
        edgeDbId: me.id,
      }});
    });

    const hasPositions = papers.some(p => p.pos_x != null);
    cy = cytoscape({
      container, elements, style: STYLESHEET,
      layout: hasPositions
        ? { name: 'preset', padding: 60, animate: false }
        : { name: 'cose', padding: 80, animate: true, randomize: false,
            nodeRepulsion: 12000, idealEdgeLength: 350, nodeOverlap: 30,
            gravity: 0.5, numIter: 1000, initialTemp: 200, coolingFactor: 0.99 },
      wheelSensitivity: 0.3, minZoom: 0.04, maxZoom: 4,
    });

    cy.fit(undefined, 80);

    // Edge handles (drag + to connect)
    if (window.cytoscapeEdgehandles) {
      try { cytoscape.use(cytoscapeEdgehandles); } catch (_) {}
      _eh = cy.edgehandles({
        preview: true, previewOpacity: 0.6,
        handleNodes: 'node', snap: true, noLoop: true,
        disableBrowserGestures: true,
      });
      cy.on('ehcomplete', (evt, sourceNode, targetNode, addedEdge) => {
        _showRelDialog(addedEdge, sourceNode, targetNode);
      });
    }

    // Double-click paper → expand keywords / collapse back
    cy.on('dblclick', 'node[type="paper"]', (evt) => {
      if (_tapTimer) { clearTimeout(_tapTimer); _tapTimer = null; }
      const node = evt.target;
      if (node.data('expanded')) _collapsePaper(node);
      else _expandPaper(node);
    });

    // Double-click preview (1차) keyword node → expand parent paper
    cy.on('dblclick', 'node[type="keyword"][?preview]', (evt) => {
      if (_tapTimer) { clearTimeout(_tapTimer); _tapTimer = null; }
      const paperId  = evt.target.data('paperId');
      const paperNode = cy.getElementById(`p_${paperId}`);
      if (paperNode.length) _expandPaper(paperNode);
    });

    // Tap keyword node — only Metric category triggers panel; others: connect mode only
    cy.on('tap', 'node[type="keyword"]', (evt) => {
      const tgt = evt.target;
      if (_connectMode) {
        if (tgt.id() === _connectSrcId) { _cancelConnectMode(); return; }
        const srcNode  = cy.getElementById(_connectSrcId);
        const tempEdge = cy.add([{ data: {
          id: `tmp_${Date.now()}`,
          source: _connectSrcId, target: tgt.id(),
          edgeType: 'user', relation: 'related_to',
        }}])[0];
        _cancelConnectMode();
        _showRelDialog(tempEdge, srcNode, tgt);
        evt.stopPropagation();
        return;
      }
      if (tgt.data('category') === 'Metric') {
        const paperId = tgt.data('paperId');
        const kwId    = parseInt(tgt.id().replace('kw_', ''));
        if (paperId && _onNodeClick) _onNodeClick({ type: 'metric', paperId, kwId, nodeData: tgt.data() });
        evt.stopPropagation();
      }
    });

    // Tap paper node — connect mode only (double-click handles expand/collapse)
    cy.on('tap', 'node[type="paper"]', (evt) => {
      if (!_connectMode) return;
      const tgt = evt.target;
      if (tgt.id() === _connectSrcId) { _cancelConnectMode(); return; }
      const srcNode  = cy.getElementById(_connectSrcId);
      const tempEdge = cy.add([{ data: {
        id: `tmp_${Date.now()}`,
        source: _connectSrcId, target: tgt.id(),
        edgeType: 'user', relation: 'related_to',
      }}])[0];
      _cancelConnectMode();
      _showRelDialog(tempEdge, srcNode, tgt);
      evt.stopPropagation();
    });

    // Tap custom node → complete edge in connect mode only
    cy.on('tap', 'node[type="custom"]', (evt) => {
      const tgt = evt.target;
      if (!_connectMode) return;
      if (tgt.id() === _connectSrcId) { _cancelConnectMode(); return; }
      const srcNode  = cy.getElementById(_connectSrcId);
      const tempEdge = cy.add([{ data: {
        id: `tmp_${Date.now()}`,
        source: _connectSrcId, target: tgt.id(),
        edgeType: 'user', relation: 'related_to',
      }}])[0];
      _cancelConnectMode();
      _showRelDialog(tempEdge, srcNode, tgt);
      evt.stopPropagation();
    });

    // Drag end → save positions
    cy.on('free', 'node', _schedSave);

    // Right-click custom node → node context menu
    cy.on('cxttap', 'node[type="custom"]', (evt) => {
      _suppressCtx = true;
      setTimeout(() => { _suppressCtx = false; }, 50);
      const oe = evt.originalEvent;
      _showNodeCtx(oe.clientX, oe.clientY, evt.target);
    });

    // Right-click edge → delete
    cy.on('cxttap', 'edge', (evt) => {
      _suppressCtx = true;
      setTimeout(() => { _suppressCtx = false; }, 50);
      if (confirm('Delete this connection?')) _deleteEdge(evt.target);
    });

    // Right-click canvas background
    container.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (_suppressCtx || _connectMode) return;
      _showCtx(e.clientX, e.clientY, _toCy(container, e.clientX, e.clientY));
    });

    // Keyboard
    container.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') { _cancelConnectMode(); _hideAllMenus(); return; }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const sel = cy.$(':selected');
      for (const el of sel.toArray()) {
        if (el.isEdge()) await _deleteEdge(el);
        if (el.isNode()) await _deleteNode(el);
      }
    });
    container.setAttribute('tabindex', '0');

    // Tap canvas
    cy.on('tap', (evt) => {
      if (evt.target !== cy) return;
      if (_connectMode) { _cancelConnectMode(); return; }
      _hideAllMenus();
      if (opts.onCanvasTap) opts.onCanvasTap();
    });

    // Tooltip
    const tooltip = document.getElementById('hover-tooltip');
    cy.on('mouseover', 'node', (evt) => {
      if (!tooltip) return;
      const d = evt.target.data();
      if (d.type === 'paper') {
        tooltip.innerHTML = `<div class="tooltip-rel">${_e(d.title)}</div><div class="tooltip-conf">Double-click to expand/collapse</div>`;
      } else if (d.type === 'custom') {
        tooltip.innerHTML = `<div class="tooltip-rel">${_e(d.label)}</div>` +
          (d.description ? `<div class="tooltip-evidence">${_e(d.description)}</div>` : '') +
          `<div class="tooltip-conf" style="color:#c084fc;margin-top:4px">Right-click: Edit / Connect / Delete</div>`;
      } else {
        tooltip.innerHTML = `<div class="tooltip-rel">${_e(d.label)}</div><div class="tooltip-conf">${_e(d.category)} · ${Math.round((d.confidence||0)*100)}%</div>`;
      }
      tooltip.classList.remove('hidden');
    });
    cy.on('mouseout',  'node', () => tooltip && tooltip.classList.add('hidden'));
    cy.on('mouseover', 'edge[edgeType="user"]', (evt) => {
      if (!tooltip) return;
      tooltip.innerHTML = `<div class="tooltip-rel">${_e(evt.target.data('relation'))}</div><div class="tooltip-conf">Right-click to delete</div>`;
      tooltip.classList.remove('hidden');
    });
    cy.on('mouseout',  'edge', () => tooltip && tooltip.classList.add('hidden'));
    cy.on('mousemove', (evt) => {
      if (tooltip && !tooltip.classList.contains('hidden')) {
        tooltip.style.left = (evt.originalEvent.clientX + 16) + 'px';
        tooltip.style.top  = (evt.originalEvent.clientY - 10) + 'px';
      }
    });

    // UI components
    _initContextMenu(container);
    _initNodeContextMenu(container);
    _initNewNodeDialog(container);
    _initEditDialog(container);
    _initRelDialog(container);
    _addZoomControls(container);

    // Legend
    const legend = document.createElement('div');
    legend.className = 'mv-legend';
    legend.innerHTML = Object.entries(CAT_COLORS)
      .filter(([cat]) => cat !== 'Metric')
      .map(([cat, col]) =>
        `<span class="legend-item"><span style="background:${col};border-radius:3px;width:10px;height:10px;display:inline-block;vertical-align:middle;margin-right:4px;"></span>${cat}</span>`
      ).join('') +
      `<span class="legend-item" style="margin-left:10px;color:#64748b;font-size:0.7rem">Dbl-click paper to expand · Right-click object for menu · Drag border + to connect</span>`;
    container.appendChild(legend);

    return cy;
  };

  return {
    init,
    fit:                () => { if (cy) cy.fit(undefined, 50); },
    applyKeywordFilter: (norms) => _applyFilter(norms),
  };
})();
