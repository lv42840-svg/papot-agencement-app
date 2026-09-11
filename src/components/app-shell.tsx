import Link from "next/link";
import { ClipboardList, Home, Menu, PlusCircle, CalendarDays, LogOut } from "lucide-react";
import type { CurrentUser } from "@/lib/auth/session";
import { accentPalette, isAccentKey } from "@/lib/theme/palette";
import { Brand } from "@/components/brand";
import { AccentPicker } from "@/components/accent-picker";

export function AppShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const accent = isAccentKey(user.accentKey)
    ? accentPalette[user.accentKey]
    : accentPalette.lavender;
  const initials = user.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className="appShell"
      style={
        {
          "--accent": accent.value,
          "--accent-foreground": accent.foreground,
        } as React.CSSProperties
      }
    >
      <aside className="sidebar">
        <div className="sidebarTop">
          <Brand />
        </div>
        <nav className="desktopNav" aria-label="Navigation principale">
          <Link href="/">
            <Home size={18} /> Accueil
          </Link>
          <Link href="/capture">
            <PlusCircle size={18} /> Nouvelle capture
          </Link>
          <Link href="/tasks">
            <ClipboardList size={18} /> Mes tâches
          </Link>
          <span className="navPending" aria-disabled="true">
            <CalendarDays size={18} /> Planning
          </span>
        </nav>
        <div className="sidebarBottom">
          <AccentPicker initialAccent={user.accentKey} />
          <div className="profileLine">
            <span className="avatar" aria-hidden="true">
              {initials}
            </span>
            <span className="profileName">{user.displayName}</span>
            <form action="/api/auth/logout" method="post">
              <button className="iconButton" type="submit" title="Se déconnecter">
                <LogOut size={17} />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <main className="content">{children}</main>

      <nav className="mobileNav" aria-label="Navigation mobile">
        <Link href="/">
          <Home size={21} />
          <span>Accueil</span>
        </Link>
        <Link className="captureNav" href="/capture">
          <PlusCircle size={23} />
          <span>Capture</span>
        </Link>
        <Link href="/tasks">
          <ClipboardList size={21} />
          <span>Mes tâches</span>
        </Link>
        <span aria-disabled="true">
          <Menu size={21} />
          <span>Menu</span>
        </span>
      </nav>
    </div>
  );
}
