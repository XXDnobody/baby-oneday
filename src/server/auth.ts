import { randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import type { z } from "zod";
import type { loginInput, registerInput, verificationInput, verifyInput, resetInput, changePasswordInput } from "../shared/contracts";
import type { Me, Person } from "../shared/contracts";
import { limits, readConfig } from "./config";
import { digest, equals, hashPassword, protectedDigest, token, verifyPassword } from "./crypto";
import { query, transaction } from "./db";
import { ensure } from "./errors";
import { sendMail } from "./mail";

export interface Actor extends Person { sessionId: string }
export const emailKey = (email: string) => email.trim().toLowerCase();
const ms = { minute: 60000, day: 86400000, hour: 3600000 };

export async function rateLimit(scope: string, value: string, count: number, seconds: number) {
  const key = scope + ":" + protectedDigest(readConfig().AUTH_SECRET, value);
  const rows = await query<{ count: number }>(
    "INSERT INTO rate_limits(key,count,window_start) VALUES ($1,1,now()) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.window_start < now()-($2 * interval '1 second') THEN 1 ELSE rate_limits.count+1 END, window_start=CASE WHEN rate_limits.window_start < now()-($2 * interval '1 second') THEN now() ELSE rate_limits.window_start END RETURNING count",
    [key, seconds],
  );
  ensure(rows[0].count <= count, "RATE_LIMITED", "操作频繁，请稍后重试。", 429);
}

interface Grant { kind: "bootstrap" | "invite"; id: string; householdId: string | null; role: "admin" | "member" }
async function grant(db: PoolClient, raw: string): Promise<Grant> {
  const bootstrap = await db.query<{ id: string }>("SELECT id FROM bootstrap_grants WHERE token_hash=$1 AND consumed_by IS NULL FOR UPDATE", [digest(raw)]);
  if (bootstrap.rowCount) return { kind: "bootstrap", id: bootstrap.rows[0].id, householdId: null, role: "admin" };
  const found = await db.query<{ household_id: string }>("SELECT household_id FROM invites WHERE token_hash=$1", [digest(raw)]);
  ensure(found.rowCount, "INVALID_INVITE", "初始化或邀请链接已失效，请联系家庭管理员。");
  await db.query("SELECT id FROM households WHERE id=$1 FOR UPDATE", [found.rows[0].household_id]);
  const invites = await db.query<{ id: string; household_id: string; role: "admin" | "member" }>(
    "SELECT id,household_id,role FROM invites WHERE token_hash=$1 AND accepted_by IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE", [digest(raw)],
  );
  ensure(invites.rowCount, "INVALID_INVITE", "邀请已使用、撤销或过期，请联系家庭管理员。");
  const invite = invites.rows[0];
  return { kind: "invite", id: invite.id, householdId: invite.household_id, role: invite.role };
}

export async function requestVerification(input: z.infer<typeof verificationInput>) {
  const key = emailKey(input.email);
  await rateLimit("verification", key, 1, limits.resendSeconds);
  const code = String(randomInt(100000, 1000000));
  const challengeId = await transaction(async (db) => {
    const access = await grant(db, input.registrationToken);
    await db.query("UPDATE email_challenges SET consumed_at=now() WHERE email_key=$1 AND grant_id=$2 AND consumed_at IS NULL", [key, access.id]);
    const result = await db.query<{ id: string }>(
      "INSERT INTO email_challenges(email,email_key,grant_kind,grant_id,code_hash,expires_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [input.email.trim(), key, access.kind, access.id, protectedDigest(readConfig().AUTH_SECRET, code), new Date(Date.now() + limits.codeMinutes * ms.minute)],
    );
    return result.rows[0].id;
  });
  try { await sendMail(input.email.trim(), "宝宝计划 · 邮箱验证码", "你的验证码是 " + code + "，10 分钟内有效。若非本人操作，请忽略此邮件。"); }
  catch (error) {
    await query("UPDATE email_challenges SET consumed_at=now() WHERE id=$1", [challengeId]);
    await query("DELETE FROM rate_limits WHERE key=$1", ["verification:" + protectedDigest(readConfig().AUTH_SECRET, key)]);
    throw error;
  }
  return { challengeId, retryAfter: limits.resendSeconds };
}

export async function verifyEmail(input: z.infer<typeof verifyInput>) {
  const ticket = token();
  const valid = await transaction(async (db) => {
    const found = await db.query<{ code_hash: string; attempts: number }>(
      "SELECT code_hash,attempts FROM email_challenges WHERE id=$1 AND consumed_at IS NULL AND verified_at IS NULL AND expires_at>now() FOR UPDATE", [input.challengeId],
    );
    const challenge = found.rows[0];
    if (!challenge || challenge.attempts >= limits.codeAttempts) return false;
    await db.query("UPDATE email_challenges SET attempts=attempts+1 WHERE id=$1", [input.challengeId]);
    if (!equals(challenge.code_hash, protectedDigest(readConfig().AUTH_SECRET, input.code))) return false;
    await db.query("UPDATE email_challenges SET verified_at=now(), ticket_hash=$2, ticket_expires_at=$3 WHERE id=$1",
      [input.challengeId, digest(ticket), new Date(Date.now() + limits.ticketMinutes * ms.minute)]);
    return true;
  });
  ensure(valid, "INVALID_CODE", "验证码错误、已使用或过期；最多尝试 5 次，请重新申请。");
  return { emailVerificationTicket: ticket };
}

export async function register(input: z.infer<typeof registerInput>) {
  const passwordHash = await hashPassword(input.password);
  return transaction(async (db) => {
    const access = await grant(db, input.registrationToken);
    const found = await db.query<{ id: string; email: string; email_key: string }>(
      "SELECT id,email,email_key FROM email_challenges WHERE ticket_hash=$1 AND verified_at IS NOT NULL AND consumed_at IS NULL AND ticket_expires_at>now() AND grant_kind=$2 AND grant_id=$3 FOR UPDATE",
      [digest(input.emailVerificationTicket), access.kind, access.id],
    );
    ensure(found.rowCount, "INVALID_TICKET", "邮箱验证已失效，请重新验证。");
    const challenge = found.rows[0];
    const users = await db.query<{ id: string }>(
      "INSERT INTO users(email,email_key,display_name,password_hash,can_create_household) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(email_key) DO NOTHING RETURNING id",
      [challenge.email, challenge.email_key, input.displayName, passwordHash, access.kind === "bootstrap"],
    );
    ensure(users.rowCount, "ACCOUNT_EXISTS", "此邮箱已注册，请登录或找回密码。", 409);
    const userId = users.rows[0].id;
    if (access.kind === "bootstrap") {
      await db.query("UPDATE bootstrap_grants SET consumed_by=$2 WHERE id=$1", [access.id, userId]);
    } else {
      await db.query("INSERT INTO memberships(household_id,user_id,role) VALUES ($1,$2,$3)", [access.householdId, userId, access.role]);
      await db.query("UPDATE invites SET accepted_by=$2,accepted_at=now() WHERE id=$1", [access.id, userId]);
      await db.query("UPDATE households SET revision=revision+1 WHERE id=$1", [access.householdId]);
      await db.query("INSERT INTO household_events(household_id,resource_type,resource_id,revision) SELECT id,'household',id,revision FROM households WHERE id=$1", [access.householdId]);
    }
    await db.query("UPDATE email_challenges SET consumed_at=now() WHERE id=$1", [challenge.id]);
    return { registered: true };
  });
}

interface Credential { id: string; password_hash: string; credential_version: number }
let dummyPassword: Promise<string> | undefined;
export async function login(input: z.infer<typeof loginInput>, device: string) {
  await rateLimit("login", emailKey(input.email), 10, 900);
  const rows = await query<Credential>("SELECT id,password_hash,credential_version FROM users WHERE email_key=$1 AND disabled_at IS NULL", [emailKey(input.email)]);
  const user = rows[0];
  dummyPassword ??= hashPassword(token());
  const valid = await verifyPassword(input.password, user?.password_hash ?? await dummyPassword);
  ensure(user && valid, "INVALID_CREDENTIALS", "邮箱或密码不正确。", 401);
  const raw = token();
  const absolute = new Date(Date.now() + (input.remember ? limits.rememberedMaxDays * ms.day : limits.sessionHours * ms.hour));
  const expires = new Date(Math.min(absolute.getTime(), Date.now() + limits.rememberedIdleDays * ms.day));
  await transaction(async (db) => {
    const current = await db.query<Credential>("SELECT id,password_hash,credential_version FROM users WHERE id=$1 AND disabled_at IS NULL FOR UPDATE", [user.id]);
    ensure(current.rows[0]?.credential_version === user.credential_version, "INVALID_CREDENTIALS", "凭证已变化，请重新登录。", 401);
    await db.query("INSERT INTO sessions(user_id,token_hash,credential_version,remembered,device,expires_at,absolute_expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [user.id, digest(raw), user.credential_version, input.remember, device.slice(0, 160), expires, absolute]);
  });
  return { token: raw, remembered: input.remember, absoluteExpiresAt: absolute };
}

export async function withUser<T>(raw: string | undefined, fn: (db: PoolClient, actor: Actor) => Promise<T>, exclusiveUser = false): Promise<T> {
  ensure(raw, "SESSION_EXPIRED", "请重新登录。", 401);
  return transaction(async (db) => {
    const candidate = await db.query<{ user_id: string }>("SELECT user_id FROM sessions WHERE token_hash=$1", [digest(raw)]);
    ensure(candidate.rowCount, "SESSION_EXPIRED", "登录已过期，请重新登录。", 401);
    const found = await db.query<Person & { credentialVersion: number }>(
      'SELECT id,email,display_name AS "displayName",can_create_household AS "canCreateHousehold",credential_version AS "credentialVersion" FROM users WHERE id=$1 AND disabled_at IS NULL ' + (exclusiveUser ? "FOR UPDATE" : "FOR SHARE"),
      [candidate.rows[0].user_id],
    );
    const user = found.rows[0];
    ensure(user, "SESSION_EXPIRED", "登录已过期，请重新登录。", 401);
    const sessions = await db.query<{ id: string }>(
      "SELECT id FROM sessions WHERE token_hash=$1 AND credential_version=$2 AND revoked_at IS NULL AND expires_at>now() AND absolute_expires_at>now() FOR UPDATE",
      [digest(raw), user.credentialVersion],
    );
    ensure(sessions.rowCount, "SESSION_EXPIRED", "登录已过期，请重新登录。", 401);
    const sessionId = sessions.rows[0].id;
    await db.query("UPDATE sessions SET last_seen_at=now(), expires_at=CASE WHEN remembered THEN LEAST(absolute_expires_at, now()+($2 * interval '1 day')) ELSE expires_at END WHERE id=$1", [sessionId, limits.rememberedIdleDays]);
    return fn(db, { id: user.id, email: user.email, displayName: user.displayName, canCreateHousehold: user.canCreateHousehold, sessionId });
  });
}

export async function me(raw: string | undefined): Promise<Me> {
  return withUser(raw, async (db, actor) => {
    const households = await db.query<Me["households"][number]>(
      'SELECT h.id,h.name,m.role,h.setup_complete AS "setupComplete" FROM households h JOIN memberships m ON m.household_id=h.id WHERE m.user_id=$1 AND m.revoked_at IS NULL ORDER BY h.created_at', [actor.id],
    );
    const user = { id: actor.id, email: actor.email, displayName: actor.displayName, canCreateHousehold: actor.canCreateHousehold };
    return { user, households: households.rows };
  });
}

export async function logout(raw: string | undefined) {
  if (raw) await query("UPDATE sessions SET revoked_at=now() WHERE token_hash=$1", [digest(raw)]);
  return { loggedOut: true };
}

export async function changePassword(raw: string | undefined, input: z.infer<typeof changePasswordInput>) {
  // Verify the old credential outside the transaction, then check its version under
  // withUser's user lock. A concurrent reset/change must invalidate this attempt.
  const actor = await withUser(raw, async (_db, actor) => actor);
  await rateLimit("password-change", actor.id, 5, 600);
  const credential = (await query<Credential>("SELECT id,password_hash,credential_version FROM users WHERE id=$1 AND disabled_at IS NULL", [actor.id]))[0];
  ensure(credential && await verifyPassword(input.currentPassword, credential.password_hash), "INVALID_PASSWORD", "当前密码不正确，请重新输入。", 422);
  const encoded = await hashPassword(input.password);
  return withUser(raw, async (db, current) => {
    const changed = await db.query("UPDATE users SET password_hash=$2,credential_version=credential_version+1 WHERE id=$1 AND credential_version=$3 RETURNING id", [current.id, encoded, credential.credential_version]);
    ensure(changed.rowCount, "SESSION_EXPIRED", "账号凭证已经变化，请重新登录。", 401);
    await db.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [current.id]);
    await db.query("UPDATE password_resets SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL", [current.id]);
    return { changed: true, loginRequired: true };
  }, true);
}

export async function requestRecovery(email: string) {
  const key = emailKey(email);
  await rateLimit("recovery", key, 1, limits.resendSeconds);
  const raw = token();
  const result = await transaction(async (db) => {
    const found = await db.query<{ id: string; email: string; credential_version: number }>("SELECT id,email,credential_version FROM users WHERE email_key=$1 AND disabled_at IS NULL FOR UPDATE", [key]);
    const user = found.rows[0];
    if (!user) return null;
    await db.query("UPDATE password_resets SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL", [user.id]);
    const reset = await db.query<{ id: string }>("INSERT INTO password_resets(user_id,token_hash,credential_version,expires_at) VALUES ($1,$2,$3,$4) RETURNING id",
      [user.id, digest(raw), user.credential_version, new Date(Date.now() + limits.resetMinutes * ms.minute)]);
    return { email: user.email, id: reset.rows[0].id };
  });
  if (result) {
    try { await sendMail(result.email, "宝宝计划 · 重置密码", "请在 10 分钟内打开以下链接并设置新密码：\n" + readConfig().origin + "/reset-password?token=" + raw + "\n若非本人操作，请忽略。"); }
    catch {
      await query("UPDATE password_resets SET consumed_at=now() WHERE id=$1", [result.id]);
      // Respond identically for known and unknown addresses; do not expose account existence.
    }
  }
  return { message: "如果此邮箱已注册，我们会发送重置邮件。请检查收件箱，稍后再试。", retryAfter: limits.resendSeconds };
}

export async function resetPassword(input: z.infer<typeof resetInput>) {
  const encoded = await hashPassword(input.password);
  return transaction(async (db) => {
    const candidate = await db.query<{ user_id: string }>("SELECT user_id FROM password_resets WHERE token_hash=$1", [digest(input.token)]);
    ensure(candidate.rowCount, "INVALID_RESET", "重置链接已失效，请重新申请。");
    const user = await db.query<{ credential_version: number }>("SELECT credential_version FROM users WHERE id=$1 AND disabled_at IS NULL FOR UPDATE", [candidate.rows[0].user_id]);
    ensure(user.rowCount, "INVALID_RESET", "重置链接已失效，请重新申请。");
    const reset = await db.query<{ id: string }>(
      "SELECT id FROM password_resets WHERE token_hash=$1 AND credential_version=$2 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE",
      [digest(input.token), user.rows[0].credential_version],
    );
    ensure(reset.rowCount, "INVALID_RESET", "重置链接已失效，请重新申请。");
    await db.query("UPDATE users SET password_hash=$2,credential_version=credential_version+1 WHERE id=$1", [candidate.rows[0].user_id, encoded]);
    await db.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [candidate.rows[0].user_id]);
    await db.query("UPDATE password_resets SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL", [candidate.rows[0].user_id]);
    return { reset: true, loginRequired: true };
  });
}
