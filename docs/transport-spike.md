# Spike transport Nextcloud

Status: **NEXTCLOUD WEBDAV REEL VALIDE**. Le spike global reste **NON VALIDE** tant que les essais PWA sur vrais telephones, le worker PostgreSQL, l'ACK et les essais de reprise/destruction ne sont pas termines.

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

## Ce que ce probe ne prouve pas

Ce succes ne valide pas encore le CORS d'une PWA, un iPhone en conditions reelles, Android, le worker PostgreSQL, l'ACK ni la reprise apres coupure. Ces points restent obligatoires avant le GO du spike complet.
