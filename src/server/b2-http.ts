import type { NextRequest } from "next/server";
import { z } from "zod";
import * as c from "../shared/b2";
import { date, id } from "../shared/contracts";
import * as content from "./content";
import * as records from "./records";
import * as trash from "./trash";
import * as printing from "./printing";
import { localDate } from "./households";
import { agreements } from "./agreements";

export async function b2Route(req: NextRequest, raw: string | undefined, householdId: string, path: string[], key: string | undefined, body: () => Promise<unknown>): Promise<{ data: unknown; status?: number } | null> {
  const [resource, objectId, action, version] = path;
  const method = req.method; const params = req.nextUrl.searchParams;
  const selectedDate = () => date.parse(params.get("date") ?? localDate());
  const cursor = () => params.get("cursor") ? id.parse(params.get("cursor")) : undefined;
  const range = () => c.rangeInput.parse({ from: params.get("from") ?? localDate(), to: params.get("to") ?? localDate() });
  if (resource === "agreements" && path.length === 1) {
    if (method === "GET") return { data: await agreements(raw, householdId) };
    if (method === "PUT") return { data: await agreements(raw, householdId, c.agreementsInput.parse(await body()), key) };
  }
  if (resource === "pantry" && path.length === 1) {
    if (method === "GET") return { data: await content.pantry(raw, householdId) };
    if (method === "PUT") return { data: await content.pantry(raw, householdId, c.pantryInput.parse(await body()), key) };
  }
  if (resource === "preferences") {
    if (path.length === 1 && method === "GET") return { data: await content.preferences(raw, householdId, selectedDate()) };
    if (path.length === 1 && method === "POST") return { data: await content.savePreference(raw, householdId, c.preferenceInput.parse(await body()), key), status: 201 };
    if (path.length === 2 && (method === "PATCH" || method === "DELETE")) return { data: await content.savePreference(raw, householdId, method === "PATCH" ? c.preferenceEdit.parse(await body()) : c.expectedInput.parse(await body()), key, id.parse(objectId), method === "DELETE") };
  }
  if (resource === "content-settings" && path.length === 1) {
    if (method === "GET") return { data: await content.contentSettings(raw, householdId) };
    if (method === "PUT") return { data: await content.contentSettings(raw, householdId, c.contentSettingsInput.parse(await body()), key) };
  }
  if (resource === "content-imports" && path.length === 1) {
    if (method === "GET") return { data: await content.importResults(raw, householdId) };
    if (method === "POST") return { data: await content.importContent(raw, householdId, c.importInput.parse(await body()), key) };
  }
  if (resource === "content") {
    if (path.length === 1 && method === "GET") return { data: await content.listContent(raw, householdId, selectedDate(), params.get("kind") ? z.enum(["recipe", "activity"]).parse(params.get("kind")) : undefined, cursor(), params.get("scene") ? c.scene.parse(params.get("scene")) : "either") };
    if (path.length === 1 && method === "POST") return { data: await content.saveContent(raw, householdId, c.contentFields.parse(await body()), key), status: 201 };
    if (path.length === 2 && method === "PATCH") { const v = c.contentEdit.parse(await body()); return { data: await content.saveContent(raw, householdId, v.content, key, id.parse(objectId), v.expectedRevision) }; }
    if (path.length === 2 && method === "GET") return { data: await content.getContent(raw, householdId, id.parse(objectId)) };
    if (path.length === 4 && action === "versions" && method === "GET") return { data: await content.getContent(raw, householdId, id.parse(objectId), z.coerce.number().int().positive().parse(version)) };
  }
  if (resource === "calendar" && path.length === 1 && method === "GET") return { data: await records.calendar(raw, householdId, range()) };
  if (resource === "records") {
    if (path.length === 1 && method === "GET") return { data: await records.listRecords(raw, householdId, range(), cursor()) };
    if (path.length === 1 && method === "POST") return { data: await records.createRecord(raw, householdId, c.recordInput.parse(await body()), key), status: 201 };
    if (path.length === 2) {
      if (method === "GET") return { data: await records.getRecord(raw, householdId, id.parse(objectId)) };
      if (method === "PATCH") return { data: await records.editRecord(raw, householdId, id.parse(objectId), c.recordEdit.parse(await body()), key) };
      if (method === "DELETE") return { data: await trash.remove(raw, householdId, id.parse(objectId), "record", c.expectedInput.parse(await body()), key) };
    }
    if (path.length === 3 && action === "revisions" && method === "GET") return { data: await records.getRecord(raw, householdId, id.parse(objectId), true) };
    if (path.length === 3 && action === "restore" && method === "POST") return { data: await trash.restore(raw, householdId, id.parse(objectId), "record", c.expectedInput.parse(await body()), key) };
  }
  if (resource === "plan-items") {
    if (path.length === 2 && method === "DELETE") return { data: await trash.remove(raw, householdId, id.parse(objectId), "plan-item", c.expectedInput.parse(await body()), key) };
    if (path.length === 3 && method === "POST") {
      if (action === "cancel" || action === "resume") return { data: await trash.cancelItem(raw, householdId, id.parse(objectId), c.expectedInput.parse(await body()), key, action === "resume") };
      if (action === "restore-preview") return { data: await trash.restorePreview(raw, householdId, id.parse(objectId), c.expectedInput.parse(await body())) };
      if (action === "restore") return { data: await trash.restore(raw, householdId, id.parse(objectId), "plan-item", c.restoreInput.parse(await body()), key) };
    }
  }
  if (resource === "trash" && path.length === 1 && method === "GET") return { data: await trash.trash(raw, householdId, cursor()) };
  if (resource === "print-snapshots") {
    if (path.length === 1 && method === "POST") return { data: await printing.createPrint(raw, householdId, c.printInput.parse(await body()), key), status: 201 };
    if (path.length === 2 && method === "GET") return { data: await printing.getPrint(raw, householdId, id.parse(objectId)) };
  }
  return null;
}
