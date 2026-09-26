import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFirstAdmin, needsSetup } from "@/server/auth/setup";
import { closeDb, initDb } from "@/server/db/client";

const meta = { ip: "127.0.0.1", userAgent: "vitest" };

// First-run setup exists only in desktop mode (embedded database).
describe.skipIf(Boolean(process.env.TEST_DATABASE_URL))("first-run setup", () => {
  beforeAll(() => initDb());
  afterAll(() => closeDb());

  it("allows exactly one admin to be created, even under concurrent attempts", async () => {
    expect(await needsSetup()).toBe(true);
    const attempts = await Promise.allSettled(
      ["a", "b", "c"].map((n) => createFirstAdmin({ name: n, email: `${n}@test.local`, password: "a-long-password-1" }, meta)),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((a) => a.status === "rejected").map((a) => (a as PromiseRejectedResult).reason.code)).toEqual(["already_set_up", "already_set_up"]);
    expect(await needsSetup()).toBe(false);
  });
});
