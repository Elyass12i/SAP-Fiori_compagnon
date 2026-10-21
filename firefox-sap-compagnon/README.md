# Compagnon SAP Fiori (Firefox extension)

**English** · [Français](README.fr.md)

Everyday helpers for SAPUI5 / Fiori / SAP Gateway work. The interface is in English by default; choose French in the options (**Interface language**).

1. **Environment banner**: colour frame and label (DEV, ACC, PROD…) on pages that match your URL rules, and a prefix in the tab title (`[PROD] …`).
2. **OData error decoder**: every failed OData response (V2/V4, Gateway or CAP, including `$batch` sub-requests) is read, its SAP message extracted (code, message, per-field details, transaction ID) and a lead suggested (CSRF, authorisations, `/IWFND/ERROR_LOG`…). Notification in the page, badge on the icon, full list in the extension window. The **Copy for Claude** button produces a data report to paste into an AI, with no instructions: context (environment, SAP client, UI5 version, component, OData sources), request (method, URL, parameters, useful headers, body sent), decoded SAP response, other recent errors in the tab and service metadata. Cookies and CSRF token values are never included; the request body may however contain business data: review it before sharing. `sap-message` messages from successful responses are listed too.
3. **App sheet** (**Application** tab, opened by default): **Loading** section — page loaded, last resource, time to first byte, DOM ready, number and size of requests, share served from cache, OData requests (count, median, maximum), breakdown by type, the 8 slowest resources, and automatic findings (UI5 debug mode, missing Component-preload, OData > 1 s, little cache use). Then: UI5 version, theme, language, bootstrap URL, loaded components (id, app version, OData sources), and the headers actually served for `manifest.json` (Last-Modified, ETag, Cache-Control). **Reload without cache** button.
4. **Errors explained by the `$metadata`**: for each error, the extension reads the service `$metadata` and shows the definition of the fields involved (type, max length, precision, mandatory, label). It also checks the values sent: length exceeded, empty mandatory field, `Edm.Decimal` sent as a number in V2, date format, GUID, boolean, unknown or non-updatable field. These are added to the **Copy for Claude** report.
5. **OData log** (**Log** tab): every OData request of the tab, with duration, size, status, decoded parameters (`$filter`, `$expand`…), body sent and received. Filter, **Errors** checkbox (errors only), **Replay** for GET requests, **Copy as curl** (without authentication), **Copy log (Markdown)** and **Save (JSON)** — the JSON file contains body excerpts, which may hold business data.
   **`$batch` details**: each sub-request is listed with its method, path and status; unfold it to see the headers and body sent, the response and the decoded SAP error. Changesets are flagged; a rejected changeset returns a single error, shown on each of its requests. **Copy $batch (Markdown)**. An error inside a `$batch` appears in the Errors tab with the real sub-request (method, entity, body), so the `$metadata` check applies to it.
6. **Control inspector**: **Alt+click** on an element of a SAPUI5 application (or the **Inspect an element** button in the **Inspector** tab) shows the control (type, id), its view and controller, the binding context, each property with its binding path and value, and the model data. Also works inside frames (launchpad, Work Zone). Alt+click can be turned off in the options.
7. **Environment comparison** (app sheet → **Compare environments**): app version (`manifest.json`) and UI5 version on DEV / ACC / PROD side by side. Fill in the **system URL** of each environment in the options; environments where you have no open session are reported as “not connected”.

8. **Open in DEV / ACC / PROD**: buttons next to the environment open the same page (path, parameters, `#` navigation) on the system of another environment; the SAP client is the target environment’s, if defined. Only the host changes: if the app path differs between systems (e.g. different Work Zone sites), adjust the URL.
9. **SAP logs**: on an error, **/IWFND/ERROR_LOG** and **/IWBEP/ERROR_LOG** open SAP GUI for HTML (`/sap/bc/gui/sap/its/webgui`) on the environment’s system URL — or on the OData host when it is an ABAP server, not an SAP BTP host. The transaction ID is copied to the clipboard so you can filter the list (SAP GUI for HTML cannot pre-fill it).
10. **Missing i18n texts** (Application tab): every control property bound to a `ResourceModel` is checked; keys missing from the i18n files are listed with their control, as well as `{i18n>…}` bindings displayed as raw text (wrong model name or syntax). Requires UI5 1.67+.
11. **Signed-in user** (Application tab): the launchpad user (`sap.ushell`), i.e. the BTP identity in SAP Build Work Zone. **Look up BTP / SAP users** queries, with your session, `/user-api/currentUser` (SAP BTP application router — only if the app’s `xs-app.json` exposes the user API) and `/sap/bc/ui2/start_up` (ABAP launchpad: the SAP user, possibly a technical one). Nothing is sent anywhere else.
12. **Error simulation** (**Simulate** tab, development systems only): rules make matching OData requests answer with an HTTP error (400…504, SAP-format message, optional target field), a network error, or a delay. Errors are produced in the page: the request never reaches the backend. A read-only `$batch` is sent and only the targeted sub-response is replaced; a `$batch` containing changes is answered entirely with the error (nothing is written). **Simulate an error** on a log entry pre-fills a rule. Safeguards: allowed only on environments ticked **Sim.** in the options (DEV preset only), red banner in the page and in the panel, rules **once** possible, switched off at every Firefox start. Simulated errors are marked “simulated” in the Errors and Log tabs.

Everything stays in your browser: no data is sent anywhere else. The page receives the OData response untouched (the extension only reads a copy, up to 2 MB) — unless you enable error simulation.

## Installation

Everything is done from the Git repository, with the `installer-firefox/` folder (Windows, PowerShell). Firefox 128 or later.

### Install or update (one command)
From the cloned repository folder:
```powershell
powershell -ExecutionPolicy Bypass -File .\installer-firefox\install.ps1 -Pull
```
The script fetches the latest version (`git pull`), then:
- **signed package** (detected automatically in `installer-firefox/compagnon-sap-fiori.xpi`): opens it in Firefox, which asks you to confirm the installation. The extension stays installed and is updated by running the same command again;
- **otherwise** (unsigned package): opens `about:debugging` and copies the file path; click “Load Temporary Add-on…” and paste the path. This installation is removed when Firefox restarts.

First clone:
```powershell
git clone https://github.com/Elyass12i/SAP-Fiori_compagnon.git
cd SAP-Fiori_compagnon
```

### Get a signed package (permanent installation) — one-time setup
Standard Firefox only installs extensions signed by Mozilla permanently. “Unlisted” signing is free and publishes nothing.
1. Create API keys at https://addons.mozilla.org/developers/addon/api/key/ (Firefox account required).
2. **Automatic signing (recommended)**: in GitHub, repository → Settings → Secrets and variables → Actions, add two secrets:
   `AMO_JWT_ISSUER` (the key, like `user:12345:67`) and `AMO_JWT_SECRET` (the secret).
   Each time the extension changes with a new `version` number in `manifest.json`, GitHub Actions checks it, has it signed, publishes a release and replaces `installer-firefox/compagnon-sap-fiori.xpi` with the signed package. Then just run `install.ps1 -Pull`.
3. **Or sign on your PC** (Node.js required):
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\installer-firefox\sign.ps1 -ApiKey "user:12345:67" -ApiSecret "your-secret"
   ```

Mozilla refuses to sign the same number twice: increase `version` in `manifest.json` before each new release.

### Other cases
- Firefox Developer Edition, Nightly or ESR: `about:config` → `xpinstall.signatures.required` = `false` lets you install the unsigned package permanently (setting ignored by standard Firefox).
- If your Firefox is managed by your organisation, installing extensions may be blocked: see `about:policies`.

## Sidebar
The extension window closes when you click elsewhere (Firefox behaviour). To keep it visible while testing, click **Sidebar** in the window, or use the **Alt+Shift+O** shortcut (can be changed in `about:addons` → gear icon → “Manage Extension Shortcuts”). The sidebar follows the active tab and refreshes at the end of each page load.

## First setup
On installation, the options page opens:
- add DEV / ACC / PROD with the buttons, then enter for each one a text contained in the URL (host name, path…) or a regular expression `/…/`;
- the SAP client is optional (the URL must then contain `sap-client=<value>`);
- **System URL** (optional): address of the environment’s system, used by the comparison, the “Open in” buttons and the SAP log links;
- **Sim.**: allows error simulation on the environment (development systems only);
- **Interface language**: English (default) or Français;
- **Test a URL** shows which rule applies.

## Development
- `i18n.js`: translations (English text as key, French translation); `t('Text {0}', value)`.
- `shared.js`: pure functions (rules, OData/`$batch` decoding, leads, Markdown).
- `background.js`: interception (`webRequest.filterResponseData`), per-tab storage (`storage.session`), badge.
- `content.js`: banner and notifications (Shadow DOM, does not alter the page’s style).
- `early.js`: enlarges the browser’s performance entry buffer from the start of loading (250 entries by default).
- `sidebar.html` / `popup.html`: same content (`popup.js`, `popup.css`) as a sidebar or a window.
- `inspect.js`: control inspector (all frames; carries its own small dictionary).
- `sim-page.js` (MAIN world) and `sim-bridge.js`: error simulation; inert until rules are active on an allowed environment.
- `probe.js`: reads UI5 information on demand (`scripting.executeScript`, `window.wrappedJSObject`).
- `compat.js`: Firefox / Chrome differences (`browser` alias, message listeners, page world for `scripting.executeScript`).
- Check: `npx web-ext lint -s firefox-sap-compagnon`; build: `npx web-ext build -s firefox-sap-compagnon`.

### Chrome / Edge
The same sources are packaged for Chrome by `node chrome/build.js` (manifest in `chrome/manifest.json`, PNG icons; writes `installer-chrome/compagnon-sap-fiori-chrome.zip`, or an unpacked folder with `--dir <folder>`). Bump `version` in both manifests together: the build refuses a mismatch. Differences:
- background: service worker (`background.js` loads `compat.js`, `i18n.js`, `shared.js` with `importScripts`);
- OData capture: Chrome has no `webRequest.filterResponseData`, so `net-page.js` (MAIN world) observes XMLHttpRequest / fetch in the page without altering them and `page-bridge.js` forwards the exchanges to the background, where they go through the same processing;
- the page’s JavaScript objects are only reachable from the MAIN world: `probe.js` and the user lookup run there (`SAPC_ENV.pageWorld`), and `inspect.js` runs there too, talking to `page-bridge.js` with `postMessage`;
- side panel (`side_panel`, `sidePanel.open`) instead of `sidebar_action`; shortcut command `open-side-panel`.
