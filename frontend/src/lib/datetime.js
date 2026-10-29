export const TZ = "Europe/Lisbon";

export function fmtTime(d = new Date()) {
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(d);
}

export function fmtDateTime(d = new Date()) {
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
}

export function detectOS() {
  const ua = (navigator.userAgent || "").toLowerCase();
  if (/android/.test(ua)) return "android";
  if (/windows|win32|win64/.test(ua)) return "windows";
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/macintosh|mac os/.test(ua)) return "mac";
  return "other";
}
