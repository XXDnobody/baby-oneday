import { setTimeout } from "node:timers/promises";
import { loadEnvironment } from "./load-env";
import { closeDatabase } from "../src/server/db";
import { runOneJob, purgeWeatherBodies } from "../src/server/b3-jobs";
import { scheduleAutomatic } from "../src/server/automatic-plans";

loadEnvironment(); let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; });
const once = process.argv.includes("--once");
console.log("B3 本地任务进程已启动" + (once ? "（单轮）" : "") + "；任务与租约保存在 PostgreSQL。");
try {
  do {
    await scheduleAutomatic(); await purgeWeatherBodies();
    let processed = 0;
    while (!stopping && processed < 30 && await runOneJob()) processed++;
    if (once) break;
    await setTimeout(1000);
  } while (!stopping);
} finally { await closeDatabase(); }
