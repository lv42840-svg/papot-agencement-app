"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AddressBook,
  BriefcaseBusiness,
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardList,
  Clock3,
  FileText,
  FolderOpen,
  Home,
  Landmark,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShoppingCart,
  Users,
} from "lucide-react";

const navigation = [
  { label: "Accueil", icon: Home, href: "/desktop-ready" },
  { label: "Entrées", icon: ClipboardList, href: "/entrees", moduleKey: "capture" },
  { label: "Clients", icon: AddressBook, href: "/clients", moduleKey: "clients" },
  { label: "Commercial", icon: BriefcaseBusiness, href: "/commercial", moduleKey: "commercial" },
  { label: "Chantiers", icon: FolderOpen, href: "/chantiers", moduleKey: "chantiers" },
  {
    label: "Grand planning",
    icon: CalendarDays,
    href: "/planning/2026-S38",
    moduleKey: "planning",
  },
  { label: "Petit planning", icon: CalendarDays, moduleKey: "planning" },
  { label: "Heures", icon: Clock3, moduleKey: "hours" },
  { label: "Achats", icon: ShoppingCart, moduleKey: "purchases" },
  { label: "Facturation", icon: FileText, moduleKey: "billing" },
  { label: "Trésorerie", icon: Landmark, moduleKey: "treasury" },
  { label: "Équipe", icon: Users, moduleKey: "team" },
  { label: "Pilotage", icon: ChartNoAxesCombined, moduleKey: "pilotage" },
  {
    label: "Paramètres",
    icon: Settings,
    href: "/settings/users",
    moduleKey: "settings",
    adminOnly: true,
  },
];

const STORAGE_KEY = "papot.desktop.sidebar.collapsed";
const COMPACT_BREAKPOINT = 1180;

export function DesktopSidebar({
  allowedModules,
  canManagePermissions,
}: {
  allowedModules: string[];
  canManagePermissions: boolean;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const allowed = new Set(allowedModules);
  const visibleNavigation = navigation.filter(
    (item) =>
      (!item.moduleKey || allowed.has(item.moduleKey)) &&
      (!("adminOnly" in item) || !item.adminOnly || canManagePermissions),
  );

  useEffect(() => {
    const applyPreference = () => {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "1") {
        setCollapsed(true);
        return;
      }
      if (saved === "0") {
        setCollapsed(false);
        return;
      }
      setCollapsed(window.innerWidth < COMPACT_BREAKPOINT);
    };

    applyPreference();
    window.addEventListener("resize", applyPreference);
    return () => window.removeEventListener("resize", applyPreference);
  }, []);

  function toggleSidebar() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <>
      <aside className={`desktopSidebarV2${collapsed ? " isCollapsed" : ""}`}>
        <div className="desktopBrandV2">
          <img
            className="desktopBrandLogoV2"
            src="/logo%20papot.jpg"
            alt="PAPOT AGENCEMENT"
            width={94}
            height={94}
          />
        </div>

        <button
          type="button"
          className="desktopSidebarToggle"
          onClick={toggleSidebar}
          aria-label={collapsed ? "Déployer le menu" : "Réduire le menu"}
          title={collapsed ? "Déployer le menu" : "Réduire le menu"}
        >
          {collapsed ? (
            <PanelLeftOpen size={15} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={15} aria-hidden="true" />
          )}
        </button>

        <nav className="desktopNavV2" aria-label="Navigation principale">
          {visibleNavigation.map(({ label, icon: Icon, href }) => {
            const active =
              href === "/desktop-ready"
                ? pathname === href
                : Boolean(href && pathname.startsWith(href));

            return href ? (
              <Link
                href={href}
                key={label}
                className={active ? "desktopNavActive" : undefined}
                aria-current={active ? "page" : undefined}
                title={collapsed ? label : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                <span className="desktopNavLabel">{label}</span>
              </Link>
            ) : (
              <span
                className="desktopNavDisabled"
                key={label}
                aria-disabled="true"
                title={collapsed ? `${label} · À venir` : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                <span className="desktopNavLabel">{label}</span>
                <small>À venir</small>
              </span>
            );
          })}
        </nav>

        <div className="desktopSidebarFooter">
          <span className="desktopVersion desktopVersionFull">PAPOT AGENCEMENT · V0.1</span>
          <span className="desktopVersion desktopVersionShort">V0.1</span>
        </div>
      </aside>

      <style jsx global>{`
        .desktopAppShellV2 {
          transition: grid-template-columns 180ms ease;
        }
        .desktopAppShellV2:has(.desktopSidebarV2.isCollapsed) {
          grid-template-columns: 72px minmax(0, 1fr);
        }
        .desktopSidebarV2 {
          position: sticky;
          top: 0;
          height: 100vh;
          min-height: 0;
          overflow: visible;
          transition: width 180ms ease;
        }
        .desktopBrandV2 {
          position: relative;
          justify-items: center;
          transition:
            min-height 180ms ease,
            padding 180ms ease;
        }
        .desktopBrandLogoV2 {
          display: block;
          width: 94px;
          height: 94px;
          object-fit: cover;
          border-radius: 50%;
          box-shadow: 0 5px 18px rgb(55 39 112 / 0.15);
          transition:
            width 180ms ease,
            height 180ms ease;
        }
        .desktopSidebarToggle {
          position: absolute;
          top: 105px;
          right: -14px;
          z-index: 5;
          width: 28px;
          height: 28px;
          padding: 0;
          display: grid;
          place-items: center;
          border: 1px solid #ded9ee;
          border-radius: 50%;
          background: #ffffff;
          color: #7666d6;
          box-shadow: 0 5px 14px rgb(54 42 102 / 0.16);
        }
        .desktopSidebarToggle:hover {
          background: #f8f6ff;
          color: #5f4cc7;
        }
        .desktopNavV2 > a:first-child {
          background: transparent;
          box-shadow: none;
        }
        .desktopNavV2 > a.desktopNavActive {
          background: rgb(255 255 255 / 0.23);
          box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.08);
        }
        .desktopVersionShort {
          display: none;
        }
        .desktopSidebarV2.isCollapsed .desktopBrandV2 {
          min-height: 92px;
          padding: 14px 8px;
        }
        .desktopSidebarV2.isCollapsed .desktopBrandLogoV2 {
          width: 46px;
          height: 46px;
          box-shadow: 0 4px 12px rgb(55 39 112 / 0.14);
        }
        .desktopSidebarV2.isCollapsed .desktopSidebarToggle {
          top: 78px;
        }
        .desktopSidebarV2.isCollapsed .desktopNavV2 {
          padding: 14px 9px;
        }
        .desktopSidebarV2.isCollapsed .desktopNavV2 > a,
        .desktopSidebarV2.isCollapsed .desktopNavV2 > span {
          min-height: 42px;
          padding: 0;
          justify-content: center;
          gap: 0;
        }
        .desktopSidebarV2.isCollapsed .desktopNavV2 svg {
          flex: 0 0 auto;
        }
        .desktopSidebarV2.isCollapsed .desktopNavLabel,
        .desktopSidebarV2.isCollapsed .desktopNavDisabled small,
        .desktopSidebarV2.isCollapsed .desktopVersionFull {
          display: none;
        }
        .desktopSidebarV2.isCollapsed .desktopSidebarFooter {
          padding: 16px 0;
          text-align: center;
        }
        .desktopSidebarV2.isCollapsed .desktopVersionShort {
          display: inline;
          font-size: 8px;
        }

        @media (max-height: 760px) {
          .desktopBrandV2 {
            min-height: 96px;
            padding: 12px 18px;
          }
          .desktopBrandLogoV2 {
            width: 72px;
            height: 72px;
          }
          .desktopSidebarToggle {
            top: 82px;
          }
          .desktopNavV2 {
            gap: 1px;
            padding-top: 10px;
            padding-bottom: 10px;
          }
          .desktopNavV2 > a,
          .desktopNavV2 > span {
            min-height: 34px;
          }
          .desktopSidebarFooter {
            padding-top: 10px;
            padding-bottom: 10px;
          }
          .desktopSidebarV2.isCollapsed .desktopBrandV2 {
            min-height: 76px;
            padding: 10px 8px;
          }
          .desktopSidebarV2.isCollapsed .desktopBrandLogoV2 {
            width: 42px;
            height: 42px;
          }
          .desktopSidebarV2.isCollapsed .desktopSidebarToggle {
            top: 62px;
          }
          .desktopSidebarV2.isCollapsed .desktopNavV2 > a,
          .desktopSidebarV2.isCollapsed .desktopNavV2 > span {
            min-height: 35px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .desktopAppShellV2,
          .desktopBrandV2,
          .desktopBrandLogoV2 {
            transition: none;
          }
        }
      `}</style>
    </>
  );
}
