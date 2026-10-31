import { spawn } from "node:child_process";
import { readConfig } from "../src/server/config";

process.loadEnvFile(".env.test");
process.env.APP_URL = "http://127.0.0.1:3001";
process.env.NEXT_DIST_DIR = ".next-test";
if (readConfig().APP_ENV !== "test") throw new Error("浏览器测试应用必须连接测试环境");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3001"], { stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => { process.exitCode = code ?? 1; });
