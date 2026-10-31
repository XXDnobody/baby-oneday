import { migrate } from "../scripts/migrate";
import { readConfig } from "../src/server/config";
import { closeDatabase, query } from "../src/server/db";
export default async function setup() {
  process.loadEnvFile(".env.test");
  if (readConfig().APP_ENV !== "test") throw new Error("测试禁止重置非测试环境");
  try {
    await migrate();
    await query("TRUNCATE households,users,bootstrap_grants,email_challenges,rate_limits,recovery_events RESTART IDENTITY CASCADE");
  } finally { await closeDatabase(); }
}
