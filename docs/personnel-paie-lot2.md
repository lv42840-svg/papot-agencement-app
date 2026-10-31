# Lot 2 : préparation de paie et coûts mensuels (avant Pennylane)

## Règles intégrées
- Une période de paie est construite avec les semaines complètes se terminant durant le mois choisi ; les semaines à cheval appartiennent au mois de leur fin.
- Les personnes sous contrat apparaissent dans le mois, même avec zéro heure.
- Les semaines confirmées pour une personne dans la préparation utilisent les heures enregistrées, les autres utilisent l’horaire contractuel moins les absences connues. Les semaines en base contrat restent signalées.
- Les heures supplémentaires sont calculées par semaine avec seuils modifiables (défaut +25 % après 35 h, +50 % après 43 h).
- Les notes restent propres au mois et au salarié. Les versions validées sont figées, les réouvertures motivées et historisées. Les exports Excel sont indépendants des données PAPOT.
- Un mois à zéro heure peut conserver son coût sans générer de tarif horaire fictif.
- La holding a une source de coût distincte ; ses heures proviennent des semaines déjà saisies (chantier, SAV, frais généraux). Une correction ultérieure d’heures est prise en compte à la lecture ; la facture holding ne doit être comptée qu’une fois au futur raccordement comptable.
- L'accès à la préparation et aux coûts respecte les permissions Paie ; les corrections sont protégées contre les écritures basées sur une ancienne version.

## Points encore à terminer avant fusion définitive
- Relier explicitement le statut de validation des semaines au module opérationnel « Saisie des heures », pour éviter une deuxième confirmation dans la paie.
- Gérer dans Paramètres le modèle Excel personnalisable (téléchargement, remplacement, génération à partir du modèle).
- Tester les parcours complets en navigateur et sur une instance sécurisée après déploiement.
- Le lien à la facture holding et aux factures Pennylane n’existe pas encore. Aucun résultat financier ne doit être considéré comme complet.

Aucune réception fournisseur ni déploiement VPS dans ce lot.
