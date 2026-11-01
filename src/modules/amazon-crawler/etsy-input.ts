export function normalizeEtsyListingId(source: string): string {
  const value = source.trim();
  if (/^\d{6,20}$/.test(value)) return value;
  try {
    const url = new URL(value);
    const match = /\/listing\/(\d{6,20})(?:\/|$)/.exec(url.pathname);
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      && (url.hostname === "etsy.com" || url.hostname.endsWith(".etsy.com")) && match?.[1]) return match[1];
  } catch { /* Invalid input is reported with the source line by the caller. */ }
  throw new Error("Nhập URL listing Etsy hoặc listing ID hợp lệ.");
}
