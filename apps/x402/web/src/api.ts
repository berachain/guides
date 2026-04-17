import { apiBaseUrl } from "./config";
import type { PaidFetch } from "./usePaidFetch";

export interface GeocodingResult {
  lat: number;
  lon: number;
  displayName: string;
}

export interface WeatherResult {
  location: string;
  temperature: number;
  unit: string;
  shortForecast: string;
  detailedForecast: string;
  windSpeed: string;
  windDirection: string;
}

export interface SettlementReceipt {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
  amount?: string;
  errorReason?: string;
}

export interface HttpResult<T> {
  endpoint: string;
  method: "GET";
  status: number;
  body: T;
  headers: Record<string, string>;
}

export function geocodeUrl(city: string): string {
  const url = new URL("/geocode", apiBaseUrl);
  url.searchParams.set("city", city);
  return url.toString();
}

export function weatherUrl(lat: number, lon: number): string {
  const url = new URL("/weather", apiBaseUrl);
  url.searchParams.set("lat", lat.toFixed(4));
  url.searchParams.set("lon", lon.toFixed(4));
  return url.toString();
}

export async function geocodeCity(
  city: string,
): Promise<HttpResult<GeocodingResult>> {
  const endpoint = geocodeUrl(city);
  const res = await fetch(endpoint);
  const body = (await res.json()) as GeocodingResult & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `geocoding failed (${res.status})`);
  }
  return {
    endpoint,
    method: "GET",
    status: res.status,
    body,
    headers: collectHeaders(res.headers),
  };
}

export async function fetchPaymentRequirements(
  lat: number,
  lon: number,
): Promise<HttpResult<unknown>> {
  const endpoint = weatherUrl(lat, lon);
  const res = await fetch(endpoint);
  let body = await res.json().catch(() => null);

  // x402 v2 puts the requirements in the PAYMENT-REQUIRED header and leaves
  // the body empty. Decode the header if we have it so the UI always has
  // something meaningful to render.
  const needsHeaderFallback =
    body === null ||
    (typeof body === "object" &&
      !Array.isArray(body) &&
      Object.keys(body).length === 0);
  if (needsHeaderFallback) {
    const encoded =
      res.headers.get("payment-required") ??
      res.headers.get("PAYMENT-REQUIRED");
    if (encoded) {
      try {
        body = JSON.parse(atob(encoded));
      } catch {
        // keep the empty body; surface an error in UI via status inspection
      }
    }
  }

  return {
    endpoint,
    method: "GET",
    status: res.status,
    body,
    headers: collectHeaders(res.headers),
  };
}

export interface PaidWeatherResult extends HttpResult<WeatherResult> {
  receipt: SettlementReceipt | null;
}

export async function payAndFetchWeather(
  paidFetch: PaidFetch,
  lat: number,
  lon: number,
): Promise<PaidWeatherResult> {
  const endpoint = weatherUrl(lat, lon);
  const res = await paidFetch(endpoint);
  const rawBody = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      (rawBody && typeof rawBody === "object" && "error" in rawBody
        ? String((rawBody as { error: unknown }).error)
        : null) ?? `weather request failed (${res.status})`;
    throw new Error(message);
  }

  return {
    endpoint,
    method: "GET",
    status: res.status,
    body: rawBody as WeatherResult,
    headers: collectHeaders(res.headers),
    receipt: decodeSettlementHeader(
      // v1 uses X-PAYMENT-RESPONSE, v2 uses PAYMENT-RESPONSE. Accept either.
      res.headers.get("x-payment-response") ??
        res.headers.get("payment-response"),
    ),
  };
}

function collectHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function decodeSettlementHeader(
  header: string | null,
): SettlementReceipt | null {
  if (!header) return null;
  try {
    return JSON.parse(atob(header)) as SettlementReceipt;
  } catch {
    return null;
  }
}
