/* Background: intercepts OData responses, keeps errors per tab, updates the badge.
   Firefox: event page reading responses with webRequest.filterResponseData.
   Chrome: service worker receiving the exchanges observed in the page by net-page.js (via page-bridge.js). */
'use strict';
if (typeof importScripts === 'function' && typeof SAPC === 'undefined') importScripts('compat.js', 'i18n.js', 'shared.js'); // Chrome service worker

const MAX_BODY = 2 * 1024 * 1024; // beyond this, the body is no longer kept (the page always receives it in full)
const MAX_RECORDS = 60;
const MAX_LOG = 150;          // OData log entries per tab
const LOG_EXCERPT = 8000;     // characters kept per body in the log
const PARTS_BUDGET = 40000;   // detail characters kept per $batch (sub-request and response bodies)
const pending = new Map();
let saveChain = Promise.resolve();

// Language of the labels stored here (e.g. "(service document)"): follows the setting
browser.storage.local.get('settings').then(r => SAPC_I18N.setLang(SAPC.withDefaults(r.settings).lang), () => {});
browser.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.settings) SAPC_I18N.setLang(SAPC.withDefaults(ch.settings.newValue).lang); });

function headersObj(list) {
  const o = {};
  (list || []).forEach(h => { if (h && h.name) o[h.name.toLowerCase()] = h.value || ''; });
  return o;
}
function decodeChunks(chunks) {
  const total = chunks.reduce((a, c) => a + c.byteLength, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  chunks.forEach(c => { buf.set(new Uint8Array(c), off); off += c.byteLength; });
  return new TextDecoder('utf-8').decode(buf);
}

const CAN_FILTER = !!(browser.webRequest && typeof browser.webRequest.filterResponseData === 'function'); // Firefox only
if (CAN_FILTER) {
  browser.webRequest.onBeforeRequest.addListener(details => {
    if (details.tabId < 0 || !SAPC.isODataUrl(details.url)) return;
    let filter;
    try { filter = browser.webRequest.filterResponseData(details.requestId); } catch (_) { return; }
    const st = { url: details.url, method: details.method, tabId: details.tabId, time: Date.now(), chunks: [], size: 0, status: 0, statusLine: '', headers: {}, reqHeaders: {}, reqBody: readRequestBody(details.requestBody, /\$batch(\?|$)/i.test(details.url) ? 400000 : 30000) };
    pending.set(details.requestId, st);
    filter.ondata = ev => {
      filter.write(ev.data); // the page always receives the response untouched
      if (st.size < MAX_BODY) { st.chunks.push(ev.data); st.size += ev.data.byteLength; }
    };
    filter.onstop = () => {
      try { filter.close(); } catch (_) { /* already closed */ }
      finish(details.requestId);
    };
    filter.onerror = () => { pending.delete(details.requestId); };
  }, { urls: ['<all_urls>'], types: ['xmlhttprequest'] }, ['blocking', 'requestBody']);

  function readRequestBody(rb, max) {
    if (!rb) return '';
    try {
      if (Array.isArray(rb.raw)) {
        const parts = rb.raw.filter(p => p && p.bytes).map(p => p.bytes);
        return parts.length ? decodeChunks(parts).slice(0, max) : '';
      }
      if (rb.formData) return JSON.stringify(rb.formData).slice(0, max);
    } catch (_) { /* unreadable body */ }
    return '';
  }

  browser.webRequest.onBeforeSendHeaders.addListener(details => {
    const st = pending.get(details.requestId);
    if (st) st.reqHeaders = headersObj(details.requestHeaders);
  }, { urls: ['<all_urls>'], types: ['xmlhttprequest'] }, ['requestHeaders']);

  browser.webRequest.onHeadersReceived.addListener(details => {
    const st = pending.get(details.requestId);
    if (!st) return;
    st.status = details.statusCode;
    st.statusLine = details.statusLine || '';
    st.headers = headersObj(details.responseHeaders);
  }, { urls: ['<all_urls>'], types: ['xmlhttprequest'] }, ['responseHeaders']);

  // New page in the tab: start again from an empty list
  browser.webRequest.onBeforeRequest.addListener(details => {
    if (details.tabId >= 0) clearTab(details.tabId);
  }, { urls: ['<all_urls>'], types: ['main_frame'] });
}

// Chrome: an OData exchange observed in the page (same processing as the Firefox interception)
function rawHeaders(raw) {
  const o = {};
  String(raw || '').split(/\r?\n/).forEach(line => { const i = line.indexOf(':'); if (i > 0) o[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); });
  return o;
}
function fromPage(tabId, ex) {
  const status = Number(ex.status) || 0;
  const reqHeaders = {};
  Object.keys(ex.reqHeaders || {}).forEach(k => { reqHeaders[String(k).toLowerCase()] = String(ex.reqHeaders[k]); });
  const st = {
    url: ex.url, method: String(ex.method).toUpperCase(), tabId, time: Number(ex.time) || Date.now(), ms: Number(ex.ms) || 0,
    size: Number(ex.size) || 0, status, statusLine: `HTTP/1.1 ${status} ${ex.statusText || ''}`, headers: rawHeaders(ex.headers),
    reqHeaders, reqBody: String(ex.reqBody || '')
  };
  process(st, String(ex.text || ''));
}

function makeRecord(st, status, statusText, error, body, inBatch) {
  const d = SAPC.describeUrl(st.url);
  return {
    id: st.time + '-' + Math.random().toString(36).slice(2, 8),
    kind: 'error', time: st.time, url: st.url, method: st.method, status, statusText,
    service: d.service, resource: d.resource, inBatch: !!inBatch,
    error: error || { code: '', message: '', details: [] },
    body: String(body || '').slice(0, 20000),
    reqBody: String(st.reqBody || '').slice(0, 30000),
    reqHeaders: keepSafe(st.reqHeaders),
    resHeaders: keepSafe(st.headers)
  };
}

// Only headers without secrets are kept (never a cookie or a token value)
function keepSafe(h) {
  const o = {};
  SAPC.safeHeaders(h).forEach(line => { const i = line.indexOf(': '); o[line.slice(0, i)] = line.slice(i + 2); });
  return o;
}

function finish(requestId) {
  const st = pending.get(requestId);
  pending.delete(requestId);
  if (!st) return;
  const needFull = st.status >= 400 || /\$batch(\?|$)/i.test(st.url);
  let text = '';
  try { text = decodeChunks(needFull ? st.chunks : firstBytes(st.chunks, LOG_EXCERPT * 4)); } catch (_) { text = ''; }
  process(st, text);
}
// Shared by both browsers: log entry, error records, sap-message records
function process(st, text) {
  const isBatch = /\$batch(\?|$)/i.test(st.url);
  const sapMsg = SAPC.parseSapMessage(st.headers['sap-message']);
  addLog(st, isBatch, text);
  if (st.status < 400 && !isBatch && !sapMsg.length) return;
  const recs = [];
  if (st.status >= 400) {
    recs.push(makeRecord(st, st.status, st.statusLine.replace(/^HTTP\/[\d.]+\s+\d+\s*/, ''), SAPC.parseODataError(text), text, false));
  } else if (isBatch) {
    // Each failed sub-request, with its URL, method and body; otherwise, plain reading of the responses
    const parts = SAPC.batchDetails(st.reqBody, text, 20000);
    if (parts.some(p => p.status)) {
      parts.forEach((p, i) => {
        if (p.status < 400) return;
        const prev = parts[i - 1];
        if (p.changesetError && prev && prev.changesetError && prev.resBody === p.resBody) return; // same changeset: a single error
        const sub = Object.assign({}, st, { url: subUrl(st.url, p.path), method: p.method, reqBody: p.reqBody, reqHeaders: p.reqHeaders, headers: p.resHeaders });
        const rec = makeRecord(sub, p.status, p.statusText, SAPC.parseODataError(p.resBody), p.resBody, true);
        rec.batchUrl = st.url;
        rec.changeset = !!p.changesetError;
        recs.push(rec);
      });
    } else {
      SAPC.parseBatch(text).forEach(p => recs.push(makeRecord(st, p.status, p.statusText, p.error, p.body, true)));
    }
  }
  if (sapMsg.length) {
    const d = SAPC.describeUrl(st.url);
    recs.push({
      id: st.time + '-m' + Math.random().toString(36).slice(2, 8), kind: 'message', time: st.time, url: st.url, method: st.method,
      status: st.status, service: d.service, resource: d.resource, messages: sapMsg
    });
  }
  if (recs.length) addRecords(st.tabId, recs);
}

// Full URL of a $batch sub-request (the $batch SAP client is added if missing)
function subUrl(batchUrl, path) {
  let u;
  try { u = new URL(path, batchUrl.replace(/\$batch[\s\S]*$/, '')); } catch (_) { return batchUrl; }
  const client = SAPC.sapClientOf(batchUrl);
  if (client && !u.searchParams.has('sap-client')) u.search += (u.search ? '&' : '?') + 'sap-client=' + encodeURIComponent(client);
  return u.href;
}

function firstBytes(chunks, max) {
  const out = [];
  let n = 0;
  for (const c of chunks) { if (n >= max) break; out.push(n + c.byteLength > max ? c.slice(0, max - n) : c); n += c.byteLength; }
  return out;
}

/* Log: every OData request of the tab (not only errors) */
function addLog(st, isBatch, text, simulated) {
  const d = SAPC.describeUrl(st.url);
  let parts = isBatch ? SAPC.batchDetails(st.reqBody, text, 4000) : [];
  // Budget: ~40 KB of detail per $batch (bodies shortened when there are many sub-requests)
  if (parts.length && parts.reduce((n, p) => n + p.reqBody.length + p.resBody.length, 0) > PARTS_BUDGET) {
    parts = SAPC.batchDetails(st.reqBody, text, Math.max(300, Math.floor(PARTS_BUDGET / (2 * parts.length))));
  }
  const subs = parts.length ? parts.map(p => ({ method: p.method, path: p.path, status: p.status })) : isBatch ? SAPC.batchSubRequests(st.reqBody, text) : [];
  const entry = {
    id: st.time + '-' + Math.random().toString(36).slice(2, 8), time: st.time, ms: st.ms || Date.now() - st.time,
    method: st.method, url: st.url, service: d.service, resource: d.resource, status: st.status, size: st.size,
    batch: isBatch, subs, parts, errors: (st.status >= 400 ? 1 : 0) + subs.filter(x => x.status >= 400).length,
    // with the sub-request details, the raw $batch response is redundant: short excerpt only
    // (the body sent stays whole up to LOG_EXCERPT: "Copy as curl" needs it)
    reqType: st.reqHeaders['content-type'] || '', reqBody: String(st.reqBody || '').slice(0, LOG_EXCERPT),
    resBody: String(text || '').slice(0, parts.length ? 1500 : LOG_EXCERPT),
    simulated: !!simulated
  };
  saveChain = saveChain.then(async () => {
    const key = 'l' + st.tabId;
    const cur = (await browser.storage.session.get(key))[key] || [];
    const next = [entry].concat(cur).slice(0, MAX_LOG);
    // Session storage quota reached: keep the most recent entries
    try { await browser.storage.session.set({ [key]: next }); } catch (_) { await browser.storage.session.set({ [key]: next.slice(0, 30) }); }
  }).catch(() => { /* tab closed */ });
}

const keyOf = tabId => 't' + tabId;
function addRecords(tabId, recs) {
  saveChain = saveChain.then(async () => {
    const key = keyOf(tabId);
    const cur = (await browser.storage.session.get(key))[key] || [];
    const next = recs.slice().reverse().concat(cur).slice(0, MAX_RECORDS);
    await browser.storage.session.set({ [key]: next });
    await updateBadge(tabId, next);
    const settings = SAPC.withDefaults((await browser.storage.local.get('settings')).settings);
    if (settings.toasts) {
      recs.filter(r => r.kind === 'error').forEach(rec => {
        const others = next.filter(o => o.kind === 'error' && o.id !== rec.id).slice(0, 5)
          .map(o => ({ time: o.time, status: o.status, method: o.method, service: o.service, resource: o.resource, error: { message: o.error && o.error.message } }));
        browser.tabs.sendMessage(tabId, { type: 'sapc-error', rec, others }, { frameId: 0 }).catch(() => { /* page without content script (special tab) */ });
      });
    }
  }).catch(() => { /* tab closed in the meantime */ });
}
function clearTab(tabId) {
  saveChain = saveChain.then(async () => {
    await browser.storage.session.remove([keyOf(tabId), 'l' + tabId, 'i' + tabId]);
    await updateBadge(tabId, []);
  }).catch(() => {});
}
async function updateBadge(tabId, recs) {
  const n = recs.filter(r => r.kind === 'error').length;
  try {
    await browser.action.setBadgeBackgroundColor({ color: '#c62828', tabId });
    await browser.action.setBadgeText({ text: n ? String(Math.min(n, 99)) : '', tabId });
  } catch (_) { /* tab closed */ }
}

browser.tabs.onRemoved.addListener(tabId => {
  browser.storage.session.remove([keyOf(tabId), 'l' + tabId, 'i' + tabId]).catch(() => {});
});

sapcOnMessage((msg, sender) => {
  if (msg && msg.type === 'sapc-exchange' && sender.tab && msg.ex && typeof msg.ex.url === 'string' && SAPC.isODataUrl(msg.ex.url)) { fromPage(sender.tab.id, msg.ex); return undefined; }
  if (msg && msg.type === 'sapc-page-start' && sender.tab && sender.frameId === 0) { clearTab(sender.tab.id); return undefined; }
  if (msg && msg.type === 'sapc-probe' && sender.tab) return probeFrame(sender.tab.id, sender.frameId);
  if (msg && msg.type === 'sapc-clear' && typeof msg.tabId === 'number') { clearTab(msg.tabId); return Promise.resolve(true); }
  if (msg && msg.type === 'sapc-clear-log' && typeof msg.tabId === 'number') { return browser.storage.session.remove('l' + msg.tabId).then(() => true); }
  if (msg && msg.type === 'sapc-inspected' && sender.tab && msg.data) {
    const tabId = sender.tab.id;
    // Last inspection, read by the panel; also leave inspection mode in the other frames
    browser.tabs.sendMessage(tabId, { type: 'sapc-inspect-stop' }).catch(() => {});
    return browser.storage.session.set({ ['i' + tabId]: msg.data }).then(() => true);
  }
  return undefined;
});

// Chrome: UI5 information of a frame for the in-page notification's report (Firefox reads it directly)
async function probeFrame(tabId, frameId) {
  try {
    const [r] = await browser.scripting.executeScript({ target: { tabId, frameIds: [frameId || 0] }, files: ['probe.js'], world: SAPC_ENV.pageWorld });
    const f = r && r.result;
    if (!f || !f.ui5) return null;
    return { version: f.version, language: f.language, theme: f.theme, components: (f.components || []).map(c => ({ id: c.id, type: c.type, version: c.version, minUI5: c.minUI5, dataSources: c.dataSources })) };
  } catch (_) { return null; }
}
// Chrome: the shortcut opens the side panel (Firefox: _execute_sidebar_action)
if (browser.commands && browser.sidePanel) {
  browser.commands.onCommand.addListener((command, tab) => {
    if (command === 'open-side-panel' && tab) browser.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  });
}

/* ---------- Error simulation (see sim-page.js) ---------- */
// Allowed only if the tab's environment (or else the frame's) has the "Sim." option
async function simAllowed(topUrl, frameUrl) {
  const settings = SAPC.withDefaults((await browser.storage.local.get('settings')).settings);
  const top = topUrl ? SAPC.matchEnv(settings.rules, topUrl) : null;
  const env = top || SAPC.matchEnv(settings.rules, frameUrl || '');
  return { allowed: !!(env && env.simulate === true), env: env ? String(env.name || '') : '' };
}
function simRecords(tabId, hit) {
  const now = Date.now();
  const status = Number(hit.status) || 0;
  const st = (url, method, reqBody) => ({ url, method, tabId, time: now, reqBody, reqHeaders: {}, headers: { 'content-type': 'application/json' }, status, size: String(hit.body || '').length });
  const errorOf = () => status ? SAPC.parseODataError(hit.body) : { code: '', message: SAPC_I18N.t('Network error (simulated: the request was not sent)'), details: [] };
  const recs = [];
  if (hit.action === 'rewrite') {
    const base = hit.url.replace(/\$batch[\s\S]*$/, '');
    (Array.isArray(hit.subs) ? hit.subs : []).forEach(s => {
      let url = base + String(s && s.path || '');
      try { url = new URL(String(s.path), base).href; } catch (_) { /* path as is */ }
      recs.push(makeRecord(st(url, String(s && s.method || 'GET'), ''), status, hit.statusText, errorOf(), hit.body, true));
    });
  } else if (hit.action === 'fake') {
    const isBatch = /\$batch(\?|$)/i.test(hit.url);
    recs.push(makeRecord(st(hit.url, hit.method, hit.reqBody), status, hit.statusText, errorOf(), hit.body, false));
    addLog(st(hit.url, hit.method, hit.reqBody), isBatch, hit.body, true);
  }
  recs.forEach(r => { r.simulated = true; });
  if (recs.length) addRecords(tabId, recs);
}
async function simDisableRule(ruleId) {
  const sim = (await browser.storage.local.get('sim')).sim;
  if (!sim || !Array.isArray(sim.rules)) return;
  const r = sim.rules.find(x => x && String(x.id) === ruleId);
  if (r && r.on !== false) { r.on = false; await browser.storage.local.set({ sim }); }
}
// To be safe, simulation is switched off at every browser start
browser.runtime.onStartup.addListener(async () => {
  const sim = (await browser.storage.local.get('sim')).sim;
  if (sim && sim.on) { sim.on = false; await browser.storage.local.set({ sim }); }
});
sapcOnMessage((msg, sender) => {
  if (!msg || !sender.tab) return undefined;
  if (msg.type === 'sapc-sim-allowed') return simAllowed(sender.tab.url, String(msg.frameUrl || ''));
  if (msg.type === 'sapc-sim-hit' && msg.hit && typeof msg.hit.url === 'string') {
    // Check the permission again: a message from the page is not enough to create entries
    return simAllowed(sender.tab.url, sender.url).then(ok => {
      if (!ok.allowed) return false;
      simRecords(sender.tab.id, msg.hit);
      if (msg.hit.once && msg.hit.ruleId) simDisableRule(String(msg.hit.ruleId));
      return true;
    });
  }
  return undefined;
});

browser.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') browser.runtime.openOptionsPage();
});
