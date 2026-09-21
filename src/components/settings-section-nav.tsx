"use client";

import Link from "next/link";

export function SettingsSectionNav({ active }: { active: "company" | "users" }) {
  return (
    <nav className="settingsSectionNav" aria-label="Paramètres">
      <Link className={active === "company" ? "isActive" : undefined} href="/settings/company">
        Société
      </Link>
      <Link className={active === "users" ? "isActive" : undefined} href="/settings/users">
        Utilisateurs et droits
      </Link>
      <style jsx global>{`
        .settingsSectionNav {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 16px;
        }
        .settingsSectionNav a {
          border: 1px solid #ddd7eb;
          border-radius: 999px;
          padding: 7px 12px;
          background: #fff;
          color: #655b7c;
          font-size: 13px;
          font-weight: 650;
          text-decoration: none;
        }
        .settingsSectionNav a.isActive {
          border-color: #c7bce7;
          background: #f1edfb;
          color: #5644a8;
        }
      `}</style>
    </nav>
  );
}
