import "server-only";
import path from "node:path";
import { z } from "zod";

const bool = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : v === "true" || v === "1"));

/**
 * Defaults are chosen for the desktop: with no configuration at all the app runs fully
 * locally — embedded PostgreSQL (PGlite), files and browser profile under DATA_DIR, and an
 * encryption key generated on first start. Set DATABASE_URL to run against a PostgreSQL
 * server instead (team / production mode).
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /** Empty = embedded database in DATA_DIR (desktop mode). */
    DATABASE_URL: z.string().optional().transform((v) => v || undefined),
    DATA_DIR: z.string().default("./data"),
    APP_ORIGIN: z.url().default("http://127.0.0.1:3000"),
    /** Optional: 32 bytes, base64. When empty a key is generated in DATA_DIR on first start. */
    ENCRYPTION_KEY: z
      .string()
      .optional()
      .transform((v) => v || undefined)
      .refine((v) => v === undefined || Buffer.from(v, "base64").length === 32, "ENCRYPTION_KEY must decode to exactly 32 bytes"),
    STORAGE_DIR: z.string().optional(),
    SESSION_TTL_HOURS: z.coerce.number().int().positive().max(24 * 30).default(12),
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    PERPLEXITY_API_KEY: z.string().optional(),
    ENABLE_MOCK_PROVIDER: bool(false),
    DEFAULT_MODEL_ID: z.string().default("browser:perplexity"),
    MAX_UPLOAD_MB: z.coerce.number().positive().max(100).default(10),
    MAX_CONTEXT_CHARS: z.coerce.number().int().positive().default(200_000),
    // Browser transport: drive the web UIs of AI tools in a desktop browser window.
    ENABLE_BROWSER_PROVIDER: bool(true),
    BROWSER_PROFILE_DIR: z.string().optional(),
    /**
     * Default browser the workspace may control until an admin picks one under Browser-tools:
     * "msedge", "chrome" or "chromium" (Playwright's bundled build). BROWSER_CHANNEL, which
     * launchers before 1.3 set to whatever browser they found, is deliberately ignored.
     */
    BROWSER_DEFAULT: z.enum(["msedge", "chrome", "chromium"]).default("msedge"),
    BROWSER_HEADLESS: bool(false),
    BROWSER_ANSWER_TIMEOUT_SEC: z.coerce.number().int().positive().default(300),
    /** Optional JSON file with selector overrides per site (see docs/BROWSER-TOOLS.md). */
    BROWSER_SITES_FILE: z.string().optional(),
  })
  .transform((e) => {
    const dataDir = path.resolve(e.DATA_DIR);
    return {
      ...e,
      DATA_DIR: dataDir,
      STORAGE_DIR: e.STORAGE_DIR ?? path.join(dataDir, "files"),
      /** Base folder of the work profiles; each browser gets its own subfolder. */
      BROWSER_PROFILE_DIR: e.BROWSER_PROFILE_DIR ?? path.join(dataDir, "browser-profiles"),
      /** True when running on the embedded database (single-user desktop mode). */
      LOCAL_MODE: !e.DATABASE_URL,
    };
  });

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/** Parsed lazily so that `next build` does not require runtime configuration. */
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
