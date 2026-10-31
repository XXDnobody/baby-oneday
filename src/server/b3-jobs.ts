import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { b3Limits, modelOutput, recipeRefinementOutput, type Job } from "../shared/b3";
import type { Actor } from "./auth";
import { transaction, query } from "./db";
import { withHousehold, type Access } from "./households";
import { AppError, ensure } from "./errors";
import { jobSelect } from "./job-store";
import { fetchWeather, readLocation, saveWeather } from "./weather";
import { generateAutomatic } from "./automatic-plans";
import { modelCall, serviceStatus, type RunningJob } from "./services";
import { prepareAi, finishAi } from "./ai";
import { prepareRecipeRefinement, finishRecipeRefinement } from "./recipe-refinement";

interface Claimed extends RunningJob { kind: Job["kind"]; conversationId: string | null; payload: { turn: number; date: string; reason: string; refineProposalId?: string }; attempts: number }
export async function getJob(raw: string | undefined, householdId: string, id: string) {
  return withHousehold(raw, householdId, async (db, actor) => {
    const job = (await db.query<Job>(jobSelect + "WHERE household_id=$1 AND id=$3 AND (kind<>'ai' OR owner_id=$2)", [householdId, actor.id, id])).rows[0]; ensure(job, "NOT_FOUND", "任务不存在。", 404);
    const usage = (await db.query('SELECT service,provider,model,region,test_service AS "testService",state,input_tokens AS "inputTokens",output_tokens AS "outputTokens",usage_known AS "usageKnown",cost,currency,duration_ms AS "durationMs",error_code AS "errorCode" FROM service_calls WHERE job_id=$1 AND (owner_id IS NULL OR owner_id=$2) ORDER BY started_at,id', [id, actor.id])).rows;
    return { ...job, usage };
  });
}
export async function listJobs(raw: string | undefined, householdId: string) { return withHousehold(raw, householdId, async (db) => (await db.query<Job>(jobSelect + "WHERE household_id=$1 AND kind<>'ai' ORDER BY created_at DESC,id DESC LIMIT 20", [householdId])).rows); }
export async function retryJob(raw: string | undefined, householdId: string, id: string) {
  return withHousehold(raw, householdId, async (db, actor, access) => {
    const job = (await db.query<{ kind: string; owner_id: string | null; conversation_id: string | null; payload: { turn: number } }>("SELECT kind,owner_id,conversation_id,payload FROM b3_jobs WHERE household_id=$1 AND id=$2 AND (kind<>'ai' OR owner_id=$3)", [householdId, id, actor.id])).rows[0]; ensure(job, "NOT_FOUND", "任务不存在。", 404);
    ensure(job.kind !== "automatic" || access.role === "admin", "FORBIDDEN", "自动计划任务由管理员重试。", 403);
    if (job.kind === "ai") {
      const active = await db.query("SELECT id FROM ai_conversations WHERE id=$1 AND owner_id=$2 AND revision=$3", [job.conversation_id, actor.id, job.payload.turn]); ensure(active.rowCount, "PROPOSAL_SUPERSEDED", "此任务已被新消息替代。", 409);
    }
    const r = await db.query("UPDATE b3_jobs SET state='queued',attempts=0,available_at=now(),error_code=NULL,error_message=NULL,finished_at=NULL WHERE household_id=$1 AND id=$2 AND state='failed' RETURNING id", [householdId, id]);
    ensure(r.rowCount, "REVISION_CONFLICT", "任务已完成或正在执行，不能重复领取。", 409); return { id };
  }, true);
}
export async function claimJob(jobId?: string): Promise<Claimed | null> {
  return transaction(async (db) => {
    await db.query("UPDATE service_calls c SET state='interrupted',error_code='WORKER_INTERRUPTED',finished_at=now() FROM b3_jobs j WHERE c.job_id=j.id AND c.state='started' AND j.state='running' AND j.lease_until<=clock_timestamp()");
    await db.query("UPDATE b3_jobs SET state='failed',error_code='JOB_ATTEMPTS_EXHAUSTED',error_message='任务多次中断，可检查后手动重试。',finished_at=now() WHERE state='running' AND lease_until<=clock_timestamp() AND attempts>=$1", [b3Limits.maxAttempts]);
    const leaseToken = randomUUID();
    return (await db.query<Claimed>(`UPDATE b3_jobs SET state='running',attempts=attempts+1,lease_token=$1,lease_until=clock_timestamp()+($2*interval '1 second') WHERE id=(SELECT id FROM b3_jobs WHERE ($3::uuid IS NULL OR id=$3) AND attempts<$4 AND ((state IN ('queued','retry') AND available_at<=clock_timestamp()) OR (state='running' AND lease_until<=clock_timestamp())) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,household_id AS "householdId",owner_id AS "ownerId",kind,conversation_id AS "conversationId",payload,attempts,lease_token AS "leaseToken"`, [leaseToken, b3Limits.leaseSeconds, jobId ?? null, b3Limits.maxAttempts])).rows[0] ?? null;
  });
}
export async function withRunningJob<T>(job: Claimed, fn: (db: PoolClient, actor: Actor, access: Access) => Promise<T>) {
  return transaction(async (db) => {
    const actor = (await db.query<Actor>('SELECT u.id,u.email,u.display_name AS "displayName",u.can_create_household AS "canCreateHousehold",\'\' AS "sessionId" FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.household_id=$1 AND m.revoked_at IS NULL AND u.disabled_at IS NULL AND (($2::uuid IS NOT NULL AND u.id=$2) OR ($2::uuid IS NULL AND m.role=\'admin\')) ORDER BY m.created_at,u.id LIMIT 1 FOR SHARE OF u', [job.householdId, job.ownerId])).rows[0];
    ensure(actor, "FORBIDDEN", "任务发起人已无执行权限。", 403);
    const household = (await db.query<Omit<Access, "role">>('SELECT id,revision,setup_complete AS "setupComplete",timezone FROM households WHERE id=$1 FOR UPDATE', [job.householdId])).rows[0];
    const member = (await db.query<{ role: Access["role"] }>("SELECT role FROM memberships WHERE household_id=$1 AND user_id=$2 AND revoked_at IS NULL", [job.householdId, actor.id])).rows[0];
    ensure(member && household && (job.kind !== "automatic" || member.role === "admin"), "FORBIDDEN", "任务执行权限已变化。", 403);
    const leased = await db.query("SELECT id FROM b3_jobs WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>clock_timestamp() FOR UPDATE", [job.id, job.leaseToken]);
    ensure(leased.rowCount, "JOB_LEASE_LOST", "任务已交由其他进程恢复。", 409);
    return fn(db, actor, { ...household, role: member.role });
  });
}
async function complete(db: PoolClient, job: Claimed, result: unknown, started: number, failure?: string) {
  await db.query("UPDATE b3_jobs SET state=$3,result=$4,error_code=$5,error_message=$6,duration_ms=$7,finished_at=now(),lease_until=NULL WHERE id=$1 AND lease_token=$2", [job.id, job.leaseToken, failure ? "failed" : "succeeded", JSON.stringify(result), failure ? "WEATHER_UNAVAILABLE" : null, failure ?? null, Date.now() - started]);
}
export async function runOneJob(jobId?: string) {
  const job = await claimJob(jobId); if (!job) return null; const started = Date.now();
  try {
    if (job.kind === "ai") {
      if (job.payload.refineProposalId) {
        const input = await withRunningJob(job, (db, actor, access) => prepareRecipeRefinement(db, actor, access, job.conversationId!, job.payload.turn, job.payload.refineProposalId!));
        const output = await modelCall(job, input.messages, (raw) => { const checked = recipeRefinementOutput.safeParse(raw); ensure(checked.success, "MODEL_OUTPUT_REJECTED", "菜谱补全格式不符合约定，日程未改动。", 422); return checked.data; }, 12000);
        await withRunningJob(job, async (db, actor, access) => { const result = await finishRecipeRefinement(db, actor, access, job.conversationId!, job.payload.turn, input, output); await complete(db, job, result, started); });
        return job.id;
      }
      const input = await withRunningJob(job, (db, actor, access) => prepareAi(db, actor, access, job.conversationId!, job.payload.turn));
      const output = await modelCall(job, input.messages, (raw) => { const result = modelOutput.safeParse(raw); ensure(result.success, "MODEL_OUTPUT_REJECTED", "模型返回了不支持的操作或字段，未保存正式改动。", 422); return result.data; });
      await withRunningJob(job, async (db, actor, access) => { const result = await finishAi(db, actor, access, job.conversationId!, job.payload.turn, input.dependencyDigest, output); await complete(db, job, result, started); });
    } else {
      const location = await withRunningJob(job, (db) => readLocation(db, job.householdId));
      ensure(job.kind !== "weather" || location, "WEATHER_LOCATION_REQUIRED", "请管理员先设置天气地点，可定位或选择城市。", 409);
      const weather = location && (job.kind === "weather" || serviceStatus().weather.ready) ? await fetchWeather(job, location) : null;
      await withRunningJob(job, async (db, actor, access) => {
        if (weather) await saveWeather(db, job.householdId, weather);
        const result = job.kind === "automatic" ? await generateAutomatic(db, actor, access, job.payload) : { products: weather!.products.map((p) => ({ product: p.product, state: p.state, reason: p.reason })) };
        await complete(db, job, result, started, job.kind === "weather" && weather!.products.some((p) => p.state !== "available") ? weather!.products.filter((p) => p.state !== "available").map((p) => p.reason).join("；") : undefined);
      });
    }
  } catch (error) {
    const e = error instanceof AppError ? error : new AppError("JOB_FAILED", "任务暂时失败，未保存正式改动。", 503);
    const retry = job.kind !== "ai" && e.status >= 500 && !["SERVICE_NOT_CONFIGURED", "INVALID_CONFIG"].includes(e.code) && job.attempts < b3Limits.maxAttempts;
    await query("UPDATE b3_jobs SET state=$3,error_code=$4,error_message=$5,duration_ms=$6,available_at=clock_timestamp()+interval '5 seconds',finished_at=CASE WHEN $3='failed' THEN now() ELSE NULL END,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND state='running'", [job.id, job.leaseToken, retry ? "retry" : "failed", e.code, e.message, Date.now() - started]);
  }
  return job.id;
}
export async function purgeWeatherBodies() { await query("UPDATE weather_snapshots SET data=NULL WHERE data IS NOT NULL AND purge_after<=clock_timestamp()"); }
