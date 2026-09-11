# Spike transport Nextcloud

Status: **NON VALIDE** tant que les essais reels ci-dessous ne sont pas executes sur l'infrastructure cible et sur de vrais telephones.

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
4. `PUT` d'un fichier temporaire `.part`;
5. `GET` et verification de son contenu;
6. `MOVE` vers le nom final `.json`;
7. `PROPFIND` et `GET` du fichier final;
8. `DELETE` du fichier final;
9. nettoyage du repertoire de test.

Le contenu de test est fixe et non metier. Le script n'affiche ni login, ni mot de passe d'application, ni entete Authorization, ni corps des reponses Nextcloud.

## Ce que ce probe ne prouve pas

Un succes de ce script ne valide pas encore le CORS d'une PWA, un iPhone en 4G/5G, Android, le worker PostgreSQL, l'ACK ni la reprise apres coupure. Ces points restent obligatoires avant le GO du spike complet.
