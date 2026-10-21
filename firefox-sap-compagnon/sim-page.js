/* OData error simulation — script run in the page's MAIN world (every frame).
   Inert until sim-bridge.js has sent an active rule: nothing in the page is modified before that.
   Then, OData requests matching a rule receive a simulated response:
   - HTTP or network error: response built here, the request is never sent to the backend;
   - read-only $batch: sent, then the targeted sub-response is replaced by the error;
   - $batch containing writes: the whole $batch receives the error (nothing is written on the backend);
   - delay: the real request is sent, its response arrives later.
   The pure functions are exported for Node tests (no "window" in Node). */
(function (root) {
  'use strict';

  const WRITE = /^(POST|PUT|PATCH|MERGE|DELETE)$/;
  const STATUS_TEXT = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 412: 'Precondition Failed', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' };
  const statusText = s => STATUS_TEXT[s] || 'Error';
  const isODataUrl = url => /\/sap\/opu\/odata4?\//i.test(url) || /\/odata\//i.test(url) || /\$batch(\?|$)/i.test(url);
  const isBatchUrl = url => /\$batch(\?|#|$)/i.test(url);
  const isV4 = url => /\/odata4\/|\/odata\/v4\//i.test(url);

  function ruleMatches(r, method, url) {
    if (!r || r.on === false) return false;
    const m = String(r.method || 'ANY').toUpperCase();
    if (m !== 'ANY' && m !== String(method).toUpperCase()) return false;
    const p = String(r.match || '').trim();
    if (!p) return false;
    if (p.length > 2 && p.startsWith('/') && p.endsWith('/')) {
      try { return new RegExp(p.slice(1, -1), 'i').test(url); } catch (_) { return false; }
    }
    return String(url).toLowerCase().includes(p.toLowerCase());
  }
  // Sub-requests of a multipart $batch body, in order (the same as the responses')
  function batchParts(body) {
    const out = [];
    const re = /^(GET|POST|PUT|PATCH|MERGE|DELETE) (\S+) HTTP\/1\.[01]/gm;
    let m;
    while ((m = re.exec(String(body || '')))) out.push({ method: m[1], path: m[2] });
    return out;
  }
  function decide(rules, method, url, body) {
    const active = (rules || []).filter(r => r && r.on !== false);
    if (!active.length || !isODataUrl(url)) return null;
    if (isBatchUrl(url)) {
      const base = url.replace(/\$batch[\s\S]*$/, '');
      const parts = batchParts(body);
      const writes = parts.some(p => WRITE.test(p.method));
      for (const r of active) {
        const idx = [];
        parts.forEach((p, i) => {
          let full = p.path;
          try { full = new URL(p.path, base).href; } catch (_) { /* path as is */ }
          if (ruleMatches(r, p.method, full)) idx.push(i);
        });
        if (idx.length) return { rule: r, batch: true, writes, idx, parts };
      }
      for (const r of active) if (ruleMatches(r, method, url)) return { rule: r, batch: true, writes, idx: [], parts };
      return null;
    }
    for (const r of active) if (ruleMatches(r, method, url)) return { rule: r, batch: false };
    return null;
  }
  // Error body in SAP Gateway (V2) or OData V4 format
  function errorPayload(r, v4) {
    const msg = String(r.message || 'Simulated error');
    const st = Number(r.status) || 500;
    const code = 'SIMULATED/' + st;
    if (v4) return JSON.stringify({ error: { code, message: msg, target: r.target || undefined, details: [] } });
    return JSON.stringify({ error: { code, message: { lang: 'en', value: msg }, innererror: { transactionid: 'SIMULATED', errordetails: r.target ? [{ code, message: msg, propertyref: r.target, severity: 'error' }] : [] } } });
  }
  function httpError(r, v4) {
    const st = Number(r.status) || 500;
    return {
      status: st, statusText: statusText(st), body: errorPayload(r, v4),
      headers: 'content-type: application/json;charset=utf-8\r\n' + (v4 ? 'odata-version: 4.0' : 'dataserviceversion: 2.0') + '\r\nsap-simulated: true\r\n'
    };
  }
  // Replaces sub-responses no. idx of a multipart $batch response with the rule's error
  function rewriteBatch(text, idx, r, v4) {
    const t = String(text || '');
    const nl = t.includes('\r\n') ? '\r\n' : '\n';
    const re = /HTTP\/1\.[01] \d{3}[^\r\n]*\r?\n/g;
    const starts = [];
    let m;
    while ((m = re.exec(t))) starts.push(m.index);
    const st = Number(r.status) || 500;
    let out = '', pos = 0;
    starts.forEach((s, i) => {
      if (!idx.includes(i) || s < pos) return;
      const rel = t.slice(s).search(/\r?\n--/);
      const end = rel < 0 ? t.length : s + rel;
      out += t.slice(pos, s) + `HTTP/1.1 ${st} ${statusText(st)}${nl}Content-Type: application/json;charset=utf-8${nl}${nl}${errorPayload(r, v4)}`;
      pos = end;
    });
    return out + t.slice(pos);
  }
  function plan(rules, method, url, body) {
    const d = decide(rules, method, url, body);
    if (!d) return null;
    const r = d.rule, v4 = isV4(url);
    if (r.kind === 'delay') return { rule: r, action: 'delay', v4, batch: d.batch };
    if (r.kind === 'network') return { rule: r, action: 'fake', v4, batch: d.batch, response: { network: true } };
    if (d.batch && !d.writes && d.idx.length) return { rule: r, action: 'rewrite', v4, batch: true, idx: d.idx, parts: d.parts };
    return { rule: r, action: 'fake', v4, batch: d.batch, response: httpError(r, v4) };
  }

  const core = { ruleMatches, batchParts, decide, errorPayload, httpError, rewriteBatch, plan, isODataUrl };
  if (typeof root.window === 'undefined') { module.exports = core; return; } // Node: tests

  /* ---------- Page ---------- */
  let config = null, installed = false;
  root.addEventListener('message', e => {
    const d = e.data;
    if (!d || typeof d !== 'object' || !('__sapcSim' in d)) return;
    let c = null;
    try { c = d.__sapcSim === null ? null : JSON.parse(d.__sapcSim); } catch (_) { return; }
    config = c && Array.isArray(c.rules) && c.rules.length ? c : null;
    if (config && !installed) install();
  });

  function report(method, url, p, reqBody, status, body) {
    if (p.rule.once) p.rule.on = false; // once: disabled here at once, then in the settings
    const hit = {
      ruleId: String(p.rule.id || ''), once: !!p.rule.once, action: p.action, kind: String(p.rule.kind || 'http'),
      method, url, status, statusText: status ? statusText(status) : '', body: String(body || ''), reqBody: String(reqBody || '').slice(0, 30000),
      subs: p.idx && p.parts ? p.idx.map(i => p.parts[i]) : []
    };
    try { root.postMessage({ __sapcSimHit: JSON.stringify(hit) }, '*'); } catch (_) { /* no effect */ }
  }
  const delayOf = r => Math.min(120000, Math.max(0, Number(r.delay) || 0));

  function install() {
    installed = true;
    const X = root.XMLHttpRequest;
    if (X) installXhr(X);
    if (typeof root.fetch === 'function') installFetch();
  }

  function installXhr(X) {
    const P = X.prototype;
    const N = { open: P.open, send: P.send, setRequestHeader: P.setRequestHeader, abort: P.abort };
    const meta = new WeakMap();
    const FAKED = ['readyState', 'status', 'statusText', 'responseText', 'response', 'responseURL', 'getAllResponseHeaders', 'getResponseHeader'];
    P.open = function (method, url, async) {
      FAKED.forEach(k => { if (Object.prototype.hasOwnProperty.call(this, k)) delete this[k]; });
      try { meta.set(this, { method: String(method).toUpperCase(), url: new URL(String(url), root.location.href).href, async: async !== false, headers: [], timer: 0, inner: null }); }
      catch (_) { meta.delete(this); }
      return N.open.apply(this, arguments);
    };
    P.setRequestHeader = function (k, v) {
      const m = meta.get(this);
      if (m) m.headers.push([k, v]);
      return N.setRequestHeader.apply(this, arguments);
    };
    P.send = function (body) {
      const m = meta.get(this);
      const reqBody = typeof body === 'string' ? body : '';
      const p = m && m.async && config ? plan(config.rules, m.method, m.url, reqBody) : null;
      if (!p) return N.send.apply(this, arguments);
      const xhr = this;
      const complete = res => { m.timer = setTimeout(() => { m.timer = 0; fakeXhr(xhr, m, res); }, delayOf(p.rule)); };
      if (p.action === 'fake') {
        report(m.method, m.url, p, reqBody, p.response.network ? 0 : p.response.status, p.response.body);
        complete(p.response);
        return undefined;
      }
      // Real request (on a separate native object), then modified or delayed response
      const inner = new X();
      m.inner = inner;
      N.open.call(inner, m.method, m.url, true);
      try { inner.withCredentials = xhr.withCredentials; } catch (_) { /* no effect */ }
      m.headers.forEach(([k, v]) => { try { N.setRequestHeader.call(inner, k, v); } catch (_) { /* header refused */ } });
      inner.addEventListener('loadend', () => {
        if (m.inner !== inner) return; // cancelled in the meantime
        m.inner = null;
        if (!inner.status) { complete({ network: true }); return; }
        let text = inner.responseText;
        if (p.action === 'rewrite') { text = rewriteBatch(text, p.idx, p.rule, p.v4); report(m.method, m.url, p, reqBody, Number(p.rule.status) || 500, errorPayload(p.rule, p.v4)); }
        complete({ status: inner.status, statusText: inner.statusText, headers: inner.getAllResponseHeaders(), body: text });
      });
      N.send.call(inner, body);
      return undefined;
    };
    P.abort = function () {
      const m = meta.get(this);
      if (m) {
        if (m.timer) { clearTimeout(m.timer); m.timer = 0; }
        if (m.inner) { const i = m.inner; m.inner = null; try { N.abort.call(i); } catch (_) { /* no effect */ } }
      }
      return N.abort.apply(this, arguments);
    };
  }

  // Completes the application's XMLHttpRequest object with the simulated response (own properties + events)
  function fakeXhr(xhr, m, res) {
    const net = !!res.network;
    const headers = net ? '' : String(res.headers || '');
    const body = net ? '' : String(res.body || '');
    let response = body;
    if (!net && xhr.responseType === 'json') { try { response = JSON.parse(body); } catch (_) { response = null; } }
    const def = (k, v) => Object.defineProperty(xhr, k, { configurable: true, get: () => v });
    def('readyState', 4);
    def('status', net ? 0 : res.status);
    def('statusText', net ? '' : res.statusText);
    def('responseText', body);
    def('response', response);
    def('responseURL', net ? '' : m.url);
    Object.defineProperty(xhr, 'getAllResponseHeaders', { configurable: true, value: () => headers });
    Object.defineProperty(xhr, 'getResponseHeader', {
      configurable: true,
      value: name => {
        const re = new RegExp('^' + String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':[ \\t]*(.*)$', 'im');
        const x = headers.match(re);
        return x ? x[1].trim() : null;
      }
    });
    xhr.dispatchEvent(new Event('readystatechange'));
    if (net) xhr.dispatchEvent(new ProgressEvent('error'));
    else xhr.dispatchEvent(new ProgressEvent('load', { lengthComputable: true, loaded: body.length, total: body.length }));
    xhr.dispatchEvent(new ProgressEvent('loadend'));
  }

  function installFetch() {
    const nativeFetch = root.fetch;
    const wait = ms => new Promise(res => setTimeout(res, ms));
    const NULL_BODY = [101, 204, 205, 304];
    const toHeaders = raw => {
      const h = new Headers();
      String(raw || '').split(/\r?\n/).forEach(line => { const i = line.indexOf(':'); if (i > 0) { try { h.append(line.slice(0, i).trim(), line.slice(i + 1).trim()); } catch (_) { /* invalid header */ } } });
      return h;
    };
    root.fetch = function (input, init) {
      let method = 'GET', url = '', body = '';
      try {
        const isReq = typeof Request !== 'undefined' && input instanceof Request;
        url = new URL(isReq ? input.url : String(input), root.location.href).href;
        method = String((init && init.method) || (isReq ? input.method : 'GET')).toUpperCase();
        body = init && typeof init.body === 'string' ? init.body : '';
      } catch (_) { return nativeFetch.apply(this, arguments); }
      const p = config ? plan(config.rules, method, url, body) : null;
      if (!p) return nativeFetch.apply(this, arguments);
      const delay = delayOf(p.rule);
      if (p.action === 'fake') {
        const res = p.response;
        report(method, url, p, body, res.network ? 0 : res.status, res.body);
        return wait(delay).then(() => {
          if (res.network) throw new TypeError('NetworkError when attempting to fetch resource. (simulated)');
          return new Response(res.body, { status: res.status, statusText: res.statusText, headers: toHeaders(res.headers) });
        });
      }
      return nativeFetch.apply(this, arguments).then(async real => {
        let text = await real.text();
        if (p.action === 'rewrite') { text = rewriteBatch(text, p.idx, p.rule, p.v4); report(method, url, p, body, Number(p.rule.status) || 500, errorPayload(p.rule, p.v4)); }
        await wait(delay);
        return new Response(NULL_BODY.includes(real.status) ? null : text, { status: real.status, statusText: real.statusText, headers: real.headers });
      }, async e => { await wait(delay); throw e; });
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
