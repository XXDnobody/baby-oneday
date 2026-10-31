import { NextRequest } from "next/server";
import { readConfig } from "../src/server/config";
import { handle } from "../src/server/http";
export function testClient() {
  const cookies = new Map<string, string>(); let csrf = "";
  async function request<T = Record<string, unknown>>(path: string, method = "GET", data?: unknown, key?: string) {
    if (method !== "GET" && !csrf) csrf = (await request<{ csrfToken: string }>("auth/csrf")).data.csrfToken;
    const url = new URL("/api/v1/" + path, readConfig().origin);
    const headers: Record<string, string> = { Origin: readConfig().origin, Cookie: [...cookies].map(([k, v]) => k + "=" + v).join("; "), "User-Agent": "B2 isolated integration" };
    if (method !== "GET") headers["X-CSRF-Token"] = csrf;
    if (data !== undefined) headers["Content-Type"] = "application/json";
    if (key) headers["Idempotency-Key"] = key;
    const response = await handle(new NextRequest(url, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) }), url.pathname.split("/").slice(3));
    for (const cookie of response.cookies.getAll()) { if (cookie.value) cookies.set(cookie.name, cookie.value); else cookies.delete(cookie.name); }
    const result = await response.json() as { data: T; error?: { code: string; message: string }; meta: { requestId: string } };
    return { ...result, status: response.status, response };
  }
  return { request, cookies };
}
