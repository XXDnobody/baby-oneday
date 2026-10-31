import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { readConfig } from "../src/server/config";
import { closeDatabase, query } from "../src/server/db";
import { digest, hashPassword } from "../src/server/crypto";
import { localDate } from "../src/server/households";
import { assertRestoreDatabase, captureRecoveryCheckpoint, reconcileRecovery, verifyRecoveryCheckpoint, type SignedCheckpoint } from "../src/server/recovery-safety";
import type { Day, Household, PlanItem } from "../src/shared/contracts";
import type { RecordEntry } from "../src/shared/b2";
import { testClient } from "./http-client";

const config = readConfig(), source = new pg.Client({ connectionString: config.DATABASE_URL }), control = new pg.Client({ connectionString: config.DATABASE_URL });
const name = "baby_plan_restore_b4_" + Date.now(), url = new URL(config.DATABASE_URL); url.pathname = "/" + name;
const restored = new pg.Client({ connectionString: url.toString() });
const owner = testClient(), member = testClient(), password = "B4-restore-test-only-password";
const today = localDate(), suffix = randomUUID().slice(0, 8);
let created = false, connected = false, h: string, ownerId: string, memberId: string, credentialUserId: string, item: PlanItem, expired: RecordEntry, kept: RecordEntry, restoredAfter: RecordEntry, purgedEarly: RecordEntry, memberRelationId: string, checkpoint: SignedCheckpoint, privateConversation: string, jobId: string, printId: string, executionId: string;
const tableResults: Array<{ table: string; rows: number; matched: boolean }> = [];
const checks: Array<{ name: string; passed: boolean }> = [];
let reconciliation: Awaited<ReturnType<typeof reconcileRecovery>> | undefined;
const path = () => "households/" + h;
async function record(text: string) { const r = await member.request<RecordEntry>(path() + "/records", "POST", { occurredOn: today, text, planItemId: item.id, planItemRevision: item.revision }, randomUUID()); expect(r.status).toBe(201); return r.data; }
async function capture() {
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try { return await captureRecoveryCheckpoint(source, config.AUTH_SECRET); } finally { await source.query("COMMIT"); }
}
beforeAll(async () => {
  await source.connect(); await control.connect();
  const hash = await hashPassword(password);
  for (const [label, browser] of [["owner", owner], ["member", member]] as const) {
    const email = "b4-restore-" + label + "-" + suffix + "@example.test";
    const id = (await query<{ id: string }>("INSERT INTO users(email,email_key,display_name,password_hash) VALUES ($1,$1,$2,$3) RETURNING id", [email, "恢复测试" + label, hash]))[0].id;
    if (label === "owner") ownerId = id; else memberId = id;
    expect((await browser.request("auth/session", "POST", { email, password, remember: true })).status).toBe(200);
  }
  credentialUserId = (await query<{ id: string }>("INSERT INTO users(email,email_key,display_name,password_hash) VALUES ($1,$1,'恢复后凭证须核对',$2) RETURNING id", ["b4-restore-credential-" + suffix + "@example.test", hash]))[0].id;
  h = (await query<{ id: string }>("INSERT INTO households(name,city,setup_complete) VALUES ('B4恢复专用虚拟家庭','上海',true) RETURNING id"))[0].id;
  await query("INSERT INTO memberships(household_id,user_id,role) VALUES ($1,$2,'admin'),($1,$3,'member')", [h, ownerId, memberId]);
  await query("INSERT INTO children(household_id,name,age_months,age_as_of,food_status) VALUES ($1,'恢复虚拟宝宝',17,$2,'none')", [h, today]);
  await query("INSERT INTO household_templates(household_id,kind) VALUES ($1,'weekday'),($1,'weekend')", [h]);
  const plan = (await owner.request<{ id: string }>(path() + "/plans", "POST", { date: today }, randomUUID())).data;
  item = (await member.request<PlanItem>(path() + "/plans/" + plan.id + "/items", "POST", { kind: "routine", title: "POST_BACKUP_DELETED_PLAN_SENTINEL", time: "09:00", notes: "正文不可复活", expectedRevision: 1 }, randomUUID())).data;
  expired = await record("POST_BACKUP_EXPIRED_RECORD_SENTINEL"); kept = await record("有效记录保留原作者和独立历史快照"); restoredAfter = await record("备份之后恢复的记录，需补齐缺失版本"); purgedEarly = await record("ALREADY_PURGED_RECORD_SENTINEL");
  await member.request(path() + "/records/" + restoredAfter.id, "DELETE", { expectedRevision: 1 }, randomUUID());
  printId = (await owner.request<{ id: string }>(path() + "/print-snapshots", "POST", { kind: "day", date: today, expectedRevision: (await owner.request<Day>(path() + "/today?date=" + today)).data.plan!.revision, items: [{ id: item.id, revision: item.revision }] }, randomUUID())).data.id;
  privateConversation = (await member.request<{ id: string }>(path() + "/ai-conversations", "POST", { from: today, to: today }, randomUUID())).data.id;
  await query("INSERT INTO ai_messages(household_id,owner_id,conversation_id,turn,role,text) VALUES ($1,$2,$3,1,'user','PRIVATE_RESTORE_AI_SENTINEL')", [h, memberId, privateConversation]);
  executionId = (await query<{ id: string }>("INSERT INTO change_proposals(household_id,owner_id,conversation_id,turn,state,operations,preview,dependency_digest,expires_at) VALUES ($1,$2,$3,1,'executed','[]','[]','test',now()+interval '10 minutes') RETURNING id", [h, memberId, privateConversation]))[0].id;
  await query("INSERT INTO proposal_executions(proposal_id,household_id,owner_id,result) VALUES ($1,$2,$3,'{\"verifiedFixture\":true}')", [executionId, h, memberId]);
  await query("INSERT INTO change_proposals(household_id,owner_id,conversation_id,turn,operations,preview,dependency_digest,expires_at) VALUES ($1,$2,$3,2,'[]','[]','test',now()+interval '10 minutes')", [h, memberId, privateConversation]);
  jobId = (await query<{ id: string }>("INSERT INTO b3_jobs(household_id,owner_id,conversation_id,kind,business_key,payload,state,lease_token,lease_until) VALUES ($1,$2,$3,'ai',$4,'{\"turn\":2}','running',gen_random_uuid(),now()+interval '2 minutes') RETURNING id", [h, memberId, privateConversation, "restore-fixture:" + suffix]))[0].id;
  await query("INSERT INTO household_automation(household_id,enabled) VALUES ($1,true)", [h]);
  await query("INSERT INTO invites(household_id,token_hash,role,created_by,expires_at) VALUES ($1,$2,'member',$3,now()+interval '7 days')", [h, digest("B4-old-invite-" + suffix), ownerId]);
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); await source.query("SET LOCAL timezone='UTC'");
  const snapshot = (await source.query<{ snapshot: string }>("SELECT pg_export_snapshot() AS snapshot")).rows[0].snapshot;
  const tables = (await source.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const dump = execFileSync("docker", ["exec", "baby-plan-postgres-test", "pg_dump", "-U", "baby_plan_test", "-Fc", "--snapshot=" + snapshot, "baby_plan_test"], { maxBuffer: 64 * 1024 * 1024 });
  await mkdir(".local/backups", { recursive: true, mode: 0o700 }); await writeFile(".local/backups/" + name + ".dump", dump, { mode: 0o600 });
  await control.query('CREATE DATABASE "' + name + '" TEMPLATE template0'); created = true;
  execFileSync("docker", ["exec", "-i", "baby-plan-postgres-test", "pg_restore", "-U", "baby_plan_test", "--no-owner", "--exit-on-error", "-d", name], { input: dump, maxBuffer: 1024 * 1024 });
  await restored.connect(); connected = true; await restored.query("SET timezone='UTC'");
  for (const { tablename } of tables) {
    if (!/^[a-z_][a-z0-9_]*$/.test(tablename)) throw new Error("未知表名");
    const sql = `SELECT count(*)::int AS rows,md5(COALESCE(string_agg(row_to_json(t)::text,chr(10) ORDER BY row_to_json(t)::text),'')) AS digest FROM "${tablename}" t`;
    const a = (await source.query(sql)).rows[0], b = (await restored.query(sql)).rows[0];
    tableResults.push({ table: tablename, rows: a.rows, matched: a.rows === b.rows && a.digest === b.digest });
  }
  await source.query("COMMIT");
  // Real online delete/restore/revoke operations happen AFTER the dump.
  await member.request(path() + "/plan-items/" + item.id, "DELETE", { expectedRevision: item.revision }, randomUUID());
  await query("UPDATE plan_items SET restore_until=clock_timestamp(),body_purged_at=clock_timestamp(),title='已过期删除的安排',notes='',content_snapshot=NULL WHERE id=$1", [item.id]);
  await query("DELETE FROM plan_item_versions WHERE plan_item_id=$1", [item.id]);
  await member.request(path() + "/records/" + expired.id, "DELETE", { expectedRevision: 1 }, randomUUID());
  await member.request(path() + "/records/" + purgedEarly.id, "DELETE", { expectedRevision: 1 }, randomUUID());
  await query("UPDATE activity_records SET restore_until=clock_timestamp(),body_purged_at=clock_timestamp(),text='',plan_snapshot=NULL WHERE id=$1", [expired.id]);
  await query("DELETE FROM record_revisions WHERE record_id=$1", [expired.id]);
  await query("UPDATE activity_records SET body_purged_at=clock_timestamp(),text='',plan_snapshot=NULL WHERE id=$1", [purgedEarly.id]);
  await query("DELETE FROM record_revisions WHERE record_id=$1", [purgedEarly.id]);
  expect((await member.request(path() + "/records/" + restoredAfter.id + "/restore", "POST", { expectedRevision: 2 }, randomUUID())).status).toBe(200);
  const relation = (await owner.request<Household>(path())).data.members.find((m) => m.userId === memberId)!; memberRelationId = relation.id;
  expect((await owner.request(path() + "/members/" + relation.id, "DELETE", { expectedRevision: relation.revision })).status).toBe(200);
  await query("UPDATE users SET credential_version=credential_version+1 WHERE id=$1", [credentialUserId]);
  await query("UPDATE invites SET revoked_at=clock_timestamp() WHERE household_id=$1", [h]);
  checkpoint = await capture();
  await mkdir(".local/recovery", { recursive: true, mode: 0o700 }); await writeFile(".local/recovery/b4-last-writes.json", JSON.stringify(checkpoint, null, 2), { mode: 0o600 });
}, 30000);

afterAll(async () => {
  if (connected) await restored.end(); await source.end();
  if (created) await control.query('DROP DATABASE "' + name + '"'); await control.end(); await closeDatabase();
  await mkdir("output/b4-local-2026-10-31", { recursive: true });
  await writeFile("output/b4-local-2026-10-31/recovery-drill.json", JSON.stringify({ verifiedAt: new Date().toISOString(), source: "isolated test 5433", snapshotConsistent: true, tables: tableResults, checks, reconciliation, targetRemovedAfterCheck: created, realFamilyData: false, productionRecoveryVerified: false }, null, 2));
});

describe("B4 完整隔离恢复与故障注入", () => {
  test("所有表逐行摘要一致，计划、历史、作者、AI 私有归属与执行事实完整恢复", async () => {
    expect(tableResults.length).toBeGreaterThanOrEqual(40); expect(tableResults.every((r) => r.matched)).toBe(true);
    expect((await restored.query("SELECT author_id,plan_snapshot->>'title' AS title FROM activity_records WHERE id=$1", [kept.id])).rows[0]).toEqual({ author_id: memberId, title: item.title });
    expect((await restored.query("SELECT owner_id,text FROM ai_messages WHERE conversation_id=$1", [privateConversation])).rows[0]).toEqual({ owner_id: memberId, text: "PRIVATE_RESTORE_AI_SENTINEL" });
    expect((await restored.query("SELECT proposal_id FROM proposal_executions WHERE proposal_id=$1", [executionId])).rowCount).toBe(1);
    checks.push({ name: "all tables and domain ownership at backup point", passed: true });
  });
  test("核对流水不含正文、邮箱、密码摘要或令牌；包含备份之后的删除、恢复、撤销与凭证变化", () => {
    expect(BigInt(checkpoint.payload.highWatermark)).toBe(checkpoint.payload.events.reduce((max, event) => BigInt(event.id) > max ? BigInt(event.id) : max, 0n));
    const text = JSON.stringify(checkpoint); for (const word of ["POST_BACKUP_DELETED_PLAN_SENTINEL", "POST_BACKUP_EXPIRED_RECORD_SENTINEL", "PRIVATE_RESTORE_AI_SENTINEL", "@example.test", "password_hash", "token_hash"]) expect(text).not.toContain(word);
    expect(checkpoint.payload.events.some((e) => e.resource_id === restoredAfter.id && e.after_state.deleted_at === null)).toBe(true);
    for (const id of [item.id, expired.id, memberRelationId, credentialUserId]) expect(checkpoint.payload.events.some((e) => e.resource_id === id)).toBe(true);
    checks.push({ name: "signed body-free independent last-write checkpoint", passed: true });
  });
  test.each(["missing", "tampered", "stale", "not-frozen"])("%s 核对资料不会让旧副本通过或发生局部变更", async (failure) => {
    const state = (await restored.query("SELECT count(*)::int AS count FROM sessions WHERE revoked_at IS NULL")).rows[0].count;
    if (failure === "missing") await expect(reconcileRecovery(restored, {}, config.AUTH_SECRET, true)).rejects.toThrow();
    if (failure === "tampered") { const bad = structuredClone(checkpoint); bad.payload.members[0].role = bad.payload.members[0].role === "admin" ? "member" : "admin"; await expect(reconcileRecovery(restored, bad, config.AUTH_SECRET, true)).rejects.toThrow("签名"); }
    if (failure === "stale") expect(() => verifyRecoveryCheckpoint(checkpoint, config.AUTH_SECRET, Date.now() + 6 * 60000)).toThrow("不新鲜");
    if (failure === "not-frozen") await expect(reconcileRecovery(restored, checkpoint, config.AUTH_SECRET, false)).rejects.toThrow("停止源应用");
    expect((await restored.query("SELECT count(*)::int AS count FROM sessions WHERE revoked_at IS NULL")).rows[0].count).toBe(state);
    checks.push({ name: "fail closed: " + failure, passed: true });
  });
  test("拒绝主库、错误来源与迁移版本不一致，不能误清开发库", async () => {
    for (const name of ["baby_plan_dev", "baby_plan_test", "postgres", "baby_plan_restore_;DROP DATABASE"]) expect(() => assertRestoreDatabase(name)).toThrow();
    await restored.query("UPDATE recovery_identity SET database_id=gen_random_uuid()");
    await expect(reconcileRecovery(restored, checkpoint, config.AUTH_SECRET, true)).rejects.toThrow("同一来源");
    await restored.query("UPDATE recovery_identity SET database_id=$1", [checkpoint.payload.databaseId]);
    await restored.query("UPDATE schema_migrations SET checksum='injected-mismatch' WHERE name='007_recovery_controls.sql'");
    await expect(reconcileRecovery(restored, checkpoint, config.AUTH_SECRET, true)).rejects.toThrow("迁移版本");
    await restored.query("UPDATE schema_migrations SET checksum=$1 WHERE name='007_recovery_controls.sql'", [checkpoint.payload.migrations.find((m) => m.name === "007_recovery_controls.sql")!.checksum]);
    checks.push({ name: "source lineage, migration and target database guard", passed: true });
  });
  test("核对事务中途失败整组回滚，不留下半份删除或撤销状态", async () => {
    await restored.query("CREATE FUNCTION fail_restore_control() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'B4 injected failure'; END $$");
    await restored.query("CREATE TRIGGER fail_restore_control BEFORE UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION fail_restore_control()");
    try { await expect(reconcileRecovery(restored, checkpoint, config.AUTH_SECRET, true)).rejects.toThrow("B4 injected failure"); }
    finally { await restored.query("DROP TRIGGER fail_restore_control ON memberships"); await restored.query("DROP FUNCTION fail_restore_control()"); }
    expect((await restored.query("SELECT deleted_at FROM plan_items WHERE id=$1", [item.id])).rows[0].deleted_at).toBeNull();
    checks.push({ name: "atomic reconciliation rollback", passed: true });
  });
  test("重新应用删除及到期清理，旧会话、旧邀请和被撤销成员不能复活", async () => {
    checkpoint = await capture(); reconciliation = await reconcileRecovery(restored, checkpoint, config.AUTH_SECRET, true);
    expect((await restored.query("SELECT deleted_at FROM plan_items WHERE id=$1", [item.id])).rows[0].deleted_at).not.toBeNull();
    for (const r of [expired, purgedEarly]) {
      expect((await restored.query("SELECT text,plan_snapshot,body_purged_at FROM activity_records WHERE id=$1", [r.id])).rows[0]).toMatchObject({ text: "", plan_snapshot: null, body_purged_at: expect.any(Date) });
      expect((await restored.query("SELECT 1 FROM record_revisions WHERE record_id=$1", [r.id])).rowCount).toBe(0);
      expect(JSON.stringify((await restored.query("SELECT result FROM idempotency_requests WHERE result->>'id'=$1", [r.id])).rows)).not.toContain("RECORD_SENTINEL");
    }
    expect((await restored.query("SELECT 1 FROM memberships WHERE id=$1 AND revoked_at IS NULL", [memberRelationId])).rowCount).toBe(0);
    expect((await restored.query("SELECT 1 FROM sessions WHERE revoked_at IS NULL")).rowCount).toBe(0);
    expect((await restored.query("SELECT 1 FROM invites WHERE accepted_by IS NULL AND revoked_at IS NULL")).rowCount).toBe(0);
    expect((await restored.query("SELECT disabled_at FROM users WHERE id=$1", [credentialUserId])).rows[0].disabled_at).not.toBeNull();
    checks.push({ name: "post-backup deletion, expiry, member and credential controls", passed: true });
  });
  test("备份后恢复的记录保持隔离并列出缺失版本；原有效记录与历史快照保持", async () => {
    expect(reconciliation?.dataGaps).toContain("activity_records:" + restoredAfter.id); expect(reconciliation?.openToUsers).toBe(false);
    expect((await restored.query("SELECT deleted_at FROM activity_records WHERE id=$1", [restoredAfter.id])).rows[0].deleted_at).not.toBeNull();
    expect((await restored.query("SELECT author_id,text,plan_snapshot->>'title' AS title FROM activity_records WHERE id=$1", [kept.id])).rows[0]).toEqual({ author_id: memberId, text: kept.text, title: item.title });
    expect((await restored.query("SELECT snapshot,body_purged_at FROM print_snapshots WHERE id=$1", [printId])).rows[0]).toMatchObject({ snapshot: {}, body_purged_at: expect.any(Date) });
    checks.push({ name: "post-backup restore gap never silently reopens content", passed: true });
  });
  test("私有 AI 内容归属不变，旧预览及租约暂停，唯一执行事实保留，重复核对不新增业务结果", async () => {
    expect((await restored.query("SELECT state,error_code,lease_token FROM b3_jobs WHERE id=$1", [jobId])).rows[0]).toEqual({ state: "failed", error_code: "RESTORE_REVIEW_REQUIRED", lease_token: null });
    expect((await restored.query("SELECT 1 FROM change_proposals WHERE state='pending'")).rowCount).toBe(0);
    expect((await restored.query("SELECT 1 FROM household_automation WHERE enabled")).rowCount).toBe(0);
    const count = (await restored.query("SELECT count(*)::int AS count FROM proposal_executions")).rows[0].count;
    await reconcileRecovery(restored, checkpoint, config.AUTH_SECRET, true);
    expect((await restored.query("SELECT count(*)::int AS count FROM proposal_executions")).rows[0].count).toBe(count);
    expect((await restored.query("SELECT owner_id FROM ai_messages WHERE conversation_id=$1", [privateConversation])).rows[0].owner_id).toBe(memberId);
    checks.push({ name: "AI ownership, task fence, execution deduplication and replay", passed: true });
  });
});
