import { loadEnvironment } from "./load-env";
import { closeDatabase } from "../src/server/db";
import { purgeExpiredTrash } from "../src/server/retention";
loadEnvironment();
try {
  const result = await purgeExpiredTrash();
  console.log(JSON.stringify({ operation: "purge-expired-deleted-bodies", ...result }));
} finally { await closeDatabase(); }
