/* Shared functions (background, page script, popup, options) — no browser access,
   so they can be tested as is in Node. Texts go through t() (i18n.js). */
(function (root) {
  'use strict';

  // Translated texts (i18n.js, loaded before this file); without it, English
  const t = (s, ...a) => root.SAPC_I18N ? root.SAPC_I18N.t(s, ...a) : s.replace(/\{(\d+)\}/g, (m, i) => (+i < a.length ? String(a[+i]) : m));
  const loc = () => root.SAPC_I18N ? root.SAPC_I18N.locale() : 'en-GB';

  const DEFAULT_SETTINGS = {
    rules: [],
    banner: { position: 'top', titlePrefix: true },
    toasts: true,
    inspectAlt: true,
    lang: 'en'
  };

  const PRESETS = [
    { name: 'DEV', color: '#2e7d32', pattern: '', base: '', client: '', simulate: true },
    { name: 'ACC', color: '#f9a825', pattern: '', base: '', client: '', simulate: false },
    { name: 'PROD', color: '#c62828', pattern: '', base: '', client: '', simulate: false }
  ];

  function withDefaults(s) {
    const src = s && typeof s === 'object' ? s : {};
    return {
      rules: Array.isArray(src.rules) ? src.rules.filter(r => r && typeof r === 'object') : [],
      banner: Object.assign({}, DEFAULT_SETTINGS.banner, src.banner || {}),
      toasts: src.toasts !== false,
      inspectAlt: src.inspectAlt !== false,
      lang: src.lang === 'fr' ? 'fr' : 'en'
    };
  }

  /* URL → environment matching.
     Pattern: text contained in the URL (case-insensitive), or a regular expression written /.../ */
  function patternMatches(pattern, url) {
    const p = String(pattern || '').trim();
    if (!p) return false;
    if (p.length > 2 && p.startsWith('/') && p.endsWith('/')) {
      try { return new RegExp(p.slice(1, -1), 'i').test(url); } catch (_) { return false; }
    }
    return String(url).toLowerCase().includes(p.toLowerCase());
  }
  function sapClientOf(url) {
    try { return new URL(url).searchParams.get('sap-client') || ''; } catch (_) { return ''; }
  }
  function matchEnv(rules, url) {
    for (const r of rules || []) {
      if (!r || r.enabled === false) continue;
      if (!patternMatches(r.pattern, url)) continue;
      const client = String(r.client || '').trim();
      if (client && sapClientOf(url) !== client) continue;
      return r;
    }
    return null;
  }

  /* OData requests (SAP Gateway V2/V4, CAP services) */
  function isODataUrl(url) {
    return /\/sap\/opu\/odata4?\//i.test(url) || /\/odata\/v[24]\//i.test(url) || /\/odata\//i.test(url) || /\$batch(\?|$)/i.test(url);
  }
  function describeUrl(url) {
    let path = '';
    try { path = decodeURIComponent(new URL(url).pathname); } catch (_) { path = String(url); }
    const segs = path.split('/').filter(Boolean);
    let base = segs.findIndex(s => /^odata4?$/i.test(s));
    let j = base + 1;
    while (segs[j] && (/^sap$/i.test(segs[j]) || /^v\d$/i.test(segs[j]))) j++;
    const srv = segs.findIndex(s => /_SRV(;.*)?$/i.test(s));
    const at = srv >= 0 ? srv : (base >= 0 ? j : Math.max(0, segs.length - 2));
    return {
      service: (segs[at] || '').replace(/;.*/, ''),
      resource: segs.slice(at + 1).join('/') || t('(service document)')
    };
  }

  /* Error decoding */
  function decodeXml(s) {
    return String(s || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&amp;/g, '&').trim();
  }
  function xmlTag(xml, tag) {
    const m = String(xml).match(new RegExp('<(?:[\\w-]+:)?' + tag + '\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?' + tag + '>', 'i'));
    return m ? decodeXml(m[1]) : '';
  }
  const msgText = m => typeof m === 'string' ? m : (m && typeof m.value === 'string' ? m.value : '');
  function parseODataError(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    if (t.startsWith('{')) {
      let j;
      try { j = JSON.parse(t); } catch (_) { return { code: '', message: t.slice(0, 500), details: [] }; }
      const e = j.error || j['odata.error'] || (j.d && j.d.error);
      if (!e) return null;
      const inner = e.innererror || {};
      let det = inner.errordetails;
      if (det && !Array.isArray(det)) det = det.errordetail ? [].concat(det.errordetail) : [];
      const details = [];
      (det || []).forEach(d => details.push({ code: d.code || '', message: msgText(d.message), target: d.propertyref || d.target || '', severity: d.severity || '' }));
      (Array.isArray(e.details) ? e.details : []).forEach(d => details.push({ code: d.code || '', message: msgText(d.message), target: d.target || '', severity: d['@Common.numericSeverity'] ? String(d['@Common.numericSeverity']) : '' }));
      return {
        code: e.code || '',
        message: msgText(e.message),
        details: details.filter(d => d.message && (d.message !== msgText(e.message) || d.target)),
        transactionId: inner.transactionid || inner.TransactionID || '',
        timestamp: inner.timestamp || '',
        service: inner.application && (inner.application.service_id || inner.application.service_namespace) || ''
      };
    }
    if (t.startsWith('<')) {
      if (/<(?:[\w-]+:)?error\b/i.test(t) && !/<html/i.test(t)) {
        const details = [];
        const re = /<(?:[\w-]+:)?errordetail\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?errordetail>/gi;
        let m;
        while ((m = re.exec(t))) details.push({ code: xmlTag(m[1], 'code'), message: xmlTag(m[1], 'message'), target: xmlTag(m[1], 'propertyref') || xmlTag(m[1], 'target'), severity: xmlTag(m[1], 'severity') });
        const head = t.replace(re, '');
        const message = xmlTag(head, 'message');
        return {
          code: xmlTag(head, 'code'), message,
          details: details.filter(d => d.message && (d.message !== message || d.target)),
          transactionId: xmlTag(head, 'transactionid'), timestamp: xmlTag(head, 'timestamp'),
          service: xmlTag(head, 'service_id') || xmlTag(head, 'service_namespace')
        };
      }
      const title = xmlTag(t, 'title');
      const body = decodeXml(t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      return { code: '', message: (title ? title + ' — ' : '') + body.slice(0, 400), details: [], html: true };
    }
    return { code: '', message: t.slice(0, 500), details: [] };
  }

  /* $batch: finds each failed sub-response (HTTP >= 400) */
  function parseBatch(text) {
    const out = [];
    const re = /HTTP\/1\.[01] (\d{3})([^\r\n]*)\r?\n([\s\S]*?)(?=\r?\n--[^\r\n]+|$)/g;
    let m;
    while ((m = re.exec(String(text || '')))) {
      const status = +m[1];
      if (status < 400) continue;
      const block = m[3];
      const sep = block.search(/\r?\n\r?\n/);
      const body = sep >= 0 ? block.slice(sep).trim() : block.trim();
      out.push({ status, statusText: m[2].trim(), body, error: parseODataError(body) });
    }
    return out;
  }

  /* sap-message header (business messages attached to successful responses) */
  function parseSapMessage(h) {
    if (!h) return [];
    try {
      const j = JSON.parse(h);
      const list = [{ code: j.code || '', message: j.message || '', severity: j.severity || '', target: j.target || '' }];
      (j.details || []).forEach(d => list.push({ code: d.code || '', message: d.message || '', severity: d.severity || '', target: d.target || '' }));
      return list.filter(x => x.message);
    } catch (_) {
      return [];
    }
  }

  function hintsFor(status, err, headers) {
    const h = headers || {};
    const tx = err && err.transactionId ? t(' (transaction ID {0})', err.transactionId) : '';
    if (status === 403 && String(h['x-csrf-token'] || '').toLowerCase() === 'required') return t('Missing or expired CSRF token: the session has probably expired. Reload the page.');
    if (status === 401) return t('Not authenticated: session expired, or user without access to this system.');
    if (status === 403) return t('Access denied: check the user’s roles (SU53 on the backend) and the S_SERVICE authorisation for this service.');
    if (status === 404) return t('Not found: non-existent entity key, misnamed entity or service not activated (/IWFND/MAINT_SERVICE).');
    if (status === 400) return t('Request rejected by the service: often an invalid value (format, length, mandatory field). Check the details and the targeted field.');
    if (status === 409 || status === 412) return t('Conflict: the data was changed in the meantime (ETag) or is locked. Reload the data.');
    if (status === 502 || status === 504) return t('Gateway: backend, BTP destination or Cloud Connector unreachable or too slow.');
    if (status === 503) return t('Service unavailable: system down, in maintenance, or Cloud Connector disconnected.');
    if (status >= 500) return t('Server error: check /IWFND/ERROR_LOG (Gateway) then /IWBEP/ERROR_LOG (backend){0}.', tx);
    return '';
  }

  /* Loading statistics from the browser's measurements.
     r = { n: url, s: start (ms), d: duration (ms), e: end (ms), ts: bytes transferred, ds: decoded bytes } */
  const CATS = [
    ['odata', 'OData'],
    ['ui5', 'UI5 libraries'],
    ['app', 'Application'],
    ['style', 'Styles and fonts'],
    ['img', 'Images'],
    ['other', 'Other']
  ];
  function categoryOf(url) {
    const u = String(url || '').split('?')[0].toLowerCase();
    if (isODataUrl(url)) return 'odata';
    if (/\.(css|woff2?|ttf|otf|eot)$/.test(u)) return 'style';
    if (/\.(png|jpe?g|gif|svg|webp|ico|bmp)$/.test(u)) return 'img';
    if (/sap-ui-(core|custom)|library-preload|\/resources\/sap[/.]|\/resources\/~[^/]+~\/sap\//.test(u)) return 'ui5';
    if (/\.(js|json|xml|properties|html?)$/.test(u)) return 'app';
    return 'other';
  }
  const isCached = r => r.ts === 0 && r.ds > 0;
  function perfStats(perf) {
    const list = (perf && perf.resources) || [];
    const nav = perf && perf.nav;
    const byCat = {};
    CATS.forEach(([k, label]) => { byCat[k] = { key: k, label: t(label), count: 0, bytes: 0, cached: 0, maxMs: 0, totalMs: 0 }; });
    let bytes = 0, cached = 0, measured = 0, lastEnd = 0;
    list.forEach(r => {
      const c = byCat[categoryOf(r.n)];
      c.count++; c.bytes += r.ts || 0; c.totalMs += r.d || 0; c.maxMs = Math.max(c.maxMs, r.d || 0);
      bytes += r.ts || 0;
      if (r.ts > 0 || r.ds > 0) measured++;
      if (isCached(r)) { cached++; c.cached++; }
      lastEnd = Math.max(lastEnd, r.e || 0);
    });
    const od = list.filter(r => categoryOf(r.n) === 'odata');
    const odDur = od.map(r => r.d || 0).sort((a, b) => a - b);
    const median = odDur.length ? odDur[Math.floor((odDur.length - 1) / 2)] : 0;
    const names = list.map(r => String(r.n || '').split('?')[0].toLowerCase());
    const appJs = list.filter(r => categoryOf(r.n) === 'app' && /\.js(\?|$)/i.test(r.n) && !/component-preload/i.test(r.n));
    const insights = [];
    if (names.some(n => /-dbg\.js$/.test(n))) insights.push({ warn: true, text: t('UI5 debug mode on (-dbg.js files): loading is much slower. Remove sap-ui-debug from the URL.') });
    const hasPreload = names.some(n => /component-preload\.js$/.test(n));
    if (list.length && !hasPreload && appJs.length > 5) insights.push({ warn: true, text: t('No Component-preload.js: the application loads {0} JS files one by one. Check the build (ui5 build).', appJs.length) });
    else if (hasPreload) insights.push({ warn: false, text: t('Component-preload.js loaded: the application files arrive in a single bundle.') });
    const slowOd = od.filter(r => r.d > 1000).length;
    if (slowOd) insights.push({ warn: true, text: t('{0} OData request(s) over one second: see the list of slowest resources.', slowOd) });
    if (measured >= 10 && cached / measured < 0.2) insights.push({ warn: true, text: t('Only {0}% of files come from the browser cache: check the Cache-Control headers or a cache token.', Math.round(cached / measured * 100)) });
    if (list.length >= 3000 || list.length === 250) insights.push({ warn: true, text: t('Measurement buffer full: some resources are not counted. Reload the page for a complete measurement.') });
    if (list.length > measured + 5) insights.push({ warn: false, text: t('{0} resource(s) from another domain without reported size (no Timing-Allow-Origin header).', list.length - measured) });
    const slowest = list.slice().sort((a, b) => (b.d || 0) - (a.d || 0)).slice(0, 8).map(r => ({ name: r.n, ms: r.d || 0, bytes: r.ts || 0, cached: isCached(r), odata: categoryOf(r.n) === 'odata' }));
    return {
      loadMs: nav && nav.load > 0 ? nav.load : 0,
      domReadyMs: nav && nav.domReady > 0 ? nav.domReady : 0,
      ttfbMs: nav && nav.ttfb > 0 ? nav.ttfb : 0,
      lastResourceMs: lastEnd,
      count: list.length, bytes, cached, measured,
      odata: { count: od.length, batch: od.filter(r => /\$batch/i.test(r.n)).length, medianMs: median, maxMs: odDur.length ? odDur[odDur.length - 1] : 0 },
      categories: CATS.map(([k]) => byCat[k]).filter(c => c.count),
      slowest, insights
    };
  }

  /* Error report for an AI: only the collected data (context, request, response, metadata). No cookie or token. */
  const SAFE_HEADERS = ['content-type', 'accept', 'x-http-method', 'dataserviceversion', 'maxdataserviceversion', 'odata-version', 'odata-maxversion', 'sap-message', 'location', 'sap-perf-fesrec', 'sap-server'];
  function safeHeaders(h) {
    const out = [];
    Object.keys(h || {}).forEach(k => {
      const key = k.toLowerCase();
      if (SAFE_HEADERS.includes(key)) out.push(`${key}: ${h[k]}`);
      else if (key === 'x-csrf-token' && /^(required|fetch)$/i.test(String(h[k]))) out.push(`${key}: ${h[k]}`);
    });
    return out;
  }
  function queryParams(url) {
    try { return [...new URL(url).searchParams.entries()].filter(([k]) => !/^sap-(contextid|passport|xsrfid)/i.test(k)); } catch (_) { return []; }
  }
  function prettyBody(b) {
    const t = String(b || '').trim();
    if (!t) return '';
    if (t.startsWith('{') || t.startsWith('[')) { try { return JSON.stringify(JSON.parse(t), null, 2); } catch (_) { /* as is */ } }
    return t;
  }
  const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + t('\n… (truncated, {0} characters in total)', s.length) : s; };
  function buildClaudePrompt(rec, ctx) {
    const c = ctx || {};
    const e = rec.error || {};
    const app = c.app || null;
    const L = [];
    const status = `${rec.status}${rec.statusText ? ' ' + rec.statusText : ''}`;
    L.push(t('# OData error {0} — {1} / {2}', status, rec.service || '?', rec.resource || '?'));
    L.push('');
    L.push(t('## Context'));
    L.push(t('- Environment: {0}{1}', c.env || t('not identified'), sapClientOf(rec.url) ? t(' · SAP client {0}', sapClientOf(rec.url)) : ''));
    if (c.pageUrl) L.push(t('- Application page: {0}', c.pageUrl));
    if (app) {
      L.push(t('- SAPUI5: {0}{1}{2}', app.version || '?', app.theme ? t(' · theme {0}', app.theme) : '', app.language ? t(' · language {0}', app.language) : ''));
      (app.components || []).slice(0, 3).forEach(cp => {
        L.push(t('- Component: {0} ({1}) version {2}{3}', cp.id || '?', cp.type || 'type ?', cp.version || '?', cp.minUI5 ? ', UI5 min ' + cp.minUI5 : ''));
        (cp.dataSources || []).forEach(d => L.push(t('  - OData source “{0}”: {1}{2}', d.name, d.uri, d.odata ? ' (OData ' + d.odata + ')' : '')));
      });
    } else {
      L.push(t('- SAPUI5 information: not available'));
    }
    if (c.browser) L.push(t('- Browser: {0}', c.browser));
    L.push(t('- Error date: {0}', new Date(rec.time).toLocaleString(loc())));
    L.push('');
    L.push(t('## Request'));
    L.push(`- ${rec.method} ${rec.url}`);
    if (rec.batchUrl) L.push(t('- Sent inside a $batch: {0}', rec.batchUrl) + (rec.changeset ? t(' (changeset: the whole changeset was rejected)') : ''));
    else if (rec.inBatch) L.push(t('- This error is a sub-request of a $batch (the $batch body is below).'));
    L.push(t('- Service: {0} · resource: {1}', rec.service || '?', rec.resource || '?'));
    const qp = queryParams(rec.url);
    if (qp.length) { L.push(t('- Parameters:')); qp.forEach(([k, v]) => L.push(`  - ${k} = ${v}`)); }
    const rqh = safeHeaders(rec.reqHeaders);
    if (rqh.length) { L.push(t('- Headers sent:')); rqh.forEach(h => L.push('  - ' + h)); }
    if (rec.reqBody) L.push('', t('Body sent:'), '```', clip(prettyBody(rec.reqBody), 6000), '```');
    L.push('');
    L.push(t('## Response'));
    L.push(t('- HTTP status: {0}', status));
    if (e.code) L.push(t('- SAP error code: {0}', e.code));
    if (e.message) L.push(t('- Message: {0}', e.message));
    if (e.service) L.push(t('- SAP service (innererror): {0}', e.service));
    if (e.transactionId) L.push(t('- Transaction ID: {0}', e.transactionId));
    if (e.timestamp) L.push(t('- SAP timestamp: {0}', e.timestamp));
    const det = e.details || [];
    if (det.length) { L.push(t('- Details:')); det.forEach(d => L.push(`  - ${d.severity ? '[' + d.severity + '] ' : ''}${d.code ? d.code + ' — ' : ''}${d.message}${d.target ? t(' (field: {0})', d.target) : ''}`)); }
    const rsh = safeHeaders(rec.resHeaders);
    if (rsh.length) { L.push(t('- Headers received:')); rsh.forEach(h => L.push('  - ' + h)); }
    if (rec.body) L.push('', t('Response body:'), '```', clip(prettyBody(rec.body), 6000), '```');
    if (c.meta && c.meta.type) {
      const mt = c.meta.type;
      L.push('', t('## Service metadata ($metadata)'));
      L.push(t('- Entity type: {0} (EntitySet {1}){2}{3}', mt.name, mt.set, mt.keys.length ? t(' · key(s): {0}', mt.keys.join(', ')) : '', c.meta.odataVersion ? ' · OData V' + c.meta.odataVersion : ''));
      if ((c.meta.props || []).length) { L.push(t('- Fields involved:')); c.meta.props.forEach(p => L.push(t('  - {0}: {1}', p.name, describeProp(p)))); }
      if ((c.meta.issues || []).length) { L.push(t('- Automatic check of the values sent:')); c.meta.issues.forEach(i => L.push(`  - [${i.level === 'error' ? t('error') : t('warning')}] ${i.text}`)); }
    }
    if (c.otherErrors && c.otherErrors.length) {
      L.push('', t('## Other recent OData errors in the same tab'));
      c.otherErrors.slice(0, 5).forEach(o => L.push(`- ${new Date(o.time).toLocaleTimeString(loc())} · ${o.status} ${o.method} ${o.service || '?'} / ${o.resource || '?'} — ${(o.error && o.error.message) || t('no message')}`));
    }
    return L.join('\n');
  }

  /* ---------- $metadata (EDMX V2 and V4) ---------- */
  function serviceRootOf(url) {
    try {
      const u = new URL(url);
      const segs = u.pathname.split('/');
      let at = segs.findIndex(s => /_SRV(;.*)?$/i.test(s));
      if (at < 0) {
        const base = segs.findIndex(s => /^odata4?$/i.test(s));
        if (base < 0) return '';
        at = base + 1;
        while (segs[at] && (/^sap$/i.test(segs[at]) || /^v\d$/i.test(segs[at]))) at++;
        // SAP OData V4 (…/odata4/sap/<group>/srvd/sap/<service>/0001/): go up to the version number
        const ver = segs.findIndex((s, i) => i > at && /^\d{4}$/.test(s));
        if (/^odata4$/i.test(segs[base]) && ver > 0) at = ver;
      }
      const client = u.searchParams.get('sap-client');
      return u.origin + segs.slice(0, at + 1).join('/') + '/' + (client ? '?sap-client=' + encodeURIComponent(client) : '');
    } catch (_) { return ''; }
  }
  function metadataUrlOf(root) {
    if (!root) return '';
    const i = root.indexOf('?');
    return i < 0 ? root + '$metadata' : root.slice(0, i) + '$metadata' + root.slice(i);
  }
  function xmlAttrs(s) {
    const o = {};
    String(s || '').replace(/([\w:.-]+)\s*=\s*"([^"]*)"/g, (_, k, v) => { o[k] = decodeXml(v); return ''; });
    return o;
  }
  function parseMetadata(xml) {
    const t = String(xml || '');
    const types = {}, sets = {};
    const vm = t.match(/<(?:[\w-]+:)?Edmx\b[^>]*\bVersion="([^"]+)"/);
    const odataVersion = vm ? (vm[1] === '4.0' ? 4 : 2) : 0;
    const reType = /<(?:[\w-]+:)?EntityType\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?EntityType>/g;
    let m;
    while ((m = reType.exec(t))) {
      const a = xmlAttrs(m[1]), body = m[2], keys = [], props = {};
      body.replace(/<(?:[\w-]+:)?PropertyRef\b([^>]*?)\/?>/g, (_, x) => { const n = xmlAttrs(x).Name; if (n) keys.push(n); return ''; });
      body.replace(/<(?:[\w-]+:)?Property\b([^>]*?)\/?>/g, (_, x) => {
        const p = xmlAttrs(x);
        if (p.Name) props[p.Name] = {
          name: p.Name, type: p.Type || '', maxLength: p.MaxLength || '', nullable: p.Nullable !== 'false',
          precision: p.Precision || '', scale: p.Scale || '', label: p['sap:label'] || '',
          creatable: p['sap:creatable'] !== 'false', updatable: p['sap:updatable'] !== 'false'
        };
        return '';
      });
      if (a.Name) types[a.Name] = { name: a.Name, keys, props };
    }
    t.replace(/<(?:[\w-]+:)?EntitySet\b([^>]*?)\/?>/g, (_, x) => { const a = xmlAttrs(x); if (a.Name) sets[a.Name] = String(a.EntityType || '').split('.').pop(); return ''; });
    return { odataVersion, types, sets };
  }
  function entityTypeFor(meta, resource) {
    if (!meta) return null;
    const set = String(resource || '').split('/')[0].replace(/\(.*$/, '');
    const name = meta.sets[set];
    return name && meta.types[name] ? Object.assign({ set }, meta.types[name]) : null;
  }
  function describeProp(p) {
    const bits = [p.type];
    if (p.maxLength) bits.push(t('max length {0}', p.maxLength));
    if (p.precision) bits.push(t('precision {0}', p.precision) + (p.scale ? t(', {0} decimals', p.scale) : ''));
    bits.push(p.nullable ? t('optional') : t('mandatory'));
    if (!p.creatable) bits.push(t('not creatable'));
    if (!p.updatable) bits.push(t('not updatable'));
    return bits.join(' · ') + (p.label ? t(' — “{0}”', p.label) : '');
  }
  /* Compares the values sent (JSON body) with the $metadata constraints */
  function checkValues(type, obj, method, odataVersion) {
    const issues = [];
    if (!type || !obj || typeof obj !== 'object' || Array.isArray(obj)) return issues;
    const add = (prop, level, text) => issues.push({ prop, level, text });
    const m = String(method || '').toUpperCase();
    Object.keys(obj).forEach(k => {
      if (k === '__metadata' || k.startsWith('@')) return;
      const p = type.props[k], v = obj[k];
      if (!p) {
        if (v === null || typeof v !== 'object') add(k, 'warn', t('“{0}” does not exist in type {1}: the service will ignore or reject this field.', k, type.name));
        return;
      }
      if (m === 'POST' && !p.creatable) add(k, 'warn', t('“{0}” is marked not creatable (sap:creatable=false).', k));
      if (/^(PUT|PATCH|MERGE)$/.test(m) && !p.updatable) add(k, 'warn', t('“{0}” is marked not updatable (sap:updatable=false).', k));
      if (v === null || v === '') {
        if (!p.nullable) add(k, 'error', t('“{0}” is mandatory (Nullable=false) but the value sent is {1}.', k, v === null ? 'null' : t('empty')));
        return;
      }
      const ty = p.type, s = String(v);
      if (ty === 'Edm.String') {
        if (typeof v !== 'string') add(k, 'warn', t('“{0}” expects a string (Edm.String), value sent of type {1}.', k, typeof v));
        else if (/^\d+$/.test(p.maxLength) && v.length > +p.maxLength) add(k, 'error', t('“{0}”: {1} characters for a max length of {2}.', k, v.length, p.maxLength));
      } else if (ty === 'Edm.Decimal' || ty === 'Edm.Int64' || ty === 'Edm.Double' || ty === 'Edm.Single') {
        if (odataVersion !== 4 && typeof v === 'number' && ty !== 'Edm.Double' && ty !== 'Edm.Single') add(k, 'warn', t('“{0}” ({1}) is sent as a number: in OData V2 it must be a string, for example "{2}".', k, ty, v));
        if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) add(k, 'error', t('“{0}” ({1}): “{2}” is not a valid number (decimal separator: dot).', k, ty, s));
        else if (ty === 'Edm.Decimal') {
          const [ip, fp = ''] = s.replace('-', '').split('.');
          if (/^\d+$/.test(p.scale) && fp.length > +p.scale) add(k, 'error', t('“{0}”: {1} decimals for {2} allowed.', k, fp.length, p.scale));
          if (/^\d+$/.test(p.precision) && ip.replace(/^0+/, '').length > (+p.precision - (+p.scale || 0))) add(k, 'error', t('“{0}”: too many digits before the decimal point (precision {1}, {2} decimals).', k, p.precision, p.scale || 0));
        }
      } else if (/^Edm\.(Int16|Int32|Byte|SByte)$/.test(ty)) {
        if (!Number.isInteger(Number(v)) || typeof v === 'boolean') add(k, 'error', t('“{0}” ({1}): “{2}” is not an integer.', k, ty, s));
      } else if (ty === 'Edm.Boolean') {
        if (typeof v !== 'boolean') add(k, 'warn', t('“{0}” expects true or false (Edm.Boolean), value sent: {1}.', k, JSON.stringify(v)));
      } else if (ty === 'Edm.DateTime') {
        if (typeof v !== 'string' || !(/^\/Date\(-?\d+([+-]\d{4})?\)\/$/.test(v) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v))) add(k, 'warn', t('“{0}” (Edm.DateTime): expected format "/Date(milliseconds)/" or "YYYY-MM-DDThh:mm:ss", received {1}.', k, JSON.stringify(v)));
      } else if (ty === 'Edm.Time') {
        if (!/^PT(\d+H)?(\d+M)?(\d+(\.\d+)?S)?$/.test(s)) add(k, 'warn', t('“{0}” (Edm.Time): expected format "PT12H30M00S", received {1}.', k, JSON.stringify(v)));
      } else if (ty === 'Edm.Guid') {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) add(k, 'error', t('“{0}” (Edm.Guid): “{1}” is not a valid GUID.', k, s));
      }
    });
    if (m === 'POST') {
      Object.values(type.props).forEach(p => {
        if (!p.nullable && p.creatable && !(p.name in obj) && !type.keys.includes(p.name)) add(p.name, 'warn', t('“{0}” is mandatory but missing from the body sent.', p.name));
      });
    }
    return issues;
  }
  /* Fields to explain for an error: detail targets, fields cited in the messages, faulty fields */
  function relevantProps(type, err, issues) {
    if (!type) return [];
    const names = new Set();
    const props = Object.keys(type.props);
    ((err && err.details) || []).forEach(d => { const t = String(d.target || '').split('/').pop().replace(/^.*\(/, '').replace(/\).*$/, ''); if (type.props[t]) names.add(t); });
    const text = [err && err.message].concat(((err && err.details) || []).map(d => d.message)).join(' ').toLowerCase();
    props.forEach(n => { if (n.length > 2 && new RegExp('\\b' + n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(text)) names.add(n); });
    (issues || []).forEach(i => { if (type.props[i.prop]) names.add(i.prop); });
    return [...names].slice(0, 12).map(n => type.props[n]);
  }
  function parseJsonBody(b) {
    const t = String(b || '').trim();
    if (!t.startsWith('{')) return null;
    try { return JSON.parse(t); } catch (_) { return null; }
  }

  /* ---------- Log ---------- */
  function batchSubRequests(reqBody, resText) {
    const subs = [];
    const re = /^(GET|POST|PUT|PATCH|MERGE|DELETE) (\S+) HTTP\/1\.[01]/gm;
    let m;
    while ((m = re.exec(String(reqBody || '')))) subs.push({ method: m[1], path: m[2], status: 0 });
    const st = [];
    const rs = /HTTP\/1\.[01] (\d{3})/g;
    while ((m = rs.exec(String(resText || '')))) st.push(+m[1]);
    if (st.length === subs.length) subs.forEach((s, i) => { s.status = st[i]; });
    else if (!subs.length) st.forEach(code => subs.push({ method: '?', path: '?', status: code }));
    return subs;
  }
  /* $batch details: each sub-request (method, path, useful headers, body) with its response.
     Multipart (V2/V4, changesets included) or JSON (V4). A failed changeset returns a single response:
     it is then assigned to all its requests (changesetError). */
  const PART_HEADERS = ['content-type', 'accept', 'if-match', 'if-none-match', 'etag', 'location', 'sap-message', 'content-id', 'dataserviceversion', 'odata-version', 'x-http-method', 'prefer', 'preference-applied', 'odata-entityid'];
  function multipartParts(text) {
    const lines = String(text || '').split(/\r?\n/);
    const first = lines.find(l => /^--\S/.test(l));
    if (!first) return null;
    const b = first.trim().replace(/--$/, '');
    const parts = [];
    let cur = null;
    for (const l of lines) {
      const s = l.trimEnd();
      if (s === b || s === b + '--') { if (cur) parts.push(cur.join('\n')); cur = s === b ? [] : null; continue; }
      if (cur) cur.push(l);
    }
    return parts;
  }
  function headerBlock(text, keepLead) {
    const lines = (keepLead ? String(text) : String(text).replace(/^(\s*\n)+/, '')).split('\n');
    const head = {};
    let i = 0;
    for (; i < lines.length && lines[i].trim() !== ''; i++) { const k = lines[i].indexOf(':'); if (k > 0) head[lines[i].slice(0, k).trim().toLowerCase()] = lines[i].slice(k + 1).trim(); }
    return { head, rest: lines.slice(i + 1).join('\n') };
  }
  function httpMessage(text) {
    const lines = String(text).replace(/^(\s*\n)+/, '').split('\n');
    const start = lines.shift() || '';
    const { head, rest } = headerBlock(lines.join('\n'), true); // right under the status line: there may be no headers
    const keep = {};
    Object.keys(head).forEach(k => { if (PART_HEADERS.includes(k)) keep[k] = head[k]; });
    return { start: start.trim(), headers: keep, body: rest.replace(/\s+$/, '') };
  }
  function batchGroups(text) {
    const parts = multipartParts(text);
    if (!parts) return null;
    return parts.map(p => {
      const { head, rest } = headerBlock(p);
      if (/multipart\/mixed/i.test(head['content-type'] || '')) return { changeset: true, items: (multipartParts(rest) || []).map(x => httpMessage(headerBlock(x).rest)) };
      return { changeset: false, items: [httpMessage(rest)] };
    });
  }
  function batchDetails(reqBody, resText, max) {
    const lim = max || 4000;
    const cut = s => { s = String(s || ''); return s.length > lim ? s.slice(0, lim) + '\n…' : s; };
    const reqT = String(reqBody || '').trim(), resT = String(resText || '').trim();
    // OData V4 in JSON format: { requests: [...] } / { responses: [...] }, paired by id
    if (reqT.startsWith('{')) {
      let rq = null, rs = null;
      try { rq = JSON.parse(reqT); } catch (_) { rq = null; }
      try { rs = JSON.parse(resT); } catch (_) { rs = null; }
      if (!rq || !Array.isArray(rq.requests)) return [];
      const byId = {};
      ((rs && rs.responses) || []).forEach(x => { if (x && x.id !== undefined) byId[x.id] = x; });
      return rq.requests.slice(0, 60).map(q => {
        const r = byId[q.id] || {};
        return { method: String(q.method || '').toUpperCase(), path: String(q.url || ''), changeset: !!q.atomicityGroup, reqHeaders: q.headers || {}, reqBody: q.body === undefined ? '' : cut(JSON.stringify(q.body, null, 2)),
          status: Number(r.status) || 0, statusText: '', resHeaders: r.headers || {}, resBody: r.body === undefined ? '' : cut(JSON.stringify(r.body, null, 2)) };
      });
    }
    const rq = batchGroups(reqT), rs = batchGroups(resT) || [];
    if (!rq) return [];
    const out = [];
    const resp = (m, cs) => {
      const st = m ? m.start.match(/^HTTP\/1\.[01] (\d{3}) ?(.*)$/) : null;
      return { status: st ? +st[1] : 0, statusText: st ? st[2] : '', resHeaders: m ? m.headers : {}, resBody: m ? cut(m.body) : '', changesetError: !!cs };
    };
    const reqOf = (m, cs) => {
      const rl = m.start.match(/^(\w+) (\S+) HTTP\/1\.[01]$/) || [];
      return { method: rl[1] || '?', path: rl[2] || m.start, changeset: cs, reqHeaders: m.headers, reqBody: cut(m.body) };
    };
    const sameShape = rq.length === rs.length;
    if (sameShape) {
      rq.forEach((g, i) => {
        const r = rs[i];
        g.items.forEach((m, j) => {
          // failed changeset: a single response (outside a changeset) for all its requests
          const single = g.changeset && (!r.changeset || r.items.length === 1) && g.items.length > 1;
          out.push(Object.assign(reqOf(m, g.changeset), resp(single ? r.items[0] : r.items[j], single)));
        });
      });
    } else {
      const flatQ = rq.flatMap(g => g.items.map(m => ({ m, cs: g.changeset })));
      const flatR = rs.flatMap(g => g.items);
      flatQ.forEach((x, i) => out.push(Object.assign(reqOf(x.m, x.cs), resp(flatR[i], false))));
    }
    return out.slice(0, 60);
  }
  function batchMarkdown(e) {
    const L = [t('# $batch {0} — {1}', e.service || '?', new Date(e.time).toLocaleString(loc())), '', `- POST ${e.url}`, t('- HTTP status: {0}', e.status), ''];
    (e.parts || []).forEach((p, i) => {
      L.push(`## ${i + 1}. ${p.status || '?'} ${p.method} ${p.path}${p.changeset ? ' (changeset)' : ''}`);
      if (p.reqBody) L.push('', t('Body sent:'), '```', p.reqBody, '```');
      if (p.resBody) L.push('', t('Response body:'), '```', p.resBody, '```');
      L.push('');
    });
    return L.join('\n');
  }

  function curlFor(e) {
    const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
    const L = [`curl -X ${e.method} ${q(e.url)}`, `  -H ${q('Accept: application/json')}`];
    if (e.reqType) L.push(`  -H ${q('Content-Type: ' + e.reqType)}`);
    if (e.reqBody) L.push(`  --data-raw ${q(e.reqBody)}`);
    L.push(t("  # Authentication to add (not copied for security): -u USER or -H 'Cookie: …'"));
    if (!/^(GET|HEAD)$/i.test(e.method)) L.push(t("  # Write request: SAP Gateway also requires an X-CSRF-Token (obtained by a GET with 'X-CSRF-Token: Fetch')"));
    return L.join(' \\\n');
  }

  /* ---------- Environment switch, SAP logs ---------- */
  // Same address (path, parameters, #navigation) on another environment's system; the SAP client
  // is the target environment's if defined, otherwise removed (the page's client may not exist there)
  function swapEnvUrl(url, base, client) {
    const x = new URL(url), b = new URL(String(base).trim());
    x.protocol = b.protocol; x.host = b.host;
    const parts = x.search.replace(/^\?/, '').split('&').filter(p => p && !/^sap-client=/i.test(p));
    if (client) parts.push('sap-client=' + encodeURIComponent(client));
    x.search = parts.length ? '?' + parts.join('&') : '';
    return x.href;
  }
  const BTP_HOST = /(\.|^)(hana\.ondemand\.com|cfapps\.[\w.-]+|ondemand\.com|cloud\.sap)$/i;
  // ABAP system on which to open SAP GUI for HTML: the environment's system URL, otherwise the host of the
  // OData request when it is an ABAP server (/sap/opu/) and not a BTP service (approuter, Work Zone)
  function systemBaseFor(reqUrl, env) {
    const b = env && String(env.base || '').trim();
    if (b) { try { const u = new URL(b); if (/^https?:$/.test(u.protocol)) return u.origin; } catch (_) { /* invalid */ } }
    try { const u = new URL(reqUrl); if (/\/sap\/opu\//i.test(u.pathname) && !BTP_HOST.test(u.hostname)) return u.origin; } catch (_) { /* invalid */ }
    return '';
  }
  function sapGuiUrl(origin, tcode, client) {
    if (!origin) return '';
    return origin + '/sap/bc/gui/sap/its/webgui?~transaction=' + encodeURIComponent(tcode) + (client ? '&sap-client=' + encodeURIComponent(client) : '');
  }

  /* ---------- OData log export ---------- */
  const cell = v => String(v === undefined || v === null ? '' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  function logMarkdown(list, ctx) {
    const c = ctx || {};
    const L = [t('# OData log — {0}', c.host || '?'), ''];
    L.push(t('- Exported: {0}', new Date(c.now || Date.now()).toLocaleString(loc())));
    if (c.env) L.push(t('- Environment: {0}{1}', c.env, ''));
    if (c.pageUrl) L.push(t('- Application page: {0}', c.pageUrl));
    L.push(t('- {0} request(s) · {1} failed', list.length, list.filter(e => e.errors).length), '');
    L.push('| ' + [t('Time'), t('Method'), t('Service / resource'), t('Status'), t('Duration'), t('Size')].join(' | ') + ' |');
    L.push('|---|---|---|---|---|---|');
    list.forEach(e => L.push('| ' + [
      new Date(e.time).toLocaleTimeString(loc()), e.method, cell((e.service || '?') + ' / ' + (e.resource || '?')) + (e.simulated ? ' ' + t('(simulated)') : ''),
      String(e.status || '—') + (e.errors ? ' ⚠' : ''), Math.round(e.ms || 0) + ' ms', Math.round((e.size || 0) / 1024) + ' KB'
    ].join(' | ') + ' |'));
    const batches = list.filter(e => e.batch && e.subs && e.subs.length);
    if (batches.length) {
      L.push('', t('## $batch details'));
      batches.forEach(e => {
        L.push('', `### ${new Date(e.time).toLocaleTimeString(loc())} · ${e.service || '?'} / $batch`);
        e.subs.forEach(s => L.push(`- ${s.status || '?'} ${s.method} ${s.path}`));
      });
    }
    if (list.length) {
      L.push('', t('## Full URLs'));
      list.forEach(e => L.push(`- ${e.method} ${e.url}`));
    }
    return L.join('\n');
  }
  function logJson(list, ctx) {
    const c = ctx || {};
    return JSON.stringify({
      exportedAt: new Date(c.now || Date.now()).toISOString(), tool: 'Compagnon SAP Fiori ' + (c.version || ''),
      environment: c.env || null, page: c.pageUrl || null,
      entries: list.map(e => ({
        time: new Date(e.time).toISOString(), method: e.method, url: e.url, service: e.service, resource: e.resource, status: e.status,
        durationMs: Math.round(e.ms || 0), size: e.size || 0, failed: e.errors || 0, simulated: !!e.simulated,
        batch: e.batch ? (e.subs || []).map(s => ({ method: s.method, path: s.path, status: s.status })) : undefined,
        requestBody: e.reqBody || undefined, responseBody: e.resBody || undefined
      }))
    }, null, 2);
  }

  /* ---------- Missing i18n texts ---------- */
  function i18nMarkdown(frames) {
    const L = [t('# Missing i18n texts')];
    (frames || []).forEach(f => {
      const r = f.i18n;
      if (!r) return;
      L.push('', `## ${f.frameUrl || '?'}`, t('- {0} bound text(s) checked · {1} missing · {2} unresolved binding(s) in the page', r.checked, r.missing.length, r.raw.length));
      r.missing.forEach(m => L.push(`- \`${m.model ? m.model + '>' : ''}${m.key}\` — ${m.control} #${m.id} (${m.prop})`));
      r.raw.forEach(x => L.push(t('- Unresolved: {0}', '`' + x + '`')));
    });
    return L.join('\n');
  }

  /* ---------- Control inspector ---------- */
  function inspectionMarkdown(d) {
    if (!d) return '';
    const L = [t('## UI5 control {0}', d.type || '?'), '', t('- Id: {0}', d.id)];
    if (d.view) L.push(t('- View: {0}', d.view));
    if (d.controller) L.push(t('- Controller: {0}', d.controller));
    L.push(t('- SAPUI5: {0} · page: {1}', d.ui5 || '?', d.frameUrl || '?'));
    if (d.context) L.push(t('- Binding context: {0} ({1}){2}', d.context.path || '?', d.context.model || t('model ?'), d.context.serviceUrl ? ' · service ' + d.context.serviceUrl : ''));
    const empty = v => (v === '' ? t('(empty)') : v);
    const bound = (d.props || []).filter(p => p.path);
    if (bound.length) { L.push('', t('### Bound properties')); bound.forEach(p => L.push(`- ${p.name} ← {${p.path}} = ${empty(p.value)}`)); }
    const other = (d.props || []).filter(p => !p.path);
    if (other.length) { L.push('', t('### Other properties')); other.forEach(p => L.push(`- ${p.name} = ${empty(p.value)}`)); }
    if ((d.aggs || []).length) { L.push('', t('### Bound aggregations')); d.aggs.forEach(a => L.push(`- ${a.name} ← {${a.path}}`)); }
    if (d.context && d.context.object) L.push('', t('### Context data'), '```json', d.context.object, '```');
    return L.join('\n');
  }

  root.SAPC = { batchDetails, batchMarkdown, swapEnvUrl, systemBaseFor, sapGuiUrl, logMarkdown, logJson, i18nMarkdown, serviceRootOf, metadataUrlOf, parseMetadata, entityTypeFor, describeProp, checkValues, relevantProps, parseJsonBody, batchSubRequests, curlFor, inspectionMarkdown, buildClaudePrompt, safeHeaders, categoryOf, perfStats, DEFAULT_SETTINGS, PRESETS, withDefaults, patternMatches, sapClientOf, matchEnv, isODataUrl, describeUrl, parseODataError, parseBatch, parseSapMessage, hintsFor };
})(typeof globalThis !== 'undefined' ? globalThis : this);
