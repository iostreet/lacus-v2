/**
 * Lacus Story Map — Cytoscape.js wrapper
 * Story: Material → Method/Structure → Property/Application
 * Metrics shown in properties panel on node click (not as graph nodes)
 */

window.StoryMap = (() => {
  let cy = null;
  let _callbacks = {};
  let _paperId = null;
  let _primaryNodeId = null;
  let _showOnlyActive = false;
  let _allMetrics = [];

  // ── Category → layer assignment (4 layers) ───────────────────────────────
  // Layer 0: Material, Structure  (top — same level)
  // Layer 1: Method
  // Layer 2: Property, Other
  // Layer 3: Application          (sub-concept of Property)

  const CATEGORY_LAYER = {
    Material:    0,
    Structure:   0,
    Method:      1,
    Property:    2,
    Other:       2,
    Application: 3,
  };

  const LAYER_Y    = [80, 270, 460, 650];
  const NODE_X_GAP = 240;  // wider gap so Material/Structure don't crowd each other

  // ── SVG card generators ───────────────────────────────────────────────────

  const _e   = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const _cut = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
  const _uri = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

  // Card dimensions
  const KW_W = 210, KW_H = 88;   // regular keyword
  const PK_W = 226, PK_H = 92;   // primary keyword
  const MT_W = 180, MT_H = 72;   // metric (unused in graph now)
  const TB   = 22;                // top-bar height

  const _kwSvg = (d, isPrimary) => {
    const W   = isPrimary ? PK_W : KW_W;
    const H   = isPrimary ? PK_H : KW_H;
    const R   = 9;
    // Primary: brighter amber-orange to stand out from regular yellow Material nodes
    const col = isPrimary ? '#f97316' : (d.color || '#a855f7');
    const cat = _e(isPrimary ? '★ ' + (d.category || '') : (d.category || ''));
    const name = _e(_cut((d.label || '').replace(/\n/g, ' '), 24));
    const conf  = d.confidence != null ? Math.round(d.confidence * 100) : 0;
    const barW  = Math.round((W - 24) * conf / 100);
    const textCol = isPrimary ? '#1a1200' : '#ffffff';
    return _uri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
      // card background
      `<rect x="1" y="1" width="${W-2}" height="${H-2}" rx="${R}" ry="${R}" fill="#0f1724" stroke="${col}" stroke-width="${isPrimary ? 2 : 1.2}" stroke-opacity="${isPrimary ? 1 : 0.55}"/>` +
      // colored top bar (full-width rounded top)
      `<rect x="1" y="1" width="${W-2}" height="${TB}" rx="${R}" ry="${R}" fill="${col}"/>` +
      `<rect x="1" y="${TB - R + 1}" width="${W-2}" height="${R}" fill="${col}"/>` +
      // category label inside bar
      `<text x="${W/2}" y="${TB/2 + 5}" font-family="'Inter','Segoe UI',sans-serif" font-size="11" font-weight="700" fill="${textCol}" text-anchor="middle">${cat}</text>` +
      // keyword name
      `<text x="12" y="${TB + 30}" font-family="'Inter','Segoe UI',sans-serif" font-size="15" font-weight="700" fill="#f1f5f9">${name}</text>` +
      // confidence bar background
      `<rect x="12" y="${H - 14}" width="${W-24}" height="4" rx="2" fill="#1e2a3a"/>` +
      // confidence bar fill
      `<rect x="12" y="${H - 14}" width="${barW}" height="4" rx="2" fill="${col}" opacity=".8"/>` +
      // confidence %
      `<text x="${W-8}" y="${H - 5}" font-family="'Inter','Segoe UI',sans-serif" font-size="9" fill="${col}" opacity=".8" text-anchor="end">${conf}%</text>` +
      `</svg>`
    );
  };

  const _metSvg = (d) => {
    const W = MT_W, H = MT_H, R = 8;
    const parts = (d.label || '').split('\n');
    const mName = _e(_cut(parts[0] || '', 21));
    const mVal  = _e(_cut((parts.slice(1).join(' ')).trim(), 24));
    return _uri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
      `<rect x="1" y="1" width="${W-2}" height="${H-2}" rx="${R}" fill="#0d1f1f" stroke="#14b8a6" stroke-width="1.5"/>` +
      `<rect x="1" y="1" width="${W-2}" height="${TB}" rx="${R}" fill="#14b8a6" opacity=".9"/>` +
      `<rect x="1" y="${TB-R+1}" width="${W-2}" height="${R}" fill="#14b8a6" opacity=".9"/>` +
      `<text x="${W/2}" y="${TB/2+5}" font-family="'Inter','Segoe UI',sans-serif" font-size="10" font-weight="700" fill="#0d2e2e" text-anchor="middle">METRIC</text>` +
      `<text x="12" y="${TB + 22}" font-family="'Inter','Segoe UI',sans-serif" font-size="13" font-weight="700" fill="#f1f5f9">${mName}</text>` +
      `<text x="12" y="${TB + 40}" font-family="'Inter','Segoe UI',sans-serif" font-size="12" fill="#2dd4bf" opacity=".95">${mVal}</text>` +
      `</svg>`
    );
  };

  // ── Cytoscape stylesheet ──────────────────────────────────────────────────

  const STYLESHEET = [
    {
      selector: 'node',
      style: {
        'background-opacity':        0,
        'background-image':          (ele) => _kwSvg(ele.data(), ele.data('id') === _primaryNodeId),
        'background-fit':            'contain',
        'background-clip':           'node',
        'background-image-opacity':  1,
        'border-width':              0,
        'label':                     '',
        'width':                     KW_W,
        'height':                    KW_H,
        'shape':                     'round-rectangle',
        'transition-property':       'opacity',
        'transition-duration':       '0.18s',
      }
    },
    {
      selector: `node[id="${_primaryNodeId || '__none__'}"]`,
      style: { 'width': PK_W, 'height': PK_H }
    },
    {
      selector: 'node[type="metric"]',
      style: {
        'width':            MT_W,
        'height':           MT_H,
        'background-image': (ele) => _metSvg(ele.data()),
      }
    },
    { selector: 'node:selected',    style: { 'overlay-color': '#c084fc', 'overlay-opacity': 0.22, 'overlay-padding': 5 } },
    { selector: 'node.highlighted', style: { 'overlay-color': '#a855f7', 'overlay-opacity': 0.18, 'overlay-padding': 5 } },
    { selector: 'node.faded',       style: { 'opacity': 0.12 } },
    { selector: 'node.filtered-out',style: { 'display': 'none' } },
    // Manual relation edges (rel_*)
    {
      selector: 'edge',
      style: {
        'width':               2.5,
        'line-color':          '#a5b4fc',
        'target-arrow-color':  '#a5b4fc',
        'target-arrow-shape':  'triangle',
        'arrow-scale':         1.0,
        'curve-style':         'bezier',
        'label':               'data(relation)',
        'font-size':           '10px',
        'color':               '#c7d2fe',
        'font-family':         '"Inter", "Segoe UI", system-ui, sans-serif',
        'text-rotation':       'autorotate',
        'text-margin-y':       -9,
        'opacity':             0.9,
        'transition-property': 'opacity, line-color',
        'transition-duration': '0.18s',
      }
    },
    // Auto story-flow edges (Material→Method→Property→Application)
    {
      selector: 'edge[?auto]',
      style: {
        'line-style':         'dashed',
        'line-dash-pattern':  [8, 5],
        'line-color':         '#94a3b8',
        'target-arrow-color': '#94a3b8',
        'target-arrow-shape': 'triangle',
        'arrow-scale':        0.9,
        'curve-style':        'bezier',
        'label':              'data(relation)',
        'font-size':          '9px',
        'color':              '#cbd5e1',
        'font-family':        '"Inter", "Segoe UI", system-ui, sans-serif',
        'text-rotation':      'autorotate',
        'text-margin-y':      -8,
        'opacity':            0.85,
        'width':              2.0,
      }
    },
    { selector: 'edge:selected',    style: { 'opacity': 1, 'line-color': '#c084fc', 'target-arrow-color': '#c084fc', 'width': 3.5, 'color': '#e0e7ff' } },
    { selector: 'edge.highlighted', style: { 'opacity': 1, 'line-color': '#c084fc', 'target-arrow-color': '#c084fc', 'width': 3.5, 'color': '#e0e7ff' } },
    { selector: 'edge.faded',       style: { 'opacity': 0.05 } },
    { selector: 'edge.filtered-out',style: { 'display': 'none' } },
  ];

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Keep only keyword nodes (kw_*) and keyword-to-keyword edges (rel_*)
  // Metric nodes (met_*) and their edges (met_edge_*) are excluded — shown in panel on click
  const _filterElements = (elements) => {
    return elements.filter(el => {
      if (el.data.source) return el.data.id && el.data.id.startsWith('rel_');
      return el.data.id && el.data.id.startsWith('kw_');
    });
  };

  const _clearHighlight = () => {
    if (!cy) return;
    cy.$('*').removeClass('highlighted faded');
    _showOnlyActive = false;
  };

  // Confidence filter: only hide manual (rel_*) edges, never hide nodes
  const _applyConfidenceFilter = (threshold) => {
    if (!cy) return;
    cy.edges().forEach(edge => {
      if (edge.data('auto')) return; // always keep story-flow edges visible
      edge.toggleClass('filtered-out', (edge.data('confidence') || 0) < threshold);
    });
  };

  // ── Auto story-flow edge generator ────────────────────────────────────────
  // Layer 0: Material / Structure (same level)
  // Layer 1: Method  ← connected from Material
  // Layer 2: Property / Other  ← connected from Method
  // Layer 3: Application  ← connected from Property (sub-concept)
  const _buildStoryEdges = (kwNodes, existingEdges) => {
    const by = { Material: [], Method: [], Structure: [], Property: [], Application: [], Other: [] };
    kwNodes.forEach(n => {
      const cat = n.data.category;
      if (by[cat]) by[cat].push(n.data.id);
    });

    // Build a set of already-connected pairs to skip duplicates
    const connected = new Set();
    existingEdges.forEach(e => {
      if (e.data.source && e.data.target) {
        connected.add(`${e.data.source}|${e.data.target}`);
        connected.add(`${e.data.target}|${e.data.source}`);
      }
    });

    const methods  = [...by.Method, ...by.Structure];
    const props    = [...by.Property, ...by.Other];

    const edges = [];
    let idx = 0;

    const addEdge = (src, tgt, relation) => {
      if (connected.has(`${src}|${tgt}`)) return;
      edges.push({ data: { id: `auto_${idx++}`, source: src, target: tgt, relation, confidence: 1.0, auto: true } });
    };

    // Material → Method
    by.Material.forEach(mId => {
      methods.forEach(nId => addEdge(mId, nId, 'made by'));
    });

    // Method → Property / Other
    methods.forEach(nId => {
      props.forEach(pId => addEdge(nId, pId, 'yields'));
    });

    // Property → Application  (Application is sub-concept of Property)
    props.forEach(pId => {
      by.Application.forEach(aId => addEdge(pId, aId, 'enables'));
    });

    // Fallback: if no Method, connect Material directly to Property
    if (methods.length === 0) {
      by.Material.forEach(mId => {
        props.forEach(pId => addEdge(mId, pId, 'related'));
      });
    }

    return edges;
  };

  // ── Hierarchical layout positions ─────────────────────────────────────────

  const _buildHierarchyPositions = (elements, primaryNodeId) => {
    const nodes = elements.filter(el => !el.data.source);
    const edges = elements.filter(el => !!el.data.source);

    // Assign layers
    const layerOf = {};
    nodes.forEach(n => {
      const cat = n.data.category || 'Other';
      layerOf[n.data.id] = CATEGORY_LAYER[cat] !== undefined ? CATEGORY_LAYER[cat] : 2;
    });

    // Group nodes by layer (4 layers)
    const layers = [[], [], [], []];
    nodes.forEach(n => {
      const l = layerOf[n.data.id] !== undefined ? layerOf[n.data.id] : 2;
      if (l < 4) layers[l].push(n.data.id);
    });

    // Initial posX = index within layer
    const posX = {};
    layers.forEach((ids) => {
      ids.forEach((id, i) => { posX[id] = i; });
    });

    // 2 passes of barycenter ordering
    for (let pass = 0; pass < 2; pass++) {
      layers.forEach((ids) => {
        if (ids.length <= 1) return;
        const bary = {};
        ids.forEach(id => {
          const neighbors = [];
          edges.forEach(e => {
            if (e.data.source === id && posX[e.data.target] !== undefined) neighbors.push(posX[e.data.target]);
            if (e.data.target === id && posX[e.data.source] !== undefined) neighbors.push(posX[e.data.source]);
          });
          bary[id] = neighbors.length > 0 ? neighbors.reduce((a, b) => a + b, 0) / neighbors.length : posX[id];
        });
        ids.sort((a, b) => (bary[a] || 0) - (bary[b] || 0));
        ids.forEach((id, i) => { posX[id] = i; });
      });
    }

    // Final positions — left-aligned, primary node first in layer 0
    const X_START = 0;
    const positions = {};
    layers.forEach((ids, li) => {
      // Put primary node first in layer 0
      if (li === 0 && primaryNodeId) {
        const idx = ids.indexOf(primaryNodeId);
        if (idx > 0) { ids.splice(idx, 1); ids.unshift(primaryNodeId); }
      }
      ids.forEach((id, i) => {
        positions[id] = { x: X_START + i * NODE_X_GAP, y: LAYER_Y[li] };
      });
    });

    return positions;
  };

  // ── Zoom controls ─────────────────────────────────────────────────────────

  const _addZoomControls = (container) => {
    const div = document.createElement('div');
    div.className = 'storymap-zoom-controls';
    div.innerHTML = `
      <button class="zoom-btn" id="sm-zoom-in"  title="Zoom in">+</button>
      <button class="zoom-btn" id="sm-zoom-fit" title="Fit">⊡</button>
      <button class="zoom-btn" id="sm-zoom-out" title="Zoom out">−</button>
    `;
    container.appendChild(div);
    const cx  = () => container.offsetWidth  / 2;
    const cy_ = () => container.offsetHeight / 2;
    div.querySelector('#sm-zoom-in').onclick  = (e) => { e.stopPropagation(); if (cy) cy.zoom({ level: cy.zoom() * 1.25, renderedPosition: { x: cx(), y: cy_() } }); };
    div.querySelector('#sm-zoom-out').onclick = (e) => { e.stopPropagation(); if (cy) cy.zoom({ level: cy.zoom() * 0.8,  renderedPosition: { x: cx(), y: cy_() } }); };
    div.querySelector('#sm-zoom-fit').onclick  = (e) => { e.stopPropagation(); if (cy) cy.fit(undefined, 50); };
  };

  // ── Node Properties Panel ─────────────────────────────────────────────────

  const _addNodePropertiesPanel = (container) => {
    const panel = document.createElement('div');
    panel.className = 'node-props-panel hidden';
    panel.id = 'sm-node-props-panel';
    panel.innerHTML = `
      <div class="npp-header">
        <span class="npp-type-badge" id="npp-type"></span>
        <button class="npp-close" id="npp-close">✕</button>
      </div>
      <input class="node-edit-input" id="npp-label" type="text" placeholder="Edit label…" />
      <div class="npp-derived" id="npp-derived"></div>
      <div class="npp-metrics" id="npp-metrics"></div>
      <div class="npp-connections" id="npp-connections"></div>
      <div class="npp-actions">
        <button class="btn btn-sm btn-primary" id="npp-save">Save</button>
        <button class="btn btn-sm btn-danger"  id="npp-delete">Delete</button>
        <button class="btn btn-sm"             id="npp-focus">Focus</button>
      </div>
    `;
    container.appendChild(panel);

    panel.querySelector('#npp-close').addEventListener('click', () => {
      panel.classList.add('hidden');
      if (cy) cy.$(':selected').unselect();
    });
    panel.querySelector('#npp-save').addEventListener('click', async () => {
      const newLabel = panel.querySelector('#npp-label').value.trim();
      if (!newLabel || !_callbacks.onNodeEdit) return;
      await _callbacks.onNodeEdit({ id: panel.dataset.nodeId, type: panel.dataset.nodeType }, newLabel);
      panel.classList.add('hidden');
    });
    panel.querySelector('#npp-delete').addEventListener('click', async () => {
      if (!_callbacks.onNodeDelete) return;
      await _callbacks.onNodeDelete({ id: panel.dataset.nodeId, type: panel.dataset.nodeType });
      panel.classList.add('hidden');
    });
    panel.querySelector('#npp-focus').addEventListener('click', () => {
      if (!cy) return;
      const node = cy.$(`#${panel.dataset.nodeId}`);
      if (node.length) cy.fit(node.closedNeighborhood(), 70);
    });

    return panel;
  };

  const _showNodePanel = (panel, node) => {
    const data = node.data();
    panel.dataset.nodeId   = data.id;
    panel.dataset.nodeType = data.type || 'keyword';
    panel.querySelector('#npp-type').textContent      = (data.type || 'node').toUpperCase();
    panel.querySelector('#npp-type').style.background = data.color || '#a855f7';
    panel.querySelector('#npp-label').value = data.label.replace(/\n/g, ' ');

    const confPct = data.confidence != null ? (data.confidence * 100).toFixed(0) : '—';
    panel.querySelector('#npp-derived').innerHTML = `
      <div class="npp-field"><span>Category</span><span>${data.category || '—'}</span></div>
      <div class="npp-field">
        <span>Confidence</span>
        <span class="npp-conf">
          <span class="conf-bar-wrap" style="width:52px;display:inline-block;vertical-align:middle">
            <span class="conf-bar" style="width:${confPct === '—' ? 0 : confPct}%"></span>
          </span>
          &nbsp;${confPct}%
        </span>
      </div>
    `;

    // Metrics section — find metrics linked to this keyword
    const kwNumericId = parseInt((data.id || '').replace('kw_', ''));
    const metricsDiv = panel.querySelector('#npp-metrics');
    const linkedMetrics = isNaN(kwNumericId) ? [] :
      _allMetrics.filter(m => m.linked_keyword_id === kwNumericId);
    if (linkedMetrics.length > 0) {
      metricsDiv.innerHTML =
        `<div class="npp-metrics-title">Measured Values</div>` +
        linkedMetrics.map(m => {
          const val  = [m.value, m.unit].filter(Boolean).join(' ');
          const cond = m.condition ? `<span class="npp-met-cond">(${_e(m.condition)})</span>` : '';
          return `<div class="npp-met-row">
            <span class="npp-met-name">${_e(m.metric_name)}</span>
            <span class="npp-met-val">${_e(val)}</span>${cond}
          </div>`;
        }).join('');
    } else {
      metricsDiv.innerHTML = '';
    }

    // Connections section
    const edges  = node.connectedEdges();
    const groups = {};
    edges.forEach(edge => {
      const rel = edge.data('relation') || 'connected';
      groups[rel] = (groups[rel] || 0) + 1;
    });

    const connDiv = panel.querySelector('#npp-connections');
    if (edges.length === 0) {
      connDiv.innerHTML = '<div class="npp-no-conn">No connections</div>';
    } else {
      connDiv.innerHTML = `<div class="npp-conn-title">Connections (${edges.length})</div>` +
        Object.entries(groups).map(([rel, count]) =>
          `<div class="npp-conn-row"><span class="rel-type-badge">${rel}</span><span class="npp-conn-count">${count}</span></div>`
        ).join('');
    }

    panel.classList.remove('hidden');
  };

  // ── Edge Edit Panel ───────────────────────────────────────────────────────

  const RELATION_TYPES = [
    'increases', 'decreases', 'enables', 'requires', 'composed_of',
    'part_of', 'related_to', 'has_value', 'measured_by', 'improves',
    'reduces', 'causes', 'affects', 'correlates_with',
  ];

  const _addEdgeEditPanel = (container) => {
    const panel = document.createElement('div');
    panel.className = 'edge-edit-panel hidden';
    panel.id = 'sm-edge-panel';
    panel.innerHTML = `
      <div class="eep-header">
        <span class="eep-title">Edit Relation</span>
        <button class="eep-close" id="eep-close">✕</button>
      </div>
      <div class="eep-nodes">
        <span class="eep-node-lbl" id="eep-src"></span>
        <span class="eep-arrow">→</span>
        <span class="eep-node-lbl" id="eep-tgt"></span>
      </div>
      <div class="eep-field">
        <label class="eep-label">Relation type</label>
        <select class="eep-select" id="eep-rel-type">
          ${RELATION_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
          <option value="__custom__">custom…</option>
        </select>
        <input class="eep-input hidden" id="eep-custom" type="text" placeholder="Custom relation type" />
      </div>
      <div class="eep-field">
        <label class="eep-label">Confidence</label>
        <input class="eep-input" id="eep-conf" type="number" min="0" max="1" step="0.05" />
      </div>
      <div class="eep-actions">
        <button class="btn btn-sm btn-primary" id="eep-save">Save</button>
        <button class="btn btn-sm btn-danger"  id="eep-delete">Delete</button>
      </div>
    `;
    container.appendChild(panel);

    panel.querySelector('#eep-close').onclick = () => panel.classList.add('hidden');

    const relSelect = panel.querySelector('#eep-rel-type');
    const customInput = panel.querySelector('#eep-custom');
    relSelect.onchange = () => {
      customInput.classList.toggle('hidden', relSelect.value !== '__custom__');
    };

    panel.querySelector('#eep-save').onclick = async () => {
      const relId = panel.dataset.edgeRelId;
      if (!relId) return;
      const relType = relSelect.value === '__custom__'
        ? customInput.value.trim()
        : relSelect.value;
      const conf = parseFloat(panel.querySelector('#eep-conf').value);
      if (!relType) return;
      try {
        await fetch(`/api/relations/${relId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...(window._authToken ? { 'Authorization': 'Bearer ' + window._authToken } : {}) },
          body: JSON.stringify({ relation_type: relType, confidence: isNaN(conf) ? undefined : conf }),
        });
        panel.classList.add('hidden');
        if (_callbacks.onEdgeSave) _callbacks.onEdgeSave();
      } catch (err) { console.error('Edge save failed', err); }
    };

    panel.querySelector('#eep-delete').onclick = async () => {
      const relId = panel.dataset.edgeRelId;
      if (!relId) return;
      try {
        await fetch(`/api/relations/${relId}`, { method: 'DELETE', headers: window._authToken ? { 'Authorization': 'Bearer ' + window._authToken } : {} });
        panel.classList.add('hidden');
        if (_callbacks.onEdgeDelete) _callbacks.onEdgeDelete();
      } catch (err) { console.error('Edge delete failed', err); }
    };

    return panel;
  };

  const _showEdgePanel = (panel, edge) => {
    const data = edge.data();
    // Edge id format: rel_123 — extract numeric id
    const relId = data.id ? data.id.replace(/^rel_/, '') : null;
    if (!relId || isNaN(parseInt(relId))) return; // metric edges not editable
    panel.dataset.edgeRelId = relId;

    panel.querySelector('#eep-src').textContent = edge.source().data('label') || '?';
    panel.querySelector('#eep-tgt').textContent = edge.target().data('label') || '?';

    const relType = data.relation || 'related_to';
    const relSelect = panel.querySelector('#eep-rel-type');
    const customInput = panel.querySelector('#eep-custom');
    if (RELATION_TYPES.includes(relType)) {
      relSelect.value = relType;
      customInput.classList.add('hidden');
    } else {
      relSelect.value = '__custom__';
      customInput.value = relType;
      customInput.classList.remove('hidden');
    }
    panel.querySelector('#eep-conf').value = data.confidence != null ? data.confidence.toFixed(2) : '0.50';

    panel.classList.remove('hidden');
  };

  // ── Context Menu (Search Around + Show Only) ──────────────────────────────

  const _addContextMenu = (container) => {
    container.addEventListener('contextmenu', (e) => e.preventDefault());

    const menu = document.createElement('div');
    menu.className = 'sm-ctx-menu hidden';
    menu.id = 'sm-ctx-menu';
    container.appendChild(menu);

    cy.on('cxttap', 'node', (evt) => {
      const node      = evt.target;
      const data      = node.data();
      const clientPos = evt.originalEvent;

      const groups = {};
      node.connectedEdges().forEach(edge => {
        const rel   = edge.data('relation') || 'connected';
        const other = edge.source().id() === node.id() ? edge.target() : edge.source();
        if (!groups[rel]) groups[rel] = { nodes: [], edges: [] };
        groups[rel].nodes.push(other.id());
        groups[rel].edges.push(edge.id());
      });

      const confPct = data.confidence != null ? (data.confidence * 100).toFixed(0) + '%' : '—';
      let html = `<div class="ctx-title">${_e(data.label)}</div><div class="ctx-subtitle">${data.category || ''} · ${confPct} conf</div>`;

      if (Object.keys(groups).length === 0) {
        html += '<div class="ctx-empty">No connections</div>';
      } else {
        html += '<div class="ctx-section">Search Around</div>';
        Object.entries(groups).forEach(([rel, info]) => {
          const count = info.nodes.length;
          html += `<div class="ctx-group">
            <span class="ctx-rel">${rel}</span>
            <span class="ctx-count">${count}</span>
            <button class="ctx-show-only btn btn-xs" data-rel="${rel}" data-nid="${node.id()}">Show Only ▶</button>
          </div>`;
        });
        html += `<div class="ctx-divider"></div>
          <div class="ctx-action" data-action="highlight" data-nid="${node.id()}">⬡ Highlight Neighborhood</div>
          <div class="ctx-action" data-action="focus"     data-nid="${node.id()}">⊙ Focus on Node</div>
          <div class="ctx-action" data-action="reset">◎ Reset Filters</div>`;
      }

      menu.innerHTML = html;
      menu.classList.remove('hidden');

      const rect = container.getBoundingClientRect();
      menu.style.left = Math.min(clientPos.clientX - rect.left + 4, container.offsetWidth  - 230) + 'px';
      menu.style.top  = Math.min(clientPos.clientY - rect.top  + 4, container.offsetHeight - 200) + 'px';

      // Show Only handlers
      menu.querySelectorAll('.ctx-show-only').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const filterRel = btn.dataset.rel;
          const centerNid = btn.dataset.nid;
          cy.$('*').removeClass('filtered-out');
          // Hide edges not matching relation type (from this node)
          cy.edges().forEach(edge => {
            const srcId = edge.source().id();
            const tgtId = edge.target().id();
            const rel   = edge.data('relation') || '';
            const involvesCenterNode = srcId === centerNid || tgtId === centerNid;
            if (involvesCenterNode) {
              if (rel !== filterRel) edge.addClass('filtered-out');
            } else {
              edge.addClass('filtered-out');
            }
          });
          // Hide nodes not connected by visible edges (except center node)
          cy.nodes().forEach(n => {
            if (n.id() === centerNid) return;
            const hasVisible = n.connectedEdges().some(e => !e.hasClass('filtered-out'));
            if (!hasVisible) n.addClass('filtered-out');
          });
          _showOnlyActive = true;
          menu.classList.add('hidden');
        };
      });

      // Other actions
      menu.querySelectorAll('.ctx-action').forEach(el => {
        el.onclick = (e) => {
          e.stopPropagation();
          const { action, nid } = el.dataset;
          if (action === 'highlight' && nid) {
            const n = cy.$(`#${nid}`);
            _clearHighlight();
            n.addClass('highlighted');
            n.neighborhood().addClass('highlighted');
            cy.$('*').not('.highlighted').addClass('faded');
          } else if (action === 'focus' && nid) {
            cy.fit(cy.$(`#${nid}`).closedNeighborhood(), 70);
          } else if (action === 'reset') {
            _clearHighlight();
            cy.$('*').removeClass('filtered-out');
            const slider = document.getElementById('sm-conf-slider');
            if (slider) _applyConfidenceFilter(parseInt(slider.value || '0') / 100);
          }
          menu.classList.add('hidden');
        };
      });
    });

    cy.on('tap', (evt) => { if (evt.target === cy) menu.classList.add('hidden'); });
    document.addEventListener('click', () => menu.classList.add('hidden'), { passive: true });

    return menu;
  };

  // ── Public: init ──────────────────────────────────────────────────────────

  const init = (containerId, graphData, callbacks) => {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (cy) { cy.destroy(); cy = null; }
    _callbacks      = callbacks || {};
    _paperId        = graphData.paper_id || null;
    _primaryNodeId  = graphData.primary_node_id || null;
    _allMetrics     = graphData.all_metrics || [];
    _showOnlyActive = false;

    container.querySelectorAll(
      '.storymap-zoom-controls, .node-props-panel, .sm-ctx-menu, .edge-edit-panel'
    ).forEach(el => el.remove());

    const allElements = graphData.elements || [];
    // Keep only keyword nodes + keyword-to-keyword edges (metrics shown in panel)
    const kwElements  = _filterElements(allElements);
    const nodeCount   = kwElements.filter(el => !el.data.source).length;
    if (nodeCount === 0) {
      container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#64748b;font-size:0.85rem;text-align:center;padding:20px;">No keywords yet.<br>Add keywords to build the story map.</div>';
      return;
    }

    // Add auto story-flow edges (Material→Method→Property/Application)
    const kwNodes       = kwElements.filter(el => !el.data.source);
    const manualEdges   = kwElements.filter(el => !!el.data.source);
    const storyEdges    = _buildStoryEdges(kwNodes, manualEdges);
    const elements      = [...kwNodes, ...manualEdges, ...storyEdges];

    container.style.position = 'relative';
    container.style.overflow = 'hidden';

    // Build preset positions
    const positions = _buildHierarchyPositions(elements, _primaryNodeId);

    // Update stylesheet with current primary node id
    const stylesheet = STYLESHEET.map(rule => {
      if (rule.selector && rule.selector.includes('__none__') && _primaryNodeId) {
        return { selector: `node[id="${_primaryNodeId}"]`, style: rule.style };
      }
      return rule;
    });

    cy = cytoscape({
      container,
      elements,
      style: stylesheet,
      layout: {
        name:      'preset',
        positions: (node) => positions[node.id()] || { x: 0, y: 0 },
        padding:   80,
        animate:   false,
      },
      wheelSensitivity: 0.3,
      minZoom: 0.08,
      maxZoom: 4,
    });

    cy.fit(undefined, 60);

    _addZoomControls(container);
    const propsPanel = _addNodePropertiesPanel(container);
    const edgePanel  = _addEdgeEditPanel(container);
    _addContextMenu(container);

    cy.on('select',   'node', (evt) => { _showNodePanel(propsPanel, evt.target); edgePanel.classList.add('hidden'); });
    cy.on('unselect', 'node', () => {
      setTimeout(() => { if (cy && cy.$(':selected').length === 0) propsPanel.classList.add('hidden'); }, 200);
    });
    cy.on('tap', 'edge', (evt) => {
      propsPanel.classList.add('hidden');
      if (cy) cy.$(':selected').unselect();
      _showEdgePanel(edgePanel, evt.target);
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        propsPanel.classList.add('hidden');
        edgePanel.classList.add('hidden');
      }
    });

    const tooltip = document.getElementById('hover-tooltip');
    cy.on('mouseover', 'edge', (evt) => {
      const d = evt.target.data();
      if (!tooltip) return;
      tooltip.innerHTML = `
        <div class="tooltip-rel">${d.relation}</div>
        ${d.evidence ? `<div class="tooltip-evidence">"${d.evidence.substring(0, 200)}…"</div>` : ''}
        <div class="tooltip-conf">Confidence: ${(d.confidence * 100).toFixed(0)}%</div>
      `;
      tooltip.classList.remove('hidden');
    });
    cy.on('mouseout',  'edge', () => { if (tooltip) tooltip.classList.add('hidden'); });
    cy.on('mouseover', 'node', (evt) => {
      const d = evt.target.data();
      if (!tooltip) return;
      tooltip.innerHTML = `
        <div class="tooltip-rel">${_e(d.label)}</div>
        <div class="tooltip-conf">Category: ${d.category} · Conf: ${(d.confidence * 100).toFixed(0)}%</div>
      `;
      tooltip.classList.remove('hidden');
    });
    cy.on('mouseout',  'node', () => { if (tooltip) tooltip.classList.add('hidden'); });
    cy.on('mousemove', (evt) => {
      if (tooltip && !tooltip.classList.contains('hidden')) {
        tooltip.style.left = (evt.originalEvent.clientX + 16) + 'px';
        tooltip.style.top  = (evt.originalEvent.clientY - 10) + 'px';
      }
    });

    const slider     = document.getElementById('sm-conf-slider');
    const valueLabel = document.getElementById('sm-conf-value');
    if (slider) {
      slider.value = '0';
      if (valueLabel) valueLabel.textContent = '0%';
      slider.oninput = () => {
        if (valueLabel) valueLabel.textContent = slider.value + '%';
        _applyConfidenceFilter(parseInt(slider.value) / 100);
      };
    }

    return cy;
  };

  const fit      = () => { if (cy) cy.fit(undefined, 50); };
  const relayout = () => {
    if (!cy) return;
    const allEls = cy.elements().map(el => ({ data: el.data() }));
    const pos    = _buildHierarchyPositions(allEls, _primaryNodeId);
    cy.layout({
      name:      'preset',
      positions: (node) => pos[node.id()] || { x: 0, y: 0 },
      padding:   80,
      animate:   true,
      animationDuration: 500,
    }).run();
  };

  const buildLegend = (categoryColors, containerId) => {
    const el = document.getElementById(containerId);
    if (!el) return;
    // Exclude Metric (metrics shown in click panel, not as graph nodes)
    el.innerHTML = Object.entries(categoryColors)
      .filter(([cat]) => cat !== 'Metric')
      .map(([cat, color]) =>
        `<span class="legend-item">` +
        `<span class="legend-dot" style="background:${color};border-radius:3px;width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:5px;"></span>` +
        `${cat}</span>`
      ).join('');
  };

  return { init, fit, relayout, buildLegend };
})();
