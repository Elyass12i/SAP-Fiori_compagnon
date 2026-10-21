/* Page script: environment banner + OData error notifications. */
(() => {
  'use strict';
  if (window.top !== window) return;
  const { t } = SAPC_I18N;

  let settings = SAPC.withDefaults(null);
  let env = null;
  let host = null, shadow = null, frameEl = null, pillEl = null, toastBox = null;
  let hiddenUntil = 0;
  let simOn = false; // active simulation rules (shown only if the environment allows it)
  const readSim = s => { simOn = !!(s && s.on && Array.isArray(s.rules) && s.rules.some(r => r && r.on !== false && String(r.match || '').trim())); };
  let baseTitle = null, lastHref = location.href;

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    kids.flat(Infinity).forEach(k => { if (k !== null && k !== undefined && k !== false) n.append(k instanceof Node ? k : String(k)); });
    return n;
  }
  const CSS = `
    :host{all:initial}
    .frame{position:fixed;inset:0;border:4px solid var(--c);pointer-events:none;z-index:2147483646;box-sizing:border-box}
    .pill{position:fixed;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:8px;
      font:600 12px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;background:var(--c);padding:4px 6px 4px 12px;
      box-shadow:0 2px 10px rgba(0,0,0,.25);letter-spacing:.02em}
    .pill.top{top:0;border-radius:0 0 8px 8px}.pill.bottom{bottom:0;border-radius:8px 8px 0 0}
    .pill .sim{background:repeating-linear-gradient(135deg,#b71c1c 0 8px,#e53935 8px 16px);color:#fff;border-radius:4px;padding:1px 6px}
    .pill button{all:unset;cursor:pointer;padding:0 6px;border-radius:4px;font-size:13px;line-height:18px}
    .pill button:hover,.pill button:focus-visible{background:rgba(0,0,0,.25)}
    .toasts{position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;max-width:min(440px,calc(100vw - 32px))}
    .toast{font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1b1b1b;background:#fff;border-radius:10px;
      box-shadow:0 8px 28px rgba(0,0,0,.28);border-left:5px solid #c62828;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
    .toast .h{display:flex;gap:8px;align-items:center;font-weight:700}
    .toast .st{background:#c62828;color:#fff;border-radius:5px;padding:1px 6px;font-size:12px}
    .toast .r{font:12px ui-monospace,Consolas,monospace;color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .toast .m{overflow-wrap:anywhere;max-height:5.6em;overflow:auto}
    .toast .hint{color:#555;font-size:12px}
    .toast .a{display:flex;gap:6px;justify-content:flex-end}
    .toast button{all:unset;cursor:pointer;font-size:12px;font-weight:600;padding:4px 9px;border-radius:6px;border:1px solid #ccc}
    .toast button:hover,.toast button:focus-visible{background:#f0f0f0}
    @media (prefers-color-scheme: dark){.toast{background:#242422;color:#f0efec}.toast .r,.toast .hint{color:#b8b6ae}.toast button{border-color:#555}.toast button:hover{background:#333}}
  `;
  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('sapc-compagnon');
    shadow = host.attachShadow({ mode: 'closed' });
    shadow.append(el('style', null, CSS));
    toastBox = el('div', { class: 'toasts', role: 'status' });
    shadow.append(toastBox);
    document.documentElement.append(host);
    frameEl = null; pillEl = null;
  }

  /* Environment banner */
  function applyBanner() {
    env = SAPC.matchEnv(settings.rules, location.href);
    const show = env && Date.now() > hiddenUntil;
    if (!show) {
      if (frameEl) { frameEl.remove(); frameEl = null; }
      if (pillEl) { pillEl.remove(); pillEl = null; }
    } else {
      ensureHost();
      const color = /^#[0-9a-f]{3,8}$/i.test(env.color || '') ? env.color : '#c62828';
      const client = SAPC.sapClientOf(location.href);
      if (!frameEl) { frameEl = el('div', { class: 'frame' }); shadow.append(frameEl); }
      if (pillEl) pillEl.remove();
      pillEl = el('div', { class: 'pill ' + (settings.banner.position === 'bottom' ? 'bottom' : 'top'), role: 'note' },
        el('span', null, String(env.name || t('Environment')) + (client ? ' · client ' + client : '')),
        simOn && env.simulate === true ? el('span', { class: 'sim', title: t('Matching OData requests receive simulated responses (Simulate tab of the extension).') }, t('⚠ ERROR SIMULATION ON')) : null,
        el('button', { title: t('Hide for 30 minutes'), 'aria-label': t('Hide the banner for 30 minutes'), onclick: () => { hiddenUntil = Date.now() + 30 * 60000; applyBanner(); } }, '×'));
      frameEl.style.setProperty('--c', color);
      pillEl.style.setProperty('--c', color);
      shadow.append(pillEl);
    }
    applyTitle();
  }
  let appliedPrefix = '';
  function applyTitle() {
    const prefix = env && settings.banner.titlePrefix ? '[' + String(env.name || '') + '] ' : '';
    if (!prefix && !appliedPrefix) return; // never touch the title of a page that does not match
    const cur = document.title;
    baseTitle = appliedPrefix && cur.startsWith(appliedPrefix) ? cur.slice(appliedPrefix.length) : cur;
    const want = prefix + baseTitle;
    if (cur !== want) document.title = want;
    appliedPrefix = prefix;
  }

  /* Error notifications */
  /* Summary of the page's UI5 application, for the report (null if UI5 is absent from this frame) */
  function appBrief() {
    const w = window.wrappedJSObject; // Firefox; in Chrome the isolated world cannot see the page's objects (see promptFor)
    const safe = fn => { try { return fn(); } catch (_) { return undefined; } };
    const sap = safe(() => w.sap);
    if (!sap || !safe(() => sap.ui.version)) return null;
    const mod = n => safe(() => sap.ui.require(n));
    const toPlain = o => { try { return JSON.parse(w.JSON.stringify(o)); } catch (_) { return null; } };
    const out = { version: String(sap.ui.version), components: [] };
    out.language = String(safe(() => mod('sap/base/i18n/Localization').getLanguage()) || '');
    out.theme = String(safe(() => mod('sap/ui/core/Theming').getTheme()) || '');
    const all = safe(() => mod('sap/ui/core/Component').registry.all());
    if (all) Object.keys(all).forEach(id => {
      const man = toPlain(safe(() => all[id].getManifest()));
      if (!man) return;
      const a = man['sap.app'] || {};
      out.components.push({
        id: a.id || '', type: a.type || '', version: (a.applicationVersion || {}).version || '',
        minUI5: ((man['sap.ui5'] || {}).dependencies || {}).minUI5Version || '',
        dataSources: Object.entries(a.dataSources || {}).map(([k, v]) => ({ name: k, uri: (v && v.uri) || '', odata: (v && v.settings && v.settings.odataVersion) || '' }))
      });
    });
    out.components.sort((x, y) => (x.type === 'application' ? 0 : 1) - (y.type === 'application' ? 0 : 1));
    return out;
  }
  const w0 = !!window.wrappedJSObject; // Firefox Xray access to the page
  const browserName = () => { const u = navigator.userAgent; const m = u.match(/Firefox\/[\d.]+/) || u.match(/Edg\/[\d.]+/) || u.match(/Chrome\/[\d.]+/); return m ? m[0].replace('/', ' ').replace(/^Edg /, 'Edge ') : ''; };
  async function promptFor(rec, others) {
    let app = w0 ? appBrief() : null;
    if (!w0) { try { app = await browser.runtime.sendMessage({ type: 'sapc-probe' }); } catch (_) { app = null; } } // Chrome: read in the page's world
    return SAPC.buildClaudePrompt(rec, { env: env && env.name, pageUrl: location.href, app, browser: browserName(), otherErrors: others || [] });
  }

  function showToast(rec, others) {
    ensureHost();
    while (toastBox.children.length >= 3) toastBox.firstElementChild.remove();
    const msg = rec.error && rec.error.message ? rec.error.message : t('No message in the response.');
    const hint = SAPC.hintsFor(rec.status, rec.error, rec.resHeaders);
    let toast;
    const close = () => { if (toast && toast.isConnected) toast.remove(); };
    toast = el('div', { class: 'toast' },
      el('div', { class: 'h' }, el('span', { class: 'st' }, String(rec.status)), el('span', null, (rec.inBatch ? t('OData error ($batch)') : t('OData error')) + (rec.simulated ? ' · ' + t('simulated') : ''))),
      el('div', { class: 'r', title: rec.url }, `${rec.method} ${rec.service || '?'} / ${rec.resource || '?'}`),
      el('div', { class: 'm' }, msg),
      hint ? el('div', { class: 'hint' }, hint) : null,
      el('div', { class: 'a' },
        el('button', { onclick: ev => copy(promptFor(rec, others), ev.currentTarget) }, t('Copy for Claude')),
        el('button', { onclick: close }, t('Close'))));
    toastBox.append(toast);
    setTimeout(close, 15000);
  }
  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(await text); btn.textContent = t('Copied ✓'); }
    catch (_) { btn.textContent = t('Copy refused: use the panel'); }
  }

  sapcOnMessage(msg => {
    if (msg && msg.type === 'sapc-error' && settings.toasts) showToast(msg.rec, msg.others);
    if (msg && msg.type === 'sapc-env') return Promise.resolve(env ? { name: env.name, color: env.color } : null);
    return undefined;
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) { settings = SAPC.withDefaults(changes.settings.newValue); SAPC_I18N.setLang(settings.lang); applyBanner(); }
    if (area === 'local' && changes.sim) { readSim(changes.sim.newValue); applyBanner(); }
  });

  // Fiori apps change URL (#) and title without reloading the page
  window.addEventListener('hashchange', applyBanner);
  window.addEventListener('popstate', applyBanner);
  setInterval(() => {
    if (location.href !== lastHref) { lastHref = location.href; applyBanner(); }
    else if (env) applyTitle();
  }, 1500);

  browser.storage.local.get(['settings', 'sim']).then(r => { settings = SAPC.withDefaults(r.settings); readSim(r.sim); SAPC_I18N.setLang(settings.lang); applyBanner(); }, () => {});
})();
