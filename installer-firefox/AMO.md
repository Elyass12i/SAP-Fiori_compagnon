# Texts for addons.mozilla.org (AMO)

[Français](AMO.fr.md) · **English** — AMO accepts one description per language: paste this one for English, the French one for French.

## Name
Compagnon SAP Fiori

## Summary (250 characters max)
Helps test and debug SAPUI5 / Fiori apps: DEV/ACC/PROD banner, OData errors decoded and explained by the $metadata, OData log with $batch details, control inspector, version comparison and error simulation.

## Description
Compagnon SAP Fiori saves time for developers and testers of SAPUI5 / Fiori applications (SAP Gateway, SAP BTP, CAP services): what you usually dig out of the developer tools is displayed clearly, in English or French.

• Environment banner
A colour frame and a label (DEV, ACC, PROD…) on pages matching your URL rules, and a [PROD] prefix in the tab title. No more testing in production by mistake.

• Decoded OData errors
Every failed OData response (V2, V4, $batch sub-requests) is read: SAP code and message, per-field details, transaction ID and a lead (CSRF token, authorisations, /IWFND/ERROR_LOG…). Notification in the page and badge on the icon.

• Explained by the $metadata
For the field at fault: type, max length, precision, mandatory or not, label. The values sent are checked automatically (length exceeded, empty mandatory field, decimal sent as a number in V2, date format…).

• "Copy for Claude"
A report ready to paste into an AI assistant, with only the useful data: application context, request, decoded response and metadata. Cookies and tokens are never included.

• OData log
Every OData request of the tab: duration, size, status, decoded parameters ($filter, $expand…). For each $batch, the details of every sub-request: body sent, response, decoded SAP error, changesets. Filter, "Replay" for reads, copy as a curl command and log export (Markdown or JSON).

• Control inspector
Alt+click an element of the application: control type and id, view, controller, binding paths with their values and model data. Also works in the Fiori launchpad and SAP Build Work Zone.

• App sheet and performance
UI5 version, theme, language, components and OData sources, manifest.json cache headers, load times, slowest resources and findings (debug mode, missing Component-preload, slow OData).

• Environment comparison
App and UI5 versions on DEV, ACC and PROD side by side, to check that a transport or a deployment went through. One click opens the same page on another environment.

• Missing i18n texts
Texts bound to an i18n file whose key does not exist, and {i18n>…} bindings left as raw text in the page.

• Signed-in user
Launchpad user and, on request, the BTP user (application router) and the SAP backend user.

• SAP logs
From an error, open /IWFND/ERROR_LOG or /IWBEP/ERROR_LOG in SAP GUI for HTML, with the transaction ID copied.

• Error simulation (development environments only)
To test an application's error handling: a chosen OData request receives an HTTP error, a network error or a delay. Off by default, allowed only on environments marked "Sim.", signalled by a red banner and switched off at every Firefox start.

Sidebar that stays open while testing (Alt+Shift+O).

Privacy: everything is processed locally in your browser. No data is collected or sent to any third-party server. OData responses are never modified, unless you enable error simulation yourself on a development environment.

Independent extension, not affiliated with SAP SE. SAP, SAPUI5 and Fiori are trademarks of SAP SE.

## Suggested category
Developer Tools

## Tags
sap, sapui5, fiori, odata, debug, developer tools

## Privacy policy (if requested)
Compagnon SAP Fiori does not collect, store on a server or transmit any personal or browsing data. The information read (OData responses, metadata, application information) is processed only in the user's browser, kept in session memory for the tab concerned and cleared when the page is reloaded or the tab is closed. Settings (environment rules, simulation rules) are stored locally in the Firefox profile. Nothing is sent to the extension's publisher or to any third party.

## Notes for reviewers
This extension helps developers debug SAPUI5/Fiori applications. All processing is local; no data is collected or sent anywhere (data_collection_permissions: none). No remote code is loaded.

Permissions:
- webRequest, webRequestBlocking, webRequestFilterResponse: read OData responses (URLs containing /sap/opu/odata, /odata/ or $batch) with filterResponseData to decode SAP error messages and build a request log. Every chunk is written back unchanged (filter.write), so pages always receive the original response.
- requestBody / requestHeaders: show the request payload of failed OData calls. Cookies and token values are never stored or copied.
- host_permissions <all_urls>: SAP system host names differ for every customer (on-premise gateways, SAP BTP subdomains), so they cannot be listed in advance. Content scripts exit immediately on non-SAP pages (no matching environment rule, no UI5 runtime).
- scripting, tabs: read SAPUI5 runtime information on demand (probe.js) and fetch $metadata / manifest.json in the page context with the user's session.
- storage: settings (storage.local) and per-tab data (storage.session).
- clipboardWrite: "Copy" buttons.
- Content scripts use window.wrappedJSObject read-only to inspect SAPUI5 objects (version, components, control bindings, i18n bindings, launchpad user).
- sim-page.js (content script in the MAIN world, document_start): optional error simulation for testing an app's error handling. It is inert by default: it only adds a "message" listener and patches nothing. It wraps XMLHttpRequest/fetch only after sim-bridge.js (isolated world) sends it rules that the user created in the Simulate tab, AND the background script has confirmed that the tab's environment rule explicitly allows simulation (option "Sim.", meant for development systems). Matching OData requests then receive a locally built error response (they are not sent), or a delayed / partially replaced $batch response. Simulation is visibly signalled (red banner in the page and in the panel) and switched off at every browser start (runtime.onStartup).
- On demand ("Look up BTP / SAP users" button), the page context fetches /user-api/currentUser (SAP BTP application router) and /sap/bc/ui2/start_up (ABAP) with the user's own session; results are only displayed.
- tabs.create: open the same app on another environment, or SAP GUI for HTML (/IWFND/ERROR_LOG), from buttons the user clicks.
- The same sources also build the Chrome version: net-page.js and page-bridge.js are only used there and are not referenced in the Firefox manifest; the sidePanel calls (flagged by the linter) only run when browser.sidePanel exists, i.e. never in Firefox.

Test: open any public SAPUI5 sample from the SAPUI5 Demo Kit (https://sapui5.hana.ondemand.com), open the extension popup (Application tab), then Alt+click a control to inspect it.
