/* Firefox / Chrome compatibility, loaded first in every extension context (background, pages, isolated content scripts).
   - Chrome exposes the WebExtension APIs as `chrome` (promise-based in Manifest V3): `browser` is aliased to it.
   - A runtime.onMessage listener that returns a Promise is enough in Firefox; Chrome needs sendResponse:
     sapcOnMessage() accepts a handler returning a value, a Promise or undefined, and works in both.
   - SAPC_ENV.chrome: true in Chrome (no runtime.getBrowserInfo, which only Firefox has). */
(function (g) {
  'use strict';
  if (typeof g.browser === 'undefined' && typeof g.chrome !== 'undefined' && g.chrome.runtime) g.browser = g.chrome;
  const isChrome = !(g.browser && g.browser.runtime && typeof g.browser.runtime.getBrowserInfo === 'function');
  g.SAPC_ENV = { chrome: isChrome, pageWorld: isChrome ? 'MAIN' : 'ISOLATED' };
  g.sapcOnMessage = handler => g.browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    let r;
    try { r = handler(msg, sender); } catch (_) { return false; }
    if (r && typeof r.then === 'function') {
      r.then(v => sendResponse(v), () => sendResponse(undefined));
      return true; // keeps the channel open until sendResponse
    }
    if (r !== undefined) sendResponse(r);
    return false;
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
