import { createPrivateKey, sign } from "node:crypto";
import { z } from "zod";
import type { ServiceStatus } from "../shared/b3";
import { readConfig } from "./config";
import { query, transaction } from "./db";
import { AppError, ensure } from "./errors";
import { parseModelJson } from "./model-json";

const schema = z.object({
  QWEATHER_API_HOST: z.string().default(""), QWEATHER_KEY_ID: z.string().default(""), QWEATHER_DEVELOPER_ID: z.string().default(""), QWEATHER_PROJECT_ID: z.string().default(""), QWEATHER_PRIVATE_KEY: z.string().default(""), QWEATHER_API_KEY: z.string().default(""),
  WEATHER_DAILY_REQUEST_LIMIT: z.coerce.number().int().min(0).default(0),
  AI_PROVIDER: z.string().max(80).default(""), AI_BASE_URL: z.string().default(""), AI_API_KEY: z.string().default(""), AI_MODEL: z.string().max(120).default(""), AI_REGION: z.string().max(100).default(""),
  AI_DAILY_REQUEST_LIMIT: z.coerce.number().int().min(0).default(0), AI_DAILY_TOKEN_LIMIT: z.coerce.number().int().min(0).default(0),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(16000).default(4000), AI_MAX_INPUT_BYTES: z.coerce.number().int().min(1000).max(100000).default(48000),
  AI_TIMEOUT_MS: z.coerce.number().int().min(100).max(90000).default(60000), AI_THINKING_MODE: z.enum(["disabled", "enabled"]).default("disabled"),
  SERVICE_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(10000), B3_TEST_WEATHER_URL: z.string().default(""),
});
export function serviceConfig() {
  const c = schema.parse(process.env); const test = readConfig().APP_ENV === "test";
  ensure(test || !c.B3_TEST_WEATHER_URL, "INVALID_CONFIG", "测试天气地址只允许在专用测试环境使用。", 503);
  if (c.QWEATHER_API_HOST) ensure(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+qweatherapi\.com$/i.test(c.QWEATHER_API_HOST), "INVALID_CONFIG", "天气 API Host 格式无效，请仅填写控制台分配的域名，不含协议或路径。", 503);
  for (const value of [c.AI_BASE_URL, c.B3_TEST_WEATHER_URL].filter(Boolean)) {
    const url = new URL(value); const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    ensure(!url.username && !url.password && !url.search && !url.hash && (test ? loopback && url.protocol === "http:" : !loopback && url.protocol === "https:"), "INVALID_CONFIG", "服务地址不符合当前环境要求。", 503);
  }
  return { ...c, test, weatherTest: !!c.B3_TEST_WEATHER_URL, modelTest: test && !!c.AI_BASE_URL };
}
export function serviceStatus(): ServiceStatus {
  const c = serviceConfig(); const weather: string[] = []; const ai: string[] = [];
  if (!c.B3_TEST_WEATHER_URL) {
    if (!c.QWEATHER_API_HOST) weather.push("QWEATHER_API_HOST");
    if (!c.QWEATHER_API_KEY) for (const key of ["QWEATHER_KEY_ID", "QWEATHER_DEVELOPER_ID", "QWEATHER_PROJECT_ID", "QWEATHER_PRIVATE_KEY"] as const) if (!c[key]) weather.push(key);
    if (c.test) weather.push("B3_TEST_WEATHER_URL（测试环境禁止真实天气调用）");
  }
  if (!c.WEATHER_DAILY_REQUEST_LIMIT) weather.push("WEATHER_DAILY_REQUEST_LIMIT");
  for (const key of ["AI_PROVIDER", "AI_BASE_URL", "AI_API_KEY", "AI_MODEL", "AI_REGION", "AI_DAILY_REQUEST_LIMIT", "AI_DAILY_TOKEN_LIMIT"] as const) if (!c[key]) ai.push(key);
  return { weather: { ready: !weather.length, missing: weather, testService: c.weatherTest }, ai: { ready: !ai.length, missing: ai, testService: c.modelTest, provider: c.AI_PROVIDER || null, model: c.AI_MODEL || null, region: c.AI_REGION || null } };
}
export interface RunningJob { id: string; householdId: string; ownerId: string | null; leaseToken: string }
async function reserve(service: "weather" | "ai", job: RunningJob, reservedTokens: number) {
  const c = serviceConfig(); const provider = service === "ai" ? c.AI_PROVIDER : "qweather";
  const ready = serviceStatus()[service].ready;
  ensure(ready, "SERVICE_NOT_CONFIGURED", service === "ai" ? "AI 服务尚未配置，已有安排仍可手动调整。" : "天气服务尚未配置，请家人核对现场天气。", 503);
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["service-quota:" + service + ":" + provider]);
    const lease = await db.query("SELECT id FROM b3_jobs WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>clock_timestamp()", [job.id, job.leaseToken]);
    ensure(lease.rowCount, "JOB_LEASE_LOST", "任务已交由其他进程恢复。", 409);
    const usage = (await db.query<{ calls: number; tokens: number }>("SELECT count(*)::int AS calls,COALESCE(sum(CASE WHEN usage_known THEN total_tokens ELSE reserved_tokens END),0)::int AS tokens FROM service_calls WHERE service=$1 AND provider=$2 AND started_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'", [service, provider])).rows[0];
    const cap = service === "ai" ? c.AI_DAILY_REQUEST_LIMIT : c.WEATHER_DAILY_REQUEST_LIMIT;
    ensure(usage.calls < cap && (service !== "ai" || usage.tokens + reservedTokens <= c.AI_DAILY_TOKEN_LIMIT), "SERVICE_QUOTA_EXCEEDED", "已达到配置的服务日用量上限，请稍后或由管理员核对额度。", 429);
    return (await db.query<{ id: string }>("INSERT INTO service_calls(household_id,owner_id,job_id,lease_token,service,provider,model,region,test_service,reserved_tokens) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id", [job.householdId, job.ownerId, job.id, job.leaseToken, service, provider, service === "ai" ? c.AI_MODEL : null, service === "ai" ? c.AI_REGION : null, service === "ai" ? c.modelTest : c.weatherTest, reservedTokens])).rows[0].id;
  });
}
export async function boundedJson(url: string, init: RequestInit, timeout: number) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store", redirect: "error" });
    ensure(response.status !== 429, "SERVICE_RATE_LIMITED", "服务限频，稍后可重试；已有安排不受影响。", 429);
    ensure(response.ok, "SERVICE_UNAVAILABLE", "外部服务调用失败，已有安排保持不变。", 503);
    const reader = response.body?.getReader(); ensure(reader, "SERVICE_INVALID_RESPONSE", "服务返回为空。", 503);
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 1500000) { await reader.cancel(); throw new AppError("SERVICE_INVALID_RESPONSE", "服务返回过长。", 503); } chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(controller.signal.aborted ? "SERVICE_TIMEOUT" : "SERVICE_UNAVAILABLE", controller.signal.aborted ? "外部服务超时，已有安排保持不变。" : "外部服务暂时不可用，已有安排保持不变。", 503);
  } finally { clearTimeout(timer); }
}
export const usageSchema = z.object({ prompt_tokens: z.number().int().min(0), completion_tokens: z.number().int().min(0), total_tokens: z.number().int().min(0) });
async function external<T>(service: "weather" | "ai", job: RunningJob, url: string, init: RequestInit, reservedTokens: number, parse: (v: unknown) => T) {
  const callId = await reserve(service, job, reservedTokens); const start = Date.now(); let usage: z.infer<typeof usageSchema> | null = null;
  try {
    const config = serviceConfig();
    const raw = await boundedJson(url, init, service === "ai" ? config.AI_TIMEOUT_MS : config.SERVICE_TIMEOUT_MS);
    if (service === "ai" && raw && typeof raw === "object" && "usage" in raw) { const parsed = usageSchema.safeParse(raw.usage); if (parsed.success && parsed.data.total_tokens === parsed.data.prompt_tokens + parsed.data.completion_tokens) usage = parsed.data; }
    const value = parse(raw);
    await query("UPDATE service_calls SET state='succeeded',usage_known=$2,input_tokens=$3,output_tokens=$4,total_tokens=$5,duration_ms=$6,finished_at=now() WHERE id=$1", [callId, service === "weather" || !!usage, usage?.prompt_tokens ?? null, usage?.completion_tokens ?? null, service === "weather" ? 0 : usage?.total_tokens ?? null, Date.now() - start]);
    return value;
  } catch (e) {
    const code = e instanceof AppError ? e.code : "SERVICE_INVALID_RESPONSE";
    await query("UPDATE service_calls SET state='failed',error_code=$2,usage_known=$3,input_tokens=$4,output_tokens=$5,total_tokens=$6,duration_ms=$7,finished_at=now() WHERE id=$1", [callId, code, !!usage, usage?.prompt_tokens ?? null, usage?.completion_tokens ?? null, usage?.total_tokens ?? null, Date.now() - start]);
    if (e instanceof AppError) throw e;
    throw new AppError("SERVICE_INVALID_RESPONSE", "服务返回格式不符合约定，未保存正式改动。", 422);
  }
}
function weatherHeaders(): Record<string, string> {
  const c = serviceConfig(); if (c.weatherTest) return {};
  if (c.QWEATHER_PRIVATE_KEY && c.QWEATHER_KEY_ID && c.QWEATHER_DEVELOPER_ID && c.QWEATHER_PROJECT_ID) {
    const head = Buffer.from(JSON.stringify({ alg: "EdDSA", kid: c.QWEATHER_KEY_ID })).toString("base64url"); const now = Math.floor(Date.now() / 1000);
    const body = Buffer.from(JSON.stringify({ iss: c.QWEATHER_DEVELOPER_ID, sub: c.QWEATHER_PROJECT_ID, iat: now - 30, exp: now + 300 })).toString("base64url");
    const key = createPrivateKey(c.QWEATHER_PRIVATE_KEY.replace(/\\n/g, "\n")); ensure(key.asymmetricKeyType === "ed25519", "INVALID_CONFIG", "天气 JWT 需使用 Ed25519 私钥。", 503);
    return { Authorization: "Bearer " + head + "." + body + "." + sign(null, Buffer.from(head + "." + body), key).toString("base64url") };
  }
  return { "X-QW-Api-Key": c.QWEATHER_API_KEY };
}
export async function weatherCall<T>(job: RunningJob, product: "current" | "hourly", latitude: number, longitude: number, parse: (v: unknown) => T) {
  const c = serviceConfig(); const root = c.B3_TEST_WEATHER_URL || "https://" + c.QWEATHER_API_HOST;
  const url = root + "/weather/v1/" + product + "/" + latitude.toFixed(2) + "/" + longitude.toFixed(2) + "?lang=zh" + (product === "hourly" ? "&hours=72" : "");
  return external("weather", job, url, { headers: weatherHeaders() }, 0, parse);
}
export async function modelCall<T>(job: RunningJob, messages: { role: "system" | "user" | "assistant"; content: string }[], parse: (v: unknown) => T, maxOutputTokens?: number) {
  const c = serviceConfig(); const bytes = Buffer.byteLength(JSON.stringify(messages));
  const outputTokens = maxOutputTokens === undefined ? c.AI_MAX_OUTPUT_TOKENS : Math.min(c.AI_MAX_OUTPUT_TOKENS, Math.max(256, Math.floor(maxOutputTokens)));
  ensure(bytes <= c.AI_MAX_INPUT_BYTES, "AI_CONTEXT_TOO_LARGE", "本次可读资料较多，请缩小日期范围后重新讨论。", 422);
  const response = z.object({ choices: z.array(z.object({ finish_reason: z.string(), message: z.object({ content: z.string().max(100000) }) })).min(1) });
  // DeepSeek defaults to thinking mode; make the selected mode explicit so the
  // output budget is available for the final JSON proposal. Other providers keep
  // their existing request contract. The timeout stays below the 120s job lease.
  const thinking = c.AI_PROVIDER.toLowerCase() === "deepseek" ? { thinking: { type: c.AI_THINKING_MODE } } : {};
  return external("ai", job, c.AI_BASE_URL.replace(/\/$/, "") + "/chat/completions", { method: "POST", headers: { Authorization: "Bearer " + c.AI_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ model: c.AI_MODEL, messages, response_format: { type: "json_object" }, max_tokens: outputTokens, stream: false, ...thinking }) }, bytes + 1024 + outputTokens, (v) => {
    const r = response.parse(v); ensure(r.choices[0].finish_reason === "stop", "MODEL_OUTPUT_REJECTED", "模型未完整返回方案，请缩小范围重试。", 422);
    return parse(parseModelJson(r.choices[0].message.content));
  });
}
