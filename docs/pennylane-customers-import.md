# Choix B : clients créés dans Pennylane, importés dans PAPOT

## Règles fonctionnelles

1. Pennylane est la source d'identité (nom, coordonnées, SIRET, conditions de paiement).
2. Le client n'est **jamais créé dans Pennylane depuis PAPOT**. L'API utilisée est GET /api/external/v2/customers et nécessite customers:readonly.
3. PAPOT conserve ses propres **UUID** pour les affaires, devis, chantiers et contacts. L'identifiant Pennylane est stocké en complément.
4. Un client PAPOT existant correspondant au même SIRET ou au même nom ne peut pas être dupliqué automatiquement : un humain le rattache.
5. Une liaison ne change jamais l'identifiant UUID de PAPOT ni son archivage. Les notes, les contacts internes et la TVA par défaut PAPOT sont conservés.
6. Les champs d'identité d'une fiche liée ne sont plus modifiables depuis PAPOT. Les notes, contacts et TVA interne le restent.
7. Après activation du connecteur sur le serveur, la création directe d'un client PAPOT par les modules métier est bloquée. Il faut créer/importer le client dans Pennylane d'abord.
8. Les mises à jour clients dans PAPOT sont **manuelles et explicites**, pas exécutées sans contrôle : « Mettre à jour depuis Pennylane ».

## Parcours utilisateur

- PAPOT → **Clients → Clients Pennylane · Importer**
- Bouton **Actualiser les clients Pennylane** : lecture seule, écrit uniquement la zone de staging « customers », sans changer les clients PAPOT.
- Sélectionner un client :
  - « À importer » : import nouvelle fiche PAPOT avec nouvel UUID.
  - « Rapprochement nécessaire » : choisir manuellement le client PAPOT à conserver, puis **Rattacher**.
  - « Lié à PAPOT » : actualiser les champs comptables.
  - « Fiche à corriger » : corriger dans Pennylane, puis réimporter.
- L'action est réservée aux utilisateurs ayant **Clients : écriture**, avec contrôle d'origine des requêtes.

## Sécurité et limites

- Le connecteur n'est pas activé par défaut (PAPOT_PENNYLANE_ENABLED=false).
- Aucun jeton n'est commité. La configuration existante chiffre le token sur le VPS.
- Un SIREN à 9 chiffres n'est **pas** considéré comme un SIRET. Le SIRET peut être reconnu à partir de l'adresse électronique française au format SIREN_NIC, quand elle est fournie et cohérente.
- En l'absence de SIRET, le rapprochement par nom sert uniquement d'**alerte** : aucune fusion automatique.
- Les clients absents de Pennylane lors d'un rafraîchissement ne sont pas supprimés dans PAPOT.
- La liste affichée est actuellement limitée aux 2000 premiers clients importés; une pagination sera nécessaire pour des volumes supérieurs.
- L'actualisation automatique horaire doit encore être finalisée, puis validée avant activation de la production.
- Tester avec une **nouvelle clé customers:readonly** et de vrais exemples entreprise/particulier avant toute fusion/déploiement.

API : https://pennylane.readme.io/reference/getcustomers
