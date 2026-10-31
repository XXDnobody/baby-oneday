import { loadEnvironment } from "../scripts/load-env";
import { closeDatabase } from "../src/server/db";
import { claimJob, runOneJob } from "../src/server/b3-jobs";
const config = loadEnvironment();
if (config.APP_ENV !== "test") throw new Error("Fault-injection process is test-only");
const id = process.argv.find((v) => v.startsWith("--job="))?.slice(6);
if (!id) throw new Error("Test job required");
try { if (process.argv.includes("--claim-only")) await claimJob(id); else await runOneJob(id); }
finally { await closeDatabase(); }
