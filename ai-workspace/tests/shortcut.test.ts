import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM launcher helper without type declarations
import { createShortcuts, shortcutScript } from "../scripts/lib/shortcut.mjs";

describe("desktop icon (Windows)", () => {
  it("points the shortcut at the start file with the workspace icon", () => {
    const s: string = shortcutScript("C:\\Users\\ze\\ai-workspace");
    expect(s).toContain("$root = 'C:\\Users\\ze\\ai-workspace'");
    expect(s).toContain("Join-Path $root 'start-windows.bat'");
    expect(s).toContain("Join-Path $root 'assets\\ai-workspace.ico'");
    expect(s).toContain("'AI Workspace.lnk'");
    expect(s).toContain("$apex = $null"); // look for an existing "Apex tools" folder
    expect(s).toContain("'^apex[ _-]*tools$'");
  });

  it("quotes paths safely, including apostrophes", () => {
    const s: string = shortcutScript("C:\\Users\\O'Neil\\ai-workspace", "D:\\Werk\\Ze's Apex tools");
    expect(s).toContain("$root = 'C:\\Users\\O''Neil\\ai-workspace'");
    expect(s).toContain("$apex = 'D:\\Werk\\Ze''s Apex tools'");
  });

  it("does nothing outside Windows", () => {
    if (process.platform === "win32") return;
    expect(createShortcuts("/tmp/x")).toMatchObject({ ok: false });
  });
});
