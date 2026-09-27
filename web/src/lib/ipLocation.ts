// Approximate city from the client's IP, for when the phone shares no location
// (permission denied, GPS off). City-level at best; mobile carriers sometimes
// route through a hub city, so this is a fallback, never a first choice.
//
// Provider: ipwho.is free tier — no key, commercial use allowed, 1,000
// requests/day. Results are cached per IP so repeat questions cost nothing.

export type IpLocation = { lat: number; lon: number; city: string };

const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 5000;
const cache = new Map<string, { at: number; loc: IpLocation | null }>();

/** The caller's public IP. Caddy sets X-Forwarded-For to the real client IP. */
export function clientIp(request: Request): string | undefined {
  const raw =
    request.headers.get("x-forwarded-for")?.split(",")[0] ??
    request.headers.get("x-real-ip") ??
    "";
  const ip = raw.trim().replace(/^::ffff:/i, "");
  return ip && isPublic(ip) ? ip : undefined;
}

function isPublic(ip: string): boolean {
  if (ip.includes(":")) {
    const v6 = ip.toLowerCase();
    return !(v6 === "::1" || /^(fc|fd|fe[89ab])/.test(v6));
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = p;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export async function lookupIp(ip: string): Promise<IpLocation | null> {
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.loc;

  let loc: IpLocation | null = null;
  try {
    // Short timeout: this runs in series before the weather fetch, mid voice turn.
    const res = await fetch(
      `https://ipwho.is/${encodeURIComponent(ip)}?fields=success,city,latitude,longitude`,
      { signal: AbortSignal.timeout(2000) },
    );
    const data = (await res.json()) as {
      success?: boolean;
      city?: string;
      latitude?: number;
      longitude?: number;
    };
    if (
      data.success &&
      data.city &&
      typeof data.latitude === "number" &&
      typeof data.longitude === "number"
    ) {
      loc = { lat: data.latitude, lon: data.longitude, city: data.city };
    }
  } catch {
    // Network failure: don't cache, the next question retries.
    return null;
  }

  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(ip, { at: Date.now(), loc });
  return loc;
}
