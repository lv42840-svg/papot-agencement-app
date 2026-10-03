# PAPOT AGENCEMENT - déploiement web VPS

Ce dossier constitue le socle de déploiement de PAPOT AGENCEMENT sur `agencement.papot.app`.

## Principes

- application Next.js exécutée dans Docker ;
- PostgreSQL partagé au niveau infrastructure, avec une base et un rôle dédiés à AGENCEMENT ;
- exposition locale uniquement sur `127.0.0.1:3002` ;
- publication HTTPS assurée par Caddy ;
- réseau Docker interne `papot-internal` commun aux services PAPOT ;
- documents AGENCEMENT sous `/srv/papot/agencement` et arborescence métier sous `/srv/agencement` ;
- le code Electron/desktop reste présent pendant la migration mais n'est pas utilisé par ce déploiement.

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

Copier ensuite `.env.example` vers `.env` et renseigner le vrai mot de passe PostgreSQL.

## Démarrage

Depuis la racine du dépôt :

```bash
sudo docker compose -f deploy/agencement-web/docker-compose.yml up -d --build
sudo docker compose -f deploy/agencement-web/docker-compose.yml ps
```

Le conteneur doit devenir `healthy`. Le healthcheck appelle `/api/health`, exécute les migrations PostgreSQL AGENCEMENT puis vérifie la connexion avec `SELECT 1`.

## Caddy

Ajouter le contenu de `Caddyfile.snippet` dans `/etc/caddy/Caddyfile`, puis :

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

La cible finale est :

`https://agencement.papot.app`

## Migration progressive

Ce socle n'impose pas de suppression immédiate d'Electron, du stockage local ou des anciennes briques Nextcloud. La migration vers le web doit rester progressive afin de réutiliser les modules métier AGENCEMENT déjà développés et testés.
