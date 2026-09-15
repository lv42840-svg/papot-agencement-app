import { listReadableModules } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { DesktopSidebar } from "./desktop-sidebar";
import { DesktopTopbar } from "./desktop-topbar";

type DesktopDeviceIdentity = {
  deviceLabel: string;
  configured: boolean;
};

function readDesktopDeviceIdentity(): DesktopDeviceIdentity {
  const rawConfig = process.env.PAPOT_DESKTOP_CONFIG_JSON;
  if (!rawConfig) {
    return {
      deviceLabel: "Poste PAPOT",
      configured: false,
    };
  }

  try {
    const config = JSON.parse(rawConfig) as { device_label?: unknown };
    return {
      deviceLabel: typeof config.device_label === "string" ? config.device_label : "Poste PAPOT",
      configured: true,
    };
  } catch {
    return {
      deviceLabel: "Poste PAPOT",
      configured: false,
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
          configured={device.configured}
        />
        <main className="desktopMain">{children}</main>
      </div>
    </div>
  );
}
