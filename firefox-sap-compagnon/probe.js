/* Probe run on demand in every frame of the tab: reads the page's SAPUI5 information.
   Firefox: window.wrappedJSObject gives access to the page's JavaScript objects from an extension script. */
(async () => {
  'use strict';
  const w = window.wrappedJSObject || window;
  const out = { frameUrl: location.href, top: window.top === window, ui5: false, components: [] };
  const safe = fn => { try { return fn(); } catch (_) { return undefined; } };
  const str = v => (v === undefined || v === null) ? '' : String(v);
  const toPlain = obj => { try { return JSON.parse(w.JSON.stringify(obj)); } catch (_) { return null; } };

  // Loading measurements (Navigation Timing + Resource Timing) of this frame
  const perfApi = safe(() => w.performance);
  if (perfApi) {
    const nav = (toPlain(safe(() => perfApi.getEntriesByType('navigation'))) || [])[0] || null;
    const res = toPlain(safe(() => perfApi.getEntriesByType('resource'))) || [];
    out.perf = {
      nav: nav ? { ttfb: nav.responseStart - nav.requestStart, domReady: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, type: nav.type } : null,
      now: safe(() => perfApi.now()) || 0,
      resources: res.map(r => ({ n: r.name, s: r.startTime, d: r.duration, e: r.responseEnd, ts: r.transferSize, ds: r.decodedBodySize }))
    };
  }

  const sap = safe(() => w.sap);
  const version = safe(() => sap && sap.ui && sap.ui.version);
  if (!version) return out;
  out.ui5 = true;
  out.version = str(version);
  out.buildTime = str(safe(() => sap.ui.buildinfo && sap.ui.buildinfo.buildtime));
  const req = safe(() => sap.ui.require);
  const mod = name => safe(() => req(name)); // synchronous form: returns the module if it is already loaded
  const Localization = mod('sap/base/i18n/Localization');
  const Theming = mod('sap/ui/core/Theming');
  // Fallback for UI5 versions before 1.118 (Configuration API, deprecated since)
  const conf = safe(() => sap.ui.getCore().getConfiguration());
  out.language = str(safe(() => Localization.getLanguage()) || safe(() => conf.getLanguage()));
  out.theme = str(safe(() => Theming.getTheme()) || safe(() => conf.getTheme()));
  const boot = document.getElementById('sap-ui-bootstrap');
  out.bootstrap = boot ? boot.src : '';
  out.cacheTokenInBootstrap = /\/~[^/]+~\//.test(out.bootstrap);

  const Component = mod('sap/ui/core/Component');
  const all = safe(() => Component.registry.all());
  if (all) {
    for (const id of Object.keys(all)) {
      const comp = safe(() => all[id]);
      const man = toPlain(safe(() => comp.getManifest()));
      if (!man) continue;
      const app = man['sap.app'] || {};
      const ui5 = man['sap.ui5'] || {};
      const appId = str(app.id);
      const manifestUrl = appId ? str(safe(() => req.toUrl(appId.replace(/\./g, '/') + '/manifest.json'))) : '';
      const c = {
        id: appId, type: str(app.type), title: str(app.title), version: str(app.applicationVersion && app.applicationVersion.version),
        minUI5: str(ui5.dependencies && ui5.dependencies.minUI5Version),
        dataSources: Object.entries(app.dataSources || {}).map(([k, v]) => ({ name: k, uri: str(v && v.uri), type: str(v && v.type), odata: str(v && v.settings && v.settings.odataVersion) })),
        manifestUrl, cacheToken: /\/~[^/]+~\//.test(manifestUrl), served: null
      };
      if (manifestUrl && !/^https?:/i.test(manifestUrl)) c.manifestUrl = new URL(manifestUrl, location.href).href;
      if (c.manifestUrl && c.type !== 'component') {
        try {
          const r = await fetch(c.manifestUrl, { method: 'HEAD', credentials: 'include', cache: 'no-store' });
          c.served = { status: r.status, lastModified: r.headers.get('last-modified') || '', etag: r.headers.get('etag') || '', cacheControl: r.headers.get('cache-control') || '' };
        } catch (_) { c.served = null; }
      }
      out.components.push(c);
    }
  } else {
    out.registryUnavailable = true;
  }
  out.components.sort((a, b) => (a.type === 'application' ? 0 : 1) - (b.type === 'application' ? 0 : 1));

  // Launchpad user: BTP identity in Work Zone, SAP user in an ABAP launchpad
  const Container = mod('sap/ushell/Container') || safe(() => sap.ushell && sap.ushell.Container);
  const user = safe(() => Container.getUser());
  if (user) out.user = { id: str(safe(() => user.getId())), name: str(safe(() => user.getFullName())), email: str(safe(() => user.getEmail())) };

  out.i18n = checkI18n();
  return out;

  /* i18n texts: properties bound to a ResourceModel whose key does not exist, and bindings left as raw text */
  function checkI18n() {
    const res = { checked: 0, missing: [], raw: [], unavailable: false };
    const ElementMod = mod('sap/ui/core/Element');
    const all = safe(() => ElementMod.registry.all()); // UI5 ≥ 1.67
    if (!all) res.unavailable = true;
    else {
      const seen = new Set();
      const isResource = m => !!safe(() => m.isA('sap.ui.model.resource.ResourceModel'));
      const bundleOf = m => {
        let b = safe(() => m.getResourceBundle());
        if (b && typeof safe(() => b.then) === 'function') b = safe(() => m._oResourceBundle); // asynchronous mode: bundle already loaded (internal property)
        return b && typeof safe(() => b.getText) === 'function' ? b : null;
      };
      const ids = Object.keys(all);
      for (let n = 0; n < ids.length && n < 20000 && res.missing.length < 60; n++) {
        const id = ids[n];
        const ctl = safe(() => all[id]);
        const meta = safe(() => ctl.getMetadata());
        const props = safe(() => meta.getAllProperties());
        if (!props) continue;
        for (const name of Object.keys(props)) {
          const bi = safe(() => ctl.getBindingInfo(name));
          const parts = bi && safe(() => bi.parts);
          const count = parts ? safe(() => parts.length) || 0 : 0;
          for (let i = 0; i < count; i++) {
            const modelName = str(safe(() => parts[i].model));
            const key = str(safe(() => parts[i].path)).replace(/^\//, '');
            if (!key) continue;
            const model = safe(() => ctl.getModel(modelName || undefined));
            if (!model || !isResource(model)) continue;
            res.checked++;
            let missing = false;
            const bundle = bundleOf(model);
            if (bundle) {
              let txt, threw = false;
              try { txt = bundle.getText(key, undefined, true); } catch (_) { threw = true; } // true: no fallback to the key
              missing = !threw && (txt === undefined || txt === null);
            } else if (count === 1 && !safe(() => bi.formatter)) {
              missing = str(safe(() => ctl.getProperty(name))) === key; // without an accessible bundle: the key displayed as is
            }
            const k = modelName + '>' + key;
            if (missing && !seen.has(k)) { seen.add(k); res.missing.push({ key, model: modelName, control: str(safe(() => meta.getName())), id: str(id), prop: name }); }
          }
        }
      }
    }
    // Uninterpreted bindings, visible as is in the page (e.g. "{i18n>title}")
    const RAW = /\{@?[\w.]*i18n[\w.]*>[^}]{1,120}\}/gi;
    const raw = new Set();
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    for (let n = 0, node; (node = walker.nextNode()) && n < 20000 && raw.size < 30; n++) {
      const m = node.nodeValue && node.nodeValue.match(RAW);
      if (m) m.forEach(x => raw.add(x));
    }
    document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(e => {
      ['placeholder', 'title', 'aria-label'].forEach(a => { const m = (e.getAttribute(a) || '').match(RAW); if (m && raw.size < 30) m.forEach(x => raw.add(x)); });
    });
    res.raw = [...raw];
    return res;
  }
})();
