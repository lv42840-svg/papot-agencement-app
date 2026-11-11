/** Only verified passive formats may be rendered on the application origin. */
export function safePreviewType(
  octets: Uint8Array,
): string | null {
  const tampon = Buffer.from(octets);
  if (
    tampon
      .subarray(0, 8)
      .equals(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      )
  ) {
    return "image/png";
  }
  if (
    tampon[0] === 255 &&
    tampon[1] === 216 &&
    tampon[2] === 255
  ) {
    return "image/jpeg";
  }
  if (
    ["GIF87a", "GIF89a"].includes(
      tampon.subarray(0, 6).toString("ascii"),
    )
  ) {
    return "image/gif";
  }
  if (
    tampon.subarray(0, 4).toString("ascii") === "RIFF" &&
    tampon.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (tampon.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  return null;
}

export const documentSecurityHeaders = {
  "Content-Security-Policy":
    "sandbox; default-src 'none'; style-src 'unsafe-inline'",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, no-store",
};
