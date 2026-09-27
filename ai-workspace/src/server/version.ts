import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Installed release (release.json), shown in the header; also used by the launcher's updater. */
export function appVersion(): string {
  try {
    return (JSON.parse(readFileSync(path.join(process.cwd(), "release.json"), "utf8")) as { version?: string }).version ?? "dev";
  } catch {
    return "dev";
  }
}
