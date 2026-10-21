/* Error simulation relay (isolated content script, every frame, start of loading).
   Reads the simulation rules; if they are active AND the tab's environment allows it ("Sim." option),
   passes them to sim-page.js (page world). Sends each simulated response to the background, so that it
   appears in the errors and the log. Without active simulation, this script only reads the storage once. */
(() => {
  'use strict';
  let last = ''; // last configuration sent ('': never, 'null': disabled)

  function post(cfg) {
    const s = JSON.stringify(cfg);
    if (s === last) return;
    last = s;
    window.postMessage({ __sapcSim: cfg === null ? null : s }, '*');
  }
  async function refresh() {
    let sim = null;
    try { sim = (await browser.storage.local.get('sim')).sim; } catch (_) { return; }
    const rules = sim && sim.on && Array.isArray(sim.rules) ? sim.rules.filter(r => r && r.on !== false && String(r.match || '').trim()) : [];
    if (!rules.length) { if (last && last !== 'null') post(null); return; }
    let ok = null;
    try { ok = await browser.runtime.sendMessage({ type: 'sapc-sim-allowed', frameUrl: location.href }); } catch (_) { ok = null; }
    if (ok && ok.allowed) post({ rules, env: ok.env || '' });
    else if (last && last !== 'null') post(null);
  }

  window.addEventListener('message', e => {
    const d = e.data;
    if (!d || typeof d !== 'object' || typeof d.__sapcSimHit !== 'string' || !last || last === 'null') return;
    let hit;
    try { hit = JSON.parse(d.__sapcSimHit); } catch (_) { return; }
    if (!hit || typeof hit.url !== 'string' || typeof hit.method !== 'string') return;
    browser.runtime.sendMessage({ type: 'sapc-sim-hit', hit }).catch(() => {});
  });
  browser.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.sim || ch.settings)) refresh(); });
  refresh();
})();
