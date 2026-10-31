import { loadEnvironment } from "./load-env";
import { startBuiltServer } from "./built-server";

const config = loadEnvironment();
if (config.APP_ENV !== "local") throw new Error("此入口只运行本机已构建版本，不用于生产部署");
const child = await startBuiltServer(3000);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal === "SIGTERM" || signal === "SIGINT" ? 0 : 1); });
