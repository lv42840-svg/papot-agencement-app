# PAPOT AGENCEMENT — état d'audit au 2026-09-13

Ce fichier est un **instantané Git technique**. Le cahier des charges Google Drive reste la source de vérité fonctionnelle. Les décisions AGE plus récentes remplacent toute règle historique incompatible.

## Correction d'architecture après l'audit

Lors du test réel du 13 septembre 2026, l'écran de premier lancement demandait encore une connexion PostgreSQL alors que l'architecture retenue n'utilise plus PostgreSQL.

La règle technique courante est donc :

- **Nextcloud est le stockage partagé de l'application et des documents** ;
- les ressources métier partagées utilisent des états JSON versionnés, ETag, verrous et détection de conflits ;
- SQLite/local reste limité au cache, à la configuration du poste et aux travaux locaux ;
- aucun `DATABASE_URL`, serveur PostgreSQL, migration SQL ou package `pg` n'est requis par PAPOT AGENCEMENT ;
- l'ancien `/capture` est absorbé par Entrées et ne constitue plus une seconde chaîne de stockage.

Les mentions PostgreSQL présentes dans les décisions ou constats ci-dessous décrivent l'état de l'audit avant cette correction et sont **supplantées pour l'implémentation courante**.

## Blocs revus

### Bloc 1 — Socle technique

Verdict corrigé : architecture conservée, stockage partagé Nextcloud.

À garder :

- Electron + installateur Windows NSIS ;
- Next.js / React / TypeScript ;
- SQLite/local uniquement pour cache, configuration et synchronisation locale ;
- Nextcloud pour données partagées, documents, versions et verrous ;
- relais HTTPS minimal pour le transport mobile extérieur ;
- paquets signés, hash, idempotence et ACK ;
- mécanisme multi-postes par verrous/version.

Corrections appliquées :

- suppression de PostgreSQL du premier lancement et du démarrage Electron ;
- suppression du faux utilisateur PAPOT local par poste ;
- utilisation du vrai utilisateur authentifié + `device_id` pour verrous/historique ;
- utilisateurs, droits et sessions déplacés dans l'état partagé Nextcloud ;
- nettoyage des chemins métier Entrées/Commercial encore raccordés à PostgreSQL.

### Bloc 2 — Connexion / utilisateurs / droits

Verdict : bloc raccordé au stockage partagé Nextcloud.

- authentification et sessions PAPOT conservées ;
- droits READ / WRITE par module + droits spéciaux conservés ;
- toutes les API desktop doivent vérifier session et droits côté serveur ;
- le menu reflète les droits de lecture ;
- l'administration utilisateurs/droits permet création, activation/désactivation, réinitialisation du mot de passe et révocation de sessions ;
- les actions historisées utilisent le vrai `user_id` connecté.

Décisions validées :

- **AGE-1247** : création d'un utilisateur uniquement par un administrateur ;
- **AGE-1248** : un administrateur peut forcer la réinitialisation du mot de passe, puis l'utilisateur choisit un nouveau mot de passe à sa prochaine connexion ;
- **AGE-1249** : un compte n'est jamais supprimé, seulement désactivé, afin de conserver l'historique.

### Bloc 3 — Architecture visuelle PC

Verdict : base actuelle conservée.

Décisions validées :

- **AGE-1250** : menu gauche repliable conservé ;
- **AGE-1251** : menu adapté aux droits de lecture de l'utilisateur ;
- **AGE-1252** : bandeau supérieur actuel conservé, sans ajouter recherche/cloche pour l'instant ;
- **AGE-1253** : accueil central non figé, à construire selon le profil et les besoins réels ; les blocs de démonstration actuels restent provisoires.

Le shell PC de référence est le `DesktopAppShell`; éviter de maintenir deux architectures visuelles desktop concurrentes.

### Bloc 4 — Entrées / Capture

Verdict corrigé : Entrées est le point d'entrée unique et son état partagé est stocké dans Nextcloud.

Décisions validées :

- **AGE-1254** : Entrées devient le point d'entrée unique PAPOT, PC et mobile ;
- **AGE-1255** : décision historique formulée à l'époque avec PostgreSQL ; la partie stockage PostgreSQL est supplantée par la correction d'architecture Nextcloud-only ci-dessus ;
- **AGE-1256** : l'ancien `/capture` est absorbé dans Entrées, en réutilisant les éléments utiles sans maintenir une deuxième chaîne métier ;
- **AGE-1257** : responsables, notifications, droits et historique utilisent les vrais `user_id`, plus de règles basées sur les noms `Nadia`/`Lucien` ;
- **AGE-1258** : ajout du tag fixe `Chiffrage seul` ;
- **AGE-1259** : `Voir plus tard` est disponible dès le traitement de l'entrée, avec date choisie + motif, sans attendre l'expiration des 48 h.

## Devis — décision ajoutée pendant l'audit

- **AGE-1245** : une quantité peut être saisie sous forme de calcul, par exemple `2+6+4+9`; PAPOT utilise le résultat numérique pour le devis et conserve la formule ;
- **AGE-1246** : la formule de quantité reste rattachée à la ligne, consultable/modifiable, copiée lors d'une duplication, et reste interne ; le document client n'affiche que la quantité calculée.

## Conséquence architecture Devis/Facturation

L'arrivée du Devis/Facturation natif ne change pas le socle général.

Flux cible :

`Capture -> Client -> Affaire -> Chiffrage -> Devis -> Confirmation -> Chantier -> Production -> TS -> Facture -> Paiement`

Le moteur Word -> données -> PDF a déjà passé une preuve de concept séparée. Il sera intégré en production lorsque la reprise module par module atteindra le Devis.

## Prochaine séquence technique

1. valider le premier lancement Nextcloud-only sur un vrai poste Windows ;
2. tester le premier administrateur, la connexion et les droits ;
3. tester Entrées et Commercial avec écriture réelle dans Nextcloud ;
4. poursuivre l'audit du module suivant ;
5. intégrer le moteur documentaire au moment du module Devis.
