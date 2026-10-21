# Textes pour addons.mozilla.org (AMO)

**Français** · [English](AMO.md) — AMO accepte une description par langue : collez celle-ci pour le français, l’anglaise pour l’anglais.

## Nom
Compagnon SAP Fiori

## Résumé (250 caractères max)
Aide au test et au débogage des applications SAPUI5/Fiori : bandeau DEV/ACC/PROD, erreurs OData décodées et expliquées par le $metadata, journal OData, inspecteur de contrôles et comparateur de versions.

## Description
Compagnon SAP Fiori fait gagner du temps aux développeurs et testeurs d'applications SAPUI5 / Fiori (SAP Gateway, SAP BTP, services CAP) : tout ce qu'on va chercher d'habitude dans les outils de développement est affiché clairement, en anglais ou en français.

• Bandeau d'environnement
Un cadre de couleur et une étiquette (DEV, ACC, PROD…) sur les pages qui correspondent à vos règles d'URL, et le préfixe [PROD] dans le titre de l'onglet. Fini les tests en production par erreur.

• Erreurs OData décodées
Chaque réponse OData en erreur (V2, V4, sous-requêtes de $batch) est lue : code et message SAP, détails par champ, ID de transaction et une piste (jeton CSRF, autorisations, /IWFND/ERROR_LOG…). Notification dans la page et badge sur l'icône.

• Explication par le $metadata
Pour le champ en cause : type, longueur maximale, précision, obligatoire ou non, libellé. Les valeurs envoyées sont contrôlées automatiquement (longueur dépassée, champ obligatoire vide, décimal envoyé comme nombre en V2, format de date…).

• « Copier pour Claude »
Un rapport prêt à coller dans un assistant IA, avec uniquement les données utiles : contexte de l'application, requête, réponse décodée et métadonnées. Les cookies et jetons ne sont jamais inclus.

• Journal OData
Toutes les requêtes OData de l'onglet : durée, taille, statut, paramètres décodés ($filter, $expand…). Pour chaque $batch, le détail de chaque sous-requête : corps envoyé, réponse, erreur SAP décodée, changesets. Filtre, « Rejouer » pour les lectures, copie en commande curl et export du journal (Markdown ou JSON).

• Inspecteur de contrôles
Alt+clic sur un élément de l'application : type et id du contrôle, vue, contrôleur, chemins de binding avec leurs valeurs et données du modèle. Fonctionne aussi dans le Fiori Launchpad et SAP Build Work Zone.

• Fiche de l'application et performances
Version UI5, thème, langue, composants et sources OData, en-têtes de cache du manifest.json, temps de chargement, éléments les plus lents et constats (mode débogage, Component-preload absent, OData lent).

• Comparateur d'environnements
Versions de l'application et d'UI5 sur DEV, ACC et PROD côte à côte, pour vérifier qu'un transport ou un déploiement est bien passé. Un clic ouvre la même page sur un autre environnement.

• Textes i18n manquants
Liste des textes liés à un fichier i18n dont la clé n'existe pas, et des liaisons {i18n>…} restées en texte brut dans la page.

• Utilisateur connecté
Utilisateur du launchpad et, à la demande, utilisateur BTP (application router) et utilisateur SAP du backend.

• Journaux SAP
Depuis une erreur, ouverture de /IWFND/ERROR_LOG ou /IWBEP/ERROR_LOG dans SAP GUI pour HTML, avec l'ID de transaction copié.

• Simulation d'erreurs (environnements de développement uniquement)
Pour tester la gestion des erreurs d'une application : une requête OData choisie reçoit une erreur HTTP, une erreur réseau ou un délai. Désactivée par défaut, autorisée seulement sur les environnements marqués « Sim. », signalée par un bandeau rouge et coupée à chaque démarrage de Firefox.

Panneau latéral qui reste ouvert pendant les tests (Alt+Maj+O).

Confidentialité : tout est traité localement dans votre navigateur. Aucune donnée n'est collectée ni envoyée à un serveur tiers. Les réponses OData ne sont jamais modifiées, sauf si vous activez vous-même la simulation d'erreurs sur un environnement de développement.

Extension indépendante, non affiliée à SAP SE. SAP, SAPUI5 et Fiori sont des marques de SAP SE.

## Catégories suggérées
Outils de développement (Developer Tools)

## Étiquettes
sap, sapui5, fiori, odata, debug, developer tools

## Politique de confidentialité (si demandée)
Compagnon SAP Fiori ne collecte, ne stocke sur un serveur, ni ne transmet aucune donnée personnelle ou de navigation. Les informations lues (réponses OData, métadonnées, informations de l'application) sont traitées uniquement dans le navigateur de l'utilisateur, conservées en mémoire de session pour l'onglet concerné et effacées au rechargement de la page ou à la fermeture de l'onglet. Les réglages (règles d'environnement, règles de simulation) sont enregistrés localement dans le profil Firefox. Rien n'est envoyé à l'éditeur de l'extension ni à un tiers.

## Notes pour les relecteurs (en anglais)
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
