import { resolve } from "node:path";
import { readConfig } from "../src/server/config";

export function loadEnvironment() {
  const file = process.argv.includes("--test") ? ".env.test" : ".env.local";
  process.loadEnvFile(resolve(file));
  const config = readConfig();
  if (file === ".env.test" && config.APP_ENV !== "test") throw new Error("测试命令必须使用测试环境");
  return config;
}
