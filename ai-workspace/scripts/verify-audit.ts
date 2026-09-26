/** Recompute the audit hash chain and report the first broken link, if any. */
import "dotenv/config";
import { verifyAuditChain } from "@/server/audit/audit";
import { closeDb, initDb } from "@/server/db/client";

await initDb();
const result = await verifyAuditChain();
await closeDb();
if (result.ok) {
  console.log(`Audit chain intact: ${result.checked} events verified.`);
  process.exit(0);
}
console.error(`AUDIT CHAIN BROKEN at seq ${result.brokenAtSeq}: ${result.reason}`);
process.exit(2);
