export type DesktopNavigationIcon =
  | "home"
  | "clipboard"
  | "users"
  | "commercial"
  | "file"
  | "folder"
  | "calendar"
  | "clock"
  | "cart"
  | "landmark"
  | "chart"
  | "settings";

export type DesktopNavigationItem = {
  label: string;
  icon: DesktopNavigationIcon;
  href?: string;
  moduleKey?: string;
  adminOnly?: boolean;
};

export const desktopNavigation: DesktopNavigationItem[] = [
  { label: "Accueil", icon: "home", href: "/desktop-ready" },
  { label: "Entrées", icon: "clipboard", href: "/entrees", moduleKey: "capture" },
  { label: "Clients", icon: "users", href: "/clients", moduleKey: "clients" },
  { label: "Commercial", icon: "commercial", href: "/commercial", moduleKey: "commercial" },
  { label: "Devis", icon: "file", href: "/devis", moduleKey: "quotes" },
  { label: "Chantiers", icon: "folder", href: "/chantiers", moduleKey: "chantiers" },
  { label: "Planning", icon: "calendar", href: "/planning", moduleKey: "planning" },
  { label: "Heures", icon: "clock", href: "/heures", moduleKey: "planning" },
  { label: "Achats", icon: "cart", href: "/achats", moduleKey: "purchases" },
  { label: "Facturation", icon: "file", href: "/facturation", moduleKey: "billing" },
  { label: "Trésorerie", icon: "landmark", moduleKey: "treasury" },
  { label: "Équipe", icon: "users", moduleKey: "team" },
  {
    label: "Rentabilité entreprise",
    icon: "chart",
    href: "/pilotage/rentabilite",
    moduleKey: "pilotage",
  },
  {
    label: "Paramètres",
    icon: "settings",
    href: "/settings/company",
    moduleKey: "settings",
    adminOnly: true,
  },
];
