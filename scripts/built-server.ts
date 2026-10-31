import { spawn } from "node:child_process";
import { access, cp } from "node:fs/promises";

// Next's installed output guide requires assets to accompany server.js.
// Build output stays ignored; runtime credentials come only from the caller's env.
export async function startBuiltServer(port: number) {
  await access(".next/BUILD_ID"); await access(".next/standalone/server.js");
  await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
  let publicExists = true;
  try { await access("public"); } catch { publicExists = false; }
  if (publicExists) await cp("public", ".next/standalone/public", { recursive: true });
  return spawn(process.execPath, [".next/standalone/server.js"], { stdio: "inherit", env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port) } });
}
