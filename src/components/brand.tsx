export function Brand({ compact = false }: { compact?: boolean }) {
  const size = compact ? 54 : 150;

  return (
    <div className={compact ? "brand brandCompact" : "brand"} aria-label="PAPOT AGENCEMENT">
      <img
        src="/logo%20papot.jpg"
        alt="PAPOT AGENCEMENT"
        width={size}
        height={size}
        style={{
          display: "block",
          width: size,
          height: size,
          objectFit: "cover",
          borderRadius: "50%",
        }}
      />
    </div>
  );
}
