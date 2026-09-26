import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";

/** Liveness + database check, used by the desktop launcher's watchdog. No data is exposed. */
export async function GET() {
  try {
    await db().execute(sql`select 1`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
