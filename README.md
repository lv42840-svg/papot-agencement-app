# PAPOT AGENCEMENT

Application interne PAPOT AGENCEMENT, V1 en développement.

Le cahier des charges officiel reste la source de vérité fonctionnelle. Le dépôt Git contient le code correspondant à l'état réellement développé ainsi que les notes techniques utiles au déploiement.

## Architecture actuelle

Le socle principal est désormais :

- application web Next.js / React / TypeScript ;
- PostgreSQL comme base de données métier ;
- stockage serveur pour les documents et pièces jointes ;
- authentification PAPOT par session serveur ;
- utilisateurs, droits READ / WRITE et droits spéciaux stockés côté serveur ;
- génération documentaire Word vers PDF ;
- déploiement Docker sur le VPS PAPOT ;
- application Windows Electron conservée comme enveloppe locale optionnelle.

Le web et le VPS ne dépendent d'aucun stockage tiers pour fonctionner.

## Modules raccordés

- **Entrées** : capture, qualification, affectation, historique et pièces jointes ;
- **Clients** : fiches clients, contacts, TVA et conditions de paiement ;
- **Commercial** : affaires, suivi, documents et passage vers devis / chantier ;
- **Devis** : chiffrage natif PAPOT, bibliothèque, PDF, validation et envoi ;
- **Chantiers** : lancement depuis une affaire, suivi opérationnel et rentabilité ;
- **Planning** : charge, capacités, absences et heures ;
- **Utilisateurs et droits** : comptes PAPOT, sessions et permissions.

L'ancienne route `/capture` redirige vers le module Entrées afin de conserver une seule entrée canonique.

## Flux métier cible

`Capture -> Client -> Affaire -> Chiffrage -> Devis -> Confirmation -> Chantier -> Production -> TS -> Facture -> Paiement`

Les devis sont générés directement par PAPOT à partir des données de l'application. Le PDF final est archivé dans le stockage serveur de PAPOT.

## Stack technique

- Next.js App Router + React + TypeScript strict
- PostgreSQL
- Docker
- stockage de fichiers serveur
- Electron + electron-builder / NSIS pour l'enveloppe Windows
- SQLite local uniquement pour le mode local de développement / secours
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

Le workflow `.github/workflows/ci.yml` rejoue ces contrôles sur les Pull Requests.

## Sécurité

- aucun secret dans le dépôt ;
- mots de passe hachés avec `scrypt` et sel aléatoire ;
- cookies de session HttpOnly, SameSite=Lax et Secure en production ;
- sessions stockées sous forme de hash de jeton ;
- validation des entrées API ;
- contrôles de droits côté serveur obligatoires ;
- secrets de production stockés uniquement dans l'environnement du VPS.
