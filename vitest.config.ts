import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", globalSetup: ["tests/global-setup.ts"], setupFiles: ["tests/setup.ts"], include: ["tests/**/*.test.ts"], testTimeout: 30000, hookTimeout: 30000, fileParallelism: false } });
