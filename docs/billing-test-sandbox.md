# Facturation V1 : bac à sable réinitialisable

## Objectif

Permettre à Lucien et Nadia d'essayer les factures et les avoirs **sans créer de
documents fiscaux** : ni numéro officiel consommé, ni écriture Pennylane, ni
transmission électronique, ni archivage fiscal.

La facturation réelle demeure contrôlée par ses propres variables et permissions
et ne doit pas être activée pour utiliser le bac à sable.

## Accès

- Variable d'environnement `PAPOT_BILLING_TEST_SANDBOX_ENABLED=true` dans
  l'environnement serveur autorisé uniquement au moment de la recette.
  Par défaut : **false**.
- Droit `billing.test_sandbox` : créer, consulter et télécharger des factures
  et avoirs fictifs.
- Droit `billing.reset_test_sandbox` : effacer les simulations.
  Ce deuxième droit n'implique pas le premier ; les deux sont nécessaires au reset.
- L'utilisateur doit également disposer de l'accès **Écriture** au module Facturation.

L'onglet **« Essais supprimables »** n'apparaît qu'avec l'activation et les
droits requis.

## Parcours recommandé

1. Créer ou retrouver un projet de facture, puis le **valider en interne**.
   Ce projet ne devient pas une facture officielle.
2. Dans l'onglet d'essai, sélectionner ce projet, renseigner dates, opération,
   conditions de pénalités et, si nécessaire, le bon de commande.
3. Cliquer « Créer une facture TEST ».
4. Télécharger le PDF et vérifier ses lignes, montants et mentions.
   Il porte « TEST / SANS VALEUR FISCALE » et « SPECIMEN - TEST - NON VALABLE ».
5. Créer des avoirs fictifs totaux ou partiels, contrôler les taux de TVA et
   télécharger leurs PDF marqués TEST.
6. Pour repartir de zéro, saisir exactement
   `EFFACER LES ESSAIS`, confirmer et déclencher la remise à zéro.

## Ce que la purge supprime réellement

**Uniquement** le registre `testSandbox` contenu dans le stockage Facturation
et ses compteurs fictifs. Le reset garde l'horodatage, le nom de l'opérateur
et le nombre de remises à zéro.

**Jamais supprimés par cette fonction** : les projets de facture, marchés,
chantiers, devis, données financières validées, numéros réels
`PA-AAAA-NNNNNN` / `AV-AAAA-NNNNNN`, registres officiels, PDF originaux
archivés, mouvements de banque et données Pennylane.

Les **anciens brouillons de test** créés avant l'existence du bac à sable ne
sont pas automatiquement identifiables. Ils doivent être supprimés
individuellement depuis les commandes de brouillon autorisées, après contrôle
qu'ils ne correspondent pas à des données réelles.

## Protections supplémentaires

- Toutes les mutations passent par les permissions serveur et la transaction
  unique du dépôt de facturation.
- Une simulation n'utilise jamais la route d'émission officielle ni le dépôt
  d'archives PDF originaux.
- Le téléchargement des spécimens est accessible uniquement avec permission.
- Aucun PDF TEST n'est conservé dans l'archive réglementaire.
- On garde les **tests automatisés du code** (Vitest, CI GitHub) : le bouton
  « Effacer les essais » ne les supprime pas.

## Recette d'acceptation avant activation sur le VPS

Tester facture simulée, avoir partiel, avoir total, PDF TEST, rejet des montants
excessifs, remise à zéro et création d'une nouvelle simulation. Vérifier que
le nombre de factures officielles, leurs derniers numéros, et les empreintes
SHA-256 des PDF archivés sont identiques **avant et après** la purge. Vérifier
aussi que l'accès est refusé aux collaborateurs sans les droits appropriés.

Ne pas confondre validation du bac à sable et autorisation de mise en service
de l'émission officielle.
