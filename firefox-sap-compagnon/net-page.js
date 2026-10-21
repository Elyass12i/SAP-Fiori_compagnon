/* Chrome only — OData capture in the page's MAIN world (every frame, document_start).
   Chrome does not let extensions read response bodies (no webRequest.filterResponseData), so this script observes
   XMLHttpRequest and fetch passively: requests are sent unchanged, responses are read without being altered.
   Only OData URLs are reported, to page-bridge.js (isolated world), which forwards them to the background
   where they go through the same processing as in Firefox. Cookies are never read (the browser adds them). */
(function () {
  'use strict';
  const MAX = 2 * 1024 * 1024;
  const isOData = url => /\/sap\/opu\/odata4?\//i.test(url) || /\/odata\//i.test(url) || /\$batch(\?|$)/i.test(url);
  const post = ex => { try { window.postMessage({ __sapcNet: JSON.stringify(ex) }, '*'); } catch (_) { /* no effect */ } };
  if (window === window.top) post({ pageStart: true, url: location.href });

  const X = window.XMLHttpRequest;
  if (X) {
    const P = X.prototype;
    const N = { open: P.open, send: P.send, setRequestHeader: P.setRequestHeader };
    const meta = new WeakMap();
    P.open = function (method, url) {
      try {
        const abs = new URL(String(url), location.href).href;
        if (isOData(abs)) meta.set(this, { method: String(method).toUpperCase(), url: abs, headers: {} });
        else meta.delete(this);
      } catch (_) { meta.delete(this); }
      return N.open.apply(this, arguments);
    };
    P.setRequestHeader = function (k, v) {
      const m = meta.get(this);
      if (m) m.headers[String(k).toLowerCase()] = String(v);
      return N.setRequestHeader.apply(this, arguments);
    };
    P.send = function (body) {
      const m = meta.get(this);
      if (m) {
        const t0 = Date.now();
        const reqBody = typeof body === 'string' ? body.slice(0, 400000) : '';
        this.addEventListener('loadend', () => {
          let text = '';
          try { if (this.responseType === '' || this.responseType === 'text') text = this.responseText || ''; } catch (_) { text = ''; }
          let headers = '';
          try { headers = this.getAllResponseHeaders() || ''; } catch (_) { headers = ''; }
          post({ url: m.url, method: m.method, time: t0, ms: Date.now() - t0, reqHeaders: m.headers, reqBody, status: this.status, statusText: this.statusText || '', headers, size: text.length, text: text.slice(0, MAX) });
        });
      }
      return N.send.apply(this, arguments);
    };
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input, init) {
      let url = '', method = 'GET', reqBody = '', reqHeaders = {};
      try {
        const isReq = typeof Request !== 'undefined' && input instanceof Request;
        url = new URL(isReq ? input.url : String(input), location.href).href;
        method = String((init && init.method) || (isReq ? input.method : 'GET')).toUpperCase();
        reqBody = init && typeof init.body === 'string' ? init.body.slice(0, 400000) : '';
        new Headers((init && init.headers) || (isReq ? input.headers : undefined)).forEach((v, k) => { reqHeaders[k] = v; });
      } catch (_) { url = ''; }
      const p = nativeFetch.apply(this, arguments);
      if (!url || !isOData(url)) return p;
      const t0 = Date.now();
      p.then(res => {
        const headers = [];
        res.headers.forEach((v, k) => headers.push(k + ': ' + v));
        res.clone().text().then(text => {
          post({ url, method, time: t0, ms: Date.now() - t0, reqHeaders, reqBody, status: res.status, statusText: res.statusText || '', headers: headers.join('\r\n'), size: text.length, text: text.slice(0, MAX) });
        }, () => {});
      }, () => {});
      return p;
    };
  }
})();
