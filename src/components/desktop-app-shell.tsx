import { Wifi } from "lucide-react";
import { DesktopSidebar } from "./desktop-sidebar";

type DesktopIdentity = {
  displayName: string;
  deviceLabel: string;
};

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
      <DesktopSidebar />

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
