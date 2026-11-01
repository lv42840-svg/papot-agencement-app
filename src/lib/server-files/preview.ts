/** Only verified passive formats may be rendered on the application origin. */
export function safePreviewType(bytes: Uint8Array): string | null {
  const b = Buffer.from(bytes);
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (
    b.subarray(0, 4).toString("ascii") === "RIFF" &&
    b.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  if (b.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  return null;
}
export const documentSecurityHeaders = {
  "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, no-store",
};
