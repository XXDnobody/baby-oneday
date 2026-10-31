import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { NextRequest } from "next/server";
import { handle } from "../src/server/http";
import { closeDatabase, query } from "../src/server/db";
import { digest, token } from "../src/server/crypto";
import { readConfig } from "../src/server/config";
import { migrate } from "../scripts/migrate";
import { login, me as getMe } from "../src/server/auth";
import { createHousehold, localDate } from "../src/server/households";
import type { Day, Household, Me, PlanItem } from "../src/shared/contracts";

interface Reply<T> { response: Response; data: T; error?: { code: string; message: string }; meta: { requestId: string } }
function client() {
  const cookies = new Map<string, string>();
  let csrf = "";
  async function request<T = Record<string, unknown>>(path: string, method = "GET", data?: unknown, key?: string, headersOverride?: Record<string, string>): Promise<Reply<T>> {
    if (method !== "GET" && !csrf) csrf = (await request<{ csrfToken: string }>("auth/csrf")).data.csrfToken;
    const url = new URL("/api/v1/" + path, readConfig().origin);
    const headers = new Headers({ Origin: readConfig().origin, Cookie: [...cookies].map(([k, v]) => k + "=" + v).join("; "), "User-Agent": "B1 integration test" });
    if (method !== "GET") headers.set("X-CSRF-Token", csrf);
    if (data !== undefined) headers.set("Content-Type", "application/json");
    if (key) headers.set("Idempotency-Key", key);
    for (const [k, v] of Object.entries(headersOverride ?? {})) headers.set(k, v);
    const req = new NextRequest(url, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });
    const response = await handle(req, url.pathname.split("/").slice(3));
    for (const cookie of response.cookies.getAll()) { if (cookie.value) cookies.set(cookie.name, cookie.value); else cookies.delete(cookie.name); }
    const result = await response.json() as Omit<Reply<T>, "response">;
    return { response, ...result };
  }
  return { request, cookies };
}
type Client = ReturnType<typeof client>;
const suffix = randomUUID().slice(0, 8);
const password = "Test-only-strong-password-" + suffix;
const ownerEmail = "owner-" + suffix + "@example.test";
const memberEmail = "member-" + suffix + "@example.test";
const otherEmail = "other-" + suffix + "@example.test";
const owner = client(); const member = client(); const other = client();
let bootstrap: string; let householdId: string; let otherHouseholdId: string;
let planId: string; let item: PlanItem; let memberId: string; let memberInvite: string;
let ownerPerson: Me;

async function mailText(to: string, subject: string) {
  const inbox = await (await fetch(readConfig().MAILPIT_URL + "/api/v1/messages?limit=100")).json() as { messages: Array<{ ID: string; Subject: string; To: Array<{ Address: string }> }> };
  const found = inbox.messages.find((m) => m.Subject.includes(subject) && m.To.some((r) => r.Address.toLowerCase() === to.toLowerCase()));
  expect(found, "Mailpit 应收到对应的测试邮件").toBeDefined();
  const mail = await (await fetch(readConfig().MAILPIT_URL + "/api/v1/message/" + found!.ID)).json() as { Text: string };
  return mail.Text;
}
async function registerAccount(browser: Client, email: string, registrationToken: string, displayName: string) {
  const challenge = await browser.request<{ challengeId: string }>("auth/email/verification", "POST", { email, registrationToken });
  expect(challenge.response.status).toBe(200);
  const code = (await mailText(email, "邮箱验证码")).match(/\b\d{6}\b/)?.[0];
  expect(code).toBeDefined();
  const verification = await browser.request<{ emailVerificationTicket: string }>("auth/email/verify", "POST", { challengeId: challenge.data.challengeId, code });
  expect(verification.response.status).toBe(200);
  const registered = await browser.request("auth/register", "POST", { emailVerificationTicket: verification.data.emailVerificationTicket, password, displayName, registrationToken });
  expect(registered.response.status).toBe(201);
  expect((await browser.request("me")).response.status).toBe(401);
  expect((await browser.request("auth/session", "POST", { email, password, remember: true })).response.status).toBe(200);
}
async function invitation(browser: Client, id: string) {
  const result = await browser.request<{ id: string; url: string }>("households/" + id + "/invites", "POST", { role: "member" }, randomUUID());
  expect(result.response.status).toBe(201);
  return { ...result.data, token: new URL(result.data.url).searchParams.get("token")! };
}

beforeAll(async () => {
  const config = readConfig();
  expect(config.APP_ENV).toBe("test");
  await migrate();
  // The guarded global setup resets the disposable database once for all suites.
  bootstrap = token();
  await query("INSERT INTO bootstrap_grants(token_hash) VALUES ($1)", [digest(bootstrap)]);
});
afterAll(async () => { await closeDatabase(); });

describe("B1 真实 PostgreSQL + Mailpit + HTTP 契约", () => {
  test("拒绝缺失 CSRF、跨站来源和伪造签名，私有响应不可缓存", async () => {
    const first = await owner.request("auth/csrf");
    expect(first.response.headers.get("cache-control")).toBe("private, no-store");
    const bad = await owner.request("auth/session", "POST", { email: ownerEmail, password }, undefined, { "X-CSRF-Token": "forged" });
    expect(bad.response.status).toBe(403);
    const crossSite = await owner.request("auth/recovery/request", "POST", { email: ownerEmail }, undefined, { Origin: "https://untrusted.example" });
    expect(crossSite.response.status).toBe(403);
    const next = await owner.request<{ csrfToken: string }>("auth/csrf");
    const again = await owner.request<{ csrfToken: string }>("auth/csrf");
    expect(again.data.csrfToken).toBe(next.data.csrfToken);
  });
  test("受控注册先验邮箱、单次准入，注册后必须正常登录", async () => {
    await registerAccount(owner, ownerEmail, bootstrap, "测试爸爸");
    ownerPerson = (await owner.request<Me>("me")).data;
    expect(ownerPerson.user.canCreateHousehold).toBe(true);
    expect((await owner.request("auth/email/verification", "POST", { email: "outsider@example.test", registrationToken: bootstrap })).error?.code).toBe("INVALID_INVITE");
    const cookie = owner.cookies.get("bp_session");
    expect(cookie).toHaveLength(43);
    const stored = await query<{ password_hash: string; token_hash: string }>("SELECT u.password_hash,s.token_hash FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.email_key=$1", [ownerEmail]);
    expect(stored[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(stored[0].token_hash).not.toBe(cookie);
  });
  test("创建家庭幂等、初始化可继续、禁止第二家庭和未初始化排程", async () => {
    const key = randomUUID(); const input = { name: "测试家庭一", city: "上海", timezone: "Asia/Shanghai" };
    const created = await owner.request<{ id: string }>("households", "POST", input, key); expect(created.response.status).toBe(201);
    householdId = created.data.id;
    expect((await owner.request<{ id: string }>("households", "POST", input, key)).data.id).toBe(householdId);
    expect((await owner.request("households", "POST", { ...input, name: "变更参数" }, key)).error?.code).toBe("IDEMPOTENCY_MISMATCH");
    expect((await owner.request("households", "POST", input, randomUUID())).response.status).toBe(403);
    expect((await owner.request("households/" + householdId + "/plans", "POST", { date: localDate() }, randomUUID())).error?.code).toBe("SETUP_REQUIRED");
    const h = (await owner.request<Household>("households/" + householdId)).data;
    expect(h.setupComplete).toBe(false);
    const child = { name: "测试宝宝", birthDate: null, ageMonths: 17, foodStatus: "unknown", foodRestrictions: "" };
    const saved = await owner.request("households/" + householdId + "/setup", "PUT", { expectedRevision: h.revision, child });
    expect(saved.response.status).toBe(200);
    expect((await owner.request("households/" + householdId + "/setup", "PUT", { expectedRevision: h.revision, child })).response.status).toBe(409);
  });
  test("多项食物过敏与忌口可保存、编辑和移除，空项与重复食物不写入", async () => {
    const path = "households/" + householdId;
    let family = (await owner.request<Household>(path)).data;
    const child = { name: family.child!.name, birthDate: null, ageMonths: 17, foodStatus: "restricted" };
    const items = [
      { kind: "allergy", food: " 鸡蛋 ", note: " 已确认，供家人核对 " },
      { kind: "allergy", food: "花生", note: "" },
      { kind: "avoid", food: "测试忌口食物", note: "已记录的忌口原因" },
    ];
    expect((await owner.request(path + "/child", "PATCH", { expectedRevision: family.revision, child: { ...child, foodRestrictionItems: items } })).response.status).toBe(200);
    family = (await owner.request<Household>(path)).data;
    const saved = items.map((item) => ({ ...item, food: item.food.trim(), note: item.note.trim() }));
    expect(family.child!.foodRestrictionItems).toEqual(saved);
    expect(family.child!.foodRestrictions).toBe("过敏：鸡蛋；备注：已确认，供家人核对\n过敏：花生\n其他忌口：测试忌口食物；备注：已记录的忌口原因");
    const rejected = [[], [{ kind: "allergy", food: "  ", note: "" }], [saved[0], { ...saved[0], kind: "avoid" }], Array.from({ length: 21 }, (_, i) => ({ kind: "allergy", food: "测试食物" + i, note: "" }))];
    for (const entries of rejected) {
      const response = await owner.request(path + "/child", "PATCH", { expectedRevision: family.revision, child: { ...child, foodRestrictionItems: entries } });
      expect(response.response.status).toBe(422);
    }
    expect((await owner.request<Household>(path)).data.child!.foodRestrictionItems).toEqual(saved);
    expect((await owner.request(path + "/child", "PATCH", { expectedRevision: family.revision, child: { ...child, foodRestrictionItems: [{ ...saved[1], note: "更新后的备注" }, saved[2]] } })).response.status).toBe(200);
    family = (await owner.request<Household>(path)).data;
    expect(family.child!.foodRestrictionItems).toEqual([{ ...saved[1], note: "更新后的备注" }, saved[2]]);
    expect(family.child!.foodRestrictions).not.toContain("鸡蛋");
    expect((await owner.request(path + "/child", "PATCH", { expectedRevision: family.revision, child: { ...child, foodStatus: "none", foodRestrictionItems: [] } })).response.status).toBe(200);
    family = (await owner.request<Household>(path)).data;
    expect(family.child!.foodRestrictionItems).toEqual([]);
    expect(family.child!.foodRestrictions).toBe("");
  });
  test("旧食物限制原文保留为待分类记录，保存后不推断为过敏", async () => {
    const path = "households/" + householdId;
    let family = (await owner.request<Household>(path)).data;
    const child = { name: family.child!.name, birthDate: null, ageMonths: 17, foodStatus: "restricted" };
    const original = "鸡蛋需要避开\n花生情况待核对";
    expect((await owner.request(path + "/child", "PATCH", { expectedRevision: family.revision, child: { ...child, foodRestrictions: original } })).response.status).toBe(200);
    family = (await owner.request<Household>(path)).data;
    expect(family.child!.foodRestrictions).toBe(original);
    expect(family.child!.foodRestrictionItems).toEqual([{ kind: "unspecified", food: original, note: "" }]);
    expect((await owner.request(path + "/child", "PATCH", { expectedRevision: family.revision, child: { ...child, foodRestrictionItems: family.child!.foodRestrictionItems } })).response.status).toBe(200);
    family = (await owner.request<Household>(path)).data;
    expect(family.child!.foodRestrictions).toBe(original);
    expect(family.child!.foodRestrictionItems[0].kind).toBe("unspecified");
    expect((await owner.request(path + "/child", "PATCH", { expectedRevision: family.revision, child: { ...child, foodStatus: "unknown", foodRestrictionItems: [] } })).response.status).toBe(200);
  });
  test("邀请新家人注册、失效码尝试持久化，成员不能改关键资料", async () => {
    const invite = await invitation(owner, householdId); memberInvite = invite.token;
    const challenge = await member.request<{ challengeId: string }>("auth/email/verification", "POST", { email: memberEmail, registrationToken: invite.token });
    const code = (await mailText(memberEmail, "邮箱验证码")).match(/\b\d{6}\b/)![0];
    expect((await member.request("auth/email/verification", "POST", { email: memberEmail, registrationToken: invite.token })).response.status).toBe(429);
    for (let i = 0; i < 5; i++) expect((await member.request("auth/email/verify", "POST", { challengeId: challenge.data.challengeId, code: code === "000000" ? "111111" : "000000" })).error?.code).toBe("INVALID_CODE");
    expect((await member.request("auth/email/verify", "POST", { challengeId: challenge.data.challengeId, code })).error?.code).toBe("INVALID_CODE");
    const attempts = await query<{ attempts: number }>("SELECT attempts FROM email_challenges WHERE id=$1", [challenge.data.challengeId]);
    expect(attempts[0].attempts).toBe(5);
    await query("DELETE FROM rate_limits WHERE key LIKE 'verification:%'");
    await registerAccount(member, memberEmail, invite.token, "测试奶奶");
    const family = (await member.request<Household>("households/" + householdId)).data;
    memberId = family.members.find((m) => m.displayName === "测试奶奶")!.id;
    expect(family.role).toBe("member");
    expect((await member.request("households/" + householdId + "/child", "PATCH", { expectedRevision: family.revision, child: { name: "不能改", birthDate: null, ageMonths: 20, foodStatus: "none", foodRestrictions: "" } })).response.status).toBe(403);
    expect((await member.request("households/" + householdId + "/invites", "POST", { role: "admin" }, randomUUID())).response.status).toBe(403);
    expect((await member.request("households/" + householdId + "/templates/weekday", "PUT", { expectedRevision: 1, slots: [{ label: "午餐", time: "12:00" }] })).response.status).toBe(200);
  });
  test("两个家庭数据隔离，修改体不能夹带角色或家庭标识", async () => {
    // A second test-only entitlement is a fixture, never an open HTTP registration path.
    const id = randomUUID();
    const original = await query<{ password_hash: string }>("SELECT password_hash FROM users WHERE email_key=$1", [ownerEmail]);
    await query("INSERT INTO users(id,email,email_key,display_name,password_hash,can_create_household) VALUES ($1,$2,$2,'测试另一家庭',$3,true)", [id, otherEmail, original[0].password_hash]);
    await other.request("auth/session", "POST", { email: otherEmail, password });
    otherHouseholdId = (await other.request<{ id: string }>("households", "POST", { name: "测试家庭二", city: "杭州" }, randomUUID())).data.id;
    expect((await other.request("households/" + householdId)).response.status).toBe(404);
    expect((await owner.request("households/" + otherHouseholdId)).response.status).toBe(404);
    expect((await owner.request("households/" + householdId + "/setup", "PUT", { expectedRevision: 3, role: "admin", child: {} })).response.status).toBe(422);
    expect((await member.request("households/" + householdId + "/today?date=2026-02-30")).response.status).toBe(422);
  });
  test("日计划唯一，成员手动添加幂等，历史版本与其他项保留", async () => {
    const date = localDate();
    const plans = await Promise.all([owner.request<{ id: string }>("households/" + householdId + "/plans", "POST", { date }, randomUUID()), member.request<{ id: string }>("households/" + householdId + "/plans", "POST", { date }, randomUUID())]);
    planId = plans[0].data.id; expect(plans[1].data.id).toBe(planId);
    const key = randomUUID();
    const input = { kind: "activity", title: "一起读绘本", time: "10:00", notes: "只读喜欢的那一本", caregiverId: memberId, expectedRevision: 1 };
    const saved = await member.request<PlanItem>("households/" + householdId + "/plans/" + planId + "/items", "POST", input, key);
    expect(saved.response.status).toBe(201); item = saved.data;
    expect((await member.request<PlanItem>("households/" + householdId + "/plans/" + planId + "/items", "POST", input, key)).data.id).toBe(item.id);
    const next = await owner.request<PlanItem>("households/" + householdId + "/plans/" + planId + "/items", "POST", { ...input, kind: "meal", title: "午餐", time: "12:00", expectedRevision: 2 }, randomUUID());
    expect(next.response.status).toBe(201);
    const day = (await owner.request<Day>("households/" + householdId + "/today?date=" + date)).data;
    expect(day.plan?.items).toHaveLength(2);
    expect(day.plan?.revision).toBe(3);
    expect((await other.request("households/" + otherHouseholdId + "/plan-items/" + item.id, "PATCH", { ...input, expectedRevision: 1 }, randomUUID())).response.status).toBe(404);
  });
  test("并发修改只有一个成功，重复确认不重复写入，旧版本可查", async () => {
    const input = { kind: item.kind, title: item.title, notes: item.notes, time: "10:30", caregiverId: memberId, expectedRevision: 1 };
    const key = randomUUID();
    const replies = await Promise.all([owner.request<PlanItem>("households/" + householdId + "/plan-items/" + item.id, "PATCH", input, key), member.request<PlanItem>("households/" + householdId + "/plan-items/" + item.id, "PATCH", { ...input, time: "11:00" }, randomUUID())]);
    expect(replies.map((r) => r.response.status).sort()).toEqual([200, 409]);
    const winner = replies.find((r) => r.response.status === 200)!.data;
    expect(winner.revision).toBe(2);
    const versions = await owner.request<Array<{ revision: number }>>("households/" + householdId + "/plan-items/" + item.id + "/versions");
    expect(versions.data.map((v) => v.revision)).toEqual([2, 1]);
    if (replies[0].response.status === 200) expect((await owner.request<PlanItem>("households/" + householdId + "/plan-items/" + item.id, "PATCH", input, key)).data.revision).toBe(2);
    const day = (await owner.request<Day>("households/" + householdId + "/today?date=" + localDate())).data;
    expect(day.plan?.items.find((v) => v.title === "午餐")?.time).toBe("12:00");
  });
  test("最后一位管理员受到保护，撤销成员后读取及幂等重放均失效", async () => {
    const h = (await owner.request<Household>("households/" + householdId)).data;
    const admin = h.members.find((m) => m.role === "admin")!;
    expect((await owner.request("households/" + householdId + "/members/" + admin.id, "DELETE", { expectedRevision: admin.revision })).error?.code).toBe("LAST_ADMIN");
    const streamRequest = new NextRequest(readConfig().origin + "/api/v1/households/" + householdId + "/events", { headers: { Cookie: [...member.cookies].map(([k, v]) => k + "=" + v).join("; ") } });
    const stream = await handle(streamRequest, ["households", householdId, "events"]);
    expect(stream.headers.get("content-type")).toBe("text/event-stream");
    const reader = stream.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: ready");
    expect((await owner.request("households/" + householdId + "/members/" + memberId, "DELETE", { expectedRevision: 1 })).response.status).toBe(200);
    let ended = false;
    for (let i = 0; i < 30; i++) {
      const part = await reader.read();
      if (part.done) break;
      if (new TextDecoder().decode(part.value).includes("access-ended")) { ended = true; break; }
    }
    await reader.cancel(); expect(ended).toBe(true);
    expect((await member.request("households/" + householdId)).response.status).toBe(404);
    expect((await other.request("households/" + householdId + "/events")).response.status).toBe(404);
    expect((await member.request("invites/accept", "POST", { token: memberInvite })).error?.code).toBe("INVALID_INVITE");
    const rejoin = await invitation(owner, householdId);
    expect((await member.request("invites/accept", "POST", { token: rejoin.token })).response.status).toBe(200);
    expect((await member.request("invites/accept", "POST", { token: rejoin.token })).response.status).toBe(200);
  });
  test("重置回应一致，GET 不消费凭证，原子单次重置撤销全部会话", async () => {
    const known = await member.request("auth/recovery/request", "POST", { email: memberEmail });
    const unknown = await other.request("auth/recovery/request", "POST", { email: "missing-" + suffix + "@example.test" });
    expect(known.data).toEqual(unknown.data);
    const text = await mailText(memberEmail, "重置密码");
    const resetToken = new URL(text.match(/http[^\s]+/)![0]).searchParams.get("token")!;
    expect((await member.request("auth/recovery/reset?token=" + resetToken)).response.status).toBe(404);
    const reset = { token: resetToken, password: password + "-reset" };
    const outcomes = await Promise.all([member.request("auth/recovery/reset", "POST", reset), other.request("auth/recovery/reset", "POST", reset)]);
    expect(outcomes.map((r) => r.response.status).sort()).toEqual([200, 400]);
    expect((await member.request("me")).response.status).toBe(401);
    expect((await member.request("auth/session", "POST", { email: memberEmail, password })).response.status).toBe(401);
    expect((await member.request("auth/session", "POST", { email: memberEmail, password: password + "-reset", remember: true })).response.status).toBe(200);
  });
  test("会话过期和 credential version 均由服务端重新校验", async () => {
    const temporary = await login({ email: ownerEmail.toUpperCase(), password, remember: false }, "session expiry probe");
    await query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [digest(temporary.token)]);
    await expect(getMe(temporary.token)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    const stale = await login({ email: ownerEmail, password, remember: true }, "credential version probe");
    await query("UPDATE sessions SET credential_version=0 WHERE token_hash=$1", [digest(stale.token)]);
    await expect(getMe(stale.token)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    const concurrent = await login({ email: ownerEmail, password, remember: false }, "concurrent create probe");
    await expect(createHousehold(concurrent.token, { name: "无额度", city: "上海", timezone: "Asia/Shanghai" }, randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN" });
    const rows = await query<{ token_hash: string }>("SELECT token_hash FROM sessions WHERE user_id=$1", [ownerPerson.user.id]);
    expect(rows.length).toBeGreaterThan(1);
  });
  test("邀请撤销后已验证票据也不能注册，失效及重放不创建账号", async () => {
    const invite = await invitation(owner, householdId);
    const address = "revoked-" + suffix + "@example.test";
    const challenge = await other.request<{ challengeId: string }>("auth/email/verification", "POST", { email: address, registrationToken: invite.token });
    const code = (await mailText(address, "邮箱验证码")).match(/\b\d{6}\b/)![0];
    const verified = await other.request<{ emailVerificationTicket: string }>("auth/email/verify", "POST", { challengeId: challenge.data.challengeId, code });
    expect(verified.response.status).toBe(200);
    expect((await other.request("auth/email/verify", "POST", { challengeId: challenge.data.challengeId, code })).error?.code).toBe("INVALID_CODE");
    await owner.request("households/" + householdId + "/invites/" + invite.id, "DELETE");
    const registered = await other.request("auth/register", "POST", { registrationToken: invite.token, emailVerificationTicket: verified.data.emailVerificationTicket, displayName: "不应建立", password });
    expect(registered.error?.code).toBe("INVALID_INVITE");
    expect(await query("SELECT id FROM users WHERE email_key=$1", [address])).toHaveLength(0);
    const expired = await invitation(owner, householdId);
    await query("UPDATE invites SET expires_at=now()-interval '1 second' WHERE id=$1", [expired.id]);
    expect((await other.request("invites/accept", "POST", { token: expired.token })).error?.code).toBe("INVALID_INVITE");
  });
  test("保留可复查的浏览器测试夹具，不包含真实家庭资料", async () => {
    const invite = await invitation(owner, householdId);
    const founderEmail = "founder-" + suffix + "@example.test";
    const encoded = (await query<{ password_hash: string }>("SELECT password_hash FROM users WHERE email_key=$1", [ownerEmail]))[0].password_hash;
    await query("INSERT INTO users(email,email_key,display_name,password_hash,can_create_household) VALUES ($1,$1,'测试新管理员',$2,true)", [founderEmail, encoded]);
    const fixture = { owner: { email: ownerEmail, password }, member: { email: memberEmail, password: password + "-reset" }, founder: { email: founderEmail, password }, householdId, otherHouseholdId, itemId: item.id, inviteUrl: invite.url, registerEmail: "browser-" + suffix + "@example.test" };
    await mkdir(".local", { recursive: true, mode: 0o700 });
    await writeFile(".local/browser-fixture.json", JSON.stringify(fixture, null, 2), { mode: 0o600 });
    expect((await owner.request<Me>("me")).data.households).toHaveLength(1);
  });
  test("同一邀请由两个账号并发接受时只允许一个消费", async () => {
    const invite = await invitation(owner, householdId);
    const results = await Promise.all([member.request("invites/accept", "POST", { token: invite.token }), other.request("invites/accept", "POST", { token: invite.token })]);
    expect(results.map((r) => r.response.status).sort()).toEqual([200, 400]);
    const accepted = await query<{ count: number }>("SELECT count(*)::int AS count FROM invites WHERE id=$1 AND accepted_by IS NOT NULL", [invite.id]);
    expect(accepted[0].count).toBe(1);
  });
  test("过期验证码和重置凭证拒绝写入，已有邮箱不能被邀请流程接管", async () => {
    const invite = await invitation(owner, householdId);
    const address = "expired-" + suffix + "@example.test";
    const sent = await other.request<{ challengeId: string }>("auth/email/verification", "POST", { email: address, registrationToken: invite.token });
    const code = (await mailText(address, "邮箱验证码")).match(/\b\d{6}\b/)![0];
    await query("UPDATE email_challenges SET expires_at=now()-interval '1 second' WHERE id=$1", [sent.data.challengeId]);
    expect((await other.request("auth/email/verify", "POST", { challengeId: sent.data.challengeId, code })).error?.code).toBe("INVALID_CODE");
    await query("DELETE FROM rate_limits WHERE key LIKE 'verification:%'");
    const existing = await other.request<{ challengeId: string }>("auth/email/verification", "POST", { email: ownerEmail, registrationToken: invite.token });
    const existingCode = (await mailText(ownerEmail, "邮箱验证码")).match(/\b\d{6}\b/)![0];
    const verified = await other.request<{ emailVerificationTicket: string }>("auth/email/verify", "POST", { challengeId: existing.data.challengeId, code: existingCode });
    expect((await other.request("auth/register", "POST", { registrationToken: invite.token, emailVerificationTicket: verified.data.emailVerificationTicket, displayName: "不能替换", password: password + "-takeover" })).error?.code).toBe("ACCOUNT_EXISTS");
    const goodLogin = await owner.request("auth/session", "POST", { email: ownerEmail, password });
    expect(goodLogin.response.status).toBe(200);
    await other.request("auth/recovery/request", "POST", { email: otherEmail });
    const resetToken = new URL((await mailText(otherEmail, "重置密码")).match(/http[^\s]+/)![0]).searchParams.get("token")!;
    await query("UPDATE password_resets SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [digest(resetToken)]);
    expect((await other.request("auth/recovery/reset", "POST", { token: resetToken, password: password + "-expired" })).error?.code).toBe("INVALID_RESET");
    expect((await other.request("auth/session", "POST", { email: otherEmail, password })).response.status).toBe(200);
  });
  test("两位管理员并发降级自身也不能移除最后一位管理员", async () => {
    const invite = await other.request<{ url: string }>("households/" + otherHouseholdId + "/invites", "POST", { role: "admin" }, randomUUID());
    const raw = new URL(invite.data.url).searchParams.get("token")!;
    expect((await owner.request("invites/accept", "POST", { token: raw })).response.status).toBe(200);
    const family = (await owner.request<Household>("households/" + otherHouseholdId)).data;
    const a = family.members.find((m) => m.userId === ownerPerson.user.id)!;
    const b = family.members.find((m) => m.userId !== ownerPerson.user.id)!;
    const result = await Promise.all([
      owner.request("households/" + otherHouseholdId + "/members/" + a.id, "PATCH", { expectedRevision: a.revision, role: "member" }),
      other.request("households/" + otherHouseholdId + "/members/" + b.id, "PATCH", { expectedRevision: b.revision, role: "member" }),
    ]);
    expect(result.map((r) => r.response.status).sort()).toEqual([200, 409]);
    const admins = await query<{ count: number }>("SELECT count(*)::int AS count FROM memberships WHERE household_id=$1 AND role='admin' AND revoked_at IS NULL", [otherHouseholdId]);
    expect(admins[0].count).toBe(1);
  });
});
