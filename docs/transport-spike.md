# Spike transport Nextcloud

Status: **NEXTCLOUD WEBDAV REEL VALIDE**. L'installation PWA sur iPhone reel est **VALIDEE**, mais le transport WebDAV direct depuis la PWA Safari iPhone est **ECARTE** a cause du CORS constate en conditions reelles. Le spike global reste **NON VALIDE** tant que le prototype hybride/native, Android, le worker PostgreSQL, l'ACK et les essais de reprise/destruction ne sont pas termines.

## Porte d'architecture

Le serveur PAPOT et PostgreSQL restent locaux. Aucun port, reverse proxy, tunnel ou API PAPOT ne doit etre publie vers Internet. Le worker PAPOT devra uniquement initier des connexions HTTPS sortantes vers Nextcloud IDEO. Le telephone exterieur communique avec Nextcloud, jamais directement avec PAPOT.

Le Nextcloud du prototype est `https://cloud.ideo-solutions.com` et l'espace logique est `PAPOT_SYNC`.

## Verification WebDAV reelle, avant protocole complet

Le script `scripts/nextcloud-probe.ts` ne simule pas Nextcloud. Il utilise le vrai serveur configure et s'arrete au premier echec significatif.

Il doit etre lance depuis une machine autorisee, idealement le serveur PAPOT, avec les valeurs reelles dans l'environnement local ou un stockage securise. Ne jamais placer l'app password dans Git, une commande partagee, un ticket ou un journal.

Variables:

- `NEXTCLOUD_BASE_URL`
- `NEXTCLOUD_LOGIN`
- `NEXTCLOUD_APP_PASSWORD`
- `NEXTCLOUD_SYNC_ROOT` (par defaut `PAPOT_SYNC`)

Commande:

```bash
npm run nextcloud:probe
```

Le probe decouvre d'abord l'identifiant Nextcloud canonique via l'API OCS. Il ne suppose donc pas que l'adresse de connexion est l'identifiant WebDAV. Il verifie ensuite sur le vrai WebDAV:

1. `PROPFIND` de la racine fichiers;
2. `PROPFIND` ou `MKCOL` de `PAPOT_SYNC`;
3. `MKCOL` d'un repertoire de test unique;
4. `PUT` d'un fichier temporaire de staging sans extension reservee;
5. `GET` et verification de son contenu;
6. `MOVE` vers le nom final `.json`;
7. `PROPFIND` et `GET` du fichier final;
8. `DELETE` du fichier final;
9. nettoyage du repertoire de test.

Le contenu de test est fixe et non metier. Le script n'affiche ni login, ni mot de passe d'application, ni entete Authorization, ni corps des reponses Nextcloud.

### Constats reels du 11 septembre 2026

Premier essai: la decouverte de l'utilisateur, `PROPFIND`, la creation de `PAPOT_SYNC` et la creation d'un repertoire de test ont reussi. Le `PUT` d'un fichier dont le nom se terminait par `.part` a ete refuse en HTTP 400. Le repertoire de test a ensuite ete nettoye correctement en HTTP 204.

La documentation Nextcloud actuelle reserve l'extension `.part` a son fonctionnement interne. Le probe de capacites utilise donc un nom temporaire de staging sans cette extension. Cette adaptation ne modifie pas silencieusement le protocole de production: la regle de nommage temporaire devra etre alignee explicitement avec cette contrainte Nextcloud avant implementation definitive.

Deuxieme essai reel, apres adaptation du nom temporaire: **SUCCES COMPLET**.

- decouverte de l'identifiant utilisateur: OK;
- `PROPFIND` racine fichiers: HTTP 207;
- `PROPFIND PAPOT_SYNC`: HTTP 207;
- `MKCOL` repertoire de test: HTTP 201;
- `PUT` staging: HTTP 201;
- `GET` staging: HTTP 200 et contenu identique;
- `MOVE` staging vers `.json`: HTTP 201;
- `PROPFIND` fichier final: HTTP 207;
- `GET` fichier final: HTTP 200 et contenu identique;
- `DELETE` fichier final: HTTP 204;
- nettoyage repertoire de test: HTTP 204.

Ce resultat valide le socle WebDAV reel de Nextcloud IDEO pour le transport asynchrone PAPOT, sous reserve de remplacer le suffixe temporaire `.part` prevu initialement par un nom de staging compatible Nextcloud.

## Essai reel iPhone / PWA

Essai effectue le 11 septembre 2026 sur iPhone en reseau cellulaire depuis la page HTTPS GitHub Pages du spike.

Premier passage dans Safari:

- HTTPS: OK;
- contexte securise: OK;
- Service Worker: PRET;
- mode installe: NON, ce qui est normal dans Safari;
- `GET https://cloud.ideo-solutions.com/status.php`: HTTP 200 lisible par Safari;
- `PROPFIND` cross-origin vers WebDAV Nextcloud: bloque avant lecture de la reponse.

Deuxieme passage depuis l'icone ajoutee a l'ecran d'accueil, en 4G:

- HTTPS: OK;
- contexte securise: OK;
- Service Worker: PRET;
- mode installe: OUI;
- le meme diagnostic CORS WebDAV reste affiche: `GET status.php` HTTP 200, puis `PROPFIND` WebDAV bloque avant lecture de la reponse.

Conclusion: l'installation PWA et le Service Worker fonctionnent reellement sur iPhone, mais le transport WebDAV direct cross-origin requis par une PWA est bloque par CORS. Conformement a la decision d'architecture du cahier des charges, la voie PWA directe vers WebDAV est ecartee. Le prochain prototype de transport mobile doit passer par une enveloppe hybride/native legere tout en conservant les types et regles TypeScript existants et sans exposer PAPOT sur Internet.

## Android

Aucun terminal Android n'est disponible pour le moment. L'essai Android reel est donc **DIFFERE**, pas valide ni abandonne. Il reste obligatoire avant le GO final du spike, mais il ne bloque pas l'implementation des composants serveur et protocole independants de la plateforme mobile.

## Protocole et worker, etat d'implementation

Le socle suivant est implemente sur la branche du spike mais n'est pas encore valide par un aller-retour reel telephone -> Nextcloud -> worker PAPOT -> PostgreSQL -> ACK -> telephone:

- paquet `capture.create` versionne avec `package_id`, `client_request_id`, version d'application, identite utilisateur/appareil, horodatage, payload metier et metadonnees de pieces jointes;
- preuve cryptographique Ed25519 rattachee a un appareil autorise;
- empreintes SHA-256 des pieces jointes et controle taille/empreinte avant ecriture metier;
- idempotence sur `package_id` et `client_request_id`, avec detection d'un meme identifiant de requete reutilise pour un contenu metier different;
- migration SQL pour les appareils autorises, les paquets recus et les metadonnees de pieces jointes;
- zones Nextcloud isolees `incoming`, `ack`, `error`, `outgoing` et `snapshot` par utilisateur et appareil;
- worker local qui ne traite que les fichiers `.json` finalises, donc ignore les fichiers de staging;
- staging compatible Nextcloud avec suffixe `.staging-<UUID>`, puis `MOVE` vers le fichier final;
- validation de l'appareil, de l'identite, de la permission Capture WRITE et de la signature avant ecriture metier;
- transaction PostgreSQL reutilisant la logique Capture existante;
- archivage des pieces jointes sous `PAPOT_SYNC/documents/captures/<capture_id>/...`;
- ACK ecrit seulement apres validation et ecriture metier completes;
- reprise idempotente prevue si le paquet a ete applique en base mais que l'ACK n'a pas encore pu etre depose;
- erreurs permanentes explicites et erreurs transitoires conservees pour nouvelle tentative;
- journaux techniques sans secret ni payload metier complet.

Commandes prevues une fois la base locale configuree:

```bash
npm run db:migrate
npm run sync:once
npm run sync:worker
```

Ne pas considerer cette section comme une preuve de fonctionnement reel: le worker et les migrations doivent encore etre executes sur l'infrastructure PAPOT cible, puis soumis aux essais de panne et d'idempotence prevus par le cahier des charges.

## Ce que ce spike ne prouve pas encore

Le succes WebDAV serveur et le constat PWA/CORS iPhone ne valident pas encore Android, le transport hybride/native authentifie, l'execution reelle du worker PostgreSQL, l'ACK de bout en bout ni la reprise apres coupure. Ces points restent obligatoires avant le GO du spike complet.
