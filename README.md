# PAPOT AGENCEMENT

Application interne PAPOT AGENCEMENT, V1 en développement.

Le cahier des charges officiel Google Drive reste la source de vérité fonctionnelle. Le dépôt Git contient le code correspondant à l'état réellement développé ainsi que des notes techniques datées. En cas de contradiction, les décisions AGE les plus récentes du cahier des charges priment.

La source technique active du dépôt pour l'architecture est désormais :

`docs/desktop-local-architecture.md`

## Architecture actuelle

PAPOT est désormais conçu comme une application **principalement locale**.

La cible d'exploitation est :

- application PAPOT sur le réseau local de l'entreprise ;
- serveur local appartenant à PAPOT AGENCEMENT ;
- PostgreSQL local comme source de vérité métier partagée ;
- dossiers du serveur PAPOT pour les documents et fichiers conservés ;
- aucun accès Internet entrant vers PostgreSQL ou le serveur PAPOT ;
- Nextcloud limité au rôle de sas de transport pour les échanges avec le téléphone extérieur ;
- fonctionnement du bureau indépendant d'Internet et de Nextcloud.

Pendant la phase actuelle de développement, l'application doit également pouvoir fonctionner localement **sans serveur PostgreSQL définitif et sans Nextcloud obligatoire**, afin de terminer la base métier avant l'installation de l'infrastructure SQL par l'informaticien.

Ce mode local actuel est transitoire. Une fois le serveur opérationnel, les modules seront migrés progressivement vers leurs repositories PostgreSQL partagés.

## État actuel du socle

Le projet comprend notamment :

- Next.js / React / TypeScript ;
- application Windows Electron avec installeur NSIS ;
- stockage local utilisé pendant la phase de développement ;
- socle PostgreSQL et repositories serveur déjà présents pour plusieurs modules ;
- authentification PAPOT par session serveur ;
- utilisateurs et droits READ / WRITE avec contrôles côté serveur ;
- shell desktop lavande avec navigation latérale ;
- modules Entrées, Commercial, Clients, Chantiers, Bibliothèque et Devis en cours de construction/reprise ;
- tests unitaires et intégrations PostgreSQL dans la CI.

Le code contient encore des mécanismes historiques Nextcloud et de ressources partagées. Ils ne doivent plus être étendus comme architecture principale du desktop. Leur rôle futur est limité au transport mobile lorsque nécessaire.

## Données métier

En exploitation, PostgreSQL sur le serveur PAPOT sera l'autorité des données métier partagées : utilisateurs, clients, captures, affaires, devis, chantiers, planning, heures, facturation, historique, etc.

SQLite et les stockages locaux restent possibles pour la configuration du poste, cache, état appareil, brouillons ou files d'attente techniques. Ils ne doivent pas créer une seconde vérité métier une fois le serveur en place.

PostgreSQL n'est jamais synchronisé par Nextcloud et n'est jamais exposé directement à Internet.

## Documents

Les documents, photos, plans, PDF et autres fichiers conservés doivent à terme être stockés dans les dossiers du serveur PAPOT.

Un document provenant du téléphone peut transiter par Nextcloud avant d'être importé dans le stockage local PAPOT. Nextcloud n'est plus l'autorité documentaire générale des postes de bureau.

## Téléphone / Nextcloud

Le téléphone extérieur ne se connecte jamais directement au serveur PAPOT ni à PostgreSQL.

Le chemin cible reste asynchrone :

`Téléphone -> relais HTTPS minimal si nécessaire -> Nextcloud -> worker PAPOT local -> PostgreSQL / dossiers PAPOT`

Le retour utilise le chemin inverse.

Les essais WebDAV, PWA iPhone, CORS, relais HTTPS, signatures, ACK et idempotence restent documentés dans `docs/transport-spike.md`. Ce fichier est désormais une **note historique et technique sur le transport mobile**, pas la définition de l'architecture desktop.

## Multi-postes

La concurrence entre postes doit être gérée par la couche serveur et PostgreSQL : transactions, contrôle de version et verrouillage SQL lorsque le besoin métier l'exige.

Les anciens verrous Nextcloud ne doivent plus être utilisés comme mécanisme général de coordination des postes de bureau.

## Devis / facturation natifs

Le flux cible est :

`Capture -> Client -> Affaire -> Chiffrage -> Devis -> Confirmation -> Chantier -> Production -> TS -> Facture -> Paiement`

OBAT n'est plus une dépendance centrale pour les nouveaux devis/factures PAPOT. Les anciens documents OBAT restent historiques.

Le module Devis est actuellement développé en mode local. Son repository PostgreSQL serveur sera réalisé lors de la migration vers l'infrastructure PAPOT définitive.

## Stack technique

- Next.js App Router + React + TypeScript strict
- Electron + electron-builder / NSIS
- PostgreSQL pour la cible métier partagée
- SQLite / stockage local pour l'état local et la phase transitoire de développement
- Nextcloud WebDAV / transport mobile uniquement lorsque nécessaire
- authentification par mot de passe `scrypt` et session en cookie HttpOnly
- Zod pour les validations d'entrée
- Vitest pour les tests
- ESLint + Prettier

## Démarrage développement

Prérequis : Node.js 22+.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Pour lancer l'application Windows en développement :

```bash
npm run desktop:dev
```

Sous PowerShell lorsque l'exécution des scripts `npm.ps1` est bloquée :

```powershell
npm.cmd run desktop:dev
```

## Qualité

Commandes attendues avant fusion d'un lot fonctionnel :

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Le workflow `.github/workflows/ci.yml` rejoue ces contrôles sur les Pull Requests, avec les tests d'intégration PostgreSQL.

## Sécurité

- aucun secret dans le dépôt ;
- PostgreSQL jamais exposé à Internet ;
- aucun port entrant Internet vers le serveur PAPOT pour l'usage mobile ;
- mots de passe hachés avec `scrypt` et sel aléatoire ;
- cookies de session HttpOnly, SameSite=Lax et Secure en production ;
- validation des entrées API ;
- contrôles de droits côté serveur obligatoires ;
- secrets techniques stockés localement de manière sécurisée ;
- les données et fichiers provenant du transport mobile sont validés avant import.
