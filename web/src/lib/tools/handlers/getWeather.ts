import type { ServerTool, ToolContext } from "../types";
import { lookupIp } from "@/lib/ipLocation";

// Well-known Georgian cities — avoids a geocoder roundtrip and handles the
// Georgian-script form reliably. Key is lowercased.
const KNOWN_CITIES: Record<string, { lat: number; lon: number; name_ka: string }> = {
  "თბილისი": { lat: 41.7151, lon: 44.8271, name_ka: "თბილისი" },
  "tbilisi": { lat: 41.7151, lon: 44.8271, name_ka: "თბილისი" },
  "ბათუმი": { lat: 41.6168, lon: 41.6367, name_ka: "ბათუმი" },
  "batumi": { lat: 41.6168, lon: 41.6367, name_ka: "ბათუმი" },
  "ქუთაისი": { lat: 42.2679, lon: 42.7180, name_ka: "ქუთაისი" },
  "kutaisi": { lat: 42.2679, lon: 42.7180, name_ka: "ქუთაისი" },
  "რუსთავი": { lat: 41.5494, lon: 45.0, name_ka: "რუსთავი" },
  "rustavi": { lat: 41.5494, lon: 45.0, name_ka: "რუსთავი" },
  "ზუგდიდი": { lat: 42.5088, lon: 41.8709, name_ka: "ზუგდიდი" },
  "zugdidi": { lat: 42.5088, lon: 41.8709, name_ka: "ზუგდიდი" },
  "გორი": { lat: 41.9847, lon: 44.1086, name_ka: "გორი" },
  "gori": { lat: 41.9847, lon: 44.1086, name_ka: "გორი" },
  "ფოთი": { lat: 42.15, lon: 41.67, name_ka: "ფოთი" },
  "poti": { lat: 42.15, lon: 41.67, name_ka: "ფოთი" },
  "ახალციხე": { lat: 41.6394, lon: 42.981, name_ka: "ახალციხე" },
  "akhaltsikhe": { lat: 41.6394, lon: 42.981, name_ka: "ახალციხე" },
  "თელავი": { lat: 41.9189, lon: 45.4734, name_ka: "თელავი" },
  "telavi": { lat: 41.9189, lon: 45.4734, name_ka: "თელავი" },
  "მცხეთა": { lat: 41.8458, lon: 44.7182, name_ka: "მცხეთა" },
  "mtskheta": { lat: 41.8458, lon: 44.7182, name_ka: "მცხეთა" },
  "ბორჯომი": { lat: 41.8394, lon: 43.3867, name_ka: "ბორჯომი" },
  "borjomi": { lat: 41.8394, lon: 43.3867, name_ka: "ბორჯომი" },
  "გუდაური": { lat: 42.4767, lon: 44.4817, name_ka: "გუდაური" },
  "gudauri": { lat: 42.4767, lon: 44.4817, name_ka: "გუდაური" },
  "ბაკურიანი": { lat: 41.7467, lon: 43.5333, name_ka: "ბაკურიანი" },
  "bakuriani": { lat: 41.7467, lon: 43.5333, name_ka: "ბაკურიანი" },
};

// WMO weather codes → Georgian condition strings.
// https://open-meteo.com/en/docs#weathervariables
const WMO_KA: Record<number, string> = {
  0: "მზიანი",
  1: "ძირითადად მზიანი",
  2: "ნაწილობრივ ღრუბლიანი",
  3: "მოღრუბლული",
  45: "ნისლიანი",
  48: "ნისლი ყინულით",
  51: "წვრილი წვიმა",
  53: "წვრილი წვიმა",
  55: "ძლიერი წვრილი წვიმა",
  56: "გაყინული წვრილი წვიმა",
  57: "ძლიერი გაყინული წვრილი წვიმა",
  61: "მსუბუქი წვიმა",
  63: "წვიმა",
  65: "ძლიერი წვიმა",
  66: "გაყინული წვიმა",
  67: "ძლიერი გაყინული წვიმა",
  71: "მსუბუქი თოვლი",
  73: "თოვლი",
  75: "ძლიერი თოვლი",
  77: "თოვლის მარცვლები",
  80: "მსუბუქი წვიმა",
  81: "წვიმა",
  82: "ძლიერი წვიმა",
  85: "მსუბუქი თოვლი",
  86: "ძლიერი თოვლი",
  95: "ჭექა-ქუხილი",
  96: "ჭექა-ქუხილი სეტყვით",
  99: "ძლიერი ჭექა-ქუხილი სეტყვით",
};

// `name` is absent only when coords resolve to no known place name.
type Geo = { lat: number; lon: number; name?: string };

async function geocode(query: string): Promise<Geo | null> {
  const key = query.trim().toLowerCase();
  if (KNOWN_CITIES[key]) {
    const c = KNOWN_CITIES[key];
    return { lat: c.lat, lon: c.lon, name: c.name_ka };
  }
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      query
    )}&count=1&language=ka&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: Array<{ latitude: number; longitude: number; name: string }>;
    };
    const hit = data.results?.[0];
    if (!hit) return null;
    return { lat: hit.latitude, lon: hit.longitude, name: hit.name };
  } catch {
    return null;
  }
}

// Georgian-script city name for GPS coords the phone couldn't name itself.
async function reverseGeocode(lat: number, lon: number): Promise<string | undefined> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&accept-language=ka`,
      {
        headers: { "User-Agent": "mia-voice-ai/1.0" },
        signal: AbortSignal.timeout(3000),
      }
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      address?: Partial<
        Record<"city" | "town" | "village" | "municipality" | "county" | "state", string>
      >;
    };
    const a = data.address ?? {};
    return a.city || a.town || a.village || a.municipality || a.county || a.state;
  } catch {
    return undefined;
  }
}

/**
 * Where the user is right now, most precise source first: phone GPS (named
 * after the phone's city), the phone's city alone (the Settings override
 * arrives without coords), then an IP guess. Null when none resolve.
 */
async function currentLocation(ctx: ToolContext): Promise<Geo | null> {
  if (ctx.userCoords) {
    const { lat, lon } = ctx.userCoords;
    return { lat, lon, name: ctx.userCity || (await reverseGeocode(lat, lon)) };
  }
  if (ctx.userCity) {
    const geo = await geocode(ctx.userCity);
    if (geo) return geo;
  }
  if (ctx.clientIp) {
    const ip = await lookupIp(ctx.clientIp);
    if (ip) {
      const known = KNOWN_CITIES[ip.city.toLowerCase()];
      return { lat: ip.lat, lon: ip.lon, name: known?.name_ka ?? ip.city };
    }
  }
  return null;
}

type OpenMeteoCurrent = {
  temperature_2m: number;
  apparent_temperature: number;
  relative_humidity_2m: number;
  wind_speed_10m: number;
  weather_code: number;
  precipitation: number;
};

async function fetchCurrent(lat: number, lon: number) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "wind_speed_10m",
      "weather_code",
      "precipitation",
    ].join(","),
    timezone: "Asia/Tbilisi",
    wind_speed_unit: "kmh",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const data = (await res.json()) as { current: OpenMeteoCurrent };
  return data.current;
}

export const getWeather: ServerTool = {
  name: "get_weather",
  execution: "server",
  definition: {
    type: "function",
    function: {
      name: "get_weather",
      description:
        "Get the current weather. Pass 'city' only when the user names a city in this request (Georgian or otherwise), or in a short follow-up to an earlier city question. Otherwise omit it: the server resolves the user's current city from their phone. Never fill 'city' from remembered facts such as where the user lives. If the result is 'need_location', ask the user which city.",
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description:
              "City name, preferably in Georgian script (e.g. 'თბილისი', 'ბათუმი'). Any language also works.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  async handler(args, ctx: ToolContext) {
    const city = typeof args.city === "string" ? args.city : "";
    let geo: Geo | null = null;

    if (city) {
      geo = await geocode(city);
      if (!geo) {
        return {
          error: "city_not_found",
          message: `ვერ ვიპოვე ქალაქი: ${city}`,
        };
      }
    } else {
      geo = await currentLocation(ctx);
      if (!geo) {
        return {
          error: "need_location",
          message:
            "The user's location is unknown. Ask the user which city they mean.",
        };
      }
    }

    try {
      const current = await fetchCurrent(geo.lat, geo.lon);
      return {
        ...(geo.name && { city: geo.name }),
        temperature_c: Math.round(current.temperature_2m),
        feels_like_c: Math.round(current.apparent_temperature),
        humidity_pct: Math.round(current.relative_humidity_2m),
        wind_kmh: Math.round(current.wind_speed_10m),
        precipitation_mm: current.precipitation,
        condition_code: current.weather_code,
        condition_ka: WMO_KA[current.weather_code] ?? "უცნობი",
      };
    } catch (err) {
      return {
        error: "weather_service_failed",
        message: err instanceof Error ? err.message : "weather fetch failed",
      };
    }
  },
};
