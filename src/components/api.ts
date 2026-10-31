"use client";

import type { ApiEnvelope } from "@/shared/contracts";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}
let csrfToken: Promise<string> | undefined;
async function csrf() {
  csrfToken ??= fetch("/api/v1/auth/csrf", { cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error("页面验证暂时不可用，请刷新重试。");
    const body = await response.json() as ApiEnvelope<{ csrfToken: string }>;
    return body.data.csrfToken;
  }).catch((error: unknown) => { csrfToken = undefined; throw error; });
  return csrfToken;
}
export async function api<T>(path: string, method = "GET", data?: unknown, key?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["X-CSRF-Token"] = await csrf();
  if (data !== undefined) headers["Content-Type"] = "application/json";
  if (key) headers["Idempotency-Key"] = key;
  let response: Response;
  try { response = await fetch("/api/v1/" + path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data), cache: "no-store" }); }
  catch { throw new ApiError("NETWORK_ERROR", "暂时无法连接。你的输入仍保留，连接恢复后可重试。", 0); }
  const result = await response.json() as ApiEnvelope<T> & { error?: { code: string; message: string; fields?: Record<string, string> } };
  if (!response.ok || result.error) {
    if (result.error?.code === "CSRF_INVALID") csrfToken = undefined;
    throw new ApiError(result.error?.code ?? "UNKNOWN", result.error?.fields ? Object.values(result.error.fields).join("；") : result.error?.message ?? "请求失败，请重试。", response.status);
  }
  return result.data;
}
export const message = (error: unknown) => error instanceof Error ? error.message : "暂时无法完成，请重试。";
export const newKey = () => crypto.randomUUID();
