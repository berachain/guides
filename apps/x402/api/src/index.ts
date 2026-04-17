import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { env } from "./env";
import { requirePayment } from "./payment";
import { geocodeCity, getWeather } from "./weather";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: (origin) => origin ?? "*",
    allowMethods: ["GET", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "X-PAYMENT",
      "PAYMENT-SIGNATURE",
      // thirdweb's wrapFetchWithPayment echoes the expected response-exposure
      // header on the retry request, so the browser preflights with it.
      "Access-Control-Expose-Headers",
    ],
    exposeHeaders: [
      "X-PAYMENT-RESPONSE",
      "PAYMENT-RESPONSE",
      "PAYMENT-REQUIRED",
    ],
    maxAge: 600,
  }),
);

const geocodeQuerySchema = z.object({
  city: z.string().trim().min(1, "city is required"),
});

const weatherQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

app.get("/health", (c) => c.json({ ok: true }));

app.get("/geocode", async (c) => {
  const parsed = geocodeQuerySchema.safeParse({ city: c.req.query("city") });
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues[0]?.message ?? "invalid query" },
      400,
    );
  }

  try {
    const result = await geocodeCity(parsed.data.city);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "geocoding failed";
    return c.json({ error: message }, 502);
  }
});

app.get(
  "/weather",
  requirePayment(
    `Access to US weather forecast, priced at ${env.HONEY_AMOUNT} HONEY`,
  ),
  async (c) => {
    const parsed = weatherQuerySchema.safeParse({
      lat: c.req.query("lat"),
      lon: c.req.query("lon"),
    });
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "invalid query" },
        400,
      );
    }

    try {
      const result = await getWeather(parsed.data.lat, parsed.data.lon);
      return c.json(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "weather lookup failed";
      return c.json({ error: message }, 502);
    }
  },
);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal server error" }, 500);
});

console.log(`weather-x402 listening on http://localhost:${env.PORT}`);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
