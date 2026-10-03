"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, FileText } from "lucide-react";

const tabs = [
  { label: "Devis", href: "/devis", icon: FileText },
  { label: "Bibliothèque", href: "/devis/bibliotheque", icon: BookOpen },
] as const;

export function QuoteModuleNav() {
  const pathname = usePathname();

  return (
    <div className="quoteModuleTop">
      <div className="quoteModuleHeading">
        <div>
          <p className="eyebrow">Chiffrage</p>
          <h1>Devis</h1>
          <p className="muted">Devis natifs et bibliothèque de chiffrage dans un même espace.</p>
        </div>
      </div>

      <nav className="quoteModuleTabs" aria-label="Navigation du module Devis">
        {tabs.map(({ label, href, icon: Icon }) => {
          const active =
            href === "/devis"
              ? pathname === "/devis" ||
                (pathname.startsWith("/devis/") && !pathname.startsWith("/devis/bibliotheque"))
              : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={active ? "isActive" : undefined}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>

      <style jsx global>{`
        .quoteModuleTop {
          display: grid;
          gap: 16px;
          margin-bottom: 20px;
        }
        .quoteModuleHeading h1 {
          margin-bottom: 5px;
        }
        .quoteModuleHeading p:last-child {
          margin-bottom: 0;
        }
        .quoteModuleTabs {
          width: fit-content;
          display: inline-flex;
          gap: 4px;
          padding: 4px;
          border: 1px solid var(--border);
          border-radius: 10px;
          background: color-mix(in srgb, var(--accent) 4%, white);
        }
        .quoteModuleTabs a {
          min-height: 36px;
          padding: 0 13px;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          border-radius: 7px;
          color: var(--muted);
          font-size: 13px;
          font-weight: 700;
        }
        .quoteModuleTabs a:hover {
          color: var(--accent);
          background: #fff;
        }
        .quoteModuleTabs a.isActive {
          color: var(--accent);
          background: #fff;
          box-shadow: 0 1px 4px rgb(55 39 112 / 0.08);
        }
      `}</style>
    </div>
  );
}
