# Clients PAPOT et Pennylane : création locale, puis rapprochement comptable

## Règles fonctionnelles

1. Pennylane reste la référence des données comptables une fois une fiche client rattachée. Une fiche PAPOT non rattachée est utilisable pour démarrer le suivi commercial.
2. PAPOT peut créer une fiche client **locale** via le bouton « Nouveau client », sans création comptable dans Pennylane. Les API Pennylane utilisées restent en lecture seule (customers:readonly).
3. PAPOT conserve ses propres **UUID** pour les affaires, devis, chantiers et contacts. L'identifiant Pennylane est stocké en complément.
4. Un client PAPOT existant correspondant au même SIRET ou au même nom ne peut pas être dupliqué automatiquement : un humain le rattache.
5. Une liaison ne change jamais l'identifiant UUID de PAPOT ni son archivage. Les notes, les contacts internes et la TVA par défaut PAPOT sont conservés.
6. Les champs d'identité d'une fiche liée ne sont plus modifiables depuis PAPOT. Les notes, contacts et TVA interne le restent.
7. Le module Clients autorise la création locale aux profils ayant le droit Clients : écriture, même lorsque Pennylane est connecté. Le rattachement comptable reste une action distincte, explicite et contrôlée.
8. Les mises à jour clients dans PAPOT sont **manuelles et explicites**, pas exécutées sans contrôle : « Mettre à jour depuis Pennylane ».

## Parcours utilisateur

- PAPOT → **Clients → Nouveau client** pour créer une fiche opérationnelle.
- PAPOT → **Clients → Clients Pennylane · Importer** pour rapprocher une fiche existante avec Pennylane.
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
- Un SIREN à 9 chiffres n'est **pas** considéré comme un SIRET. Le SIRET peut être reconnu à partir de l'adresse électronique française au format SIREN_NIC ou SIREN_SIRET (éventuellement avec suffixe de routage).
- Si Pennylane ne donne que le SIREN, un rattachement ou import peut consulter **l'API publique Recherche d'entreprises** : uniquement pour le SIREN exact, afin de récupérer le SIRET officiel du **siège**. Ce SIRET de siège n'est pas forcément celui d'un autre établissement facturé : un SIRET PAPOT déjà saisi n'est pas remplacé. En cas d'indisponibilité de l'annuaire, l'import n'est pas bloqué et le champ reste vide si aucune autre source n'est disponible.
- En l'absence de SIRET, le rapprochement par nom sert uniquement d'**alerte** : aucune fusion automatique.
- Les clients absents de Pennylane lors d'un rafraîchissement ne sont pas supprimés dans PAPOT.
- La liste affichée est actuellement limitée aux 2000 premiers clients importés; une pagination sera nécessaire pour des volumes supérieurs.
- L'actualisation automatique horaire doit encore être finalisée, puis validée avant activation de la production.
- Tester avec une clé customers:readonly et de vrais exemples entreprise/particulier avant un déploiement en production.

API : https://pennylane.readme.io/reference/getcustomers
