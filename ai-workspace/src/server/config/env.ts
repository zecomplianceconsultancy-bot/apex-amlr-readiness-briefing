import "server-only";
import { z } from "zod";

const boolFromString = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_ORIGIN: z.url().default("http://localhost:3000"),
  ENCRYPTION_KEY: z
    .string()
    .min(1, "ENCRYPTION_KEY is required (32 bytes, base64)")
    .refine((v) => Buffer.from(v, "base64").length === 32, "ENCRYPTION_KEY must decode to exactly 32 bytes"),
  STORAGE_DIR: z.string().default("./storage"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().max(24 * 30).default(12),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ENABLE_MOCK_PROVIDER: boolFromString,
  // Browser transport: drive the web UIs of AI tools in a desktop browser window.
  ENABLE_BROWSER_PROVIDER: boolFromString,
  BROWSER_PROFILE_DIR: z.string().default("./.browser-profile"),
  /** "chrome" / "msedge" use the installed browser; empty uses Playwright's bundled Chromium. */
  BROWSER_CHANNEL: z.string().default("chrome"),
  BROWSER_HEADLESS: boolFromString,
  BROWSER_ANSWER_TIMEOUT_SEC: z.coerce.number().int().positive().default(300),
  /** Optional JSON file with selector overrides per site (see docs/BROWSER-TOOLS.md). */
  BROWSER_SITES_FILE: z.string().optional(),
  DEFAULT_MODEL_ID: z.string().default("anthropic:claude-opus-5"),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(100).default(10),
  MAX_CONTEXT_CHARS: z.coerce.number().int().positive().default(200_000),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/** Parsed lazily so that `next build` does not require runtime secrets. */
export function env(): Env {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Invalid environment configuration:\n${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Test hook: forget the parsed environment so a test can change process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
