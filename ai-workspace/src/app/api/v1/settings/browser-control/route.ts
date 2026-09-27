import { NextResponse } from "next/server";
import { z } from "zod";
import { closeBrowser } from "@/server/ai/browser/session";
import { BROWSER_CHOICES } from "@/server/ai/browser/isolation";
import { authed, parseJson } from "@/server/http/api";
import { browserChoice, browserControlMode, setBrowserChoice, setBrowserControlMode } from "@/server/settings/permissions";

export const GET = authed(async () => NextResponse.json({ mode: browserControlMode(), browser: browserChoice() }));

/** Admin only; every change is written to the audit trail. */
export const PUT = authed(async (req, { user, meta }) => {
  const body = await parseJson(req, z.object({ mode: z.enum(["off", "ask"]).optional(), browser: z.enum(BROWSER_CHOICES).optional() }));
  if (body.browser && body.browser !== browserChoice()) {
    await setBrowserChoice(user, body.browser, meta);
    await closeBrowser(); // the next action starts the newly chosen browser
  }
  if (body.mode) {
    await setBrowserControlMode(user, body.mode, meta);
    if (body.mode === "off") await closeBrowser();
  }
  return NextResponse.json({ mode: browserControlMode(), browser: browserChoice() });
});
