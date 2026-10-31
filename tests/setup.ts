import { readConfig } from "../src/server/config";

process.loadEnvFile(".env.test");
if (readConfig().APP_ENV !== "test") throw new Error("测试禁止连接开发或生产环境");
