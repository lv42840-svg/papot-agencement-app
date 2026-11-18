# PAPOT AGENCEMENT - déploiement web VPS

Ce dossier constitue le socle de déploiement de PAPOT AGENCEMENT sur `agencement.papot.app`.

## Principes

- application Next.js exécutée dans Docker ;
- PostgreSQL partagé au niveau infrastructure, avec une base et un rôle dédiés à AGENCEMENT ;
- exposition locale uniquement sur `127.0.0.1:3002` ;
- publication HTTPS assurée par Caddy ;
- réseau Docker interne `papot-internal` commun aux services PAPOT ;
- documents techniques sous `/srv/papot/agencement` et fichiers métier AGENCEMENT sous `/srv/agencement` ;
- le code Electron/desktop reste présent pendant la migration mais n'est pas utilisé par ce déploiement ;
- le VPS utilise `PAPOT_STORAGE_MODE=postgres` ;
- une base neuve utilise `PAPOT_POSTGRES_BOOTSTRAP_MODE=fresh` afin d'initialiser directement les états métier dans PostgreSQL ;
- `PAPOT_SERVER_FILES_ROOT=/srv/agencement` rend les pièces jointes et documents indépendants du runtime desktop.

## Préparation VPS

Créer la base et le rôle PostgreSQL dédiés :

```sql
CREATE ROLE papot_agencement LOGIN PASSWORD 'MOT_DE_PASSE_SOLIDE';
CREATE DATABASE papot_agencement OWNER papot_agencement;
```

Créer les dossiers :

```bash
sudo mkdir -p /srv/papot/agencement/documents
sudo mkdir -p /srv/papot/agencement/modeles
sudo mkdir -p /srv/agencement
sudo chown -R 1000:1000 /srv/papot/agencement
```

Copier ensuite `.env.example` vers `.env`, renseigner le vrai mot de passe PostgreSQL et générer `PAPOT_BOOTSTRAP_TOKEN` avec `openssl rand -hex 32`.

Le bootstrap `fresh` est volontairement protégé : s'il détecte déjà des données métier ou un cutover partiel, il refuse de continuer au lieu d'écraser ou de requalifier silencieusement la base.

La création du premier administrateur demande également `PAPOT_BOOTSTRAP_TOKEN`. Cette clé reste uniquement dans le `.env` du VPS et n'est jamais stockée dans le code.

## Démarrage

Depuis la racine du dépôt :

```bash
sudo docker compose -f deploy/agencement-web/docker-compose.yml up -d --build
sudo docker compose -f deploy/agencement-web/docker-compose.yml ps
```

Le conteneur doit devenir `healthy`. Le healthcheck appelle `/api/health`, exécute les migrations PostgreSQL AGENCEMENT puis vérifie la connexion avec `SELECT 1`.

## Synchronisation Pennylane automatique : 06:00 et 12:00, heure de Paris

PAPOT peut actualiser en lecture seule les **fournisseurs, factures fournisseurs, clients et
factures clients** à 6 h et 12 h, heure France (`Europe/Paris`).
L'affectation automatique des fournisseurs FG déjà paramétrée se déclenche aussi à ces heures.
Les boutons d'actualisation manuelle restent disponibles dans l'application.

**Préparer la sécurité et la minuterie sur le VPS** (après sauvegarde de la base/fichiers,
depuis la racine du dépôt après un `git pull`) :

```bash
sudo sh deploy/agencement-web/install-pennylane-sync.sh
sudo docker compose -f deploy/agencement-web/docker-compose.yml up -d --build
sudo docker compose -f deploy/agencement-web/docker-compose.yml ps
curl -fsS http://127.0.0.1:3002/api/health
sudo systemctl start papot-pennylane-sync.timer
sudo systemctl list-timers papot-pennylane-sync.timer --no-pager
```

Le script crée une **clé de 256 bits séparée** de la clé API Pennylane, inscrite dans
`deploy/agencement-web/.env` et dans un fichier `/etc/papot-agencement/pennylane-sync.curl`
non accessible aux autres utilisateurs. Le jeton n'est pas passé en argument de processus
et n'est jamais renvoyé par l'API. Le déclencheur n'a pas besoin de session utilisateur
et écoute sur `http://127.0.0.1:3002` depuis l'hôte, pas via le domaine public.

Le bloc Caddy `deploy/agencement-web/Caddyfile.snippet` a été mis à jour :
`/api/internal/*` renvoie 404 depuis le domaine public, tandis que le
minuteur continue d'accéder directement à `127.0.0.1:3002`. Si le
`/etc/caddy/Caddyfile` du VPS est déjà installé, **reprendre cette règle**
dans son bloc `agencement.papot.app`, puis valider et recharger :

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Le script enregistre l'unité `systemd` mais **ne démarre pas le timer avant la reconstruction
du conteneur**, pour éviter une tâche planifiée contre une ancienne version. Une fois le
conteneur sain, l'activation par la commande ci-dessus suffit. Le fuseau horaire du minuteur
est explicitement `Europe/Paris` : passages à l'heure française toute l'année, même après
les changements d'heure. `Persistent=true` peut rattraper un passage manqué après redémarrage.

Pour vérifier l'expression du calendrier et voir le prochain lancement :

```bash
systemd-analyze calendar '*-*-* 06,12:00:00 Europe/Paris'
sudo systemctl list-timers papot-pennylane-sync.timer --no-pager
```

Pour déclencher volontairement un essai (attention : il réalise un **vrai import**
et valide automatiquement dans PAPOT les factures FG éligibles) :

```bash
sudo systemctl start papot-pennylane-sync.service
sudo journalctl -u papot-pennylane-sync.service -n 30 --no-pager
```

Prérequis : `PAPOT_PENNYLANE_ENABLED=true` dans le `.env` serveur et connexion
Pennylane configurée et testée dans Paramètres → Pennylane. Le timer n'altère aucune
donnée dans Pennylane. Une ressource inaccessible provoque un échec sans publier
de données partielles. Un verrou PostgreSQL empêche le chevauchement avec un
rafraîchissement manuel.

Le **compteur Accueil → Factures à valider** indique, comme le filtre correspondant,
le nombre de factures sans validation PAPOT parmi les **500 dernières actuellement
affichées**. Il ne faut pas le confondre avec la totalité des factures historiques
importées ou avec les factures en attente de validation comptable dans Pennylane.
Le compteur n'est montré qu'aux personnes autorisées à consulter le module Achats.

## Caddy

Ajouter le contenu de `Caddyfile.snippet` dans `/etc/caddy/Caddyfile`, puis :

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

La cible finale est :

`https://agencement.papot.app`

## Architecture cible

Le déploiement web utilise PostgreSQL et le stockage serveur PAPOT. Electron reste une enveloppe locale optionnelle pour les fonctions Windows utiles.
