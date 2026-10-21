/* Window and sidebar: Application (loading, components, comparison), Errors (+ $metadata),
   OData log, control inspector, error simulation. */
'use strict';

const $ = s => document.querySelector(s);
const main = $('#main');
const TABS = ['app', 'errors', 'log', 'inspect', 'sim'];
let tab = null, settings = SAPC.withDefaults(null), env = null, current = 'app', probeFrames = null;
const isSide = document.body.classList.contains('side'); // sidebar: stays open and follows the active tab
const { t } = SAPC_I18N;

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === false) return;
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  });
  kids.flat(Infinity).forEach(k => { if (k !== null && k !== undefined && k !== false) n.append(k instanceof Node ? k : String(k)); });
  return n;
}
const loc = () => SAPC_I18N.locale();
const fmtTime = ts => new Date(ts).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtMs = ms => ms >= 1000 ? (ms / 1000).toLocaleString(loc(), { maximumFractionDigits: 1 }) + ' s' : Math.round(ms) + ' ms';
const fmtBytes = b => b >= 1048576 ? t('{0} MB', (b / 1048576).toLocaleString(loc(), { maximumFractionDigits: 1 })) : b >= 1024 ? t('{0} KB', Math.round(b / 1024)) : t('{0} B', b);
async function copy(getText, btn) {
  try { await navigator.clipboard.writeText(await getText()); btn.textContent = t('Copied ✓'); }
  catch (_) { btn.textContent = t('Copy refused'); }
  setTimeout(() => { btn.textContent = btn.dataset.label; }, 1600);
}
function copyBtn(label, getText) {
  const b = el('button', { class: 'btn sm', 'data-label': label }, label);
  b.addEventListener('click', () => copy(getText, b));
  return b;
}
const browserName = () => { const u = navigator.userAgent; const m = u.match(/Firefox\/[\d.]+/) || u.match(/Edg\/[\d.]+/) || u.match(/Chrome\/[\d.]+/); return m ? m[0].replace('/', ' ').replace(/^Edg /, 'Edge ') : ''; };
const tryJson = s => { try { return JSON.parse(s); } catch (_) { return null; } };
const statusClass = s => s >= 400 ? '' : s >= 300 || !s ? 'mid' : 'ok';

/* HTTP requests with the user's session: from a same-origin frame (cookies guaranteed),
   otherwise from the extension (host permission). */
async function execFetch(tabId, url, accept) {
  const origin = new URL(url).origin;
  try {
    const res = await browser.scripting.executeScript({
      target: { tabId, allFrames: true }, args: [url, origin, accept],
      func: async (u, o, acc) => {
        if (location.origin !== o) return null;
        try {
          const r = await fetch(u, { credentials: 'include', headers: { Accept: acc }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
          return { status: r.status, lastModified: r.headers.get('last-modified') || '', text: await r.text() };
        } catch (e) { return { error: String(e) }; }
      }
    });
    return res.map(r => r && r.result).find(Boolean) || null;
  } catch (_) { return null; }
}
async function extFetch(url, accept) {
  try {
    const r = await fetch(url, { credentials: 'include', headers: { Accept: accept }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
    return { status: r.status, lastModified: r.headers.get('last-modified') || '', text: await r.text() };
  } catch (e) { return { error: String(e) }; }
}
async function fetchAny(url, accept) {
  const origin = new URL(url).origin;
  if (tab && tab.url && (() => { try { return new URL(tab.url).origin === origin; } catch (_) { return false; } })()) {
    const r = await execFetch(tab.id, url, accept);
    if (r) return r;
  }
  const tabs = await browser.tabs.query({});
  for (const tb of tabs) {
    let o = '';
    try { o = new URL(tb.url).origin; } catch (_) { o = ''; }
    if (o === origin || (tb.id === tab.id)) { const r = await execFetch(tb.id, url, accept); if (r) return r; }
  }
  return extFetch(url, accept);
}

const colorOf = c => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#c62828');
// "Open in" buttons: same page on the system of the other environments (system URL filled in)
function envLinks() {
  if (!tab || !/^https?:/i.test(tab.url || '')) return null;
  const others = settings.rules.filter(r => r.enabled !== false && r.name && /^https?:\/\//i.test(String(r.base || '').trim()) && !(env && r.name === env.name));
  if (!others.length) return null;
  return el('span', { class: 'envs' }, el('span', { class: 'muted' }, t('Open in')), others.map(r => {
    const b = el('button', { class: 'btn sm', title: t('Open this page on {0}', r.name) }, el('span', { class: 'sw', style: `background:${colorOf(r.color)}` }), r.name);
    b.addEventListener('click', () => {
      let url;
      try { url = SAPC.swapEnvUrl(tab.url, r.base, r.client); } catch (_) { return; }
      browser.tabs.create({ url, index: tab.index + 1 });
      if (!isSide) window.close();
    });
    return b;
  }));
}
function renderEnv() {
  const box = $('#env');
  box.replaceChildren();
  if (env) {
    box.append(el('span', { class: 'sw', style: `background:${colorOf(env.color)}` }),
      el('b', null, env.name || t('Environment')),
      el('span', { class: 'muted' }, SAPC.sapClientOf(tab.url) ? 'client ' + SAPC.sapClientOf(tab.url) : t('matched by the rule “{0}”', env.pattern || '')));
  } else {
    const link = el('button', { class: 'btn sm' }, t('Define environments'));
    link.addEventListener('click', () => browser.runtime.openOptionsPage());
    box.append(el('span', { class: 'muted', style: 'flex:1' }, settings.rules.length ? t('No environment matches this page.') : t('No environment defined.')), link);
  }
  box.append(envLinks() || '');
  const bar = $('#simbar');
  bar.hidden = !simActiveHere();
  if (!bar.hidden) {
    const go = el('button', { class: 'btn sm' }, t('Settings'));
    go.addEventListener('click', () => select('sim'));
    bar.replaceChildren(el('span', null, t('⚠ Error simulation is ON for this environment: matching OData requests receive simulated responses.')), go);
  }
}

/* ---------- Errors tab (+ explanation by the $metadata) ---------- */
const metaDocs = new Map();  // service root → parsed $metadata
const metaCache = new Map(); // error id → explanation
async function loadMeta(r) {
  if (metaCache.has(r.id)) return metaCache.get(r.id);
  const root = SAPC.serviceRootOf(r.url);
  if (!root) return { note: t('Service root not found in the URL.') };
  let doc = metaDocs.get(root);
  if (!doc) {
    const res = await fetchAny(SAPC.metadataUrlOf(root), 'application/xml');
    if (!res || res.error) return { note: t('Cannot read the $metadata: {0}.', (res && res.error) || t('no response')) };
    if (res.status >= 400 || !/<(?:[\w-]+:)?Edmx\b/.test(res.text)) return { note: t('The $metadata could not be read (HTTP {0}).', res.status) };
    doc = SAPC.parseMetadata(res.text);
    metaDocs.set(root, doc);
  }
  const type = SAPC.entityTypeFor(doc, r.resource);
  const body = SAPC.parseJsonBody(r.reqBody); // $batch sub-request: its own body
  const issues = type && body ? SAPC.checkValues(type, body, r.method, doc.odataVersion) : [];
  const out = { type, odataVersion: doc.odataVersion, props: SAPC.relevantProps(type, r.error, issues), issues, matches: [] };
  if (!type) {
    out.note = r.inBatch && !r.batchUrl ? t('$batch sub-request: the exact entity is unknown, searching for the fields cited across the whole service.') : t('Entity “{0}” not found in the $metadata.', r.resource);
    const targets = new Set(((r.error && r.error.details) || []).map(d => String(d.target || '').split('/').pop()).filter(Boolean));
    Object.values(doc.types).forEach(ty => targets.forEach(n => { if (ty.props[n]) out.matches.push({ type: ty.name, prop: ty.props[n] }); }));
  }
  metaCache.set(r.id, out);
  return out;
}
function metaBlock(m) {
  const parts = [el('span', { class: 'lbl' }, t('Service metadata'))];
  if (m.note) parts.push(el('div', { class: 'muted' }, m.note));
  if (m.type) {
    parts.push(el('div', null, 'Type ', el('b', { class: 'mono' }, m.type.name), ' (EntitySet ', el('span', { class: 'mono' }, m.type.set), ')', m.type.keys.length ? t(' · key(s) {0}', m.type.keys.join(', ')) : '', m.odataVersion ? ' · OData V' + m.odataVersion : ''));
    if (m.issues.length) parts.push(el('ul', { class: 'ins' }, m.issues.map(i => el('li', { class: i.level === 'error' ? 'bad' : 'warn' }, i.text))));
    else if (m.props.length) parts.push(el('div', { class: 'muted' }, t('No anomaly detected in the values sent.')));
    if (m.props.length) parts.push(el('table', null, el('tbody', null, m.props.map(p => el('tr', null, el('td', { class: 'mono' }, p.name), el('td', null, SAPC.describeProp(p)))))));
    else parts.push(el('div', { class: 'muted' }, t('No specific field is cited by the error.')));
  }
  if (m.matches && m.matches.length) parts.push(el('table', null, el('tbody', null, m.matches.slice(0, 8).map(x => el('tr', null, el('td', { class: 'mono' }, x.type + '.' + x.prop.name), el('td', null, SAPC.describeProp(x.prop)))))));
  return parts;
}

async function renderErrors() {
  const key = 't' + tab.id;
  const recs = (await browser.storage.session.get(key))[key] || [];
  const nErr = recs.filter(r => r.kind === 'error').length;
  $('#tab-errors').textContent = nErr ? t('Errors ({0})', nErr) : t('Errors');
  if (current !== 'errors') return;
  main.replaceChildren();
  if (!recs.length) {
    main.append(el('p', { class: 'empty' }, t('No OData error captured in this tab since it was last loaded. New errors appear here and at the bottom right of the page.')));
    return;
  }
  const clear = el('button', { class: 'btn sm' }, t('Clear'));
  clear.addEventListener('click', async () => { await browser.runtime.sendMessage({ type: 'sapc-clear', tabId: tab.id }); setTimeout(renderErrors, 150); });
  main.append(el('div', { class: 'bar' }, el('span', { class: 'muted' }, t('{0} entry(ies), most recent first', recs.length)), clear));
  recs.forEach((r, i) => main.append(r.kind === 'message' ? messageRec(r) : errorRec(r, i === 0, recs)));
}
function ctxFor(r, recs) {
  const app = (probeFrames || []).find(f => f.ui5) || null;
  return {
    env: env && env.name, pageUrl: tab && tab.url, app, browser: browserName(),
    otherErrors: (recs || []).filter(o => o.kind === 'error' && o.id !== r.id),
    meta: metaCache.get(r.id) || null
  };
}
function errorRec(r, open, recs) {
  const e = r.error || {};
  const det = e.details || [];
  const hint = SAPC.hintsFor(r.status, r.error, r.resHeaders); // computed when displayed: follows the chosen language
  // SAP logs in SAP GUI for HTML (the transaction ID is copied to filter the list)
  const sysBase = SAPC.systemBaseFor(r.url, env);
  const client = SAPC.sapClientOf(r.url) || (env && env.client) || '';
  const logBtn = tcode => {
    const b = el('button', { class: 'btn sm', disabled: !sysBase, title: sysBase ? t('Open {0} in SAP GUI for HTML', tcode) + (e.transactionId ? t(' (the transaction ID is copied to the clipboard)') : '') : t('Fill in the system URL of this environment in the options to open the SAP logs.') }, tcode);
    b.addEventListener('click', async () => {
      if (e.transactionId) { try { await navigator.clipboard.writeText(e.transactionId); } catch (_) { /* copy refused */ } }
      browser.tabs.create({ url: SAPC.sapGuiUrl(sysBase, tcode, client), index: tab.index + 1 });
    });
    return b;
  };
  const metaBox = el('div', { class: 'meta-box' }, el('span', { class: 'muted' }, t('Reading the $metadata…')));
  let metaStarted = false;
  const startMeta = () => {
    if (metaStarted) return;
    metaStarted = true;
    loadMeta(r).then(m => metaBox.replaceChildren(...metaBlock(m)), () => metaBox.replaceChildren(el('span', { class: 'muted' }, t('Cannot read the $metadata.'))));
  };
  const body = el('div', { class: 'body' },
    el('dl', { class: 'kv' },
      el('dt', null, 'URL'), el('dd', { class: 'mono' }, r.url),
      r.batchUrl ? [el('dt', null, '$batch'), el('dd', { class: 'mono' }, r.batchUrl, r.changeset ? el('div', { class: 'muted' }, t('Changeset rejected: this error applies to all its requests.')) : null)] : null,
      e.code ? [el('dt', null, 'Code'), el('dd', { class: 'mono' }, e.code)] : null,
      e.transactionId ? [el('dt', null, 'Transaction'), el('dd', { class: 'mono' }, e.transactionId, ' ', copyBtn(t('copy'), () => e.transactionId))] : null,
      e.service ? [el('dt', null, t('SAP service')), el('dd', { class: 'mono' }, e.service)] : null,
      el('dt', null, t('Time')), el('dd', null, fmtTime(r.time))),
    r.simulated ? el('div', { class: 'hint sim' }, r.inBatch ? t('Simulated error: the $batch was sent, then this sub-response was replaced by the extension.') : t('Simulated error: produced by the extension, the request did not reach the backend.')) : null,
    hint && !r.simulated ? el('div', { class: 'hint' }, hint) : null,
    det.length ? el('table', null,
      el('thead', null, el('tr', null, el('th', null, t('Severity')), el('th', null, 'Code'), el('th', null, 'Message'), el('th', null, t('Field')))),
      el('tbody', null, det.map(d => el('tr', null, el('td', null, d.severity || ''), el('td', { class: 'mono' }, d.code || ''), el('td', null, d.message || ''), el('td', { class: 'mono' }, d.target || ''))))) : null,
    metaBox,
    r.reqBody ? el('details', null, el('summary', { style: 'cursor:pointer' }, t('Body sent')), el('pre', null, r.reqBody)) : null,
    el('details', null, el('summary', { style: 'cursor:pointer' }, t('Raw response')), el('pre', null, r.body || t('(empty)'))),
    el('div', { class: 'acts' },
      copyBtn(t('Copy for Claude'), async () => { await loadMeta(r).catch(() => null); return SAPC.buildClaudePrompt(r, ctxFor(r, recs)); }),
      copyBtn(t('Copy URL'), () => r.url),
      r.simulated ? null : [logBtn('/IWFND/ERROR_LOG'), logBtn('/IWBEP/ERROR_LOG')]));
  const d = el('details', { class: 'rec', open },
    el('summary', null,
      el('span', { class: 'st' }, String(r.status)),
      el('span', { class: 'res', title: r.url }, `${r.method} ${r.service || '?'} / ${r.resource}`),
      el('span', { class: 'muted' }, fmtTime(r.time) + (r.inBatch ? ' · $batch' : ''), r.simulated ? el('span', { class: 'chip sim' }, t('simulated')) : null),
      el('span', { class: 'msg' }, e.message || t('No message in the response.'))),
    body);
  d.addEventListener('toggle', () => { if (d.open) startMeta(); });
  if (open) startMeta();
  return d;
}
function messageRec(r) {
  return el('details', { class: 'rec' },
    el('summary', null,
      el('span', { class: 'st info' }, 'msg'),
      el('span', { class: 'res', title: r.url }, `${r.method} ${r.service || '?'} / ${r.resource}`),
      el('span', { class: 'muted' }, fmtTime(r.time)),
      el('span', { class: 'msg' }, r.messages.map(m => m.message).join(' · '))),
    el('div', { class: 'body' }, el('table', null, el('tbody', null, r.messages.map(m => el('tr', null, el('td', null, m.severity || ''), el('td', { class: 'mono' }, m.code || ''), el('td', null, m.message || ''), el('td', { class: 'mono' }, m.target || '')))))));
}

/* ---------- OData log tab ---------- */
const logState = { filter: '', errOnly: false, open: new Set(), replays: new Map() };
const readLog = async () => { const key = 'l' + tab.id; return (await browser.storage.session.get(key))[key] || []; };
function filterLog(list) {
  const q = logState.filter.trim().toLowerCase();
  return list.filter(e => (!logState.errOnly || e.errors) && (!q || [e.method, e.url, e.service, e.resource, String(e.status)].join(' ').toLowerCase().includes(q)));
}
async function renderLog() {
  const key = 'l' + tab.id;
  const list = (await browser.storage.session.get(key))[key] || [];
  $('#tab-log').textContent = list.length ? t('Log ({0})', list.length) : t('Log');
  if (current !== 'log') return;
  if (!$('#log-list')) {
    const input = el('input', { type: 'text', id: 'log-q', placeholder: t('Filter: service, entity, status, $filter…'), value: logState.filter, style: 'flex:1;min-width:140px' });
    input.addEventListener('input', () => { logState.filter = input.value; renderLog(); });
    const errOnly = el('input', { type: 'checkbox', id: 'log-err', checked: logState.errOnly });
    errOnly.addEventListener('change', () => { logState.errOnly = errOnly.checked; renderLog(); });
    const clear = el('button', { class: 'btn sm' }, t('Clear'));
    clear.addEventListener('click', async () => { await browser.runtime.sendMessage({ type: 'sapc-clear-log', tabId: tab.id }); renderLog(); });
    // Export: displayed list (filter applied); Markdown without bodies, JSON with body excerpts
    const exportCtx = () => { let host = ''; try { host = new URL(tab.url).host; } catch (_) { host = ''; } return { host, env: env && env.name, pageUrl: tab.url, now: Date.now(), version: browser.runtime.getManifest().version }; };
    const saveJson = el('button', { class: 'btn sm', title: t('The JSON file contains excerpts of the request and response bodies (business data possible).') }, t('Save (JSON)'));
    saveJson.addEventListener('click', async () => {
      const ctx = exportCtx();
      const blob = new Blob([SAPC.logJson(filterLog(await readLog()), ctx)], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob), download: `odata-log-${ctx.host.replace(/[^\w.-]/g, '_') || 'page'}-${new Date(ctx.now).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    });
    main.replaceChildren(
      el('div', { class: 'bar' }, input, el('label', { class: 'muted', style: 'display:flex;gap:4px;align-items:center' }, errOnly, t('Errors')), clear),
      el('div', { class: 'acts', style: 'margin-bottom:8px' }, copyBtn(t('Copy log (Markdown)'), async () => SAPC.logMarkdown(filterLog(await readLog()), exportCtx())), saveJson),
      el('div', { id: 'log-sum', class: 'muted', style: 'margin-bottom:8px' }),
      el('div', { id: 'log-list' }));
  }
  const shown = filterLog(list);
  const ms = list.map(e => e.ms).sort((a, b) => a - b);
  $('#log-sum').textContent = list.length
    ? t('{0} request(s) · {1} failed · median {2} · {3} > 1 s', list.length, list.filter(e => e.errors).length, fmtMs(ms[Math.floor((ms.length - 1) / 2)] || 0), list.filter(e => e.ms > 1000).length) + (shown.length !== list.length ? t(' · {0} shown', shown.length) : '')
    : '';
  const box = $('#log-list');
  box.replaceChildren();
  if (!list.length) { box.append(el('p', { class: 'empty' }, t('No OData request recorded in this tab since it was last loaded.'))); return; }
  shown.forEach(e => box.append(logRow(e)));
}
function logRow(e) {
  let params = [];
  try { params = [...new URL(e.url).searchParams.entries()]; } catch (_) { params = []; }
  const replayOut = el('div');
  const prev = logState.replays.get(e.id);
  if (prev) replayOut.append(prev);
  const acts = [];
  if (/^GET$/i.test(e.method) && !e.batch) {
    const b = el('button', { class: 'btn sm' }, t('Replay'));
    b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = t('Sending…');
      const t0 = performance.now();
      const r = await fetchAny(e.url, 'application/json');
      const node = r && !r.error
        ? el('div', null, el('div', { class: 'muted' }, t('Replayed: HTTP {0} in {1}', r.status, fmtMs(performance.now() - t0))), el('pre', null, prettyText(r.text).slice(0, 6000)))
        : el('div', { class: 'muted' }, t('Failed: {0}', (r && r.error) || t('no response')));
      logState.replays.set(e.id, node);
      replayOut.replaceChildren(node);
      b.disabled = false; b.textContent = t('Replay');
    });
    acts.push(b);
  }
  acts.push(copyBtn(t('Copy as curl'), () => SAPC.curlFor(e)), copyBtn(t('Copy URL'), () => e.url));
  if (simAllowedHere() && !e.simulated) {
    const s = el('button', { class: 'btn sm', title: t('Create an error simulation rule for this request') }, t('Simulate an error'));
    s.addEventListener('click', () => {
      const sub = e.batch && e.subs.length ? (e.subs.find(x => x.status >= 400) || e.subs[0]) : null;
      const target = sub ? String(sub.path).split('?')[0] : String(e.resource || '');
      addSimRule({ match: target.replace(/\(.*$/, '') || e.service, method: sub ? sub.method : e.method });
      select('sim');
    });
    acts.push(s);
  }
  const d = el('details', { class: 'rec', open: logState.open.has(e.id) },
    el('summary', null,
      el('span', { class: 'st ' + (e.errors ? '' : statusClass(e.status)) }, String(e.status || '—')),
      el('span', { class: 'res', title: e.url }, `${e.method} ${e.service || '?'} / ${e.resource}`),
      el('span', { class: 'muted' }, `${fmtMs(e.ms)} · ${fmtBytes(e.size)}`, e.simulated ? el('span', { class: 'chip sim' }, t('simulated')) : null),
      el('span', { class: 'msg' }, fmtTime(e.time) + (e.batch ? t(' · $batch of {0} request(s)', e.subs.length) + (e.errors ? t(', {0} failed', e.errors) : '') : ''))),
    el('div', { class: 'body' },
      el('div', { class: 'mono' }, e.url),
      params.length ? el('table', null, el('tbody', null, params.map(([k, v]) => el('tr', null, el('td', { class: 'mono' }, k), el('td', { class: 'mono' }, v))))) : null,
      e.parts && e.parts.length ? batchView(e)
        : e.subs.length ? [el('span', { class: 'lbl' }, t('$batch sub-requests')), el('table', null, el('tbody', null, e.subs.map(s => el('tr', null,
          el('td', null, el('span', { class: 'st ' + statusClass(s.status) }, s.status ? String(s.status) : '?')), el('td', { class: 'mono' }, s.method), el('td', { class: 'mono' }, s.path)))))] : null,
      e.reqBody ? el('details', null, el('summary', { style: 'cursor:pointer' }, t('Body sent')), el('pre', null, prettyText(e.reqBody))) : null,
      e.resBody ? el('details', null, el('summary', { style: 'cursor:pointer' }, t('Response (excerpt)')), el('pre', null, prettyText(e.resBody))) : null,
      el('div', { class: 'acts' }, acts),
      replayOut));
  d.addEventListener('toggle', () => { if (d.open) logState.open.add(e.id); else logState.open.delete(e.id); });
  return d;
}
/* $batch details: one expandable row per sub-request (body sent, response, decoded SAP error) */
function batchView(e) {
  const headers = h => { const k = Object.keys(h || {}); return k.length ? el('div', { class: 'mono muted' }, k.map(x => el('div', null, x + ': ' + h[x]))) : null; };
  return [
    el('div', { class: 'bar', style: 'margin:0' }, el('span', { class: 'lbl' }, t('$batch sub-requests ({0})', e.parts.length)), copyBtn(t('Copy $batch (Markdown)'), () => SAPC.batchMarkdown(e))),
    el('div', { class: 'parts' }, e.parts.map((p, i) => {
      const err = p.status >= 400 ? SAPC.parseODataError(p.resBody) : null;
      return el('details', { class: 'part' },
        el('summary', null,
          el('span', { class: 'st ' + statusClass(p.status) }, p.status ? String(p.status) : '?'),
          el('span', { class: 'res' }, `${i + 1}. ${p.method} ${p.path}`),
          p.changeset ? el('span', { class: 'chip' }, 'changeset') : el('span')),
        el('div', { class: 'body' },
          p.changesetError ? el('div', { class: 'hint' }, t('Changeset rejected: this error applies to all its requests.')) : null,
          err && err.message ? el('div', { class: 'hint' }, el('b', null, err.code ? err.code + ' — ' : ''), err.message,
            (err.details || []).length ? el('ul', { style: 'margin:4px 0 0;padding-left:18px' }, err.details.map(d => el('li', null, d.message + (d.target ? ' (' + d.target + ')' : '')))) : null) : null,
          el('div', { class: 'mono' }, p.method + ' ' + p.path), headers(p.reqHeaders),
          p.reqBody ? [el('span', { class: 'lbl' }, t('Body sent')), el('pre', null, prettyText(p.reqBody))] : null,
          el('span', { class: 'lbl' }, t('Response') + (p.status ? ` · HTTP ${p.status} ${p.statusText || ''}` : '')), headers(p.resHeaders),
          p.resBody ? el('pre', null, prettyText(p.resBody)) : el('div', { class: 'muted' }, t('(empty)'))));
    }))];
}
function prettyText(text) {
  const s = String(text || '').trim();
  if (s.startsWith('{') || s.startsWith('[')) { const j = tryJson(s); if (j) return JSON.stringify(j, null, 2); }
  return s;
}

/* ---------- Inspector tab ---------- */
async function renderInspect() {
  if (current !== 'inspect') return;
  const key = 'i' + tab.id;
  const d = (await browser.storage.session.get(key))[key];
  const start = el('button', { class: 'btn primary' }, t('Inspect an element'));
  start.addEventListener('click', async () => {
    await browser.tabs.sendMessage(tab.id, { type: 'sapc-inspect-start' }).catch(() => {});
    if (!isSide) window.close();
    else start.textContent = t('Click an element in the page…');
  });
  main.replaceChildren(
    el('div', { class: 'bar' }, start, el('span', { class: 'muted', style: 'flex:1' }, settings.inspectAlt ? t('or Alt+click directly in the application') : '')),
    d ? inspectionView(d) : el('p', { class: 'empty' }, t('No control inspected in this tab. Start the inspection, then click a field, a button or a table row of the application.')));
}
function inspectionView(d) {
  const bound = (d.props || []).filter(p => p.path), other = (d.props || []).filter(p => !p.path);
  const shown = v => (v === '' ? t('(empty)') : v);
  return el('div', { class: 'comp' },
    el('div', { class: 'bar', style: 'margin:0' }, el('b', null, d.type || t('Control')), el('span', { class: 'muted' }, fmtTime(d.time))),
    el('dl', { class: 'kv' },
      el('dt', null, 'Id'), el('dd', { class: 'mono' }, d.id),
      d.view ? [el('dt', null, t('View')), el('dd', { class: 'mono' }, d.view)] : null,
      d.controller ? [el('dt', null, t('Controller')), el('dd', { class: 'mono' }, d.controller)] : null,
      d.context ? [el('dt', null, t('Context')), el('dd', { class: 'mono' }, d.context.path, el('div', { class: 'muted' }, d.context.model + (d.context.serviceUrl ? ' · ' + d.context.serviceUrl : '')))] : null,
      el('dt', null, 'SAPUI5'), el('dd', null, d.ui5 || '—')),
    bound.length ? [el('h3', null, t('Bound properties')), el('table', null, el('thead', null, el('tr', null, el('th', null, t('Property')), el('th', null, 'Binding'), el('th', null, t('Value')))),
      el('tbody', null, bound.map(p => el('tr', null, el('td', { class: 'mono' }, p.name), el('td', { class: 'mono' }, '{' + p.path + '}'), el('td', { class: 'mono' }, shown(p.value))))))] : el('p', { class: 'muted' }, t('No property bound to the model.')),
    other.length ? [el('h3', null, t('Other properties')), el('table', null, el('tbody', null, other.map(p => el('tr', null, el('td', { class: 'mono' }, p.name), el('td', { class: 'mono' }, shown(p.value))))))] : null,
    (d.aggs || []).length ? [el('h3', null, t('Bound aggregations')), el('div', { class: 'mono' }, d.aggs.map(a => el('div', null, `${a.name} ← {${a.path}}`)))] : null,
    d.context && d.context.object ? el('details', null, el('summary', { style: 'cursor:pointer' }, t('Context data')), el('pre', null, d.context.object)) : null,
    el('div', { class: 'acts' }, copyBtn(t('Copy (Markdown)'), () => SAPC.inspectionMarkdown(d))));
}

/* ---------- Application tab ---------- */
async function renderApp() {
  main.replaceChildren(el('p', { class: 'empty' }, t('Reading the page…')));
  let results = [];
  try {
    // Chrome: the page's world (its isolated world cannot see UI5); Firefox: isolated world + wrappedJSObject
    results = await browser.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['probe.js'], world: SAPC_ENV.pageWorld });
  } catch (e) {
    if (current === 'app') main.replaceChildren(el('p', { class: 'empty' }, t('Cannot read this page (internal Firefox page or access denied).')));
    return;
  }
  const all = results.map(r => r && r.result).filter(Boolean);
  probeFrames = all;
  if (current !== 'app') return;
  const frames = all.filter(x => x.ui5);
  main.replaceChildren();
  const again = el('button', { class: 'btn sm' }, t('Refresh'));
  again.addEventListener('click', renderApp);
  let host = '';
  try { host = new URL(tab.url).host; } catch (_) { host = ''; }
  main.append(el('div', { class: 'bar' }, el('span', { class: 'muted' }, host ? t('Tab: {0}', host) : ''), again));
  if (!frames.length) {
    const top = all.find(f => f.top);
    if (top && top.perf) main.append(perfSection(top.perf));
    main.append(el('p', { class: 'empty' }, t('SAPUI5 is not detected on this page. If the application has just opened, wait until it has finished loading, then reopen this panel.')));
    return;
  }
  frames.forEach(f => {
    if (f.perf) main.append(perfSection(f.perf));
    main.append(el('section', { style: 'margin-bottom:12px' },
      el('div', { class: 'bar' }, el('h2', null, f.top ? t('Main page') : t('Embedded frame')), el('span', { class: 'mono muted', title: f.frameUrl }, new URL(f.frameUrl).host)),
      el('dl', { class: 'kv' },
        el('dt', null, t('UI5 version')), el('dd', null, el('b', null, f.version), f.buildTime ? el('span', { class: 'muted' }, ' · build ' + f.buildTime) : null),
        el('dt', null, t('Theme')), el('dd', null, f.theme || '—'),
        el('dt', null, t('Language')), el('dd', null, f.language || '—'),
        el('dt', null, 'Bootstrap'), el('dd', { class: 'mono' }, f.bootstrap || '—', f.cacheTokenInBootstrap ? el('span', { class: 'chip' }, t('cache token')) : null)),
      f.registryUnavailable ? el('p', { class: 'muted' }, t('The component list is not accessible with this UI5 version.')) : null,
      f.components.length ? f.components.map(c => componentCard(c, f)) : el('p', { class: 'muted' }, t('No component loaded.')),
      i18nSection(f)));
  });
  main.append(userSection(frames));
}
/* Loading section: browser measurements for this frame */
function shortName(url) {
  try { const u = new URL(url); const segs = u.pathname.split('/').filter(Boolean); return '…/' + segs.slice(-2).join('/') + (u.search ? '?' + u.search.slice(1, 40) : ''); }
  catch (_) { return String(url).slice(-60); }
}
function perfSection(perf) {
  const st = SAPC.perfStats(perf);
  const tile = (v, l, title) => el('div', { class: 'tile', title }, el('div', { class: 'v' }, v), el('div', { class: 'l' }, l));
  const maxMs = Math.max(1, ...st.slowest.map(s => s.ms));
  return el('section', { style: 'margin-bottom:12px' },
    el('div', { class: 'bar', style: 'margin:0' }, el('h3', { style: 'margin:0 0 6px' }, t('Loading')), el('span', { class: 'muted', style: 'font-size:11px' }, t('measured {0} after the page opened', fmtMs(perf.now || 0)))),
    el('div', { class: 'tiles' },
      tile(st.loadMs ? fmtMs(st.loadMs) : '—', t('page loaded'), t('End of the load event (Navigation Timing)')),
      tile(st.lastResourceMs ? fmtMs(st.lastResourceMs) : '—', t('last resource'), t('End of the last resource received, OData included')),
      tile(String(st.count), t('requests · {0}', fmtBytes(st.bytes)), t('Number of resources and bytes transferred over the network')),
      tile(st.measured ? Math.round(st.cached / st.measured * 100) + ' %' : '—', t('from cache'), t('Resources served by the browser cache (0 bytes transferred)'))),
    el('div', { class: 'tiles' },
      tile(st.ttfbMs ? fmtMs(st.ttfbMs) : '—', t('1st byte (TTFB)'), t('Delay before the first byte of the page')),
      tile(st.domReadyMs ? fmtMs(st.domReadyMs) : '—', t('DOM ready'), t('End of DOMContentLoaded')),
      tile(String(st.odata.count), 'OData' + (st.odata.batch ? ' · ' + st.odata.batch + ' $batch' : ''), t('OData requests of this frame')),
      tile(st.odata.count ? fmtMs(st.odata.medianMs) : '—', t('OData median') + (st.odata.count ? ' · max ' + fmtMs(st.odata.maxMs) : ''), t('Median and maximum duration of OData requests'))),
    st.insights.length ? el('ul', { class: 'ins' }, st.insights.map(i => el('li', { class: i.warn ? 'warn' : '' }, i.text))) : null,
    st.categories.length ? el('table', null,
      el('thead', null, el('tr', null, el('th', null, 'Type'), el('th', null, t('Count')), el('th', null, t('Transferred')), el('th', null, 'Cache'), el('th', null, t('Slowest')))),
      el('tbody', null, st.categories.map(c => el('tr', null, el('td', null, c.label), el('td', null, String(c.count)), el('td', null, fmtBytes(c.bytes)), el('td', null, String(c.cached)), el('td', null, fmtMs(c.maxMs)))))) : null,
    st.slowest.length ? [el('h3', null, t('Slowest resources')),
      el('div', { class: 'slow' }, st.slowest.map(s => [
        el('span', { class: 'n', title: s.name }, shortName(s.name)),
        el('div', null, el('div', { class: 'b' + (s.odata ? ' od' : ''), style: `width:${Math.max(2, s.ms / maxMs * 100).toFixed(1)}%` })),
        el('span', { class: 't' }, fmtMs(s.ms))]))] : null);
}

function componentCard(c, f) {
  const served = c.served;
  const cmpOut = el('div');
  const cmpBtn = el('button', { class: 'btn sm' }, t('Compare environments'));
  cmpBtn.addEventListener('click', () => compareEnvs(c, f, cmpOut, cmpBtn));
  return el('div', { class: 'comp' },
    el('div', { class: 'bar', style: 'margin:0' }, el('b', { class: 'mono' }, c.id || t('(no id)')), el('span', { class: 'chip' }, c.type || 'type ?')),
    el('dl', { class: 'kv' },
      c.title ? [el('dt', null, t('Title')), el('dd', null, c.title)] : null,
      el('dt', null, t('App version')), el('dd', null, el('b', null, c.version || '—')),
      c.minUI5 ? [el('dt', null, t('Minimum UI5')), el('dd', null, c.minUI5)] : null,
      el('dt', null, t('Manifest')), el('dd', { class: 'mono' }, c.manifestUrl || '—', c.cacheToken ? el('span', { class: 'chip' }, t('cache token')) : null),
      served ? [el('dt', null, t('Served by the server')), el('dd', null,
        `HTTP ${served.status}`, served.lastModified ? t(' · modified {0}', new Date(served.lastModified).toLocaleString(loc())) : '',
        served.etag ? el('div', { class: 'mono muted' }, 'ETag ' + served.etag) : null,
        served.cacheControl ? el('div', { class: 'mono muted' }, 'Cache-Control ' + served.cacheControl) : null)] : null,
      c.dataSources.length ? [el('dt', null, t('OData sources')), el('dd', null, c.dataSources.map(d => el('div', { class: 'mono' }, `${d.name} → ${d.uri}${d.odata ? ' (V' + d.odata.replace(/\.0$/, '') + ')' : ''}`)))] : null),
    c.manifestUrl && c.type === 'application' ? [el('div', { class: 'acts' }, cmpBtn), cmpOut] : null);
}

/* ---------- Missing i18n texts ---------- */
function i18nSection(f) {
  const r = f.i18n;
  if (!r) return null;
  const head = el('div', { class: 'bar', style: 'margin:10px 0 4px' }, el('h3', { style: 'margin:0' }, t('i18n texts')),
    r.unavailable ? null : el('span', { class: 'muted' }, t('{0} bound text(s) checked', r.checked)));
  if (r.unavailable && !r.raw.length) return el('div', null, head, el('p', { class: 'muted' }, t('The control list is not accessible with this UI5 version.')));
  if (!r.missing.length && !r.raw.length) return el('div', null, head, el('ul', { class: 'ins' }, el('li', null, t('No missing text detected.'))));
  return el('div', null, head,
    r.missing.length ? el('table', null,
      el('thead', null, el('tr', null, el('th', null, t('Missing key')), el('th', null, t('Control')), el('th', null, t('Property')))),
      el('tbody', null, r.missing.map(m => el('tr', null, el('td', { class: 'mono' }, (m.model ? m.model + '>' : '') + m.key), el('td', { class: 'mono' }, m.control + ' #' + m.id), el('td', { class: 'mono' }, m.prop))))) : null,
    r.raw.length ? el('div', { class: 'hint', style: 'margin-top:6px' }, t('Bindings displayed as raw text in the page (model name or syntax error?): '), el('span', { class: 'mono' }, r.raw.join('  '))) : null,
    el('div', { class: 'acts', style: 'margin-top:6px' }, copyBtn(t('Copy (Markdown)'), () => SAPC.i18nMarkdown([f]))));
}

/* ---------- Users (launchpad, BTP, SAP) ---------- */
function userSection(frames) {
  const box = el('div');
  const lp = frames.find(f => f.user && (f.user.id || f.user.email));
  const btn = el('button', { class: 'btn sm', title: t('Queries /user-api/currentUser (BTP application router) and /sap/bc/ui2/start_up (ABAP) with your session.') }, t('Look up BTP / SAP users'));
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    box.replaceChildren(el('p', { class: 'muted' }, t('Looking up…')));
    const urls = frames.flatMap(f => f.components.map(c => c.manifestUrl).filter(Boolean));
    let res = [];
    try { res = await browser.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, args: [urls], func: whoAmI, world: SAPC_ENV.pageWorld }); } catch (_) { res = []; }
    const found = res.map(x => x && x.result).filter(Boolean).flatMap(x => x.results);
    box.replaceChildren(found.length ? el('table', null, el('tbody', null, found.map(userRow))) : el('p', { class: 'muted' }, t('Nothing found.')),
      el('p', { class: 'muted', style: 'margin:6px 0 0' }, t('The BTP user is the person signed in; the SAP backend may still use a technical user for the OData calls.')));
    btn.disabled = false;
  });
  return el('section', { style: 'margin-bottom:12px' },
    el('div', { class: 'bar', style: 'margin:0 0 6px' }, el('h3', { style: 'margin:0' }, t('Signed-in user')), btn),
    lp ? el('dl', { class: 'kv' }, el('dt', null, t('Launchpad')), el('dd', null, [lp.user.name, lp.user.email, lp.user.id].filter(Boolean).join(' · '))) : el('p', { class: 'muted', style: 'margin:0' }, t('No launchpad user (the page is not running in a launchpad).')),
    box);
}
function userRow(x) {
  const d = x.data || {};
  const pick = ['displayName', 'fullName', 'firstname', 'lastname', 'name', 'id', 'email', 'Email', 'Id'].filter(k => typeof d[k] === 'string' && d[k]).map(k => d[k]);
  const label = x.kind === 'approuter' ? t('BTP user (application router)') : t('SAP user (ABAP start_up)');
  const state = !x.status ? t('unreachable') : x.status >= 400 ? 'HTTP ' + x.status : !x.data ? t('no JSON (login page or route not configured)') : '';
  return el('tr', null, el('td', null, label, el('div', { class: 'mono muted' }, x.url)), el('td', null, pick.length ? [...new Set(pick)].join(' · ') : el('span', { class: 'muted' }, state || '—')));
}
// Runs in every frame of the tab (with the user's session)
async function whoAmI(manifestUrls) {
  const w = window.wrappedJSObject || window; // Firefox isolated world / Chrome page world
  if (!w || !w.sap) return null;
  const results = [];
  const get = async (url, kind) => {
    try {
      const r = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
      const text = await r.text();
      let data = null;
      try { const j = JSON.parse(text); data = j && typeof j === 'object' ? j : null; } catch (_) { data = null; }
      results.push({ kind, url, status: r.status, data });
    } catch (_) { results.push({ kind, url, status: 0, data: null }); }
  };
  const cands = new Set([location.origin + '/user-api/currentUser']);
  (manifestUrls || []).forEach(u => { try { if (new URL(u).origin === location.origin) cands.add(new URL('user-api/currentUser', u).href); } catch (_) { /* invalid URL */ } });
  for (const u of cands) await get(u, 'approuter');
  if (/\/sap\/bc\//i.test(location.pathname)) {
    const client = new URL(location.href).searchParams.get('sap-client');
    await get(location.origin + '/sap/bc/ui2/start_up' + (client ? '?sap-client=' + encodeURIComponent(client) : ''), 'abap');
  }
  return { frameUrl: location.href, results };
}

/* ---------- Error simulation tab ---------- */
let sim = { on: false, rules: [] };
const simAllowedHere = () => !!(env && env.simulate === true);
const simActiveHere = () => simAllowedHere() && sim.on && sim.rules.some(r => r.on !== false && String(r.match || '').trim());
let simTimer = 0;
function saveSim(now) {
  clearTimeout(simTimer);
  renderEnv(); // the alert bar follows the state of the rules
  const go = () => browser.storage.local.set({ sim: JSON.parse(JSON.stringify(sim)) });
  if (now) go(); else simTimer = setTimeout(go, 350);
}
function addSimRule(o) {
  sim.rules.push(Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), on: true, match: '', method: 'ANY', kind: 'http', status: 400, message: t('Simulated error'), target: '', delay: 300, once: false }, o || {}));
  sim.on = true;
  saveSim(true);
}
const SIM_STATUSES = [400, 401, 403, 404, 409, 412, 500, 502, 503, 504];
function renderSim() {
  if (current !== 'sim') return;
  const allowed = simAllowedHere();
  const master = el('input', { type: 'checkbox', checked: sim.on });
  master.addEventListener('change', () => { sim.on = master.checked; saveSim(true); renderEnv(); });
  const add = el('button', { class: 'btn sm' }, t('Add a rule'));
  add.addEventListener('click', () => { addSimRule(); renderSim(); });
  const opts = el('button', { class: 'btn sm' }, t('Open the options'));
  opts.addEventListener('click', () => browser.runtime.openOptionsPage());
  main.replaceChildren(...[ // replaceChildren ignores neither null nor arrays: flatten and filter
    allowed ? null : el('div', { class: 'hint', style: 'margin-bottom:8px' },
      env ? t('Error simulation is not allowed on {0}. Allow it for this environment in the options (column “Sim.”): it is meant for development systems only.', env.name)
        : t('This page matches no environment. Error simulation only works on environments where it is allowed in the options (column “Sim.”).'), ' ', opts),
    el('div', { class: 'bar' }, el('label', { style: 'display:flex;gap:6px;align-items:center;font-weight:600' }, master, t('Simulation on')), add),
    el('p', { class: 'muted', style: 'margin:0 0 8px' }, t('OData requests matching an active rule get a simulated response. Errors are produced in the page: the request never reaches the backend. Exceptions: a read-only $batch is sent and only the targeted sub-response is replaced; a $batch containing changes is answered entirely with the error; “Delay” sends the real request and delays its response. Simulation is switched off when Firefox starts.')),
    sim.rules.length ? sim.rules.map(simRuleCard) : el('p', { class: 'empty' }, t('No rule. Add one, or use “Simulate an error” on a request in the Log tab.'))
  ].flat().filter(Boolean));
}
function simRuleCard(r) {
  const save = () => { saveSim(); };
  const on = el('input', { type: 'checkbox', checked: r.on !== false, 'aria-label': t('Rule enabled') });
  on.addEventListener('change', () => { r.on = on.checked; saveSim(true); renderEnv(); });
  const match = el('input', { type: 'text', class: 'mono', value: r.match || '', placeholder: t('URL contains (e.g. CartSet) or /regex/'), style: 'flex:1;min-width:120px' });
  match.addEventListener('input', () => { r.match = match.value; save(); });
  const method = el('select', { 'aria-label': t('Method') }, ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'MERGE', 'DELETE'].map(m => el('option', { value: m }, m === 'ANY' ? t('Any method') : m)));
  method.value = r.method || 'ANY';
  method.addEventListener('change', () => { r.method = method.value; saveSim(true); });
  const kind = el('select', { 'aria-label': t('Response') },
    SIM_STATUSES.map(s => el('option', { value: 'http:' + s }, 'HTTP ' + s)), el('option', { value: 'network' }, t('Network error')), el('option', { value: 'delay' }, t('Delay only')));
  kind.value = r.kind === 'http' ? 'http:' + (r.status || 400) : r.kind;
  kind.addEventListener('change', () => {
    if (kind.value.startsWith('http:')) { r.kind = 'http'; r.status = +kind.value.slice(5); } else r.kind = kind.value;
    if (r.kind === 'delay' && (r.delay || 0) < 1000) r.delay = 3000;
    saveSim(true); renderSim();
  });
  const delay = el('input', { type: 'number', min: '0', max: '120000', step: '100', value: String(r.delay || 0), style: 'width:80px', 'aria-label': t('Delay (ms)') });
  delay.addEventListener('input', () => { r.delay = Math.max(0, Math.min(120000, +delay.value || 0)); save(); });
  const once = el('input', { type: 'checkbox', checked: !!r.once });
  once.addEventListener('change', () => { r.once = once.checked; saveSim(true); });
  const del = el('button', { class: 'btn sm', title: t('Delete the rule'), 'aria-label': t('Delete the rule') }, '✕');
  del.addEventListener('click', () => { sim.rules = sim.rules.filter(x => x !== r); saveSim(true); renderSim(); renderEnv(); });
  const msg = el('input', { type: 'text', value: r.message || '', placeholder: t('Error message'), style: 'flex:1;min-width:120px' });
  msg.addEventListener('input', () => { r.message = msg.value; save(); });
  const target = el('input', { type: 'text', class: 'mono', value: r.target || '', placeholder: t('Field (optional)'), style: 'width:120px' });
  target.addEventListener('input', () => { r.target = target.value.trim(); save(); });
  return el('div', { class: 'comp sim-rule' + (r.on === false ? ' off' : '') },
    el('div', { class: 'row' }, on, match, method, del),
    el('div', { class: 'row' }, kind, el('label', { class: 'row muted' }, t('after'), delay, 'ms'), el('label', { class: 'row muted' }, once, t('once'))),
    r.kind === 'http' ? el('div', { class: 'row' }, msg, target) : null);
}

/* ---------- DEV / ACC / PROD comparison ---------- */
async function compareEnvs(c, f, out, btn) {
  const rules = settings.rules.filter(r => r.enabled !== false && /^https?:\/\//i.test(String(r.base || '').trim()));
  if (!rules.length) {
    const o = el('button', { class: 'btn sm' }, t('Open the options'));
    o.addEventListener('click', () => browser.runtime.openOptionsPage());
    out.replaceChildren(el('p', { class: 'muted' }, t('Fill in the “system URL” of each environment in the options (for example https://sap-dev.example.com:44300).')), o);
    return;
  }
  btn.disabled = true;
  out.replaceChildren(el('p', { class: 'muted' }, t('Comparing…')));
  const verUrl = f.bootstrap ? f.bootstrap.split('?')[0].replace(/[^/]*$/, 'sap-ui-version.json') : '';
  const current = { name: env ? env.name : t('This page'), color: env && env.color, appVersion: c.version, ui5: f.version, modified: c.served && c.served.lastModified, status: t('this page'), isCurrent: true };
  const rows = await Promise.all(rules.filter(r => !(env && r.name === env.name)).map(async r => {
    const row = { name: r.name, color: r.color };
    let base;
    try { base = new URL(String(r.base).trim()); } catch (_) { row.status = t('invalid system URL'); return row; }
    const swap = u => SAPC.swapEnvUrl(u, base.href, r.client);
    const m = await fetchAny(swap(c.manifestUrl), 'application/json');
    if (!m || m.error) row.status = t('unreachable');
    else if (m.status >= 400) row.status = 'HTTP ' + m.status;
    else {
      const j = tryJson(m.text);
      if (!j) row.status = t('not connected (login page received)');
      else { row.appVersion = (j['sap.app'] && j['sap.app'].applicationVersion && j['sap.app'].applicationVersion.version) || '?'; row.modified = m.lastModified; row.status = 'OK'; }
    }
    if (verUrl && row.status === 'OK') {
      const v = await fetchAny(swap(verUrl), 'application/json');
      const j = v && !v.error ? tryJson(v.text) : null;
      row.ui5 = (j && j.version) || '';
    }
    return row;
  }));
  const all = [current].concat(rows);
  const diff = (a, b) => a && b && a !== b;
  out.replaceChildren(el('table', null,
    el('thead', null, el('tr', null, el('th', null, t('Environment')), el('th', null, t('App version')), el('th', null, 'UI5'), el('th', null, t('Modified')), el('th', null, t('Status')))),
    el('tbody', null, all.map(r => el('tr', null,
      el('td', null, el('span', { class: 'sw', style: `display:inline-block;margin-right:5px;background:${/^#[0-9a-f]{3,8}$/i.test(r.color || '') ? r.color : 'var(--muted)'}` }), r.name, r.isCurrent ? el('span', { class: 'muted' }, t(' (here)')) : null),
      el('td', { class: diff(r.appVersion, current.appVersion) ? 'diff' : '' }, r.appVersion || '—'),
      el('td', { class: diff(r.ui5, current.ui5) ? 'diff' : '' }, r.ui5 || '—'),
      el('td', null, r.modified ? new Date(r.modified).toLocaleString(loc(), { dateStyle: 'short', timeStyle: 'short' }) : '—'),
      el('td', { class: 'muted' }, r.status))))),
    el('p', { class: 'muted', style: 'margin:6px 0 0' }, t('In orange: different from this page. “Not connected”: open a session on this environment in a tab, then try again.')));
  btn.disabled = false;
}

/* ---------- Tab navigation ---------- */
function select(name) {
  current = name;
  TABS.forEach(k => $('#tab-' + k).setAttribute('aria-selected', String(k === name)));
  main.replaceChildren();
  if (name === 'errors') renderErrors();
  else if (name === 'log') renderLog();
  else if (name === 'inspect') renderInspect();
  else if (name === 'sim') renderSim();
  else renderApp();
}

async function loadTab() {
  [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  env = tab && tab.url ? SAPC.matchEnv(settings.rules, tab.url) : null;
  renderEnv();
}
let refreshTimer = 0;
function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    await loadTab();
    renderErrors(); renderLog();
    if (current === 'app') renderApp(); else if (current === 'inspect') renderInspect();
  }, 400);
}
let logTimer = 0;

function applyLang() {
  SAPC_I18N.setLang(settings.lang);
  SAPC_I18N.translatePage(document);
}

(async () => {
  const stored = await browser.storage.local.get(['settings', 'sim']);
  settings = SAPC.withDefaults(stored.settings);
  if (stored.sim && Array.isArray(stored.sim.rules)) sim = stored.sim;
  applyLang();
  await loadTab();
  TABS.forEach(k => $('#tab-' + k).addEventListener('click', () => select(k)));
  $('#opts').addEventListener('click', () => browser.runtime.openOptionsPage());
  $('#reload').addEventListener('click', () => { browser.tabs.reload(tab.id, { bypassCache: true }); if (!isSide) window.close(); });
  $('#side').addEventListener('click', () => {
    // must be called directly in the click (user gesture)
    const opened = browser.sidebarAction ? browser.sidebarAction.open() : browser.sidePanel.open({ windowId: tab.windowId }); // Firefox / Chrome
    opened.then(() => window.close(), () => window.close());
  });
  browser.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch.settings) {
      const langChanged = SAPC.withDefaults(ch.settings.newValue).lang !== settings.lang;
      settings = SAPC.withDefaults(ch.settings.newValue); env = tab && tab.url ? SAPC.matchEnv(settings.rules, tab.url) : null; renderEnv();
      if (langChanged) { applyLang(); metaCache.clear(); renderErrors(); renderLog(); select(current); }
    }
    if (area === 'local' && ch.sim) {
      const next = ch.sim.newValue && Array.isArray(ch.sim.newValue.rules) ? ch.sim.newValue : { on: false, rules: [] };
      if (JSON.stringify(next) !== JSON.stringify(sim)) { sim = next; renderEnv(); if (current === 'sim') renderSim(); } // change made elsewhere
    }
    if (area !== 'session' || !tab) return;
    if (ch['t' + tab.id] && current === 'errors') renderErrors();
    if (ch['l' + tab.id]) { clearTimeout(logTimer); logTimer = setTimeout(renderLog, 250); }
    if (ch['i' + tab.id] && current === 'inspect') renderInspect();
  });
  if (isSide) {
    const win = await browser.windows.getCurrent();
    browser.tabs.onActivated.addListener(info => { if (info.windowId === win.id) refreshSoon(); });
    browser.tabs.onUpdated.addListener((id, change) => { if (tab && id === tab.id && (change.status === 'complete' || change.url)) refreshSoon(); });
  }
  renderErrors(); renderLog(); // tab counters
  select('app');
})();
