import { listReadableModules } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { DesktopSidebar } from "./desktop-sidebar";
import { DesktopTopbar } from "./desktop-topbar";

type DesktopDeviceIdentity = {
  deviceLabel: string;
};

function readDesktopDeviceIdentity(): DesktopDeviceIdentity {
  const rawConfig = process.env.PAPOT_DESKTOP_CONFIG_JSON;
  if (!rawConfig) {
    return {
      deviceLabel: "Poste PAPOT",
    };
  }

  try {
    const configuration = JSON.parse(rawConfig) as { device_label?: unknown };
    return {
      deviceLabel:
        typeof configuration.device_label === "string" ? configuration.device_label : "Poste PAPOT",
    };
  } catch {
    return {
      deviceLabel: "Poste PAPOT",
    };
  }
}

export async function DesktopAppShell({ children }: { children: React.ReactNode }) {
  const utilisateur = await requireUser();
  const device = readDesktopDeviceIdentity();
  const allowedModules = await listReadableModules(utilisateur.id);
  const initials = utilisateur.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="desktopAppShellV2">
      <DesktopSidebar
        allowedModules={allowedModules}
        canManagePermissions={utilisateur.canManagePermissions}
      />

      <div className="desktopWorkspace">
        <DesktopTopbar
          displayName={utilisateur.displayName}
          deviceLabel={device.deviceLabel}
          initials={initials}
        />
        <main className="desktopMain">{children}</main>
      </div>
    </div>
  );
}
