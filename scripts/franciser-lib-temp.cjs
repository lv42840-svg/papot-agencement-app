const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const RACINE = process.cwd();
const RENOMMAGES = new Map(
  Object.entries({
    value: "valeur",
    values: "valeurs",
    parsed: "analyse",
    result: "resultat",
    results: "resultats",
    row: "ligneTableau",
    rows: "lignesTableau",
    line: "ligne",
    lines: "lignes",
    item: "element",
    items: "elements",
    input: "saisie",
    output: "sortie",
    error: "erreur",
    errors: "erreurs",
    data: "donnees",
    payload: "contenu",
    response: "reponse",
    request: "requete",
    body: "corps",
    headers: "entetes",
    params: "parametres",
    user: "utilisateur",
    users: "utilisateurs",
    person: "personne",
    people: "personnes",
    file: "fichier",
    files: "fichiers",
    folder: "dossier",
    path: "chemin",
    index: "indice",
    current: "courant",
    next: "suivant",
    previous: "precedent",
    expected: "attendu",
    actual: "reel",
    found: "trouve",
    match: "correspondance",
    matches: "correspondances",
    now: "maintenant",
    today: "aujourdhui",
    week: "semaine",
    weeks: "semaines",
    month: "mois",
    months: "listeMois",
    year: "annee",
    years: "annees",
    day: "jour",
    days: "jours",
    hour: "heure",
    hours: "heures",
    amount: "montant",
    amounts: "montants",
    price: "prix",
    cost: "cout",
    margin: "marge",
    label: "libelle",
    labels: "libelles",
    name: "nom",
    names: "noms",
    key: "cle",
    keys: "cles",
    status: "statut",
    state: "etat",
    target: "cible",
    selected: "selectionne",
    selection: "selectionCourante",
    config: "configuration",
    settings: "reglages",
    context: "contexte",
    actor: "auteur",
    candidate: "candidat",
    candidates: "candidats",
    entry: "entree",
    entries: "entrees",
    record: "enregistrement",
    records: "enregistrements",
    count: "nombre",
    sum: "somme",
    start: "debut",
    end: "fin",
    left: "gauche",
    right: "droite",
    top: "haut",
    bottom: "bas",
    event: "evenement",
    events: "evenements",
    search: "recherche",
    query: "requeteRecherche",
    filter: "filtre",
    sort: "tri",
    draft: "brouillon",
    drafts: "brouillons",
    preview: "apercu",
    loading: "chargement",
    saving: "sauvegardeEnCours",
    expanded: "deplie",
    collapsed: "replie",
    enabled: "active",
    disabled: "desactive",
    checked: "coche",
    title: "titre",
    text: "texte",
    phone: "telephone",
    address: "adresse",
    city: "ville",
    company: "entreprise",
    order: "commande",
    purchase: "achat",
    invoice: "facture",
    task: "tache",
    tasks: "taches",
    attachment: "pieceJointe",
    attachments: "piecesJointes",
    tag: "etiquette",
    tags: "etiquettes",
    byId: "parId",
    ids: "identifiants",
    quoteId: "idDevis",
    itemId: "idElement",
    userId: "idUtilisateur",
    caseId: "idAffaire",
    entryId: "idEntree",
    documentId: "idDocument",
    clientId: "idClient",
    orderId: "idCommande",
    draftId: "idBrouillon",
  }),
);

function collecterIdentifiantsLiaison(nom, sortie) {
  if (ts.isIdentifier(nom)) {
    sortie.push(nom);
    return;
  }
  for (const element of nom.elements) {
    if (ts.isOmittedExpression(element)) continue;
    collecterIdentifiantsLiaison(element.name, sortie);
  }
}

function nomsDeclares(fichier) {
  const noms = new Set();
  const visiter = (noeud) => {
    if (ts.isVariableDeclaration(noeud) || ts.isParameter(noeud)) {
      const identifiants = [];
      collecterIdentifiantsLiaison(noeud.name, identifiants);
      identifiants.forEach((identifiant) => noms.add(identifiant.text));
    } else if (
      (ts.isFunctionDeclaration(noeud) ||
        ts.isClassDeclaration(noeud) ||
        ts.isEnumDeclaration(noeud) ||
        ts.isTypeAliasDeclaration(noeud) ||
        ts.isInterfaceDeclaration(noeud)) &&
      noeud.name
    ) {
      noms.add(noeud.name.text);
    } else if (ts.isImportClause(noeud) && noeud.name) {
      noms.add(noeud.name.text);
    } else if (ts.isImportSpecifier(noeud)) {
      noms.add(noeud.name.text);
    } else if (ts.isNamespaceImport(noeud)) {
      noms.add(noeud.name.text);
    }
    ts.forEachChild(noeud, visiter);
  };
  visiter(fichier);
  return noms;
}

function estDeclarationExportee(noeud) {
  let courant = noeud;
  while (courant && !ts.isSourceFile(courant)) {
    if (ts.isVariableStatement(courant)) {
      const indicateurs = ts.getCombinedModifierFlags(courant);
      return Boolean(indicateurs & ts.ModifierFlags.Export);
    }
    if (
      ts.isFunctionDeclaration(courant) ||
      ts.isFunctionExpression(courant) ||
      ts.isArrowFunction(courant) ||
      ts.isMethodDeclaration(courant) ||
      ts.isConstructorDeclaration(courant)
    ) {
      return false;
    }
    courant = courant.parent;
  }
  return false;
}

const cheminConfig = ts.findConfigFile(RACINE, ts.sys.fileExists, "tsconfig.json");
if (!cheminConfig) throw new Error("tsconfig.json introuvable");

const fichierConfig = ts.readConfigFile(cheminConfig, ts.sys.readFile);
if (fichierConfig.error) {
  throw new Error(ts.flattenDiagnosticMessageText(fichierConfig.error.messageText, "\n"));
}
const configuration = ts.parseJsonConfigFileContent(
  fichierConfig.config,
  ts.sys,
  path.dirname(cheminConfig),
);
const programme = ts.createProgram({
  rootNames: configuration.fileNames,
  options: configuration.options,
});
const verificateur = programme.getTypeChecker();

const fichiersSources = programme.getSourceFiles().filter((fichier) => {
  if (fichier.isDeclarationFile) return false;
  const relatif = path.relative(RACINE, fichier.fileName).replaceAll("\\", "/");
  return relatif.startsWith("src/lib/");
});

const renommagesParSymbole = new Map();

for (const fichier of fichiersSources) {
  const declarations = nomsDeclares(fichier);
  const visiter = (noeud) => {
    if (ts.isVariableDeclaration(noeud) || ts.isParameter(noeud)) {
      const identifiants = [];
      collecterIdentifiantsLiaison(noeud.name, identifiants);
      for (const identifiant of identifiants) {
        const ancienNom = identifiant.text;
        const nouveauNom = RENOMMAGES.get(ancienNom);
        if (!nouveauNom || nouveauNom === ancienNom) continue;
        if (declarations.has(nouveauNom)) continue;
        if (ts.isVariableDeclaration(noeud) && estDeclarationExportee(noeud)) {
          continue;
        }
        const symbole = verificateur.getSymbolAtLocation(identifiant);
        if (!symbole) continue;
        renommagesParSymbole.set(symbole, { ancienNom, nouveauNom });
      }
    }
    ts.forEachChild(noeud, visiter);
  };
  visiter(fichier);
}

let fichiersModifies = 0;
let occurrencesModifiees = 0;

for (const fichier of fichiersSources) {
  const remplacements = [];

  const visiter = (noeud) => {
    if (ts.isIdentifier(noeud)) {
      let symbole;
      if (ts.isShorthandPropertyAssignment(noeud.parent) && noeud.parent.name === noeud) {
        symbole =
          verificateur.getShorthandAssignmentValueSymbol(noeud.parent) ||
          verificateur.getSymbolAtLocation(noeud);
      } else {
        symbole = verificateur.getSymbolAtLocation(noeud);
      }

      const renommage = symbole && renommagesParSymbole.get(symbole);
      if (renommage) {
        let texte = renommage.nouveauNom;

        if (
          ts.isBindingElement(noeud.parent) &&
          noeud.parent.name === noeud &&
          ts.isObjectBindingPattern(noeud.parent.parent) &&
          !noeud.parent.propertyName &&
          !noeud.parent.dotDotDotToken
        ) {
          texte = `${renommage.ancienNom}: ${renommage.nouveauNom}`;
        } else if (
          ts.isShorthandPropertyAssignment(noeud.parent) &&
          noeud.parent.name === noeud &&
          !noeud.parent.objectAssignmentInitializer
        ) {
          texte = `${renommage.ancienNom}: ${renommage.nouveauNom}`;
        }

        remplacements.push({
          debut: noeud.getStart(fichier),
          fin: noeud.getEnd(),
          texte,
        });
      }
    }
    ts.forEachChild(noeud, visiter);
  };
  visiter(fichier);

  if (remplacements.length === 0) continue;

  remplacements.sort((a, b) => b.debut - a.debut);
  let contenu = fichier.getFullText();
  for (const remplacement of remplacements) {
    contenu =
      contenu.slice(0, remplacement.debut) + remplacement.texte + contenu.slice(remplacement.fin);
  }

  fs.writeFileSync(fichier.fileName, contenu, "utf8");
  fichiersModifies += 1;
  occurrencesModifiees += remplacements.length;
}

console.log(
  `Francisation lib sure: ${occurrencesModifiees} occurrence(s) dans ${fichiersModifies} fichier(s).`,
);
