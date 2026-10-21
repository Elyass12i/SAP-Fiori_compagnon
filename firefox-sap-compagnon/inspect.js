/* SAPUI5 control inspector: Alt+click (or inspection mode started from the panel) on an element
   → control, view, controller, binding paths and model values. Loaded in every frame.
   Firefox: isolated content script, page objects through window.wrappedJSObject, extension APIs directly.
   Chrome: runs in the page's MAIN world (no extension APIs there): talks to page-bridge.js with postMessage. */
(() => {
  'use strict';
  const direct = typeof browser !== 'undefined' && !!(browser.runtime && browser.runtime.id); // Firefox content script
  const w = direct ? window.wrappedJSObject : window;
  if (!w) return;
  const safe = fn => { try { return fn(); } catch (_) { return undefined; } };
  let altEnabled = true, mode = false, host = null, shadow = null, box = null, card = null, raf = 0;

  // Small dictionary of its own (i18n.js is not loaded in every frame); English by default
  const FR = {
    'UI5 inspector': 'Inspecteur UI5', 'Control': 'Contrôle', 'View: ': 'Vue : ', 'Controller: ': 'Contrôleur : ', 'Context: ': 'Contexte : ',
    '(empty)': '(vide)', 'Aggregations: ': 'Agrégations : ', 'Context data': 'Données du contexte', 'Copied ✓': 'Copié ✓',
    'Copy refused': 'Copie refusée', 'Copy': 'Copier', 'Close': 'Fermer', 'UI5 control {0} — id {1}': 'Contrôle UI5 {0} — id {1}',
    'View: {0}': 'Vue : {0}', 'Controller: {0}': 'Contrôleur : {0}', 'Context: {0} ({1})': 'Contexte : {0} ({1})',
    'Context data:': 'Données du contexte :', 'Click an element of the application · Esc to cancel': 'Cliquez un élément de l’application · Échap pour annuler'
  };
  let lang = 'en';
  const t = (s, ...a) => (lang === 'fr' && FR[s] || s).replace(/\{(\d+)\}/g, (m, i) => (+i < a.length ? String(a[+i]) : m));
  const readSettings = s => { altEnabled = !(s && s.inspectAlt === false); lang = s && s.lang === 'fr' ? 'fr' : 'en'; };

  // Link with the extension: direct (Firefox) or through page-bridge.js (Chrome)
  const toBridge = m => window.postMessage({ __sapcInspOut: JSON.stringify(m) }, '*');
  const report = d => { if (direct) browser.runtime.sendMessage({ type: 'sapc-inspected', data: d }).catch(() => {}); else toBridge({ type: 'inspected', data: d }); };
  const onCommand = msg => {
    if (!msg) return;
    if (msg.type === 'sapc-inspect-start') { if (ui5()) setMode(true); }
    if (msg.type === 'sapc-inspect-stop') { if (mode) setMode(false); }
  };
  if (direct) {
    browser.storage.local.get('settings').then(r => readSettings(r.settings), () => {});
    browser.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.settings) readSettings(ch.settings.newValue); });
    browser.runtime.onMessage.addListener(msg => { onCommand(msg); return undefined; });
  } else {
    window.addEventListener('message', e => {
      const d = e.data;
      if (!d || typeof d !== 'object' || typeof d.__sapcInspIn !== 'string') return;
      let m;
      try { m = JSON.parse(d.__sapcInspIn); } catch (_) { return; }
      if (m && m.type === 'settings') readSettings(m.settings);
      else onCommand(m);
    });
    toBridge({ type: 'ready' }); // asks page-bridge.js for the settings
  }

  const ui5 = () => { const sap = safe(() => w.sap); return sap && safe(() => sap.ui.version) ? sap : null; };
  const str = (v, n) => {
    if (v === null || v === undefined) return '';
    let s;
    if (typeof v === 'object') s = safe(() => w.JSON.stringify(v)) || '[object]';
    else s = String(v);
    return s.length > (n || 300) ? s.slice(0, n || 300) + '…' : s;
  };

  function controlFor(node) {
    const sap = ui5();
    if (!sap || !node) return null;
    const El = safe(() => sap.ui.require('sap/ui/core/Element'));
    let c = El && typeof El.closestTo === 'function' ? safe(() => El.closestTo(node.wrappedJSObject || node)) : null; // UI5 ≥ 1.106
    for (let n = node; !c && n && n.nodeType === 1; n = n.parentElement) {
      if (!n.hasAttribute('data-sap-ui') || !n.id) continue;
      const id = n.id;
      c = safe(() => El.getElementById(id)) || safe(() => El.registry.get(id)) || safe(() => sap.ui.getCore().byId(id)); // fallback for older UI5
    }
    return c || null;
  }

  function describe(c) {
    const sap = ui5();
    const meta = safe(() => c.getMetadata());
    const out = { id: str(safe(() => c.getId())), type: str(safe(() => meta.getName())), ui5: str(sap && sap.ui.version), props: [], aggs: [], view: '', controller: '', context: null, frameUrl: location.href, time: Date.now() };
    for (let p = c, i = 0; p && i < 80; p = safe(() => p.getParent()), i++) {
      const n = str(safe(() => p.getMetadata().getName()));
      if (/^sap\.ui\.core\.mvc\.\w*View$/.test(n)) {
        out.view = str(safe(() => p.getViewName())) || str(safe(() => p.getId()));
        out.controller = str(safe(() => p.getController().getMetadata().getName()));
        break;
      }
    }
    const interesting = ['value', 'text', 'selectedKey', 'dateValue', 'enabled', 'editable', 'visible', 'required', 'valueState', 'title', 'number', 'state', 'selected'];
    const props = safe(() => meta.getAllProperties()) || {};
    Object.keys(props).forEach(name => {
      const bi = safe(() => c.getBindingInfo(name));
      let path = '';
      if (bi) {
        const parts = safe(() => bi.parts);
        if (parts && parts.length) path = Array.from(parts).map(x => (x.model ? x.model + '>' : '') + (x.path || '')).join(' + ');
        else if (bi.path) path = (bi.model ? bi.model + '>' : '') + bi.path;
        if (!path) path = str(safe(() => bi.binding.getPath()));
      }
      if (path || interesting.includes(name)) out.props.push({ name, path, value: str(safe(() => c.getProperty(name))) });
    });
    const aggs = safe(() => meta.getAllAggregations()) || {};
    Object.keys(aggs).forEach(name => {
      const bi = safe(() => c.getBindingInfo(name));
      if (bi && bi.path) out.aggs.push({ name, path: (bi.model ? bi.model + '>' : '') + bi.path });
    });
    const ctx = safe(() => c.getBindingContext());
    if (ctx) {
      const model = safe(() => ctx.getModel());
      out.context = {
        path: str(safe(() => ctx.getPath())),
        model: str(safe(() => model.getMetadata().getName())),
        serviceUrl: str(safe(() => model.sServiceUrl) || safe(() => model.getServiceUrl())),
        object: str(safe(() => w.JSON.stringify(ctx.getObject(), null, 2)), 4000)
      };
    }
    return out;
  }

  /* Display in the page (Shadow DOM: does not alter the application's style) */
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); });
    kids.flat(Infinity).forEach(k => { if (k !== null && k !== undefined && k !== false) n.append(k instanceof Node ? k : String(k)); });
    return n;
  }
  const CSS = `
    :host{all:initial}
    .box{position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #f9a825;background:rgba(249,168,37,.12);border-radius:3px}
    .lab{position:absolute;left:-2px;top:-20px;background:#f9a825;color:#1b1b1b;font:600 11px/1.4 system-ui,sans-serif;padding:1px 6px;border-radius:3px 3px 0 0;white-space:nowrap}
    .card{position:fixed;top:12px;right:12px;z-index:2147483647;width:min(420px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;
      font:12.5px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1b1b1b;background:#fff;border-radius:10px;box-shadow:0 10px 32px rgba(0,0,0,.3);border-top:4px solid #f9a825;padding:10px 12px}
    .card h4{margin:0 0 2px;font-size:13.5px}
    .mono{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;overflow-wrap:anywhere}
    .mut{color:#666}
    table{border-collapse:collapse;width:100%;margin-top:6px}
    td{border-top:1px solid #eee;padding:3px 4px;vertical-align:top;overflow-wrap:anywhere}
    pre{background:#f4f4f2;border-radius:6px;padding:6px;max-height:180px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:11px ui-monospace,Consolas,monospace}
    .a{display:flex;gap:6px;justify-content:flex-end;margin-top:8px}
    button{all:unset;cursor:pointer;font-weight:600;font-size:12px;padding:4px 9px;border-radius:6px;border:1px solid #ccc}
    button:hover,button:focus-visible{background:#f0f0f0}
    .hint{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;background:#1b1b1b;color:#fff;font:600 12.5px system-ui,sans-serif;padding:7px 12px;border-radius:8px}
    @media (prefers-color-scheme: dark){.card{background:#242422;color:#f0efec}.mut{color:#b8b6ae}td{border-color:#3a3a37}pre{background:#1a1a19}button{border-color:#555}button:hover{background:#333}}
  `;
  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('sapc-inspecteur');
    shadow = host.attachShadow({ mode: 'closed' });
    shadow.append(el('style', null, CSS));
    document.documentElement.append(host);
    box = null; card = null;
  }
  function highlight(c) {
    const dom = c && safe(() => c.getDomRef());
    if (!dom) { if (box) box.hidden = true; return; }
    ensureHost();
    if (!box || !box.isConnected) { box = el('div', { class: 'box' }, el('span', { class: 'lab' })); shadow.append(box); }
    const r = dom.getBoundingClientRect();
    Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    box.hidden = false;
    box.firstChild.textContent = str(safe(() => c.getMetadata().getName())) + '  #' + str(safe(() => c.getId()));
  }
  function showCard(d) {
    ensureHost();
    if (card) card.remove();
    const bound = d.props.filter(p => p.path);
    const other = d.props.filter(p => !p.path);
    let copyBtn;
    card = el('div', { class: 'card', role: 'dialog', 'aria-label': t('UI5 inspector') },
      el('h4', null, d.type || t('Control')),
      el('div', { class: 'mono mut' }, d.id),
      d.view ? el('div', null, el('span', { class: 'mut' }, t('View: ')), el('span', { class: 'mono' }, d.view)) : null,
      d.controller ? el('div', null, el('span', { class: 'mut' }, t('Controller: ')), el('span', { class: 'mono' }, d.controller)) : null,
      d.context ? el('div', null, el('span', { class: 'mut' }, t('Context: ')), el('span', { class: 'mono' }, d.context.path + ' (' + d.context.model.split('.').slice(-2).join('.') + ')')) : null,
      bound.length || other.length ? el('table', null, bound.concat(other).slice(0, 16).map(p =>
        el('tr', null, el('td', { class: 'mono' }, p.name), el('td', { class: 'mono mut' }, p.path ? '{' + p.path + '}' : ''), el('td', { class: 'mono' }, p.value === '' ? t('(empty)') : p.value)))) : null,
      d.aggs.length ? el('div', { class: 'mut', style: 'margin-top:6px' }, t('Aggregations: '), d.aggs.map(a => a.name + ' ← {' + a.path + '}').join(', ')) : null,
      d.context && d.context.object ? el('details', null, el('summary', { style: 'cursor:pointer;margin-top:6px' }, t('Context data')), el('pre', null, d.context.object)) : null,
      el('div', { class: 'a' },
        copyBtn = el('button', { onclick: async () => {
          try { await navigator.clipboard.writeText(SAPC_md(d)); copyBtn.textContent = t('Copied ✓'); } catch (_) { copyBtn.textContent = t('Copy refused'); }
        } }, t('Copy')),
        el('button', { onclick: () => { card.remove(); card = null; if (box) box.hidden = true; } }, t('Close'))));
    shadow.append(card);
  }
  // shared.js is not loaded in every frame: the panel uses SAPC.inspectionMarkdown, the card this small equivalent
  function SAPC_md(d) {
    const L = [t('UI5 control {0} — id {1}', d.type, d.id)];
    if (d.view) L.push(t('View: {0}', d.view));
    if (d.controller) L.push(t('Controller: {0}', d.controller));
    if (d.context) L.push(t('Context: {0} ({1})', d.context.path, d.context.model));
    d.props.forEach(p => L.push(`${p.name}${p.path ? ' ← {' + p.path + '}' : ''} = ${p.value === '' ? t('(empty)') : p.value}`));
    d.aggs.forEach(a => L.push(`${a.name} ← {${a.path}}`));
    if (d.context && d.context.object) L.push(t('Context data:'), d.context.object);
    return L.join('\n');
  }
  let hintEl = null;
  function setMode(on) {
    mode = on;
    if (on) { ensureHost(); hintEl = el('div', { class: 'hint' }, t('Click an element of the application · Esc to cancel')); shadow.append(hintEl); }
    else { if (hintEl) hintEl.remove(); hintEl = null; if (box && !card) box.hidden = true; }
  }
  function select(target) {
    const c = controlFor(target);
    if (!c) return false;
    highlight(c);
    const d = describe(c);
    showCard(d);
    report(d);
    setMode(false);
    return true;
  }

  const wantsInspect = ev => (mode || (altEnabled && ev.altKey && !ev.ctrlKey && !ev.metaKey)) && ui5();
  const block = ev => { if (wantsInspect(ev)) { ev.preventDefault(); ev.stopImmediatePropagation(); } };
  window.addEventListener('mousedown', block, true);
  window.addEventListener('mouseup', block, true);
  window.addEventListener('pointerdown', block, true);
  window.addEventListener('pointerup', block, true);
  window.addEventListener('click', ev => {
    if (!wantsInspect(ev)) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    if (!select(ev.target)) setMode(false);
  }, true);
  window.addEventListener('mousemove', ev => {
    if (!mode) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => highlight(controlFor(ev.target)));
  }, true);
  window.addEventListener('keydown', ev => { if (ev.key === 'Escape' && (mode || card)) { setMode(false); if (card) { card.remove(); card = null; } if (box) box.hidden = true; } }, true);
  window.addEventListener('scroll', () => { if (box && !mode) box.hidden = true; }, true);

})();
