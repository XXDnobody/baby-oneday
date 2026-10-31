import type { NextRequest } from "next/server";
import { z } from "zod";
import * as c from "../shared/b3";
import { date, id } from "../shared/contracts";
import { idempotent, localDate, withHousehold } from "./households";
import { serviceStatus } from "./services";
import { weatherLocation, getWeather, readLocation } from "./weather";
import { enqueueJob } from "./job-store";
import { automation, requestAutomatic } from "./automatic-plans";
import * as ai from "./ai";
import { getJob, listJobs, retryJob } from "./b3-jobs";
import { ensure } from "./errors";

export async function b3Route(req: NextRequest, raw: string | undefined, householdId: string, path: string[], key: string | undefined, body: () => Promise<unknown>): Promise<{ data: unknown; status?: number } | null> {
  const [resource, objectId, action] = path, method = req.method;
  if (resource === "services" && path.length === 1 && method === "GET") return { data: await withHousehold(raw, householdId, async () => serviceStatus()) };
  if (resource === "weather-location" && path.length === 1) {
    if (method === "GET") return { data: await weatherLocation(raw, householdId) };
    if (method === "PUT") return { data: await weatherLocation(raw, householdId, c.locationInput.parse(await body()), key) };
  }
  if (resource === "weather" && path.length === 1) {
    if (method === "GET") {
      const p = req.nextUrl.searchParams;
      return { data: await getWeather(raw, householdId, c.weatherInput.parse({ date: p.get("date") ?? localDate(), startTime: p.get("startTime") ?? "09:00", endTime: p.get("endTime") ?? "10:00", scene: p.get("scene") ?? "outdoor" })) };
    }
    if (method === "POST") {
      const input = c.weatherInput.parse(await body());
      const data = await withHousehold(raw, householdId, async (db, actor) => {
        ensure(await readLocation(db, householdId), "WEATHER_LOCATION_REQUIRED", "请管理员先设置天气地点，可定位或选择城市。", 409);
        return idempotent(db, actor, householdId + ":weather", key, input, () => enqueueJob(db, householdId, "weather", householdId + ":weather:" + actor.id + ":" + key, input));
      }, true);
      return { data: { jobId: data.id }, status: 202 };
    }
  }
  if (resource === "automation" && path.length === 1) {
    if (method === "GET") return { data: await automation(raw, householdId) };
    if (method === "PUT") return { data: await automation(raw, householdId, c.automationInput.parse(await body()), key) };
  }
  if (resource === "automatic-plans" && path.length === 1 && method === "POST") { const input = z.object({ date }).strict().parse(await body()); const data = await requestAutomatic(raw, householdId, input.date, key); return { data: { jobId: data.id }, status: 202 }; }
  if (resource === "jobs") {
    if (path.length === 1 && method === "GET") return { data: await listJobs(raw, householdId) };
    if (path.length === 2 && method === "GET") return { data: await getJob(raw, householdId, id.parse(objectId)) };
    if (path.length === 3 && action === "retry" && method === "POST") { z.object({}).strict().parse(await body()); return { data: await retryJob(raw, householdId, id.parse(objectId)), status: 202 }; }
  }
  if (resource === "ai-conversations") {
    if (path.length === 1 && method === "GET") return { data: await ai.conversations(raw, householdId) };
    if (path.length === 1 && method === "POST") return { data: await ai.conversations(raw, householdId, c.conversationInput.parse(await body()), key), status: 201 };
    if (path.length === 2 && method === "GET") return { data: await ai.conversation(raw, householdId, id.parse(objectId)) };
    if (path.length === 3 && action === "messages" && method === "POST") return { data: await ai.sendMessage(raw, householdId, id.parse(objectId), c.messageInput.parse(await body()), key), status: 202 };
  }
  if (resource === "ai-proposals" && path.length === 3 && action === "confirm" && method === "POST") { const input = c.confirmInput.parse(await body()); return { data: await ai.confirmProposal(raw, householdId, id.parse(objectId), input.turn, key) }; }
  return null;
}
