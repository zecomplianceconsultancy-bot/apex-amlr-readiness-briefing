import { randomBytes } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";

// Default: embedded database in a fresh temp dir per test worker (nothing to install).
// Set TEST_DATABASE_URL to run the same tests against a PostgreSQL server (it gets wiped!).
const runId = `${process.pid}-${Date.now()}`;
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else delete process.env.DATABASE_URL;
process.env.DATA_DIR = path.join(tmpdir(), `aiw-test-data-${runId}`);
process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.ENABLE_MOCK_PROVIDER = "true";
process.env.DEFAULT_MODEL_ID = "mock:echo";
process.env.ANTHROPIC_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.ENABLE_BROWSER_PROVIDER = "true";
process.env.BROWSER_HEADLESS = "true";
process.env.BROWSER_CHANNEL = "";
delete process.env.STORAGE_DIR;
delete process.env.BROWSER_PROFILE_DIR;
delete process.env.BROWSER_SITES_FILE;
