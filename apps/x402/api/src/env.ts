import { z } from "zod";

const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/u, "must be a 0x-prefixed 20-byte address")
  .transform((v) => v as `0x${string}`);

const envSchema = z.object({
  RPC_URL: z.string().url(),
  CHAIN_ID: z.coerce.number().int().positive(),
  CHAIN_NAME: z.string().min(1).default("berachain"),

  HONEY_CONTRACT_ADDRESS: addressSchema,
  HONEY_DECIMALS: z.coerce.number().int().min(0).max(36).default(18),
  HONEY_AMOUNT: z
    .string()
    .regex(/^\d+(\.\d+)?$/u, "must be a positive decimal string like 0.1"),
  PAY_TO_ADDRESS: addressSchema,

  THIRDWEB_SECRET_KEY: z.string().min(1),
  THIRDWEB_SERVER_WALLET_ADDRESS: addressSchema,

  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration. Check your .env file:\n${issues}`,
    );
  }
  return parsed.data;
}

export const env = loadEnv();
