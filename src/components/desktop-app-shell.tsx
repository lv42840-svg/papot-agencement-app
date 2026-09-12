import Link from "next/link";
import {
  BriefcaseBusiness,
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardList,
  Clock3,
  FileText,
  FolderOpen,
  Home,
  Landmark,
  Settings,
  ShoppingCart,
  Users,
  Wifi,
} from "lucide-react";

type DesktopIdentity = {
  displayName: string;
  deviceLabel: string;
};

const navigation = [
  { label: "Accueil", icon: Home, href: "/desktop-ready" },
  { label: "Entrées", icon: ClipboardList },
  { label: "Commercial", icon: BriefcaseBusiness },
  { label: "Chantiers", icon: FolderOpen, href: "/chantiers/chantier-test-verrou" },
  { label: "Grand planning", icon: CalendarDays, href: "/planning/2026-S38" },
  { label: "Petit planning", icon: CalendarDays },
  { label: "Heures", icon: Clock3 },
  { label: "Achats", icon: ShoppingCart },
  { label: "Facturation", icon: FileText },
  { label: "Trésorerie", icon: Landmark },
  { label: "Équipe", icon: Users },
  { label: "Pilotage", icon: ChartNoAxesCombined },
  { label: "Paramètres", icon: Settings },
];

function readDesktopIdentity(): DesktopIdentity {
  const rawConfig = process.env.PAPOT_DESKTOP_CONFIG_JSON;
  if (!rawConfig) return { displayName: "Utilisateur PAPOT", deviceLabel: "Poste PAPOT" };
  try {
    const config = JSON.parse(rawConfig) as {
      papot_user_display_name?: unknown;
      device_label?: unknown;
    };
    return {
      displayName:
        typeof config.papot_user_display_name === "string"
          ? config.papot_user_display_name
          : "Utilisateur PAPOT",
      deviceLabel:
        typeof config.device_label === "string" ? config.device_label : "Poste PAPOT",
    };
  } catch {
    return { displayName: "Utilisateur PAPOT", deviceLabel: "Poste PAPOT" };
  }
}

export function DesktopAppShell({ children }: { children: React.ReactNode }) {
  const identity = readDesktopIdentity();
  const initials = identity.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="desktopAppShellV2">
      <aside className="desktopSidebarV2">
        <div className="desktopBrandV2">
          <img
            src="/logo%20papot.jpg"
            alt="PAPOT AGENCEMENT"
            width={94}
            height={94}
            style={{
              display: "block",
              width: 94,
              height: 94,
              objectFit: "cover",
              borderRadius: "50%",
              margin: "0 auto",
            }}
          />
        </div>
        <nav className="desktopNavV2" aria-label="Navigation principale">
          {navigation.map(({ label, icon: Icon, href }) =>
            href ? (
              <Link href={href} key={label}>
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
              </Link>
            ) : (
              <span className="desktopNavDisabled" key={label} aria-disabled="true">
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
                <small>À venir</small>
              </span>
            ),
          )}
        </nav>
        <div className="desktopSidebarFooter">
          <span className="desktopVersion">PAPOT AGENCEMENT · V0.1</span>
        </div>
      </aside>

      <div className="desktopWorkspace">
        <header className="desktopTopbar">
          <div className="desktopConnection">
            <Wifi size={16} aria-hidden="true" />
            <span>Configuration active</span>
          </div>
          <div className="desktopIdentity">
            <div>
              <strong>{identity.displayName}</strong>
              <span>{identity.deviceLabel}</span>
            </div>
            <span className="desktopAvatar">{initials}</span>
          </div>
        </header>
        <main className="desktopMain">{children}</main>
      </div>
    </div>
  );
}
