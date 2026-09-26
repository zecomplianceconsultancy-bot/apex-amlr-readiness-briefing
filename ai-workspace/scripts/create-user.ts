/**
 * Create a user (there is no public sign-up; accounts are provisioned deliberately).
 *   npm run user:create -- --email jane@example.com --name "Jane" [--admin]
 * The password is read from the USER_PASSWORD env var or prompted interactively.
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { recordAudit } from "@/server/audit/audit";
import { hashPassword, PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import { closeDb, db, initDb, schema } from "@/server/db/client";

const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" }, admin: { type: "boolean", default: false } },
});
if (!values.email || !values.name) {
  console.error('Usage: npm run user:create -- --email <email> --name "<name>" [--admin]');
  process.exit(1);
}

let password = process.env.USER_PASSWORD;
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question(`Password (min ${PASSWORD_MIN_LENGTH} chars): `);
  rl.close();
}
if (password.length < PASSWORD_MIN_LENGTH) {
  console.error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  process.exit(1);
}

await initDb();
const email = values.email.toLowerCase();
const role = values.admin ? "admin" : "member";
await db().transaction(async (tx) => {
  const [user] = await tx
    .insert(schema.users)
    .values({ email, name: values.name!, passwordHash: await hashPassword(password!), role })
    .returning({ id: schema.users.id });
  await recordAudit(
    { action: "user.create", actorUserId: null, actorType: "system", entityType: "user", entityId: user!.id, details: { email, role, via: "cli" } },
    tx,
  );
});
await closeDb();
console.log(`Created ${role} ${email}`);
process.exit(0);
