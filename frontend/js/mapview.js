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
  let _papersCache   = [];   // paper data for preview restoration
  let _viewMode      = 'full';   // 'overview' | 'full'
  let _groups        = [];       // { id, name, color, paper_ids }
  let _paperKwCatMap = {};       // { paperId: { norm: category } }
  let _focusKwNorm   = null;     // active Focus Mode keyword norm

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

  // ── Palantir-style card: left accent panel + right text area ─────────────
  // Draw order: fill → accent panel → border on top (prevents border being
  // obscured by the panel fill on the left side).

  const PW = 280, PH = 76, PR = 8;

  const _paperSvg = (title, year, materials, expanded) => {
    const ind = expanded ? '▼' : '▶';
    return _uri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}">` +
      `<rect x=".5" y=".5" width="${PW-1}" height="${PH-1}" rx="${PR}" ry="${PR}" fill="#111827"/>` +
      `<rect x=".5" y=".5" width="48" height="${PH-1}" rx="${PR}" ry="${PR}" fill="#2e1065"/>` +
      `<rect x=".5" y=".5" width="${PW-1}" height="${PH-1}" rx="${PR}" ry="${PR}" fill="none" stroke="#6d28d9" stroke-width="1.5"/>` +
      `<circle cx="24" cy="${PH/2}" r="10" fill="#7c3aed" fill-opacity=".4"/>` +
      `<circle cx="24" cy="${PH/2}" r="5" fill="#a855f7"/>` +
      `<text x="56" y="19" font-family="'Inter','Segoe UI',sans-serif" font-size="9" font-weight="700" fill="#a78bfa" letter-spacing=".8">PAPER${year ? '  ' + _e(year) : ''}</text>` +
      `<text x="56" y="39" font-family="'Inter','Segoe UI',sans-serif" font-size="14" font-weight="700" fill="#f8fafc">${_e(_cut(title, 24))}</text>` +
      (materials.length ? `<text x="56" y="57" font-family="'Inter','Segoe UI',sans-serif" font-size="10.5" fill="#fcd34d">◆ ${_e(_cut(materials.join(' · '), 28))}</text>` : '') +
      `<text x="${PW-8}" y="${PH-5}" font-family="'Inter','Segoe UI',sans-serif" font-size="9" fill="#6b7280" text-anchor="end">${ind} expand</text>` +
      `</svg>`
    );
  };

  const KW = 200, KH = 62, KR = 7;
  const _kwSvg = (label, category) => {
    const col = CAT_COLORS[category] || '#94a3b8';
    return _uri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${KW}" height="${KH}">` +
      `<rect x=".5" y=".5" width="${KW-1}" height="${KH-1}" rx="${KR}" ry="${KR}" fill="#0f172a"/>` +
      `<rect x=".5" y=".5" width="38" height="${KH-1}" rx="${KR}" ry="${KR}" fill="${col}" fill-opacity=".18"/>` +
      `<rect x=".5" y=".5" width="${KW-1}" height="${KH-1}" rx="${KR}" ry="${KR}" fill="none" stroke="${col}" stroke-width="1.5" stroke-opacity=".6"/>` +
      `<circle cx="19" cy="${KH/2}" r="8" fill="${col}" fill-opacity=".3"/>` +
      `<circle cx="19" cy="${KH/2}" r="4" fill="${col}"/>` +
      `<text x="46" y="19" font-family="'Inter','Segoe UI',sans-serif" font-size="9" font-weight="700" fill="${col}" letter-spacing=".5">${_e(category||'')}</text>` +
      `<text x="46" y="40" font-family="'Inter','Segoe UI',sans-serif" font-size="14" font-weight="700" fill="#f1f5f9">${_e(_cut(label, 18))}</text>` +
      `</svg>`
    );
  };

  const GW = 280, GH = 90, GR = 10;
  const _groupSvg = (name, count, color, expanded) => {
    const col = color || '#334155';
    const ind = expanded ? '▼' : '▶';
    return _uri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${GW}" height="${GH}">` +
      `<rect x=".5" y=".5" width="${GW-1}" height="${GH-1}" rx="${GR}" ry="${GR}" fill="#0f172a"/>` +
      `<rect x=".5" y=".5" width="10" height="${GH-1}" rx="${GR}" ry="${GR}" fill="${col}"/>` +
      `<rect x=".5" y=".5" width="${GW-1}" height="${GH-1}" rx="${GR}" ry="${GR}" fill="none" stroke="${col}" stroke-width="1.5"/>` +
      `<text x="22" y="30" font-family="'Inter','Segoe UI',sans-serif" font-size="9" font-weight="700" fill="${col}" letter-spacing=".8">GROUP</text>` +
      `<text x="22" y="53" font-family="'Inter','Segoe UI',sans-serif" font-size="14" font-weight="700" fill="#f8fafc">${_e(_cut(name, 22))}</text>` +
      `<text x="22" y="72" font-family="'Inter','Segoe UI',sans-serif" font-size="10.5" fill="#94a3b8">논문 ${_e(count)}개</text>` +
      `<text x="${GW-10}" y="${GH-8}" font-family="'Inter','Segoe UI',sans-serif" font-size="9" fill="#6b7280" text-anchor="end">${ind}</text>` +
      `</svg>`
    );
  };

  const CN_W = 200, CN_H = 68, CN_R = 7;
  const _customSvg = (label, category, color) => {
    const col = color || CAT_COLORS[category] || '#64748b';
    return _uri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${CN_W}" height="${CN_H}">` +
      `<rect x=".5" y=".5" width="${CN_W-1}" height="${CN_H-1}" rx="${CN_R}" ry="${CN_R}" fill="#0a0a12"/>` +
      `<rect x=".5" y=".5" width="38" height="${CN_H-1}" rx="${CN_R}" ry="${CN_R}" fill="${col}" fill-opacity=".18"/>` +
      `<rect x=".5" y=".5" width="${CN_W-1}" height="${CN_H-1}" rx="${CN_R}" ry="${CN_R}" fill="none" stroke="${col}" stroke-width="1.5"/>` +
      `<circle cx="19" cy="${CN_H/2}" r="9" fill="${col}" fill-opacity=".3"/>` +
      `<circle cx="19" cy="${CN_H/2}" r="4.5" fill="${col}"/>` +
      `<text x="46" y="20" font-family="'Inter','Segoe UI',sans-serif" font-size="9" font-weight="700" fill="${col}" letter-spacing=".5">${_e(category||'Custom')}</text>` +
      `<text x="46" y="42" font-family="'Inter','Segoe UI',sans-serif" font-size="14" font-weight="700" fill="#f1f5f9">${_e(_cut(label, 18))}</text>` +
      `</svg>`
    );
  };

  // ── Layout helpers ────────────────────────────────────────────────────────

  // Palantir-style: papers left column, keywords grid to the right
  const PAPER_COL_X  = 200;   // paper center x (left column)
  const PAPER_V_GAP  = 80;    // gap between paper bottom edge and next paper top
  const KW_COL_GAP   = 20;    // horizontal gap between keyword columns
  const KW_ROW_H     = KH + 14;
  const MAX_PER_LAYER = 4;

  // Number of keyword columns: square-ish grid grows wider as n increases
  const _gridCols = (n) => n <= 4 ? 2 : n <= 9 ? 3 : 4;

  // x-center of keyword column col (0-indexed) relative to paper center
  const _kwColX = (paperX, col) =>
    paperX + PW / 2 + 80 + col * (KW + KW_COL_GAP) + KW / 2;

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
    const allKw = layers.flat();
    const cols  = _gridCols(allKw.length);
    const posMap = {};
    allKw.forEach((kw, i) => {
      posMap[`kw_${kw.id}`] = {
        x: _kwColX(px, i % cols),
        y: py + Math.floor(i / cols) * KW_ROW_H,
      };
    });
    return { layers, posMap };
  };

  // Re-stack all papers in the left column, expanding vertical space where a
  // paper is expanded so keyword blocks never overlap the paper below.
  const _relayoutPapers = () => {
    if (!cy) return;
    let y = 80;
    _papersCache.forEach(p => {
      const pNode = cy.getElementById(`p_${p.id}`);
      if (!pNode.length) return;
      pNode.position({ x: PAPER_COL_X, y });
      if (pNode.data('expanded')) {
        const kwNodes = cy.nodes(`[type="keyword"][paperId="${p.id}"]`);
        if (kwNodes.length) {
          const cols = _gridCols(kwNodes.length);
          const rows = Math.ceil(kwNodes.length / cols);
          kwNodes.forEach((kw, i) => {
            kw.position({ x: _kwColX(PAPER_COL_X, i % cols), y: y + Math.floor(i / cols) * KW_ROW_H });
          });
          y += Math.max(PH + PAPER_V_GAP, rows * KW_ROW_H + PAPER_V_GAP);
          return;
        }
      }
      y += PH + PAPER_V_GAP;
    });
    _schedSave();
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
        'curve-style': 'unbundled-bezier',
        'control-point-distances': [60, -60],
        'control-point-weights': [0.25, 0.75],
        'opacity': 0.55, 'label': '',
      }
    },
    // Story-flow edges
    {
      selector: 'edge[edgeType="story"]',
      style: {
        'width': 1.5, 'line-color': '#2d4a72', 'target-arrow-color': '#2d4a72',
        'target-arrow-shape': 'triangle', 'arrow-scale': 0.8,
        'curve-style': 'unbundled-bezier',
        'control-point-distances': [50, -50],
        'control-point-weights': [0.25, 0.75],
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
        'curve-style': 'unbundled-bezier',
        'control-point-distances': [60, -60],
        'control-point-weights': [0.25, 0.75],
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
        'curve-style': 'unbundled-bezier',
        'control-point-distances': [40, -40],
        'control-point-weights': [0.25, 0.75],
        'opacity': 0.55,
        'label': 'data(relation)',
        'font-size': '8px', 'color': '#64748b',
        'font-family': '"Inter","Segoe UI",sans-serif',
        'text-rotation': 'autorotate', 'text-margin-y': -6,
        'text-opacity': 0.75,
        'target-arrow-shape': 'none',
      }
    },
    // Research-chain edges (directed cross-paper flow)
    {
      selector: 'edge[edgeType="research_chain"]',
      style: {
        'width': 2, 'line-color': '#06b6d4', 'target-arrow-color': '#06b6d4',
        'target-arrow-shape': 'triangle', 'arrow-scale': 0.9,
        'curve-style': 'unbundled-bezier',
        'control-point-distances': [70, -70],
        'control-point-weights': [0.25, 0.75],
        'label': 'data(relation)', 'font-size': '8px', 'color': '#67e8f9',
        'font-family': '"Inter","Segoe UI",sans-serif',
        'text-rotation': 'autorotate', 'text-margin-y': -7, 'opacity': 0.8,
      }
    },
    // Group nodes (overview mode)
    {
      selector: 'node[type="group"]',
      style: {
        'background-opacity': 0,
        'background-image': (ele) => _groupSvg(ele.data('label'), ele.data('count'), ele.data('color'), ele.data('expanded')),
        'background-fit': 'contain', 'background-clip': 'node', 'background-image-opacity': 1,
        'border-width': 0, 'label': '', 'width': GW, 'height': GH,
        'shape': 'round-rectangle', 'cursor': 'pointer',
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
    // Skip keyword nodes — their positions are always recomputed from the grid
    const items = cy.nodes().filter(n => n.data('type') !== 'keyword').map(n => ({
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
        }, position: posMap[kwId] || { x: paperNode.position('x'), y: paperNode.position('y') + 200 },
           locked: true }]);
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
      _relayoutPapers();
    } catch (e) { _showToast('Failed to load keywords: ' + e.message, 'error'); }
  };

  const _collapsePaper = (paperNode) => {
    const paperId = paperNode.data('paperId');
    cy.nodes(`[type="keyword"][paperId="${paperId}"]`).remove();
    cy.edges(`[edgeType="story"][paperId="${paperId}"]`).remove();
    cy.edges(`[edgeType="parent"][paperId="${paperId}"]`).remove();
    paperNode.data('expanded', false);
    _refreshPaperSvg(paperNode);
    _relayoutPapers();
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
      <div class="mv-ctx-item hidden" id="mv-ctx-group">⬡  Create Group</div>
      <div class="mv-ctx-item" id="mv-ctx-fit">⊡  Fit View</div>
    `;
    container.appendChild(_ctxEl);
    _ctxEl.querySelector('#mv-ctx-new').onclick   = () => { _hideAllMenus(); _showNewNodeDialog(_createPos); };
    _ctxEl.querySelector('#mv-ctx-fit').onclick   = () => { _hideAllMenus(); cy && cy.fit(undefined, 50); };
    _ctxEl.querySelector('#mv-ctx-group').onclick = () => {
      _hideAllMenus();
      const selPapers = cy ? cy.nodes('[type="paper"]:selected') : null;
      const pids = selPapers ? selPapers.map(n => n.data('paperId')).toArray() : [];
      _showGroupDialog(pids);
    };
    document.addEventListener('click', _hideAllMenus, { passive: true });
  };

  const _showCtx = (clientX, clientY, cyPos) => {
    _createPos = cyPos;
    const c = _ctxEl.parentElement;
    const rect = c.getBoundingClientRect();
    _ctxEl.style.left = Math.min(clientX - rect.left + 4, c.offsetWidth  - 180) + 'px';
    _ctxEl.style.top  = Math.min(clientY - rect.top  + 4, c.offsetHeight - 100) + 'px';
    // Show "Create Group" only when 2+ papers are selected
    const selPapers = cy ? cy.nodes('[type="paper"]:selected') : null;
    const groupBtn  = _ctxEl.querySelector('#mv-ctx-group');
    if (groupBtn) groupBtn.classList.toggle('hidden', !selPapers || selPapers.length < 2);
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

    // Auto-pan: bring topmost visible paper to top-left
    const visiblePapers = cy.nodes('[type="paper"]').not('.faded');
    if (visiblePapers.length) {
      const top = visiblePapers.min(n => n.position('y'));
      const topNode = top.ele;
      const pos = topNode.renderedPosition();
      const container = cy.container();
      cy.animate({
        pan: {
          x: cy.pan().x + (20 - pos.x + topNode.renderedWidth() / 2),
          y: cy.pan().y + (20 - pos.y + topNode.renderedHeight() / 2),
        },
        duration: 300,
        easing: 'ease-in-out',
      });
    }
  };

  // ── Research Chain ───────────────────────────────────────────────────────

  const _buildResearchChainEdges = (papers) => {
    const kwToEntries = {};
    papers.forEach(p => {
      const cats = p.keyword_categories || {};
      Object.entries(cats).forEach(([norm, cat]) => {
        if (!kwToEntries[norm]) kwToEntries[norm] = [];
        kwToEntries[norm].push({ pid: p.id, cat });
      });
    });
    const edges = [];
    const addedPairs = new Set();
    Object.entries(kwToEntries).forEach(([norm, entries]) => {
      if (entries.length < 2) return;
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const a = entries[i], b = entries[j];
          const layerA = CAT_LAYER[a.cat] ?? 2;
          const layerB = CAT_LAYER[b.cat] ?? 2;
          if (layerA === layerB) continue;
          const [src, tgt] = layerA < layerB ? [a.pid, b.pid] : [b.pid, a.pid];
          const key = `${src}>${tgt}`;
          if (addedPairs.has(key)) continue;
          addedPairs.add(key);
          edges.push({ data: { id: `rc_${src}_${tgt}`, source: `p_${src}`, target: `p_${tgt}`, edgeType: 'research_chain', relation: norm } });
        }
      }
    });
    return edges;
  };

  const _calcFlowScore = (paperId) => {
    const cats = _paperKwCatMap[paperId] || {};
    const layers = Object.values(cats).map(c => CAT_LAYER[c] ?? 2);
    return layers.length ? layers.reduce((a, b) => a + b, 0) / layers.length : 1.5;
  };

  // ── View Modes ────────────────────────────────────────────────────────────

  const _addGroupNodes = () => {
    _groups.forEach(g => {
      const gid = `grp_${g.id}`;
      if (cy.getElementById(gid).length > 0) return;
      g.paper_ids.forEach(pid => cy.getElementById(`p_${pid}`).style('display', 'none'));
      const memberNodes = g.paper_ids.map(pid => cy.getElementById(`p_${pid}`)).filter(n => n.length > 0);
      let gx = PAPER_COL_X, gy = 200;
      if (memberNodes.length) {
        gx = memberNodes.reduce((s, n) => s + n.position('x'), 0) / memberNodes.length;
        gy = memberNodes.reduce((s, n) => s + n.position('y'), 0) / memberNodes.length;
      }
      cy.add([{ data: { id: gid, type: 'group', label: g.name, color: g.color, count: g.paper_ids.length, groupId: g.id, paper_ids: g.paper_ids, expanded: false }, position: { x: gx, y: gy } }]);
    });
  };

  const _applyFlowLayout = () => {
    if (!cy) return;
    const nodes = cy.nodes().filter(n => {
      const t = n.data('type');
      if (t === 'keyword') return false;
      if (t === 'paper') return n.style('display') !== 'none';
      return t === 'group';
    });
    const sorted = nodes.toArray().sort((a, b) => {
      const scoreOf = (n) => {
        if (n.data('type') === 'group') {
          const pids = n.data('paper_ids') || [];
          return pids.length ? pids.reduce((s, pid) => s + _calcFlowScore(pid), 0) / pids.length : 1.5;
        }
        return _calcFlowScore(n.data('paperId'));
      };
      return scoreOf(a) - scoreOf(b);
    });
    let y = 80;
    sorted.forEach(n => {
      n.position({ x: PAPER_COL_X, y });
      y += (n.data('type') === 'group' ? GH : PH) + PAPER_V_GAP;
    });
  };

  const _updateRCVisibility = () => {
    if (!cy) return;
    cy.edges('[edgeType="research_chain"]').style('display', 'element');
    cy.edges('[edgeType="cross_paper"]').style('display', _viewMode === 'overview' ? 'none' : 'element');
  };

  const _updateModeButtons = () => {
    const ovBtn = document.getElementById('mv-btn-overview');
    const flBtn = document.getElementById('mv-btn-full');
    if (ovBtn) ovBtn.classList.toggle('mv-mode-active', _viewMode === 'overview');
    if (flBtn) flBtn.classList.toggle('mv-mode-active', _viewMode === 'full');
  };

  const _enterOverviewMode = () => {
    if (!cy) return;
    _viewMode = 'overview';
    cy.nodes('[type="keyword"]').remove();
    cy.edges('[edgeType="story"]').remove();
    cy.edges('[edgeType="parent"]').remove();
    cy.nodes('[type="paper"]').forEach(n => {
      if (n.data('expanded')) { n.data('expanded', false); _refreshPaperSvg(n); }
    });
    _papersCache.forEach(p => { if (p.expanded) p.expanded = false; });
    _addGroupNodes();
    _applyFlowLayout();
    _updateRCVisibility();
    _updateModeButtons();
  };

  const _enterFullMode = () => {
    if (!cy) return;
    _viewMode = 'full';
    cy.nodes('[type="group"]').remove();
    cy.nodes('[type="paper"]').style('display', 'element');
    _relayoutPapers();
    _updateRCVisibility();
    _updateModeButtons();
  };

  // ── Focus Mode ────────────────────────────────────────────────────────────

  const _keywordFocus = (kwNorm) => {
    if (!cy) return;
    _focusKwNorm = kwNorm;
    const focusPaperIds = new Set();
    Object.entries(_paperKwCatMap).forEach(([pid, cats]) => {
      if (cats[kwNorm] !== undefined) focusPaperIds.add(parseInt(pid));
    });
    cy.nodes().forEach(n => {
      const t = n.data('type');
      if (t === 'paper')   n.toggleClass('faded', !focusPaperIds.has(n.data('paperId')));
      else if (t === 'keyword') n.toggleClass('faded', n.data('normalized') !== kwNorm && !focusPaperIds.has(n.data('paperId')));
      else n.addClass('faded');
    });
    cy.edges().forEach(e => {
      const type = e.data('edgeType');
      const relevant = (type === 'research_chain' || type === 'story' || type === 'parent') &&
        !e.source().hasClass('faded') && !e.target().hasClass('faded');
      e.toggleClass('faded', !relevant);
    });
  };

  const _exitFocus = () => {
    if (!cy) return;
    _focusKwNorm = null;
    cy.nodes().removeClass('faded');
    cy.edges().removeClass('faded');
  };

  // ── Groups ────────────────────────────────────────────────────────────────

  const _createGroup = async (paperIds, name, color) => {
    try {
      const g = await _fetch('/map-groups', { method: 'POST', body: JSON.stringify({ name, color, paper_ids: paperIds }) });
      _groups.push(g);
      if (_viewMode === 'overview') {
        _addGroupNodes();
        _applyFlowLayout();
      }
      _showToast(`Group "${name}" created`, 'ok');
      return g;
    } catch (e) { _showToast('Failed to create group: ' + e.message, 'error'); }
  };

  const _showGroupDialog = (paperIds) => {
    const container = cy && cy.container();
    if (!container) return;
    let dlg = container.querySelector('#mv-grp-dialog');
    if (!dlg) {
      dlg = document.createElement('div');
      dlg.id = 'mv-grp-dialog';
      dlg.className = 'mv-nd-dialog hidden';
      dlg.innerHTML = `
        <div class="mv-nd-header">Create Group</div>
        <label class="mv-nd-label">Group Name</label>
        <input class="mv-nd-input" id="mv-grp-name" type="text" placeholder="e.g. Perovskite Series…" />
        <label class="mv-nd-label">Color</label>
        <input type="color" id="mv-grp-color" value="#334155" style="width:100%;height:32px;border:none;border-radius:4px;cursor:pointer;margin-bottom:6px" />
        <div class="mv-nd-actions">
          <button class="btn btn-sm btn-primary" id="mv-grp-save">Create</button>
          <button class="btn btn-sm" id="mv-grp-cancel">Cancel</button>
        </div>
      `;
      container.appendChild(dlg);
      dlg.querySelector('#mv-grp-cancel').onclick = () => dlg.classList.add('hidden');
      dlg.querySelector('#mv-grp-save').onclick = async () => {
        const name  = (dlg.querySelector('#mv-grp-name').value || '').trim();
        const color = dlg.querySelector('#mv-grp-color').value || '#334155';
        if (!name) { dlg.querySelector('#mv-grp-name').focus(); return; }
        dlg.classList.add('hidden');
        await _createGroup(dlg._paperIds || [], name, color);
      };
      dlg.querySelector('#mv-grp-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') dlg.querySelector('#mv-grp-save').click();
        if (e.key === 'Escape') dlg.classList.add('hidden');
      });
    }
    dlg._paperIds = paperIds;
    dlg.querySelector('#mv-grp-name').value = '';
    const c = dlg.parentElement;
    dlg.style.left = Math.min(c.offsetWidth / 2 - 120, c.offsetWidth - 260) + 'px';
    dlg.style.top  = Math.min(c.offsetHeight / 2 - 120, c.offsetHeight - 260) + 'px';
    dlg.classList.remove('hidden');
    setTimeout(() => dlg.querySelector('#mv-grp-name').focus(), 50);
  };

  // ── Mode toggle UI ────────────────────────────────────────────────────────

  const _addModeToggle = (container) => {
    const div = document.createElement('div');
    div.className = 'mv-mode-toggle';
    div.innerHTML = `
      <button class="mv-mode-btn mv-mode-active" id="mv-btn-overview" title="Overview — research flow">Overview</button>
      <button class="mv-mode-btn" id="mv-btn-full" title="Full — all keywords">Full</button>
    `;
    container.appendChild(div);
    div.querySelector('#mv-btn-overview').onclick = (e) => { e.stopPropagation(); _enterOverviewMode(); };
    div.querySelector('#mv-btn-full').onclick      = (e) => { e.stopPropagation(); _enterFullMode(); };
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
    _paperKwCatMap = {};
    _groups = canvasData.groups || [];
    papers.forEach(p => {
      _paperKwMap[p.id]    = (p.keyword_norms || []).map(n => n.toLowerCase());
      _paperKwCatMap[p.id] = p.keyword_categories || {};
    });

    if (papers.length === 0 && customNodes.length === 0) {
      container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#64748b;font-size:0.9rem;">No papers yet. Upload a PDF to get started.</div>';
      return;
    }

    container.style.position = 'relative';
    container.style.overflow = 'hidden';

    const elements = [];

    // Assign paper column positions: stack vertically on the left.
    // Expanded papers get extra height so their keyword block fits.
    let colY = 80;
    papers.forEach(p => {
      const paperY = colY;

      elements.push({ data: {
        id: `p_${p.id}`, type: 'paper',
        title: p.title, year: p.year,
        materials: p.materials || [],
        expanded: !!p.expanded,
        paperId: p.id,
      }, position: { x: PAPER_COL_X, y: paperY } });

      if (p.expanded && p.keywords) {
        const papNodeId = `p_${p.id}`;
        const sorted = p.keywords.slice().sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
        const cols = _gridCols(sorted.length);

        sorted.forEach((kw, i) => {
          elements.push({ data: {
            id: `kw_${kw.id}`, type: 'keyword',
            label: kw.name, normalized: kw.normalized,
            category: kw.category, confidence: kw.confidence,
            paperId: p.id,
          }, position: {
            x: _kwColX(PAPER_COL_X, i % cols),
            y: paperY + Math.floor(i / cols) * KW_ROW_H,
          } });
        });

        const byCat = {};
        sorted.forEach(kw => {
          if (!byCat[kw.category]) byCat[kw.category] = [];
          byCat[kw.category].push(`kw_${kw.id}`);
        });
        (byCat.Material || []).forEach((kwId, i2) =>
          elements.push({ data: { id: `pe_${p.id}_m${i2}`, source: papNodeId, target: kwId, relation: '', edgeType: 'parent', paperId: p.id } }));
        (byCat.Structure || []).forEach((kwId, i2) =>
          elements.push({ data: { id: `pe_${p.id}_s${i2}`, source: papNodeId, target: kwId, relation: '', edgeType: 'parent', paperId: p.id } }));

        const methods = [...(byCat.Method || []), ...(byCat.Structure || [])];
        const props   = [...(byCat.Property || []), ...(byCat.Other || [])];
        let si = 0;
        const addS = (src, tgt, rel) => elements.push({ data: {
          id: `se_${p.id}_${si++}`, source: src, target: tgt, relation: rel, edgeType: 'story', paperId: p.id,
        }});
        (byCat.Material || []).forEach(m => methods.forEach(n => addS(m, n, 'made by')));
        methods.forEach(n => props.forEach(pp => addS(n, pp, 'yields')));
        props.forEach(pp => (byCat.Application || []).forEach(a => addS(pp, a, 'enables')));

        const rows = Math.ceil(sorted.length / cols);
        colY += Math.max(PH + PAPER_V_GAP, rows * KW_ROW_H + PAPER_V_GAP);
      } else {
        colY += PH + PAPER_V_GAP;
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

    // Research chain edges (directed, based on keyword category layers)
    _buildResearchChainEdges(papers).forEach(e => elements.push(e));

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

    cy = cytoscape({
      container, elements, style: STYLESHEET,
      layout: { name: 'preset', animate: false },
      wheelSensitivity: 0.3, minZoom: 0.04, maxZoom: 4,
    });

    // Lock keyword nodes so they can't be dragged out of their grid positions
    cy.nodes('[type="keyword"]').lock();

    // Position top-left: zoom 1.0, pan so first paper is visible near top-left
    cy.zoom(1.0);
    cy.pan({ x: -(PAPER_COL_X - PW / 2 - 20), y: -(80 - PH / 2 - 20) });

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

    // Tap keyword node — detail panel + focus mode (connect mode overrides)
    cy.on('tap', 'node[type="keyword"]', (evt) => {
      const tgt = evt.target;
      if (_connectMode) {
        if (tgt.id() === _connectSrcId) { _cancelConnectMode(); return; }
        const srcNode  = cy.getElementById(_connectSrcId);
        const tempEdge = cy.add([{ data: { id: `tmp_${Date.now()}`, source: _connectSrcId, target: tgt.id(), edgeType: 'user', relation: 'related_to' } }])[0];
        _cancelConnectMode();
        _showRelDialog(tempEdge, srcNode, tgt);
        evt.stopPropagation();
        return;
      }
      const paperId = tgt.data('paperId');
      const kwId    = parseInt(tgt.id().replace('kw_', ''));
      const norm    = tgt.data('normalized');
      // Enter focus mode in Full view; fire detail panel callback
      if (_viewMode === 'full') _keywordFocus(norm);
      if (_onNodeClick) _onNodeClick({ type: 'keyword', paperId, kwId, nodeData: tgt.data() });
      evt.stopPropagation();
    });

    // Tap paper node — detail panel (connect mode overrides; dblclick handles expand)
    cy.on('tap', 'node[type="paper"]', (evt) => {
      const tgt = evt.target;
      if (_connectMode) {
        if (tgt.id() === _connectSrcId) { _cancelConnectMode(); return; }
        const srcNode  = cy.getElementById(_connectSrcId);
        const tempEdge = cy.add([{ data: { id: `tmp_${Date.now()}`, source: _connectSrcId, target: tgt.id(), edgeType: 'user', relation: 'related_to' } }])[0];
        _cancelConnectMode();
        _showRelDialog(tempEdge, srcNode, tgt);
        evt.stopPropagation();
        return;
      }
      if (_onNodeClick) _onNodeClick({ type: 'paper', paperId: tgt.data('paperId'), nodeData: tgt.data() });
      evt.stopPropagation();
    });

    // Tap custom node — detail panel (connect mode overrides)
    cy.on('tap', 'node[type="custom"]', (evt) => {
      const tgt = evt.target;
      if (_connectMode) {
        if (tgt.id() === _connectSrcId) { _cancelConnectMode(); return; }
        const srcNode  = cy.getElementById(_connectSrcId);
        const tempEdge = cy.add([{ data: { id: `tmp_${Date.now()}`, source: _connectSrcId, target: tgt.id(), edgeType: 'user', relation: 'related_to' } }])[0];
        _cancelConnectMode();
        _showRelDialog(tempEdge, srcNode, tgt);
        evt.stopPropagation();
        return;
      }
      if (_onNodeClick) _onNodeClick({ type: 'custom', nodeData: tgt.data() });
      evt.stopPropagation();
    });

    // Tap group node — detail panel + expand/collapse in overview
    cy.on('tap', 'node[type="group"]', (evt) => {
      const tgt = evt.target;
      if (_onNodeClick) _onNodeClick({ type: 'group', nodeData: tgt.data() });
      evt.stopPropagation();
    });

    // Double-click group → expand (show member papers, remove group node)
    cy.on('dblclick', 'node[type="group"]', (evt) => {
      const tgt    = evt.target;
      const pids   = tgt.data('paper_ids') || [];
      const gid    = tgt.id();
      cy.remove(cy.getElementById(gid));
      pids.forEach(pid => cy.getElementById(`p_${pid}`).style('display', 'element'));
      _applyFlowLayout();
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
      if (e.key === 'Escape') { _cancelConnectMode(); _hideAllMenus(); if (_focusKwNorm) _exitFocus(); return; }
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
      if (_focusKwNorm) { _exitFocus(); return; }
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
    _addModeToggle(container);

    // Legend
    const legend = document.createElement('div');
    legend.className = 'mv-legend';
    legend.innerHTML = Object.entries(CAT_COLORS)
      .filter(([cat]) => cat !== 'Metric')
      .map(([cat, col]) =>
        `<span class="legend-item"><span style="background:${col};border-radius:3px;width:10px;height:10px;display:inline-block;vertical-align:middle;margin-right:4px;"></span>${cat}</span>`
      ).join('') +
      `<span class="legend-item" style="margin-left:10px;color:#64748b;font-size:0.7rem">Dbl-click paper to expand · Right-click for menu · Click keyword to focus</span>`;
    container.appendChild(legend);

    // Start in Overview mode by default
    _viewMode = 'full';  // enter overview will set to 'overview'
    _enterOverviewMode();

    return cy;
  };

  return {
    init,
    fit:                () => { if (cy) cy.fit(undefined, 50); },
    applyKeywordFilter: (norms) => _applyFilter(norms),
    enterOverviewMode:  () => _enterOverviewMode(),
    enterFullMode:      () => _enterFullMode(),
    exitFocus:          () => _exitFocus(),
    refreshGroup:       (g) => {
      _groups = _groups.map(x => x.id === g.id ? g : x);
      const gNode = cy && cy.getElementById(`grp_${g.id}`);
      if (gNode && gNode.length) {
        gNode.data({ label: g.name, color: g.color, count: g.paper_ids.length, paper_ids: g.paper_ids });
        gNode.style('background-image', _groupSvg(g.name, g.paper_ids.length, g.color, gNode.data('expanded')));
      }
    },
    deleteGroup: async (groupId) => {
      try {
        await _fetch(`/map-groups/${groupId}`, { method: 'DELETE' });
        _groups = _groups.filter(g => g.id !== groupId);
        const gNode = cy && cy.getElementById(`grp_${groupId}`);
        if (gNode && gNode.length) {
          const pids = gNode.data('paper_ids') || [];
          cy.remove(gNode);
          pids.forEach(pid => cy.getElementById(`p_${pid}`).style('display', 'element'));
          if (_viewMode === 'overview') _applyFlowLayout();
        }
      } catch (e) { _showToast('Failed to delete group: ' + e.message, 'error'); }
    },
  };
})();
