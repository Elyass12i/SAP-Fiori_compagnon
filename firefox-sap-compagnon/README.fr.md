# Compagnon SAP Fiori (extension Firefox)

[English](README.md) · **Français**

Aides pour le travail quotidien sur SAPUI5 / Fiori / SAP Gateway. L’interface est en anglais par défaut ; choisissez le français dans les options (**Interface language** → Français). Les libellés cités ci-dessous sont ceux de l’interface en français.

1. **Bandeau d'environnement** : cadre de couleur et étiquette (DEV, ACC, PROD…) sur les pages qui correspondent à vos règles d'URL, et préfixe dans le titre de l'onglet (`[PROD] …`).
2. **Décodeur d'erreurs OData** : chaque réponse OData en erreur (V2/V4, Gateway ou CAP, y compris les sous-requêtes de `$batch`) est lue, son message SAP extrait (code, message, détails par champ, ID de transaction) et une piste proposée (CSRF, autorisations, `/IWFND/ERROR_LOG`…). Notification dans la page, badge sur l'icône, liste complète dans la fenêtre de l'extension. Le bouton « Copier pour Claude » produit un rapport de données à coller dans une IA, sans consigne : contexte (environnement, client SAP, version UI5, composant, sources OData), requête (méthode, URL, paramètres, en-têtes utiles, corps envoyé), réponse SAP décodée, autres erreurs récentes de l'onglet et métadonnées du service. Les cookies et les valeurs de jetons CSRF ne sont jamais inclus ; le corps des requêtes peut en revanche contenir des données métier : relisez avant de partager. Les messages `sap-message` des réponses réussies sont aussi listés.
3. **Fiche de l'application** (onglet ouvert par défaut) : section **Chargement** — page chargée, dernière ressource, premier octet, DOM prêt, nombre de requêtes et volume, part servie par le cache, requêtes OData (nombre, médiane, maximum), répartition par type, les 8 éléments les plus lents, et constats automatiques (mode débogage UI5, Component-preload absent, OData > 1 s, cache peu utilisé). Puis : version UI5, thème, langue, URL du bootstrap, composants chargés (id, version de l'app, sources OData), et en-têtes réellement servis pour le `manifest.json` (Last-Modified, ETag, Cache-Control). Bouton « Recharger sans cache ».

4. **Erreurs expliquées par le `$metadata`** : pour chaque erreur, l'extension lit le `$metadata` du service et affiche la définition des champs concernés (type, longueur max, précision, obligatoire, libellé). Elle contrôle aussi les valeurs envoyées : longueur dépassée, champ obligatoire vide, `Edm.Decimal` envoyé comme nombre en V2, format de date, GUID, booléen, champ inconnu ou non modifiable. Ces éléments sont ajoutés au prompt « Copier pour Claude ».
5. **Journal OData** (onglet Journal) : toutes les requêtes OData de l'onglet, avec durée, taille, statut, paramètres décodés (`$filter`, `$expand`…), corps envoyé et reçu. Filtre, case « Erreurs », bouton **Rejouer** pour les GET, **Copier en curl** (sans authentification), **Copier le journal (Markdown)** et **Enregistrer (JSON)** — le fichier JSON contient des extraits des corps, donc possiblement des données métier.
   **Détail des `$batch`** : chaque sous-requête est listée avec sa méthode, son chemin et son statut ; dépliez-la pour voir les en-têtes et le corps envoyés, la réponse et l’erreur SAP décodée. Les changesets sont signalés ; un changeset refusé renvoie une seule erreur, affichée sur chacune de ses requêtes. **Copier le $batch (Markdown)**. Une erreur dans un `$batch` apparaît dans l’onglet Erreurs avec la vraie sous-requête (méthode, entité, corps) : le contrôle par le `$metadata` s’y applique.
6. **Inspecteur de contrôles** : **Alt+clic** sur un élément d'une application SAPUI5 (ou bouton « Inspecter un élément » dans l'onglet Inspecteur) affiche le contrôle (type, id), sa vue et son contrôleur, le contexte de binding, chaque propriété avec son chemin de binding et sa valeur, et les données du modèle. Fonctionne aussi dans les cadres (launchpad, Work Zone). Alt+clic désactivable dans les options.
7. **Comparateur d'environnements** (fiche de l'application → « Comparer les environnements ») : version de l'application (`manifest.json`) et version UI5 sur DEV / ACC / PROD côte à côte. Il faut renseigner l'« URL système » de chaque environnement dans les options ; les environnements où vous n'avez pas de session ouverte sont signalés « non connecté ».

8. **Ouvrir dans DEV / ACC / PROD** : des boutons à côté de l’environnement ouvrent la même page (chemin, paramètres, navigation `#`) sur le système d’un autre environnement ; le client SAP est celui de l’environnement cible s’il est défini. Seul l’hôte change : si le chemin de l’application diffère entre systèmes (sites Work Zone différents par exemple), adaptez l’URL.
9. **Journaux SAP** : sur une erreur, **/IWFND/ERROR_LOG** et **/IWBEP/ERROR_LOG** ouvrent SAP GUI pour HTML (`/sap/bc/gui/sap/its/webgui`) sur l’URL système de l’environnement — ou sur l’hôte OData quand c’est un serveur ABAP et pas un hôte SAP BTP. L’ID de transaction est copié dans le presse-papiers pour filtrer la liste (SAP GUI pour HTML ne permet pas de le préremplir).
10. **Textes i18n manquants** (onglet Application) : chaque propriété de contrôle liée à un `ResourceModel` est vérifiée ; les clés absentes des fichiers i18n sont listées avec leur contrôle, ainsi que les liaisons `{i18n>…}` affichées en texte brut (nom de modèle ou syntaxe erronés). UI5 1.67 ou plus récent.
11. **Utilisateur connecté** (onglet Application) : l’utilisateur du launchpad (`sap.ushell`), c’est-à-dire l’identité BTP dans SAP Build Work Zone. **Chercher les utilisateurs BTP / SAP** interroge, avec votre session, `/user-api/currentUser` (application router SAP BTP — seulement si le `xs-app.json` de l’application expose l’API utilisateur) et `/sap/bc/ui2/start_up` (launchpad ABAP : l’utilisateur SAP, éventuellement technique). Rien n’est envoyé ailleurs.
12. **Simulation d’erreurs** (onglet **Simulation**, systèmes de développement uniquement) : des règles font répondre les requêtes OData concernées par une erreur HTTP (400 à 504, message au format SAP, champ ciblé facultatif), une erreur réseau ou un délai. Les erreurs sont produites dans la page : la requête n’atteint jamais le backend. Un `$batch` en lecture seule est envoyé et seule la sous-réponse visée est remplacée ; un `$batch` contenant des modifications reçoit l’erreur en entier (rien n’est écrit). **Simuler une erreur** sur une entrée du journal préremplit une règle. Garde-fous : autorisée seulement sur les environnements cochés **Sim.** dans les options (préréglage DEV uniquement), bandeau rouge dans la page et dans le panneau, règles **une seule fois** possibles, coupure à chaque démarrage de Firefox. Les erreurs simulées sont marquées « simulée » dans les onglets Erreurs et Journal.

Tout reste dans votre navigateur : aucune donnée n'est envoyée ailleurs. La page reçoit la réponse OData intacte (l'extension en lit seulement une copie, jusqu'à 2 Mo) — sauf si vous activez la simulation d’erreurs.

## Installation

Tout se fait depuis le dépôt Git, avec le dossier `installer-firefox/` (Windows, PowerShell). Firefox 128 ou plus récent.

### Installer ou mettre à jour (une commande)
Depuis le dossier du dépôt cloné :
```powershell
powershell -ExecutionPolicy Bypass -File .\installer-firefox\install.ps1 -Pull
```
Le script récupère la dernière version (`git pull`), puis :
- **paquet signé** (détecté automatiquement dans `installer-firefox/compagnon-sap-fiori.xpi`) : l'ouvre dans Firefox, qui demande de confirmer l'installation. L'extension reste installée et se met à jour en relançant la même commande ;
- **sinon** (paquet non signé) : ouvre `about:debugging` et copie le chemin du fichier ; cliquez « Charger un module complémentaire temporaire… » et collez le chemin. Cette installation s'efface au redémarrage de Firefox.

Premier clonage :
```powershell
git clone https://github.com/Elyass12i/SAP-Fiori_compagnon.git
cd SAP-Fiori_compagnon
```

### Obtenir un paquet signé (installation permanente) — à faire une fois
Firefox standard n'installe de façon permanente que des extensions signées par Mozilla. La signature « non listée » est gratuite et ne publie rien.
1. Créez des clés d'API sur https://addons.mozilla.org/developers/addon/api/key/ (compte Firefox requis).
2. **Signature automatique (recommandé)** : dans GitHub, dépôt → Settings → Secrets and variables → Actions, ajoutez deux secrets :
   `AMO_JWT_ISSUER` (la clé, du type `user:12345:67`) et `AMO_JWT_SECRET` (le secret).
   À chaque modification de l'extension avec un nouveau numéro de `version` dans `manifest.json`, GitHub Actions vérifie, fait signer, publie une release et remplace `installer-firefox/compagnon-sap-fiori.xpi` par la version signée. Il ne reste qu'à lancer `install.ps1 -Pull`.
3. **Ou signature sur votre PC** (Node.js requis) :
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\installer-firefox\sign.ps1 -ApiKey "user:12345:67" -ApiSecret "votre-secret"
   ```

Mozilla refuse de signer deux fois le même numéro : augmentez `version` dans `manifest.json` avant chaque nouvelle version.

### Autres cas
- Firefox Developer Edition, Nightly ou ESR : `about:config` → `xpinstall.signatures.required` = `false` permet d'installer le paquet non signé de façon permanente (réglage ignoré par Firefox standard).
- Si votre Firefox est géré par votre organisation, l'installation d'extensions peut être bloquée : voir `about:policies`.

## Panneau latéral
La fenêtre de l'extension se ferme quand on clique ailleurs (comportement imposé par Firefox). Pour la garder affichée pendant vos tests, cliquez **« Panneau latéral »** dans la fenêtre, ou utilisez le raccourci **Alt+Maj+O** (modifiable dans `about:addons` → roue dentée → « Gérer les raccourcis »). Le panneau suit l'onglet actif et s'actualise à la fin de chaque chargement de page.

## Premier réglage
À l'installation, la page d'options s'ouvre :
- ajoutez DEV / ACC / PROD avec les boutons, puis indiquez pour chacun un texte contenu dans l'URL (nom d'hôte, chemin…) ou une expression régulière `/…/` ;
- le client SAP est facultatif (l'URL doit alors contenir `sap-client=<valeur>`) ;
- **URL système** (facultative) : adresse du système de l’environnement, utilisée par le comparateur, les boutons « Ouvrir dans » et les liens vers les journaux SAP ;
- **Sim.** : autorise la simulation d’erreurs sur l’environnement (systèmes de développement uniquement) ;
- **Langue de l’interface** : anglais (par défaut) ou français ;
- « Tester une URL » vérifie la règle qui s'applique.

## Développement
- `i18n.js` : traductions (texte anglais comme clé, traduction française) ; `t('Texte {0}', valeur)`.
- `shared.js` : fonctions pures (règles, décodage OData/`$batch`, pistes, Markdown).
- `background.js` : interception (`webRequest.filterResponseData`), stockage par onglet (`storage.session`), badge.
- `content.js` : bandeau et notifications (Shadow DOM, n'altère pas le style de la page).
- `early.js` : agrandit le tampon des mesures du navigateur dès le début du chargement (250 entrées par défaut).
- `sidebar.html` / `popup.html` : même contenu (`popup.js`, `popup.css`) en panneau latéral ou en fenêtre.
- `inspect.js` : inspecteur de contrôles (tous les cadres ; contient son propre petit dictionnaire).
- `sim-page.js` (monde MAIN) et `sim-bridge.js` : simulation d’erreurs ; inertes tant qu’aucune règle n’est active sur un environnement autorisé.
- `probe.js` : lecture des infos UI5 à la demande (`scripting.executeScript`, `window.wrappedJSObject`).
- `compat.js` : différences Firefox / Chrome (alias `browser`, écouteurs de messages, monde de la page pour `scripting.executeScript`).
- Vérifier : `npx web-ext lint -s firefox-sap-compagnon` ; construire : `npx web-ext build -s firefox-sap-compagnon`.

### Chrome / Edge
Les mêmes sources sont empaquetées pour Chrome par `node chrome/build.js` (manifeste dans `chrome/manifest.json`, icônes PNG ; écrit `installer-chrome/compagnon-sap-fiori-chrome.zip`, ou un dossier non empaqueté avec `--dir <dossier>`). Changez `version` dans les deux manifestes en même temps : la construction refuse un écart. Différences :
- arrière-plan : service worker (`background.js` charge `compat.js`, `i18n.js`, `shared.js` avec `importScripts`) ;
- capture OData : Chrome n’a pas `webRequest.filterResponseData`, donc `net-page.js` (monde MAIN) observe XMLHttpRequest / fetch dans la page sans les modifier et `page-bridge.js` transmet les échanges à l’arrière-plan, où ils suivent le même traitement ;
- les objets JavaScript de la page ne sont accessibles que depuis le monde MAIN : `probe.js` et la recherche d’utilisateurs y sont exécutés (`SAPC_ENV.pageWorld`), et `inspect.js` y tourne aussi, en dialoguant avec `page-bridge.js` par `postMessage` ;
- panneau latéral de Chrome (`side_panel`, `sidePanel.open`) au lieu de `sidebar_action` ; commande de raccourci `open-side-panel`.
