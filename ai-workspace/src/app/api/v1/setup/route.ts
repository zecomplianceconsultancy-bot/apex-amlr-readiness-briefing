import { NextResponse } from "next/server";
import { z } from "zod";
import { PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { createFirstAdmin } from "@/server/auth/setup";
import { parseJson, publicRoute, requestMeta } from "@/server/http/api";

const setupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(320),
  password: z.string().min(PASSWORD_MIN_LENGTH, `Wachtwoord moet minimaal ${PASSWORD_MIN_LENGTH} tekens zijn.`).max(1000),
});

export const POST = publicRoute(async (req) => {
  const input = await parseJson(req, setupSchema);
  const meta = requestMeta(req);
  const user = await createFirstAdmin(input, meta);
  await createSession(user.id, meta);
  return NextResponse.json({ ok: true }, { status: 201 });
});
