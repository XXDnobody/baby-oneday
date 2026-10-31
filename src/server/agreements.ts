import type { PoolClient } from "pg";
import type { z } from "zod";
import type { agreementsInput, Agreements } from "../shared/b2";
import { admin, expected, idempotent, withHousehold } from "./households";
import { audit } from "./content";
export async function readAgreements(db: PoolClient, householdId: string): Promise<Agreements> {
  return (await db.query<Agreements>('SELECT a.revision,a.items,u.display_name AS "confirmedBy",a.updated_at::text AS "confirmedAt" FROM household_agreements a JOIN users u ON u.id=a.updated_by WHERE a.household_id=$1', [householdId])).rows[0] ?? { revision: 1, items: [], confirmedBy: null, confirmedAt: null };
}
export async function agreements(raw: string | undefined, householdId: string, input?: z.infer<typeof agreementsInput>, key?: string) {
  return withHousehold(raw, householdId, async (db, actor, access) => {
    if (!input) return readAgreements(db, householdId);
    admin(access);
    return idempotent(db, actor, householdId + ":agreements", key, input, async () => {
      const old = await readAgreements(db, householdId); expected(old.revision, input.expectedRevision);
      await db.query("INSERT INTO household_agreements(household_id,items,updated_by,revision) VALUES ($1,$2,$3,2) ON CONFLICT(household_id) DO UPDATE SET items=excluded.items,updated_by=excluded.updated_by,revision=household_agreements.revision+1,updated_at=now()", [householdId, JSON.stringify(input.items), actor.id]);
      await audit(db, householdId, actor, "agreements", householdId, "save", old.revision + 1); return readAgreements(db, householdId);
    });
  }, !!input);
}
