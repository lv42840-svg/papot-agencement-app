# Architecture actuelle PAPOT AGENCEMENT

Statut : **source technique active du dépôt**, mise à jour le 16 septembre 2026.

Cette note décrit l'architecture à utiliser pour les nouveaux développements. Elle ne remplace pas le cahier des charges fonctionnel PAPOT AGENCEMENT. Les anciennes notes techniques restent utiles comme historique et comme preuve des essais déjà réalisés, mais elles ne doivent plus être utilisées pour déduire l'architecture courante lorsqu'elles contredisent ce document.

Le snapshot du cahier des charges du 13 septembre 2026 confirme déjà le principe serveur PAPOT local + PostgreSQL local, sans exposition Internet entrante. La décision technique plus récente resserre encore le rôle de Nextcloud : **PAPOT devient principalement local ; Nextcloud n'est conservé que pour le transport nécessaire au téléphone**.

## Décision en une phrase

L'architecture cible est :

```text
PC PAPOT sur le réseau local
        |
        v
SERVEUR LOCAL PAPOT
  |             |
  v             v
PostgreSQL   Dossiers / documents locaux

Téléphone extérieur
        |
        v
Internet / relais HTTPS minimal si nécessaire
        |
        v
Nextcloud, uniquement comme sas de transport mobile
        |
        v
Worker / service PAPOT local
        |
        +----> PostgreSQL
        +----> dossiers locaux PAPOT
```

Le fonctionnement du bureau ne doit pas dépendre d'Internet ni de Nextcloud.

## Phase actuelle de développement

Pendant la construction de la base métier, l'application doit pouvoir être lancée et développée **en local sans serveur PostgreSQL définitif et sans connexion Nextcloud obligatoire**.

Cette phase permet de terminer les modules métier sans attendre la mise en place du serveur SQL par l'informaticien PAPOT.

Le stockage local actuel est donc un **mode transitoire de développement**, pas une nouvelle architecture de production multi-postes. Il ne faut pas transformer silencieusement chaque PC en source de vérité indépendante à long terme.

Le code est actuellement mixte : certains modules possèdent déjà des repositories et des tests d'intégration PostgreSQL, tandis que d'autres fonctionnent encore uniquement avec leur stockage local. Cette coexistence est acceptée pendant la transition.

## Cible d'exploitation V1

Une fois l'infrastructure installée, PAPOT repose principalement sur le réseau local de l'entreprise :

- un serveur local appartenant à PAPOT AGENCEMENT ;
- PostgreSQL sur ce serveur pour les données métier partagées ;
- des dossiers partagés sur le serveur PAPOT pour les documents, photos, plans, PDF et autres fichiers conservés ;
- les postes Windows PAPOT utilisant l'application sur le réseau local ;
- Nextcloud absent du chemin normal de travail des postes de bureau ;
- Nextcloud conservé uniquement comme sas d'échange avec le téléphone lorsqu'il est à l'extérieur.

Le détail final de l'installation réseau, du nom du serveur et des partages sera défini avec l'informaticien. Le code ne doit donc pas figer une adresse IP, un nom DNS ou un chemin UNC particulier tant que cette installation n'est pas arrêtée.

## Source de vérité métier

En exploitation, **PostgreSQL sur le serveur PAPOT est la source de vérité des données métier** :

- utilisateurs et droits ;
- clients et contacts ;
- entrées / captures ;
- commercial / affaires ;
- devis ;
- chantiers ;
- planning ;
- heures ;
- facturation ;
- historique et autres données structurées.

SQLite ou tout autre stockage local peut rester utile pour la configuration du poste, le cache, l'état appareil, les brouillons locaux ou une file d'attente technique. Il ne doit pas devenir une seconde vérité métier concurrente une fois le serveur opérationnel.

La base PostgreSQL n'est jamais synchronisée par Nextcloud et n'est jamais exposée directement à Internet.

## Documents et fichiers

La conservation normale des documents de l'entreprise doit se faire dans les **dossiers du serveur local PAPOT**.

Nextcloud n'est plus l'autorité documentaire générale des postes de bureau et ne doit pas être utilisé comme système permanent de verrouillage ou de versionnement des fichiers métier entre les PC.

Un fichier provenant du téléphone peut transiter temporairement par Nextcloud. Après import réussi, le fichier à conserver rejoint le stockage local PAPOT prévu pour le dossier concerné.

La couche fichier doit continuer à protéger les chemins, refuser les traversées de répertoires et contrôler l'intégrité lorsque cela est nécessaire.

## Rôle exact de Nextcloud

Nextcloud devient un composant périphérique, pas le cœur de PAPOT.

Son rôle V1 est limité au **transport asynchrone entre le téléphone extérieur et PAPOT local** :

- dépôt d'une capture ou d'une action mobile ;
- transit des photos et pièces jointes associées ;
- récupération par le worker PAPOT local ;
- dépôt d'un accusé de réception ou d'informations destinées au téléphone ;
- reprise des échanges après coupure réseau.

Nextcloud ne doit pas servir à :

- stocker la base métier de PAPOT ;
- maintenir les données métier quotidiennes des postes de bureau ;
- synchroniser directement PostgreSQL ;
- gérer les verrous de modification entre les postes du bureau ;
- devenir obligatoire pour ouvrir ou utiliser PAPOT au bureau.

Les anciens mécanismes WebDAV, ETag, leases et zones `PAPOT_SYNC` restent utiles pour le **transport mobile** et comme historique technique, mais ils ne définissent plus le stockage principal de l'application desktop.

## Téléphone et transport extérieur

Le téléphone ne se connecte jamais directement à PostgreSQL ni au serveur PAPOT depuis Internet.

Le chemin cible reste asynchrone :

```text
Téléphone -> HTTPS -> relais minimal si nécessaire -> Nextcloud
          -> connexion sortante du service PAPOT local
          -> validation / import -> PostgreSQL + fichiers locaux
```

Le retour suit le chemin inverse via le sas de transport.

Le relais HTTPS minimal déjà étudié peut être conservé si la technologie mobile l'exige, notamment à cause des contraintes CORS constatées avec WebDAV sur iPhone. Ce relais reste un composant de transport très limité : il ne doit jamais devenir une API métier générale ni avoir accès directement à PostgreSQL.

Les échanges mobiles restent idempotents et utilisent des identifiants uniques. Une capture ne doit jamais être créée deux fois à cause d'un double envoi ou d'une reprise après coupure.

## Fonctionnement sans Internet

Le bureau doit continuer à fonctionner lorsque l'accès Internet ou Nextcloud est indisponible :

- PostgreSQL local reste disponible sur le réseau PAPOT ;
- les dossiers partagés locaux restent accessibles ;
- les utilisateurs du bureau continuent à travailler ;
- seuls les échanges avec le téléphone extérieur attendent ;
- la synchronisation mobile reprend lorsque le transport redevient disponible.

Une panne de Nextcloud ne doit donc jamais bloquer l'activité normale au bureau.

## Multi-postes et concurrence

La coordination des modifications entre les postes doit reposer sur la couche serveur et PostgreSQL, pas sur des verrous Nextcloud.

Les repositories serveur déjà développés utilisent des transactions, des contrôles de version et, lorsque nécessaire, des verrouillages SQL tels que `FOR UPDATE`. Cette direction est à conserver.

Règles :

- contrôles de droits côté serveur ;
- version attendue lors d'une modification sensible ;
- refus d'un écrasement silencieux si la donnée a changé ;
- transaction pour les opérations qui doivent rester atomiques ;
- verrou explicite ou lecture seule uniquement lorsque le métier l'exige réellement.

## Application Windows

Le client principal reste l'application Windows Electron déjà packagée avec NSIS.

Elle réutilise Next.js / React / TypeScript et doit pouvoir être lancée comme une application normale.

Le poste conserve une identité technique stable `device_id`. L'identité métier vient du vrai utilisateur PAPOT connecté. Les droits et l'historique ne doivent pas être attachés arbitrairement à un poste.

Les secrets éventuellement nécessaires au poste sont conservés dans un stockage sécurisé Windows et ne sont jamais committés dans Git.

## Sécurité réseau

Invariants :

- PostgreSQL jamais exposé à Internet ;
- aucun port entrant Internet vers le serveur PAPOT pour l'usage mobile ;
- pas de reverse proxy public donnant accès à l'application desktop ;
- pas de tunnel public vers le réseau PAPOT ;
- le serveur PAPOT initie lui-même les connexions sortantes nécessaires au transport mobile ;
- aucun mot de passe, token, `DATABASE_URL`, clé privée ou secret Nextcloud dans Git ou les logs ;
- les données reçues depuis le mobile sont validées avant import ;
- les fichiers provenant du transport ne sont jamais exécutés.

## Réalité actuelle du code

La migration vers la cible n'est pas terminée et la documentation doit le dire clairement.

Au 16 septembre 2026 :

- l'application Electron et le lancement local existent ;
- SQLite / stockage local restent utilisés dans plusieurs chemins de développement ;
- des repositories et tests d'intégration PostgreSQL existent déjà notamment pour le socle serveur, les clients, l'authentification, les entrées, le commercial, les chantiers et la bibliothèque ;
- le module Devis fonctionne actuellement en local et son repository serveur PostgreSQL reste à réaliser ;
- le code de transport Nextcloud et les anciens mécanismes de ressources partagées restent présents dans le dépôt parce qu'ils ont été développés et testés, mais ils ne doivent plus être étendus comme architecture desktop principale.

Cette situation intermédiaire est normale. La migration se fera module par module, avec tests et sans réécriture générale brutale.

## Ordre de migration retenu

1. continuer à terminer la base métier localement sans dépendance obligatoire au serveur définitif ;
2. faire installer/configurer par l'informaticien le serveur PAPOT, PostgreSQL, les dossiers partagés, sauvegardes et accès réseau local ;
3. migrer les modules vers leurs repositories serveur un par un ;
4. valider le fonctionnement multi-postes et les conflits sur le réseau local ;
5. stabiliser les documents et fichiers sur le stockage local PAPOT ;
6. raccorder ensuite le transport téléphone -> Nextcloud -> PAPOT local sans remettre Nextcloud dans le chemin desktop normal.

Chaque étape doit rester petite, testée, couverte par la CI et fusionnée séparément.

## Documents historiques

- `docs/transport-spike.md` : preuve et historique des essais Nextcloud/mobile. Ce n'est plus la définition de l'architecture desktop.
- `docs/audit-status-2026-09-13.md` : photographie de l'audit du 13 septembre 2026.
- les anciennes sections du README ou d'autres notes présentant Nextcloud comme autorité générale des données sont remplacées par le présent document.

Toute nouvelle modification d'architecture doit d'abord mettre à jour cette note afin d'éviter une nouvelle divergence entre le code, le README et les décisions du projet.
