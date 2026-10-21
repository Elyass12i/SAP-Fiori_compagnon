/* Chrome only — relay between the page's MAIN world scripts and the extension (isolated content script,
   every frame, document_start). Chrome's isolated world cannot reach the page's JavaScript objects (Firefox
   offers window.wrappedJSObject), so net-page.js and inspect.js run in the MAIN world and talk to this script
   through window.postMessage. A page can post the same messages: they only affect what the extension shows
   for that page's own tab. */
(() => {
  'use strict';
  const send = m => browser.runtime.sendMessage(m).catch(() => {});
  window.addEventListener('message', e => {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    // OData exchange observed by net-page.js
    if (typeof d.__sapcNet === 'string') {
      let ex;
      try { ex = JSON.parse(d.__sapcNet); } catch (_) { return; }
      if (ex && ex.pageStart) { if (window === window.top) send({ type: 'sapc-page-start' }); return; }
      if (ex && typeof ex.url === 'string' && typeof ex.method === 'string') send({ type: 'sapc-exchange', ex });
      return;
    }
    // Control inspector (inspect.js in the MAIN world)
    if (typeof d.__sapcInspOut === 'string') {
      let m;
      try { m = JSON.parse(d.__sapcInspOut); } catch (_) { return; }
      if (m && m.type === 'inspected' && m.data) send({ type: 'sapc-inspected', data: m.data });
      if (m && m.type === 'ready') sendSettings();
    }
  });
  const toPage = m => window.postMessage({ __sapcInspIn: JSON.stringify(m) }, '*');
  async function sendSettings() {
    let s = null;
    try { s = (await browser.storage.local.get('settings')).settings || null; } catch (_) { s = null; }
    toPage({ type: 'settings', settings: s ? { inspectAlt: s.inspectAlt !== false, lang: s.lang === 'fr' ? 'fr' : 'en' } : { inspectAlt: true, lang: 'en' } });
  }
  browser.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.settings) sendSettings(); });
  browser.runtime.onMessage.addListener(msg => {
    if (msg && (msg.type === 'sapc-inspect-start' || msg.type === 'sapc-inspect-stop')) toPage({ type: msg.type });
    return undefined;
  });
  sendSettings();
})();
