# Lot 1 : affectations Achats et separation des indicateurs

## Livre dans ce lot

- Commandes rapides reparties entre chantiers, SAV et frais generaux, dans les ecrans de creation et de modification existants.
- SAV et frais generaux sont des destinations explicites, avec `chantierId: null`. Aucun faux chantier n'est cree. Les commandes detaillees restent mono-chantier.
- Lecture compatible des anciennes commandes. Somme des affectations egale au total HT, destinations uniques, historique des anciennes affectations et controle de version a l'edition.
- La cloture d'un chantier ne retire que sa part. Une commande mixte conserve les autres parts. Les anciennes commandes et les historiques ne sont pas supprimes.
- Refus d'un nouvel engagement sur un chantier ferme, archive ou annule ; une part historique inchangee peut etre conservee lors d'une correction sur une autre destination.
- La marge reelle d'un chantier attend un CA facture net explicite. Elle ne reutilise jamais les devis retenus.
- La situation mensuelle entreprise est distincte des budgets cumules des chantiers. Les heures chantier, SAV et frais generaux sont rassemblees, sans filtre d'etat du chantier ; les couts salariaux restent soumis au droit Paie.
- Les engagements presentes sont les engagements ACTUELS, toutes dates. Ce ne sont ni les factures du mois, ni une reconstitution des engagements a une date passee.

## Sources financieres a raccorder

Le moteur mensuel attend trois sources completes pour le mois selectionne : factures clients emises nettes d'avoirs, charges fournisseurs validees nettes d'avoirs, cout total de paie valide. Un jeu vide certifie complet vaut zero ; une source absente, incomplete ou d'un autre mois vaut `null`.

Le connecteur doit normaliser les factures d'acompte et de solde sans double comptage. Les avances fournisseurs ne sont pas ajoutees aux charges en plus de la facture finale. La facture de holding figure une fois dans les charges fournisseurs ; la source de paie l'exclut. Les ventilations analytiques expliquent les sources : elles ne s'ajoutent pas a leurs totaux. Les factures sans affectation analytique restent dans le total entreprise, sans inventer une affectation chantier.

Le futur adaptateur devra certifier la completude, la fraicheur, les dates et la classification des donnees. Aucun endpoint de saisie de factures ou aucune comptabilite parallele n'est ajoute ici. L'API mensuelle actuelle transmet explicitement des sources absentes. Le resultat reste indisponible avant raccordement et validation des sources.

La valorisation des heures saisies est un indicateur operationnel, pas le cout total de paie : heures non saisies, holding et absence d'heures restent a traiter dans le lot personnel/paie. Le mois en cours conserve la regle du cout horaire du mois precedent. Les semaines partagees entre mois sont ventilees selon le prorata deja utilise par PAPOT.

## Hors perimetre

Pas de synchronisation Pennylane, d'emission officielle de facture, de preparation de paie, de receptions fournisseurs, de modification VPS ou de refonte Devis/Planning. La recette navigateur sur le VPS n'est pas remplacee par les tests automatises.

## Tests de regression

Repartition 600/250/150 sur 1000 ; achat SAV sans chantier ; ancienne commande mono-chantier ; annulation ; retrait partiel a la cloture ; revision des destinations ; doublons et montants invalides ; sources financieres absentes/incompletes ; avoirs et avances ; absence de cout salarial ; mois en cours et mois clos ; semaine a cheval ; protection des couts salariaux ; marge reelle sans recours aux devis.
