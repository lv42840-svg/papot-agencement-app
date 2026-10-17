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
    const config = JSON.parse(rawConfig) as { device_label?: unknown };
    return {
      deviceLabel: typeof config.device_label === "string" ? config.device_label : "Poste PAPOT",
    };
  } catch {
    return {
      deviceLabel: "Poste PAPOT",
    };
  }
}

export async function DesktopAppShell({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const device = readDesktopDeviceIdentity();
  const allowedModules = await listReadableModules(user.id);
  const initials = user.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="desktopAppShellV2">
      <DesktopSidebar
        allowedModules={allowedModules}
        canManagePermissions={user.canManagePermissions}
      />

      <div className="desktopWorkspace">
        <DesktopTopbar
          displayName={user.displayName}
          deviceLabel={device.deviceLabel}
          initials={initials}
        />
        <main className="desktopMain">{children}</main>
      </div>
    </div>
  );
}
