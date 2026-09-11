export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "brand brandCompact" : "brand"} aria-label="PAPOT AGENCEMENT">
      <div className="brandName">PAPOT</div>
      {!compact && <div className="brandSubtitle">AGENCEMENT</div>}
    </div>
  );
}
