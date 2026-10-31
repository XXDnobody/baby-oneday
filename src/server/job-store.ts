import type { PoolClient } from "pg";
import type { Job } from "../shared/b3";
export const jobSelect = 'SELECT id,kind,state,attempts,result,error_code AS "errorCode",error_message AS "errorMessage",duration_ms AS "durationMs" FROM b3_jobs ';
export async function enqueueJob(db: PoolClient, householdId: string, kind: Job["kind"], businessKey: string, payload: unknown, ownerId?: string, conversationId?: string) {
  return (await db.query<{ id: string }>("INSERT INTO b3_jobs(household_id,kind,business_key,payload,owner_id,conversation_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(business_key) DO UPDATE SET business_key=excluded.business_key RETURNING id", [householdId, kind, businessKey, JSON.stringify(payload), ownerId ?? null, conversationId ?? null])).rows[0];
}
