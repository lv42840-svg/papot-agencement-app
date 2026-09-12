"use client";

import { Wifi, WifiOff } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type DesktopTopbarProps = {
  displayName: string;
  deviceLabel: string;
  initials: string;
  configured: boolean;
};

const routeTitles: Array<{ prefix: string; title: string }> = [
  { prefix: "/desktop-ready", title: "Accueil" },
  { prefix: "/entrees", title: "Entrées" },
  { prefix: "/commercial", title: "Commercial" },
  { prefix: "/chantiers", title: "Chantiers" },
  { prefix: "/planning", title: "Grand planning" },
  { prefix: "/petit-planning", title: "Petit planning" },
  { prefix: "/heures", title: "Heures" },
  { prefix: "/achats", title: "Achats" },
  { prefix: "/facturation", title: "Facturation" },
  { prefix: "/tresorerie", title: "Trésorerie" },
  { prefix: "/equipe", title: "Équipe" },
  { prefix: "/pilotage", title: "Pilotage" },
  { prefix: "/parametres", title: "Paramètres" },
];

function resolveTitle(pathname: string) {
  return routeTitles.find(({ prefix }) => pathname.startsWith(prefix))?.title ?? "PAPOT AGENCEMENT";
}

export function DesktopTopbar({
  displayName,
  deviceLabel,
  initials,
  configured,
}: DesktopTopbarProps) {
  const pathname = usePathname();
  const [dateLabel, setDateLabel] = useState("");
  const pageTitle = useMemo(() => resolveTitle(pathname), [pathname]);

  useEffect(() => {
    const formatter = new Intl.DateTimeFormat("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const refreshDate = () => setDateLabel(formatter.format(new Date()));
    refreshDate();
    const timer = window.setInterval(refreshDate, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <>
      <header className="desktopTopbar">
        <div className="desktopTopbarContext">
          <strong className="desktopTopbarPageTitle">{pageTitle}</strong>
          <span className="desktopTopbarDate">{dateLabel}</span>
        </div>

        <div className="desktopTopbarRight">
          <div className={`desktopConnection${configured ? "" : " isOffline"}`}>
            {configured ? <Wifi size={16} aria-hidden="true" /> : <WifiOff size={16} aria-hidden="true" />}
            <span>{configured ? "Configuration active" : "Configuration absente"}</span>
          </div>
          <div className="desktopIdentity">
            <div>
              <strong>{displayName}</strong>
              <span>{deviceLabel}</span>
            </div>
            <span className="desktopAvatar">{initials}</span>
          </div>
        </div>
      </header>

      <style jsx global>{`
        .desktopTopbar {
          justify-content: space-between;
        }
        .desktopTopbarContext {
          min-width: 0;
          display: grid;
          gap: 3px;
        }
        .desktopTopbarPageTitle {
          font-size: 16px;
          line-height: 1.1;
          color: #25232d;
        }
        .desktopTopbarDate {
          color: var(--muted);
          font-size: 11px;
          text-transform: capitalize;
        }
        .desktopTopbarRight {
          display: flex;
          align-items: center;
          gap: 22px;
          min-width: 0;
        }
        .desktopConnection.isOffline {
          color: #b45309;
        }

        @media (max-width: 1280px) {
          .desktopMain {
            padding: 24px 22px 40px;
          }
          .dashboardStats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .dashboardGrid {
            grid-template-columns: minmax(0, 1fr);
          }
          .dashboardQuickPanel {
            grid-column: auto;
          }
        }

        @media (max-width: 1120px) {
          .desktopTopbar {
            min-height: 68px;
            padding: 0 20px;
            gap: 16px;
          }
          .desktopTopbarRight {
            gap: 14px;
          }
          .desktopConnection span {
            display: none;
          }
          .desktopIdentity div span {
            display: none;
          }
          .desktopMain {
            padding: 22px 18px 36px;
          }
          .dashboardHeading {
            align-items: flex-start;
            flex-direction: column;
          }
          .dashboardHeading > * {
            width: 100%;
          }
          .dashboardQuickActions {
            flex-wrap: wrap;
          }
        }

        @media (max-width: 860px) {
          .desktopTopbar {
            padding: 0 14px;
          }
          .desktopTopbarPageTitle {
            font-size: 14px;
          }
          .desktopTopbarDate {
            font-size: 10px;
          }
          .desktopIdentity > div {
            display: none;
          }
          .dashboardStats {
            grid-template-columns: minmax(0, 1fr);
          }
          .desktopMain {
            padding: 18px 14px 30px;
          }
        }
      `}</style>
    </>
  );
}
