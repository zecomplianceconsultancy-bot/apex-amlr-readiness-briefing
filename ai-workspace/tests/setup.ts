import { randomBytes } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";

// Tests run against a dedicated database; never the development database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://workspace:workspace@localhost:5432/ai_workspace_test";
process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.STORAGE_DIR = path.join(tmpdir(), `aiw-test-storage-${process.pid}`);
process.env.ENABLE_MOCK_PROVIDER = "true";
process.env.DEFAULT_MODEL_ID = "mock:echo";
process.env.ANTHROPIC_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.ENABLE_BROWSER_PROVIDER = "true";
process.env.BROWSER_HEADLESS = "true";
process.env.BROWSER_CHANNEL = "";
process.env.BROWSER_PROFILE_DIR = path.join(tmpdir(), `aiw-test-browser-${process.pid}`);
