import { Eye, Pencil } from "lucide-react";
import { describeSharedResourceAccess } from "@/lib/sync/resource-access-presentation";

export function SharedResourceAccessBanner(props: {
  status: "editable" | "read-only";
  version: number;
  ownerDisplayName?: string;
}) {
  const presentation = describeSharedResourceAccess(props);
  const readOnly = !presentation.canEdit;
  const Icon = readOnly ? Eye : Pencil;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        marginBottom: 18,
        padding: "12px 14px",
        borderRadius: 9,
        border: readOnly ? "1px solid #efd7ad" : "1px solid #cbe7d6",
        background: readOnly ? "#fff8eb" : "#f2fbf6",
        color: readOnly ? "#7a5418" : "#256c47",
      }}
    >
      <Icon size={19} aria-hidden="true" style={{ flex: "0 0 auto", marginTop: 1 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 13 }}>{presentation.heading}</div>
        <div style={{ marginTop: 2, fontSize: 13 }}>{presentation.detail}</div>
        <div style={{ marginTop: 4, fontSize: 11, opacity: 0.78 }}>{presentation.versionLabel}</div>
      </div>
    </div>
  );
}
