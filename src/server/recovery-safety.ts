import { createHmac, timingSafeEqual } from "node:crypto";
import type { Client } from "pg";
import { z } from "zod";

type Db = Pick<Client, "query">;
const uuid = z.uuid(), stamp = z.iso.datetime({ offset: true }), nullableStamp = stamp.nullable();
const objectSchema = z.object({ kind: z.enum(["plan-item", "record"]), id: uuid, householdId: uuid, childId: uuid, revision: z.number().int(), deletedAt: nullableStamp, restoreUntil: nullableStamp, purgedAt: nullableStamp, deletedBy: uuid.nullable(), authorId: uuid.nullable() }).strict();
const checkpointSchema = z.object({
  version: z.literal(1), databaseId: uuid, capturedAt: stamp,
  migrations: z.array(z.object({ name: z.string(), checksum: z.string() }).strict()),
  highWatermark: z.string(),
  events: z.array(z.object({ id: z.string(), resource_type: z.string(), resource_id: uuid, household_id: uuid.nullable(), before_state: z.record(z.string(), z.unknown()), after_state: z.record(z.string(), z.unknown()), created_at: stamp }).strict()),
  users: z.array(z.object({ id: uuid, credentialVersion: z.number().int(), disabledAt: nullableStamp, canCreateHousehold: z.boolean() }).strict()),
  members: z.array(z.object({ id: uuid, householdId: uuid, userId: uuid, role: z.enum(["admin", "member"]), revision: z.number().int(), revokedAt: nullableStamp }).strict()),
  objects: z.array(objectSchema),
  guards: z.array(z.object({ householdId: uuid, childId: uuid, date: z.string(), time: z.string() }).strict()),
  heads: z.array(z.object({ table: z.string(), id: z.string(), digest: z.string() }).strict()),
}).strict();
export type RecoveryCheckpoint = z.infer<typeof checkpointSchema>;
export interface SignedCheckpoint { payload: RecoveryCheckpoint; signature: string }
const headTables = { households: "id", daily_plans: "id", plan_items: "id", activity_records: "id", content_items: "id", children: "id", recent_preferences: "id", ai_conversations: "id", ai_messages: "id", change_proposals: "id", proposal_executions: "proposal_id", b3_jobs: "id", household_templates: "household_id::text || ':' || kind", pantry_snapshots: "household_id", content_versions: "content_id::text || ':' || version", plan_item_versions: "plan_item_id::text || ':' || revision", record_revisions: "record_id::text || ':' || revision" } as const;

async function heads(db: Db) {
  const rows: RecoveryCheckpoint["heads"] = [];
  for (const [table, id] of Object.entries(headTables)) {
    const result = await db.query<{ id: string; digest: string }>(`SELECT (${id})::text AS id,md5(row_to_json(t)::text) AS digest FROM ${table} t ORDER BY (${id})`);
    rows.push(...result.rows.map((row) => ({ table, ...row })));
  }
  return rows;
}

// Caller holds a repeatable-read snapshot (and stops writes before the final export).
// No email, token, password hash, plan/record body, or AI text enters this checkpoint.
export async function captureRecoveryCheckpoint(db: Db, secret: string): Promise<SignedCheckpoint> {
  const identity = (await db.query<{ id: string; at: Date }>("SELECT database_id AS id,clock_timestamp() AS at FROM recovery_identity")).rows[0];
  if (!identity) throw new Error("缺少恢复来源标识");
  const migrations = (await db.query("SELECT name,checksum FROM schema_migrations ORDER BY name")).rows;
  const events = (await db.query("SELECT id::text,resource_type,resource_id,household_id,before_state,after_state,created_at FROM recovery_events ORDER BY recovery_events.id")).rows;
  const users = (await db.query('SELECT id,credential_version AS "credentialVersion",disabled_at AS "disabledAt",can_create_household AS "canCreateHousehold" FROM users ORDER BY id')).rows;
  const members = (await db.query('SELECT id,household_id AS "householdId",user_id AS "userId",role,revision,revoked_at AS "revokedAt" FROM memberships ORDER BY id')).rows;
  const objects = (await db.query(`SELECT 'plan-item' AS kind,id,household_id AS "householdId",child_id AS "childId",revision,deleted_at AS "deletedAt",restore_until AS "restoreUntil",body_purged_at AS "purgedAt",deleted_by AS "deletedBy",NULL::uuid AS "authorId" FROM plan_items
    UNION ALL SELECT 'record',id,household_id,child_id,revision,deleted_at,restore_until,body_purged_at,deleted_by,author_id FROM activity_records ORDER BY kind,id`)).rows;
  const guards = (await db.query('SELECT household_id AS "householdId",child_id AS "childId",plan_date::text AS date,time FROM plan_slot_guards ORDER BY household_id,child_id,plan_date,time')).rows;
  const payload = checkpointSchema.parse(JSON.parse(JSON.stringify({ version: 1, databaseId: identity.id, capturedAt: identity.at, migrations, highWatermark: events.at(-1)?.id ?? "0", events, users, members, objects, guards, heads: await heads(db) })));
  return { payload, signature: createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex") };
}

export function verifyRecoveryCheckpoint(value: unknown, secret: string, now = Date.now()): RecoveryCheckpoint {
  const signed = z.object({ payload: checkpointSchema, signature: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(value);
  const actual = Buffer.from(signed.signature, "hex");
  const expected = createHmac("sha256", secret).update(JSON.stringify(signed.payload)).digest();
  if (!timingSafeEqual(actual, expected)) throw new Error("恢复核对资料签名不匹配");
  const age = now - Date.parse(signed.payload.capturedAt);
  if (age < -5000 || age > 5 * 60000) throw new Error("核对资料不新鲜；停止源库写入后重新导出，无法核对时保持隔离");
  return signed.payload;
}

export function assertRestoreDatabase(name: string) {
  if (!/^baby_plan_restore_[a-z0-9_]+$/.test(name)) throw new Error("恢复核对只允许独立 baby_plan_restore_* 副本，禁止开发库和主测试库");
}

export async function reconcileRecovery(db: Db, value: unknown, secret: string, sourceFrozen: boolean) {
  if (!sourceFrozen) throw new Error("必须先停止源应用与 worker，确认核对资料覆盖最后写入；副本保持隔离");
  const checkpoint = verifyRecoveryCheckpoint(value, secret);
  const name = (await db.query<{ name: string }>("SELECT current_database() AS name")).rows[0].name;
  assertRestoreDatabase(name);
  const identity = (await db.query<{ id: string }>("SELECT database_id AS id FROM recovery_identity")).rows[0];
  if (identity?.id !== checkpoint.databaseId) throw new Error("备份和核对资料不属于同一来源，保持隔离");
  const migrations = (await db.query("SELECT name,checksum FROM schema_migrations ORDER BY name")).rows;
  if (JSON.stringify(migrations) !== JSON.stringify(checkpoint.migrations)) throw new Error("迁移版本不一致，保持隔离");
  const before = await heads(db);
  const current = new Map(checkpoint.heads.map((h) => [h.table + ":" + h.id, h.digest]));
  const restored = new Map(before.map((h) => [h.table + ":" + h.id, h.digest]));
  const deleted = new Set(checkpoint.objects.filter((o) => o.deletedAt).map((o) => (o.kind === "record" ? "activity_records:" : "plan_items:") + o.id));
  const deletedVersions = checkpoint.objects.filter((o) => o.deletedAt).map((o) => (o.kind === "record" ? "record_revisions:" : "plan_item_versions:") + o.id + ":");
  const dataGaps = [...new Set([...current.keys(), ...restored.keys()])].filter((key) => current.get(key) !== restored.get(key) && !deleted.has(key) && !deletedVersions.some((prefix) => key.startsWith(prefix)));
  const counts = { tombstones: 0, revokedMembers: 0, credentialHolds: 0, sessions: 0, heldJobs: 0, expiredRecords: 0, expiredItems: 0, printBodies: 0 };
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL lock_timeout='5s'");
    for (const object of checkpoint.objects.filter((o) => o.deletedAt)) {
      const table = object.kind === "record" ? "activity_records" : "plan_items";
      const result = await db.query(`UPDATE ${table} SET deleted_at=$2,restore_until=$3,deleted_by=(SELECT id FROM users WHERE id=$4),revision=GREATEST(revision,$5),body_purged_at=COALESCE($6::timestamptz,body_purged_at) WHERE id=$1 AND household_id=$7`, [object.id, object.deletedAt, object.restoreUntil, object.deletedBy, object.revision, object.purgedAt, object.householdId]);
      counts.tombstones += result.rowCount ?? 0;
    }
    const known = checkpoint.members.map((m) => m.id);
    counts.revokedMembers += (await db.query("UPDATE memberships SET revoked_at=COALESCE(revoked_at,clock_timestamp()),revision=revision+1 WHERE NOT(id=ANY($1::uuid[])) AND revoked_at IS NULL", [known])).rowCount ?? 0;
    for (const member of checkpoint.members) {
      const changed = await db.query("UPDATE memberships SET revoked_at=COALESCE(revoked_at,$2),role=CASE WHEN role='member' OR $3='member' THEN 'member' ELSE role END,revision=GREATEST(revision,$4) WHERE id=$1 AND household_id=$5 AND user_id=$6", [member.id, member.revokedAt, member.role, member.revision, member.householdId, member.userId]);
      if (member.revokedAt) counts.revokedMembers += changed.rowCount ?? 0;
    }
    // Changed passwords are never rolled back to usable old credentials. An operator
    // must resolve the account through the verified recovery flow before release.
    for (const user of checkpoint.users) {
      counts.credentialHolds += (await db.query("UPDATE users SET disabled_at=COALESCE(disabled_at,$2,clock_timestamp()),can_create_household=false WHERE id=$1 AND (credential_version<>$3 OR $2::timestamptz IS NOT NULL)", [user.id, user.disabledAt, user.credentialVersion])).rowCount ?? 0;
    }
    await db.query("UPDATE users SET disabled_at=COALESCE(disabled_at,clock_timestamp()) WHERE NOT(id=ANY($1::uuid[]))", [checkpoint.users.map((u) => u.id)]);
    counts.sessions = (await db.query("UPDATE sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp())")).rowCount ?? 0;
    await db.query("UPDATE invites SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE accepted_by IS NULL");
    await db.query("UPDATE email_challenges SET consumed_at=COALESCE(consumed_at,clock_timestamp())");
    await db.query("UPDATE password_resets SET consumed_at=COALESCE(consumed_at,clock_timestamp())");
    await db.query("UPDATE bootstrap_grants SET token_hash=replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','') WHERE consumed_by IS NULL");
    await db.query("UPDATE users SET can_create_household=false");
    await db.query("UPDATE change_proposals SET state='superseded' WHERE state='pending'");
    counts.heldJobs = (await db.query("UPDATE b3_jobs SET state='failed',lease_token=NULL,lease_until=NULL,error_code='RESTORE_REVIEW_REQUIRED',error_message='恢复后须核对来源和执行事实，再由有权成员显式重试。',finished_at=clock_timestamp() WHERE state IN ('queued','running','retry')")).rowCount ?? 0;
    await db.query("UPDATE household_automation SET enabled=false,revision=revision+1 WHERE enabled");
    await db.query("UPDATE weather_snapshots SET data=NULL WHERE purge_after<=clock_timestamp()");
    for (const guard of checkpoint.guards) await db.query("INSERT INTO plan_slot_guards(household_id,child_id,plan_date,time) SELECT $1,$2,$3,$4 WHERE EXISTS(SELECT 1 FROM children WHERE household_id=$1 AND id=$2) ON CONFLICT DO NOTHING", [guard.householdId, guard.childId, guard.date, guard.time]);
    const records = (await db.query<{ id: string }>("UPDATE activity_records SET text='',participation=NULL,interest=NULL,plan_snapshot=NULL,body_purged_at=clock_timestamp() WHERE deleted_at IS NOT NULL AND (restore_until<=clock_timestamp() OR body_purged_at IS NOT NULL) RETURNING id")).rows.map((r) => r.id);
    const items = (await db.query<{ id: string }>("UPDATE plan_items SET title='已过期删除的安排',notes='',caregiver_name=NULL,content_snapshot=NULL,ai_suggestion=NULL,body_purged_at=clock_timestamp() WHERE deleted_at IS NOT NULL AND (restore_until<=clock_timestamp() OR body_purged_at IS NOT NULL) RETURNING id")).rows.map((r) => r.id);
    counts.expiredRecords = records.length; counts.expiredItems = items.length;
    await db.query("DELETE FROM record_revisions WHERE record_id=ANY($1::uuid[])", [records]);
    await db.query("DELETE FROM plan_item_versions WHERE plan_item_id=ANY($1::uuid[])", [items]);
    counts.printBodies = (await db.query("UPDATE print_snapshots SET snapshot='{}',body_purged_at=clock_timestamp() WHERE source_item_ids && $1::uuid[]", [items])).rowCount ?? 0;
    await db.query("UPDATE idempotency_requests SET result=jsonb_build_object('id',result->>'id','revision',result->'revision','purged',true) WHERE result->>'id'=ANY($1::text[])", [[...records, ...items]]);
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  return { checkedAt: new Date().toISOString(), sourceCapturedAt: checkpoint.capturedAt, sourceHighWatermark: checkpoint.highWatermark, reviewedControlEvents: checkpoint.events.length, database: name, counts, dataGaps, sourceFrozenConfirmed: true, oldSessionsInvalidated: true, pendingProposalsSuperseded: true, automaticExecutionHeld: true, openToUsers: false, productionRecoveryVerified: false, nextStep: "副本继续隔离。逐项处理 dataGaps、凭证停用和未完成任务；核实当前授权、数据丢失窗口、生产容量及恢复指标，再单独决定开放。" };
}
