import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ZodError, z } from "zod";
import * as c from "../shared/contracts";
import * as auth from "./auth";
import * as h from "./households";
import { readConfig } from "./config";
import { equals, protectedDigest, token } from "./crypto";
import { AppError, ensure } from "./errors";
import { b2Route } from "./b2-http";

export const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const sessionCookie = () => readConfig().APP_ENV === "production" ? "__Host-bp-session" : "bp_session";
const csrfCookie = () => readConfig().APP_ENV === "production" ? "__Host-bp-csrf" : "bp_csrf";
const cookieOptions = () => ({ httpOnly: true, secure: readConfig().APP_ENV === "production", sameSite: "lax" as const, path: "/" });
const rawSession = (req: NextRequest) => req.cookies.get(sessionCookie())?.value;
function csrf(req: NextRequest) {
  ensure(req.headers.get("origin") === readConfig().origin, "FORBIDDEN", "请求来源无效，请刷新后重试。", 403);
  const header = req.headers.get("x-csrf-token") ?? "";
  const stored = req.cookies.get(csrfCookie())?.value ?? "";
  const [value, signature] = header.split(".");
  ensure(value && signature && equals(header, stored) && equals(signature, protectedDigest(readConfig().AUTH_SECRET, value)), "CSRF_INVALID", "页面验证已失效，请刷新后重试。", 403);
}
async function body(req: NextRequest) {
  ensure(req.headers.get("content-type")?.split(";")[0] === "application/json", "INVALID_INPUT", "请使用 JSON 提交。", 415);
  const reader = req.body?.getReader();
  ensure(reader, "INVALID_INPUT", "缺少请求内容。");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 131072) { await reader.cancel(); throw new AppError("INVALID_INPUT", "提交内容过长。", 413); }
    chunks.push(part.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new AppError("INVALID_INPUT", "提交格式无效。"); }
}
const tokenInput = z.object({ token: z.string().min(30).max(200) }).strict();
const changedMember = z.object({ expectedRevision: c.revision, role: c.role }).strict();
const removedMember = z.object({ expectedRevision: c.revision }).strict();

export async function handle(req: NextRequest, path: string[]) {
  const requestId = randomUUID();
  const respond = (data: unknown, status = 200) => NextResponse.json({ data, meta: { requestId, serverTime: new Date().toISOString() } }, { status, headers: privateHeaders });
  const method = req.method;
  const url = path.join("/");
  const raw = rawSession(req);
  const key = req.headers.get("idempotency-key") ?? undefined;
  try {
    if (method !== "GET") csrf(req);
    if (url === "auth/csrf" && method === "GET") {
      const stored = req.cookies.get(csrfCookie())?.value;
      const [oldValue, oldSignature] = (stored ?? "").split(".");
      const valid = oldValue && oldSignature && equals(oldSignature, protectedDigest(readConfig().AUTH_SECRET, oldValue));
      const value = token();
      const signed = valid && stored ? stored : value + "." + protectedDigest(readConfig().AUTH_SECRET, value);
      const response = respond({ csrfToken: signed });
      response.cookies.set(csrfCookie(), signed, { ...cookieOptions(), sameSite: "strict", maxAge: 86400 });
      return response;
    }
    if (method !== "GET" && (url.startsWith("auth/") || url.startsWith("invites/"))) await auth.rateLimit("auth-global", "installation", 200, 60);
    if (url === "auth/email/verification" && method === "POST") return respond(await auth.requestVerification(c.verificationInput.parse(await body(req))));
    if (url === "auth/email/verify" && method === "POST") return respond(await auth.verifyEmail(c.verifyInput.parse(await body(req))));
    if (url === "auth/register" && method === "POST") return respond(await auth.register(c.registerInput.parse(await body(req))), 201);
    if (url === "auth/session" && method === "POST") {
      const result = await auth.login(c.loginInput.parse(await body(req)), req.headers.get("user-agent") ?? "浏览器");
      const response = respond({ loggedIn: true });
      response.cookies.set(sessionCookie(), result.token, { ...cookieOptions(), ...(result.remembered ? { expires: result.absoluteExpiresAt } : {}) });
      return response;
    }
    if (url === "auth/session" && method === "DELETE") {
      const response = respond(await auth.logout(raw));
      response.cookies.set(sessionCookie(), "", { ...cookieOptions(), maxAge: 0 });
      return response;
    }
    if (url === "auth/recovery/request" && method === "POST") return respond(await auth.requestRecovery(z.object({ email: c.email }).strict().parse(await body(req)).email));
    if (url === "auth/recovery/reset" && method === "POST") return respond(await auth.resetPassword(c.resetInput.parse(await body(req))));
    if (url === "me" && method === "GET") return respond(await auth.me(raw));
    if (url === "auth/sessions" && method === "GET") return respond(await auth.withUser(raw, async (db, actor) => (await db.query(
      'SELECT id,device,(id=$2) AS current,last_seen_at::text AS "lastSeenAt",LEAST(expires_at,absolute_expires_at)::text AS "expiresAt",remembered FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() AND absolute_expires_at>now() ORDER BY last_seen_at DESC LIMIT 50', [actor.id, actor.sessionId],
    )).rows));
    if (path[0] === "auth" && path[1] === "sessions" && path.length === 3 && method === "DELETE") {
      const sessionId = c.id.parse(path[2]);
      return respond(await auth.withUser(raw, async (db, actor) => {
        const result = await db.query("UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 RETURNING id", [sessionId, actor.id]);
        ensure(result.rowCount, "NOT_FOUND", "设备会话不存在。", 404);
        return { revoked: true };
      }, true));
    }
    if (url === "invites/preview" && method === "POST") return respond(await h.invitePreview(tokenInput.parse(await body(req)).token));
    if (url === "invites/accept" && method === "POST") return respond(await h.acceptInvite(raw, tokenInput.parse(await body(req)).token));
    if (url === "households" && method === "POST") return respond(await h.createHousehold(raw, c.householdInput.parse(await body(req)), key), 201);
    if (path[0] === "households" && path[1]) {
      const householdId = c.id.parse(path[1]);
      const resource = path[2];
      const b2 = await b2Route(req, raw, householdId, path.slice(2), key, () => body(req));
      if (b2) return respond(b2.data, b2.status ?? 200);
      if (path.length === 2 && method === "GET") return respond(await h.getHousehold(raw, householdId));
      if (resource === "setup" && path.length === 3 && method === "PUT") return respond(await h.saveSetup(raw, householdId, c.setupInput.parse(await body(req))));
      if (resource === "child" && path.length === 3 && method === "PATCH") return respond(await h.saveSetup(raw, householdId, c.setupInput.parse(await body(req)), true));
      if (resource === "today" && path.length === 3 && method === "GET") return respond(await h.getDay(raw, householdId, c.date.parse(req.nextUrl.searchParams.get("date") ?? h.localDate())));
      if (resource === "plans" && path.length === 3 && method === "POST") return respond(await h.createPlan(raw, householdId, z.object({ date: c.date }).strict().parse(await body(req)).date, key), 201);
      if (resource === "plans" && path[3] && path[4] === "items" && path.length === 5 && method === "POST") return respond(await h.addItem(raw, householdId, c.id.parse(path[3]), c.itemInput.parse(await body(req)), key), 201);
      if (resource === "plan-items" && path[3] && path.length === 4 && method === "PATCH") return respond(await h.editItem(raw, householdId, c.id.parse(path[3]), c.itemInput.parse(await body(req)), key));
      if (resource === "plan-items" && path[3] && path[4] === "versions" && path.length === 5 && method === "GET") return respond(await h.itemVersions(raw, householdId, c.id.parse(path[3])));
      if (resource === "members" && path[3] && path.length === 4 && (method === "PATCH" || method === "DELETE")) {
        const data = await body(req);
        const input = method === "PATCH" ? changedMember.parse(data) : { ...removedMember.parse(data), role: null };
        return respond(await h.changeMember(raw, householdId, c.id.parse(path[3]), input.expectedRevision, input.role));
      }
      if (resource === "invites" && path.length === 3 && method === "GET") return respond(await h.listInvites(raw, householdId));
      if (resource === "invites" && path.length === 3 && method === "POST") return respond(await h.createInvite(raw, householdId, z.object({ role: c.role }).strict().parse(await body(req)).role, key), 201);
      if (resource === "invites" && path[3] && path.length === 4 && method === "DELETE") return respond(await h.revokeInvite(raw, householdId, c.id.parse(path[3])));
      if (resource === "templates" && path.length === 3 && method === "GET") return respond(await h.templates(raw, householdId));
      if (resource === "templates" && path.length === 4 && method === "PUT") return respond(await h.templates(raw, householdId, z.enum(["weekday", "weekend"]).parse(path[3]), c.templateInput.parse(await body(req))));
      if (resource === "events" && path.length === 3 && method === "GET") return await eventStream(req, raw, householdId);
    }
    throw new AppError("NOT_FOUND", "接口不存在。", 404);
  } catch (error) {
    let problem: AppError;
    if (error instanceof ZodError) {
      problem = new AppError("INVALID_INPUT", "请检查填写内容。", 422, Object.fromEntries(error.issues.map((i) => [i.path.join("."), i.message])));
    } else if (error instanceof AppError) { problem = error; }
    else {
      // Never log request bodies, cookies, DB connection strings, email tickets, or reset links.
      console.error("API 请求失败", { requestId, errorType: error instanceof Error ? error.name : "Unknown" });
      problem = new AppError("DEPENDENCY_UNAVAILABLE", "服务暂时不可用，请稍后重试。", 503);
    }
    const response = NextResponse.json({ error: { code: problem.code, message: problem.message, fields: problem.fields, retryable: problem.status >= 500 }, meta: { requestId, serverTime: new Date().toISOString() } }, { status: problem.status, headers: privateHeaders });
    if (problem.code === "SESSION_EXPIRED") response.cookies.set(sessionCookie(), "", { ...cookieOptions(), maxAge: 0 });
    if (problem.status === 429) response.headers.set("Retry-After", "60");
    return response;
  }
}

async function eventStream(req: NextRequest, raw: string | undefined, householdId: string) {
  let cursor = req.headers.get("last-event-id") ?? "0";
  ensure(/^\d{1,19}$/.test(cursor) && BigInt(cursor) <= 9223372036854775807n, "INVALID_INPUT", "同步游标无效。");
  const initial = await h.events(raw, householdId, cursor);
  const encoder = new TextEncoder();
  let stop: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let active = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => finish();
      const finish = (close = true) => { if (!active) return; active = false; clearTimeout(timer); req.signal.removeEventListener("abort", onAbort); if (close) controller.close(); };
      stop = () => finish(false);
      const emit = (event: string, data: unknown, id?: string) => {
        if (active) controller.enqueue(encoder.encode((id ? "id: " + id + "\n" : "") + "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n"));
      };
      const send = (result: Awaited<ReturnType<typeof h.events>>) => {
        cursor = result.cursor;
        if (result.reset) emit("refresh", { reset: true }, cursor);
        else for (const event of result.events) emit("change", event, event.id);
      };
      emit("ready", { connected: true });
      send(initial);
      const poll = async () => {
        if (!active) return;
        try { send(await h.events(raw, householdId, cursor)); }
        catch (error) {
          emit("access-ended", { code: error instanceof AppError ? error.code : "DEPENDENCY_UNAVAILABLE" });
          finish(); return;
        }
        if (active) { emit("heartbeat", { serverTime: new Date().toISOString() }); timer = setTimeout(poll, 1500); }
      };
      req.signal.addEventListener("abort", onAbort, { once: true });
      if (req.signal.aborted) finish();
      else timer = setTimeout(poll, 1500);
    },
    cancel() { stop?.(); },
  });
  return new NextResponse(stream, { headers: { ...privateHeaders, "Content-Type": "text/event-stream", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
