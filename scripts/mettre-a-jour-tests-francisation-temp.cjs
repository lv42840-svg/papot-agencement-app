const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = process.cwd();
const TESTS = path.join(ROOT, "tests");

const RENOMMAGES = new Map(
  Object.entries({
    context: "contexte",
    input: "saisie",
    body: "corps",
    event: "evenement",
    user: "utilisateur",
    person: "personne",
    data: "donnees",
    row: "ligneTableau",
    line: "ligne",
    item: "element",
    candidate: "candidat",
    result: "resultat",
    selected: "selectionne",
    target: "cible",
    draft: "brouillon",
    entries: "entrees",
    value: "valeur",
    next: "suivant",
    previous: "precedent",
    week: "semaine",
    year: "annee",
    key: "cle",
    params: "parametres",
    request: "requete",
    response: "reponse",
    current: "courant",
    error: "erreur",
    file: "fichier",
    path: "chemin",
    actor: "auteur",
    record: "enregistrement",
    search: "recherche",
    filter: "filtre",
    rows: "lignesTableau",
    drafts: "brouillons",
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

function echapperRegExp(texte) {
  return texte.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&");
}

function transformer(texte) {
  let sortie = texte;

  // Identifiants racine devant un accès de propriété. Les propriétés elles-mêmes
  // restent intactes (ex. contexte.user, saisie.action, donnees.payload).
  for (const [ancien, nouveau] of RENOMMAGES) {
    const mot = echapperRegExp(ancien);
    sortie = sortie.replace(
      new RegExp("(^|[^A-Za-z0-9_$\\.])" + mot + "(?=(?:\\?\\.)|\\.)", "g"),
      "$1" + nouveau,
    );
  }

  // Déclarations locales présentes dans les fragments de code inspectés.
  for (const [ancien, nouveau] of RENOMMAGES) {
    const mot = echapperRegExp(ancien);
    sortie = sortie.replace(
      new RegExp("\\b(const|let|var)\\s+" + mot + "\\b", "g"),
      (_m, type) => type + " " + nouveau,
    );
  }

  // Paramètres de callbacks, ex. .map((person) => ...)
  for (const [ancien, nouveau] of RENOMMAGES) {
    const mot = echapperRegExp(ancien);
    sortie = sortie.replace(new RegExp("(\\(\\s*)" + mot + "(?=\\s*[,):])", "g"), "$1" + nouveau);
  }

  // Identifiants utilisés comme valeurs/arguments, jamais comme clés de propriété.
  for (const [ancien, nouveau] of RENOMMAGES) {
    const mot = echapperRegExp(ancien);
    sortie = sortie.replace(
      new RegExp(
        "([=(,+!\\[{:?&|]\\s*)" + mot + "(?=\\s*(?:[),}\\];+]|\\?\\?|&&|\\|\\||=>|$))",
        "g",
      ),
      "$1" + nouveau,
    );
  }

  // Raccourcis d'objet/déstructurations : la clé de contrat reste anglaise.
  for (const [ancien, nouveau] of RENOMMAGES) {
    const mot = echapperRegExp(ancien);
    sortie = sortie.replace(
      new RegExp("([,{]\\s*)" + mot + "(?=\\s*[,}])", "g"),
      "$1" + ancien + ": " + nouveau,
    );
  }

  // Cas composés observés dans les tests de câblage.
  const exacts = [
    ["parseBillingPercentageInput(value)", "parseBillingPercentageInput(valeur)"],
    ["calculateLineProgress(data.payload", "calculateLineProgress(donnees.payload"],
    ["filterBillingProjects(drafts", "filterBillingProjects(brouillons"],
    ["linePercentages = rows", "linePercentages = lignesTableau"],
    ["planningPotentialCollapsed: next", "planningPotentialCollapsed: suivant"],
    ["assignments.get(key)", "assignments.get(cle)"],
    ["metaByWeek.get(week)", "metaByWeek.get(semaine)"],
    ['href={"/planning/" + week}', 'href={"/planning/" + semaine}'],
    ["quoteRichTextToPlainText(next)", "quoteRichTextToPlainText(suivant)"],
    ["itemMatchesKind(item,", "itemMatchesKind(element,"],
    ["itemId ??", "idElement ??"],
    ["body.endYear", "corps.endYear"],
    ["[week]", "[semaine]"],
    ["allPeople,", "allPeople,"],
  ];
  for (const [ancien, nouveau] of exacts) sortie = sortie.split(ancien).join(nouveau);

  return sortie;
}

function estMatcher(noeud) {
  let courant = noeud.parent;
  while (courant && !ts.isSourceFile(courant)) {
    if (ts.isCallExpression(courant)) {
      const expression = courant.expression;
      if (
        ts.isPropertyAccessExpression(expression) &&
        ["toContain", "toMatch"].includes(expression.name.text)
      ) {
        return true;
      }
    }
    courant = courant.parent;
  }
  return false;
}

function fichiers(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entree) => {
    const complet = path.join(dir, entree.name);
    if (entree.isDirectory()) return fichiers(complet);
    return entree.isFile() && /\.test\.tsx?$/.test(entree.name) ? [complet] : [];
  });
}

let totalFichiers = 0;
let totalLitteraux = 0;

for (const fichier of fichiers(TESTS)) {
  const source = fs.readFileSync(fichier, "utf8");
  const sf = ts.createSourceFile(fichier, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits = [];

  function visiter(noeud) {
    if (
      (ts.isStringLiteral(noeud) || ts.isNoSubstitutionTemplateLiteral(noeud)) &&
      estMatcher(noeud)
    ) {
      const suivant = transformer(noeud.text);
      if (suivant !== noeud.text) {
        edits.push({
          start: noeud.getStart(sf),
          end: noeud.getEnd(),
          text: JSON.stringify(suivant),
        });
      }
    } else if (noeud.kind === ts.SyntaxKind.RegularExpressionLiteral && estMatcher(noeud)) {
      const brut = noeud.getText(sf);
      const suivant = transformer(brut);
      if (suivant !== brut) {
        edits.push({ start: noeud.getStart(sf), end: noeud.getEnd(), text: suivant });
      }
    }
    ts.forEachChild(noeud, visiter);
  }
  visiter(sf);

  if (!edits.length) continue;
  edits.sort((a, b) => b.start - a.start);
  let contenu = source;
  for (const edit of edits) {
    contenu = contenu.slice(0, edit.start) + edit.text + contenu.slice(edit.end);
  }
  fs.writeFileSync(fichier, contenu, "utf8");
  totalFichiers += 1;
  totalLitteraux += edits.length;
}

console.log(
  `Assertions de francisation: ${totalLitteraux} littéral(aux) mis à jour dans ${totalFichiers} fichier(s).`,
);
