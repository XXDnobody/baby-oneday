import { transaction } from "./db";

// Explicit maintenance only. Active/old records have no age-based deletion policy.
// Take the same household lock as restore, then recheck the actual deadline in SQL.
export async function purgeExpiredTrash() {
  return transaction(async (db) => {
    const households = await db.query<{ id: string }>(`SELECT h.id FROM households h WHERE
      EXISTS(SELECT 1 FROM activity_records r WHERE r.household_id=h.id AND r.deleted_at IS NOT NULL AND r.restore_until<=clock_timestamp() AND r.body_purged_at IS NULL)
      OR EXISTS(SELECT 1 FROM plan_items i WHERE i.household_id=h.id AND i.deleted_at IS NOT NULL AND i.restore_until<=clock_timestamp() AND i.body_purged_at IS NULL)
      ORDER BY h.id LIMIT 20 FOR UPDATE OF h SKIP LOCKED`);
    const counts = { records: 0, planItems: 0, printSnapshots: 0, cachedResults: 0, households: households.rowCount ?? 0 };
    for (const { id: householdId } of households.rows) {
      const records = await db.query<{ id: string }>("UPDATE activity_records SET text='',participation=NULL,interest=NULL,plan_snapshot=NULL,body_purged_at=clock_timestamp() WHERE household_id=$1 AND deleted_at IS NOT NULL AND restore_until<=clock_timestamp() AND body_purged_at IS NULL RETURNING id", [householdId]);
      const items = await db.query<{ id: string }>("UPDATE plan_items SET title='已过期删除的安排',notes='',caregiver_name=NULL,content_snapshot=NULL,body_purged_at=clock_timestamp() WHERE household_id=$1 AND deleted_at IS NOT NULL AND restore_until<=clock_timestamp() AND body_purged_at IS NULL RETURNING id", [householdId]);
      const recordIds = records.rows.map((r) => r.id), itemIds = items.rows.map((r) => r.id);
      await db.query("DELETE FROM record_revisions WHERE household_id=$1 AND record_id=ANY($2::uuid[])", [householdId, recordIds]);
      await db.query("DELETE FROM plan_item_versions WHERE household_id=$1 AND plan_item_id=ANY($2::uuid[])", [householdId, itemIds]);
      const prints = await db.query("UPDATE print_snapshots SET snapshot='{}'::jsonb,body_purged_at=clock_timestamp() WHERE household_id=$1 AND source_item_ids && $2::uuid[] AND body_purged_at IS NULL", [householdId, itemIds]);
      // Successful create/edit responses may contain old bodies. Keep only the permanent
      // request fingerprint and reference; replay still checks current visibility first.
      const cache = await db.query("UPDATE idempotency_requests SET result=jsonb_build_object('id',result->>'id','revision',result->'revision','purged',true) WHERE result->>'id'=ANY($1::text[])", [[...recordIds, ...itemIds]]);
      counts.records += records.rowCount ?? 0; counts.planItems += items.rowCount ?? 0; counts.printSnapshots += prints.rowCount ?? 0; counts.cachedResults += cache.rowCount ?? 0;
    }
    return counts;
  });
}
