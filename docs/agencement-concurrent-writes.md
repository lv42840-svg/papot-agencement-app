# AGENCEMENT : protection contre les écritures concurrentes

## Objectif

Cette branche empêche un écran devenu périmé d'écraser silencieusement une modification enregistrée depuis un autre poste, un autre navigateur ou un autre onglet.

Le principe utilisé est la concurrence optimiste :

1. l'écran conserve une version, une date de mise à jour ou une empreinte de l'état qu'il affiche ;
2. cette précondition est envoyée avec la mutation ;
3. le serveur la vérifie au plus près de l'écriture, à l'intérieur du verrou ou de la transaction quand le repository le permet ;
4. si l'état a changé depuis l'ouverture de l'écran, l'écriture est refusée avec un conflit au lieu de remplacer la donnée récente.

Cette protection est distincte :
- de l'idempotence universelle des créations ;
- de l'atomicité PostgreSQL + système de fichiers ;
- d'une recette manuelle à deux postes sur la version installée.

## Couverture

### Clients

Les mutations suivantes transportent le `updatedAt` de la fiche réellement ouverte :
- modification complète ;
- TVA par défaut ;
- archivage ;
- réactivation.

L'éditeur fige le token au moment du clic sur « Modifier ». Un rechargement ultérieur ne remplace pas ce token tant que l'enregistrement n'a pas réussi.

Le repository PostgreSQL conserve en plus son contrôle de version interne pour les requêtes réellement simultanées.

### Commercial / affaires

Les mutations d'une affaire existante vérifient le `updatedAt` affiché avant écriture.

Le dépôt de documents fait un contrôle avant l'upload puis un second contrôle au moment de l'enregistrement métier. Un état périmé est refusé.

La création d'une nouvelle affaire reste une création et ne remplace pas une fiche existante.

### Chantiers

Les mutations d'un chantier existant exigent le `updatedAt` affiché.

La règle est volontairement conservatrice : si un autre onglet modifie le même chantier, une action issue d'un ancien écran est refusée même si elle visait un autre sous-onglet.

Le lancement d'un chantier depuis une affaire est une création métier. Les protections « déjà lancé / conflit » existantes restent le mécanisme de sécurité principal de cette action.

### Entrées

Les modifications d'une entrée existante utilisent une révision stable de l'entrée affichée.

La protection est appliquée :
- à la modification de l'entrée ;
- à l'enregistrement d'une pièce jointe ;
- aux différents adapters de stockage concernés.

La capture d'une nouvelle entrée reste append-only.

### Devis

Le devis entier est la frontière de concurrence.

Toutes les mutations d'un devis existant exigent son `updatedAt` affiché :
- lignes, titres, sous-titres et réordonnancement ;
- duplication / suppression d'éléments ;
- informations générales ;
- notes internes ;
- dates travaux et TVA ;
- ajustements de prix, remise, options ;
- mise en forme riche ;
- photos, visibilité client et suppression ;
- création de nouvelle version / variante / duplication ;
- validation, génération PDF et envoi.

Ainsi, une modification faite dans un onglet du devis rend périmées les actions d'un ancien écran ouvert sur un autre onglet du même devis.

La création initiale d'un brouillon reste une création append-only.

### Planning

Le grand planning possède une révision d'état.

Les mutations de charge, capacité, absences, ordre des chantiers et potentiel doivent envoyer la révision affichée. Une mutation basée sur un ancien planning est refusée.

### Profil société

Le profil société possède désormais un contrat de version cohérent sur :
- repository PostgreSQL ;
- repository local ;
- API admin ;
- interface.

Une ancienne fiche ne peut plus remplacer le profil récent.

### Utilisateurs / permissions

Les fiches utilisateurs admin exposent une empreinte de révision.

Elle protège :
- nom / e-mail ;
- activation / désactivation ;
- permissions modules ;
- permissions spéciales.

Les actions « réinitialiser le mot de passe » et « révoquer une session » restent des actions explicites et ne remplacent pas une fiche utilisateur complète.

### Préférences personnelles

Les préférences légères sont aussi protégées :
- couleur d'accent ;
- état replié / déplié du bloc POTENTIEL du planning.

L'ancienne valeur affichée est envoyée avec la nouvelle. Si la valeur stockée a changé entre-temps, la seconde écriture est refusée.

### Ressources partagées

Le mécanisme `shared-resource` possédait déjà :
- bail / lease ;
- `expectedVersion` ;
- réponse de conflit.

Il est conservé tel quel.

## Inventaire API

Les routes API AGENCEMENT ont été parcourues sur le head de la branche.

Les routes de modification de ressources existantes sont classées dans l'une des catégories suivantes :
- version / révision affichée obligatoire ;
- mécanisme `shared-resource` déjà versionné ;
- action explicite ne remplaçant pas une fiche complète ;
- suppression / lecture par identifiant immuable ;
- création append-only.

Les créations append-only ne constituent pas un écrasement d'une ancienne fiche, mais elles ne possèdent pas toutes une clé d'idempotence universelle.

## Tests de concurrence

Des tests reproduisent notamment les scénarios A/B suivants :
- deux écrans ouvrent le même client, A sauvegarde, B tente une ancienne modification : B est refusé ;
- deux écritures réellement simultanées sur un client : une seule version gagne sans perte silencieuse ;
- affaire commerciale périmée ;
- chantier périmé ;
- entrée périmée ;
- devis périmé ;
- planning : contrat de révision obligatoire surveillé par un test API ;
- préférences personnelles : contrat API/UI vérifié.

Les suites PostgreSQL existantes restent utilisées pour valider les repositories et les verrous transactionnels.

## Limites séparées

### Idempotence des créations

Cette branche traite l'anti-écrasement.

Elle ne garantit pas qu'un retry réseau volontaire ou deux requêtes de création métier identiques ne puissent jamais produire deux objets lorsque la ressource n'a pas sa propre contrainte d'unicité.

Une politique d'idempotence générale des POST de création reste un durcissement séparé.

### PostgreSQL et fichiers

Une transaction SQL ne rend pas atomique une écriture de fichier.

Les chemins de documents et photos utilisent des contrôles avant / après et du nettoyage de compensation lorsque possible, mais une coupure brutale au mauvais instant peut encore nécessiter une procédure de reprise.

### Actions externes

La génération, l'ouverture d'Outlook ou d'autres effets externes ne peuvent pas être rendus atomiques par PostgreSQL. Le but de cette branche est de figer et vérifier l'état métier avant l'effet externe.

## Recette manuelle avant fusion / déploiement

Sur une base de recette :

1. ouvrir la même ressource sur deux sessions distinctes ;
2. modifier et enregistrer A ;
3. tenter d'enregistrer B sans recharger ;
4. vérifier que B reçoit un conflit ;
5. vérifier que la donnée de A est intacte ;
6. vérifier que la saisie de B n'a pas écrasé la base.

À répéter au minimum pour :
- Client ;
- Commercial ;
- Chantier ;
- Entrée ;
- Devis ;
- Planning ;
- Profil société ;
- Utilisateur.

## Livraison

Branche : `fix/agencement-concurrent-writes`.

Base : `spike/nextcloud-transport`.

Aucun déploiement n'est réalisé par cette branche. La fusion ne doit intervenir qu'après validation de la CI finale et revue du statut de la PR.
