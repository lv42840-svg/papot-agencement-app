export const MODULE_PERMISSION_CATALOG = [
  { key: "capture", label: "Entrées" },
  { key: "commercial", label: "Commercial" },
  { key: "chantiers", label: "Chantiers" },
  { key: "planning", label: "Planning" },
  { key: "hours", label: "Heures" },
  { key: "purchases", label: "Achats" },
  { key: "billing", label: "Facturation" },
  { key: "treasury", label: "Trésorerie / Banque" },
  { key: "team", label: "Équipe" },
  { key: "pilotage", label: "Pilotage" },
] as const;

export const SPECIAL_PERMISSION_CATALOG = [
  {
    key: "commercial.create",
    label: "Créer une affaire commerciale",
    group: "Commercial",
  },
  {
    key: "commercial.provision",
    label: "Provisionner une affaire avant confirmation",
    group: "Commercial",
  },
  {
    key: "commercial.confirm_launch",
    label: "Confirmer une affaire et lancer le chantier",
    group: "Commercial",
  },
  {
    key: "planning.macro.write",
    label: "Modifier le grand planning",
    group: "Planning",
  },
  {
    key: "planning.daily.write",
    label: "Modifier le petit planning",
    group: "Planning",
  },
  {
    key: "hours.actual.write",
    label: "Saisir les heures passées",
    group: "Planning",
  },
  {
    key: "planning.schedules.write",
    label: "Gérer les horaires et absences",
    group: "Planning",
  },
  {
    key: "chantiers.archive",
    label: "Archiver et réactiver un chantier",
    group: "Chantiers",
  },
  {
    key: "pilotage.financial.read",
    label: "Voir le pilotage financier / rentabilité",
    group: "Pilotage",
  },
  {
    key: "treasury.bank.read",
    label: "Accéder aux mouvements bancaires",
    group: "Trésorerie",
  },
] as const;

export type ModulePermissionKey = (typeof MODULE_PERMISSION_CATALOG)[number]["key"];
export type SpecialPermissionKey = (typeof SPECIAL_PERMISSION_CATALOG)[number]["key"];

export const FUTURE_PERMISSION_NAMESPACES = ["quotes", "billing"] as const;
