# Achats : factures fournisseurs Pennylane (PR #252)

## Principe

- **Pennylane demeure la source comptable**. PAPOT n'appelle que les routes GET de l'API V2.
- **PAPOT reste l'outil d'affectation opérationnelle** (Nadia) : une facture peut viser plusieurs bons de commande et chantiers, ou SAV / frais généraux.
- **BC = engagement**, **facture doublement validée = coût réel**. Aucun rapprochement ne crée, n'édite, ne valide ou ne règle une facture chez Pennylane.
- **Le flag PAPOT_PENNYLANE_ENABLED reste désactivé par défaut.** La clé depuis Paramètres → Pennylane peut être testée sans import; seule une décision distincte activera l'import. Ne jamais enregistrer la clé en clair sur GitHub.

## Interface

- /achats/factures : liste de factures et états, PDF à gauche, commandes correspondantes et affectations à droite.
- Sélection de plusieurs BC, reprise des destinations des commandes, affichage du reste à facturer, choix solder ou laisser ouvert.
- Ventilation **globale ou par ligne**, ajouts de frais de transport, emballage et de remises négatives; prorata avec correction manuelle sur une destination.
- Enregistrement de brouillon partiel, validation PAPOT seulement pour une répartition exactement équilibrée, journal d'audit des changements.
- Alertes de doublon avant validation, verrou de concurrence (révision/facture + version locale), chantiers clos acceptés comme destination (sans changement de leur état).
- Achats → Nouveau BC et Modifier BC : si le catalogue fournisseurs a été récupéré, sélection obligatoire de l'identifiant Pennylane et possibilité d'actualiser. Avant le premier import de fournisseurs, anciens BC sans lien comptable conservés.

## Stockage

- Table papot_pennylane_staging (PR #250) : copie brute isolée et remplaçable des factures / fournisseurs.
- Table papot_pennylane_purchase_allocations (migration 19) : un état courant par facture, brouillon, ventilation validée, historique et version.
- Les modifications successives n'écrasent pas la dernière ventilation validée jusqu'à validation de sa révision.
- Aucune écriture comptable et aucune synchronisation automatique au démarrage.
- Les fournisseurs programmés en FG dans Bons de commande sont affectés **automatiquement et validés dans PAPOT** à chaque synchronisation Pennylane déclenchée, sans approbation Nadia supplémentaire. Pennylane reste en lecture seule.
- Dans **Achats → Factures fournisseurs**, le bouton **Affecter les factures FG** rafraîchit toutes les factures disponibles et rattrape l'historique ; il n'est pas dans Bons de commande.
- Seules les factures jamais affectées, montant HT EUR positif, numéro et fournisseur fiables, sans doublon, sont validées automatiquement. Les affectations précédentes ne sont jamais écrasées.
- **Priorité chantier** : si un BC engagé du même fournisseur comporte une destination chantier ou SAV et que le rapprochement n'est pas certain, la facture reste à affecter/à vérifier et n'est pas classée FG.
- Tant que la validation comptable Pennylane n'est pas `complete`, le statut PAPOT est **En attente de Pennylane**, même après affectation validée dans PAPOT. Aucun coût réel n'est pris en compte avant cette deuxième validation.
- Aucune nouvelle tâche cron n'est créée par cette fonction ; elle s'exécute à chaque synchronisation Pennylane réellement lancée.

## Validation

1. Répartition entière HT égale au champ Pennylane currency_amount_before_tax, qui ne doit être interprété comme euro que si currency === "EUR".
2. Une facture au statut comptable complete et une affectation PAPOT validée sont nécessaires pour exposer un coût réel sur un chantier.
3. Les montants et remises sont calculés en centimes, sans répartir de fraction de centime.
4. Les doublons de numéro / fournisseur / montant ne peuvent pas être validés deux fois.
5. Un changement de montant ou de fournisseur demande une revalidation. Le dernier validé reste historisé avec une alerte provisoire.

## Avant fusion et production

- Vérifier les scopes réels suppliers:readonly et supplier_invoices:readonly, le retour des dates et montants, et le PDF éphémère sur une facture test.
- Vérifier l'enregistrement, les droits achats READ/WRITE, la répartition multi-BC, l'historique et la suppression de clé.
- Cas particuliers restant à spécifier/tester avec des factures réelles : **avoirs**, acomptes repris sur facture finale, factures multi-devises et changements de PDF sans variation du montant.
- Automatisation horaire et traitement des volumes dépassant la limite d'affichage de 500 factures à finaliser **avant l'ouverture en production**.
- Ne pas fusionner ni déployer tant que CI, tests en base, dossier Pennylane et comportement de Nadia ne sont pas validés.

Références API :

- https://pennylane.readme.io/reference/getsupplierinvoices
- https://pennylane.readme.io/reference/getsupplierinvoicelines
- https://pennylane.readme.io/reference/getsuppliers
