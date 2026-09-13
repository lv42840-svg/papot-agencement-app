export const MODULE_PERMISSIONS = [
  { key: "capture", label: "Entrées" },
  { key: "commercial", label: "Commercial" },
  { key: "quotes", label: "Devis / Chiffrage", future: true },
  { key: "chantiers", label: "Chantiers" },
  { key: "planning", label: "Planning" },
  { key: "hours", label: "Heures" },
  { key: "purchases", label: "Achats" },
  { key: "billing", label: "Facturation", future: true },
  { key: "treasury", label: "Trésorerie / Banque" },
  { key: "team", label: "Équipe" },
  { key: "payroll", label: "Paie" },
  { key: "pilotage", label: "Pilotage" },
  { key: "settings", label: "Paramètres" },
] as const;

export const SPECIAL_PERMISSIONS = [
  {
    key: "commercial.create",
    label: "Créer une affaire commerciale",
    moduleKey: "commercial",
  },
  {
    key: "commercial.provision",
    label: "Provisionner une affaire avant confirmation",
    moduleKey: "commercial",
  },
  {
    key: "commercial.confirm_launch",
    label: "Confirmer une affaire / lancer le chantier",
    moduleKey: "commercial",
  },
  {
    key: "planning.edit_macro",
    label: "Modifier le grand planning",
    moduleKey: "planning",
  },
  {
    key: "planning.edit_daily",
    label: "Modifier le petit planning",
    moduleKey: "planning",
  },
  {
    key: "planning.enter_actual_hours",
    label: "Saisir les heures passées",
    moduleKey: "planning",
  },
  {
    key: "planning.manage_schedules",
    label: "Gestion des horaires et absences",
    moduleKey: "planning",
  },
  {
    key: "chantiers.archive_reactivate",
    label: "Archiver / réactiver un chantier archivé",
    moduleKey: "chantiers",
  },
  {
    key: "purchases.view_supplier_credentials",
    label: "Voir les identifiants fournisseurs",
    moduleKey: "purchases",
  },
  {
    key: "purchases.send_orders",
    label: "Envoyer les bons de commande",
    moduleKey: "purchases",
  },
  {
    key: "purchases.mark_paid",
    label: "Marquer les achats comme payés",
    moduleKey: "purchases",
  },
  {
    key: "dashboard.view_global",
    label: "Voir le tableau de bord global",
    moduleKey: "pilotage",
  },
] as const;

export type ModulePermissionKey = (typeof MODULE_PERMISSIONS)[number]["key"];
export type SpecialPermissionKey = (typeof SPECIAL_PERMISSIONS)[number]["key"];
