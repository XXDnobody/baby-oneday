import type { PoolClient } from "pg";
import type { z } from "zod";
import { z as v } from "zod";
import type { WeatherLocation, WeatherPoint, WeatherProduct, WeatherView, WeatherInput } from "../shared/b3";
import { b3Limits, locationInput } from "../shared/b3";
import { admin, expected, idempotent, publish, withHousehold } from "./households";
import { AppError, ensure } from "./errors";
import { serviceConfig, serviceStatus, weatherCall, type RunningJob } from "./services";
import { instant } from "./b3-time";

export async function readLocation(db: PoolClient, householdId: string): Promise<WeatherLocation | null> {
  return (await db.query<WeatherLocation>('SELECT label,latitude::float8 AS latitude,longitude::float8 AS longitude,provenance,revision,confirmed_at::text AS "confirmedAt" FROM weather_locations WHERE household_id=$1', [householdId])).rows[0] ?? null;
}
export async function weatherLocation(raw: string | undefined, householdId: string, input?: z.infer<typeof locationInput>, key?: string) {
  return withHousehold(raw, householdId, async (db, actor, access) => {
    if (!input) return readLocation(db, householdId);
    admin(access);
    return idempotent(db, actor, householdId + ":weather-location", key, input, async () => {
      const old = await readLocation(db, householdId); expected(old?.revision ?? 1, input.expectedRevision);
      const latitude = Math.round(input.latitude * 100) / 100, longitude = Math.round(input.longitude * 100) / 100;
      await db.query("INSERT INTO weather_locations(household_id,label,latitude,longitude,provenance,confirmed_by,revision) VALUES ($1,$2,$3,$4,$5,$6,2) ON CONFLICT(household_id) DO UPDATE SET label=excluded.label,latitude=excluded.latitude,longitude=excluded.longitude,provenance=excluded.provenance,confirmed_by=excluded.confirmed_by,confirmed_at=now(),revision=weather_locations.revision+1", [householdId, input.label, latitude, longitude, input.provenance, actor.id]);
      await db.query("UPDATE households SET revision=revision+1 WHERE id=$1", [householdId]);
      await publish(db, householdId, "weather-location", householdId, (old?.revision ?? 1) + 1);
      return readLocation(db, householdId);
    });
  }, !!input);
}
const quantity = (unit: string) => v.object({ value: v.number().finite(), unit: v.literal(unit) });
const pointFields = { condition: v.object({ text: v.string().max(100) }), temperature: quantity("°C"), feelsLike: quantity("°C"), wind: v.object({ speed: quantity("m/s") }), precipitation: v.object({ amount: quantity("mm"), probability: v.number().min(0).max(1).optional() }) };
const metadata = v.object({ attributions: v.array(v.string().max(1000)).max(30) });
const currentSchema = v.object({ ...pointFields, metadata });
// QWeather's ISO 8601 forecast times may omit seconds (e.g. 2026-10-31T18:00Z).
const forecastTime = v.union([v.iso.datetime({ offset: true, precision: -1 }), v.iso.datetime({ offset: true })]);
const hourlySchema = v.object({ metadata, hours: v.array(v.object({ ...pointFields, forecastTime })).min(1).max(240) });
function normalize(p: z.infer<typeof currentSchema> | z.infer<typeof hourlySchema>["hours"][number], at: string): WeatherPoint {
  return { at, temperature: p.temperature.value, feelsLike: p.feelsLike.value, text: p.condition.text, windSpeed: p.wind.speed.value, precipitation: p.precipitation.amount.value, probability: p.precipitation.probability ?? null };
}
export interface WeatherFetch { location: WeatherLocation; products: Array<{ product: "current" | "hourly"; state: string; reason: string; data: WeatherPoint[] | null; attributions: string[]; fetchedAt: Date }> }
export async function fetchWeather(job: RunningJob, location: WeatherLocation): Promise<WeatherFetch> {
  const products: WeatherFetch["products"] = [];
  for (const product of ["current", "hourly"] as const) {
    try {
      const response = await weatherCall(job, product, location.latitude, location.longitude, (raw) => product === "current" ? currentSchema.parse(raw) : hourlySchema.parse(raw));
      const fetchedAt = new Date(); const data = "hours" in response ? response.hours.map((p) => normalize(p, new Date(p.forecastTime).toISOString())).sort((a, b) => a.at.localeCompare(b.at)) : [normalize(response, fetchedAt.toISOString())];
      products.push({ product, state: "available", reason: "", data, attributions: response.metadata.attributions, fetchedAt });
    } catch (e) {
      const error = e instanceof AppError ? e : new AppError("SERVICE_UNAVAILABLE", "天气服务暂时不可用。", 503);
      products.push({ product, state: error.code === "SERVICE_NOT_CONFIGURED" ? "not_configured" : error.code === "SERVICE_TIMEOUT" ? "timeout" : ["SERVICE_RATE_LIMITED", "SERVICE_QUOTA_EXCEEDED"].includes(error.code) ? "limited" : "unavailable", reason: error.message, data: null, attributions: [], fetchedAt: new Date() });
    }
  }
  return { location, products };
}
export async function saveWeather(db: PoolClient, householdId: string, result: WeatherFetch) {
  const location = await readLocation(db, householdId);
  ensure(location?.revision === result.location.revision, "REVISION_CONFLICT", "天气地点已变化，请按新地点重新刷新。", 409);
  for (const p of result.products) {
    const fresh = p.product === "current" ? b3Limits.currentMinutes : b3Limits.hourlyMinutes;
    await db.query("INSERT INTO weather_snapshots(household_id,location_revision,location,provider,product,state,reason,valid_from,valid_to,fetched_at,stale_after,purge_after,data,attributions,source_url,test_service) VALUES ($1,$2,$3,'qweather',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)", [householdId, location.revision, JSON.stringify(location), p.product, p.state, p.reason, p.data?.[0]?.at ?? null, p.data?.length ? new Date(Date.parse(p.data.at(-1)!.at) + (p.product === "hourly" ? 3600000 : fresh * 60000)) : null, p.fetchedAt, new Date(+p.fetchedAt + fresh * 60000), new Date(+p.fetchedAt + b3Limits.weatherRetentionHours * 3600000), p.data ? JSON.stringify(p.data) : null, JSON.stringify(p.attributions), p.product === "current" ? "https://dev.qweather.com/docs/api/weather/weather-current/" : "https://dev.qweather.com/docs/api/weather/weather-hourly-forecast/", serviceConfig().weatherTest]);
  }
  await publish(db, householdId, "weather", householdId, location.revision);
}
export async function readWeather(db: PoolClient, householdId: string, input: WeatherInput, timezone: string, now = new Date()): Promise<WeatherView> {
  const location = await readLocation(db, householdId);
  const products = location ? (await db.query<WeatherProduct>(`SELECT DISTINCT ON (product) id,product,state,reason,provider,provider_time::text AS "providerTime",fetched_at::text AS "fetchedAt",valid_from::text AS "validFrom",valid_to::text AS "validTo",stale_after::text AS "staleAfter",CASE WHEN purge_after>clock_timestamp() THEN data ELSE NULL END AS data,attributions,source_url AS "sourceUrl",test_service AS "testService" FROM weather_snapshots WHERE household_id=$1 AND location_revision=$2 ORDER BY product,fetched_at DESC,id DESC`, [householdId, location.revision])).rows : [];
  for (const p of products) if (p.state === "available" && (!p.data || +new Date(p.staleAfter) <= +now)) { p.state = "stale"; p.reason = "天气数据已过时，请刷新后再参考穿搭。"; }
  const current = products.find((p) => p.product === "current") ?? null, hourly = products.find((p) => p.product === "hourly") ?? null;
  const view: WeatherView = { location, request: input, current, hourly, state: "missing", reason: !location ? "请管理员设置天气地点，可使用当前位置或直接选择城市。" : serviceStatus().weather.ready ? "尚未取得此地点的天气，请刷新。" : "天气服务尚未配置，请家人核对现场天气。", hours: [], outfit: null };
  if (!hourly || hourly.state !== "available") { if (hourly) { view.state = hourly.state; view.reason = hourly.reason; } return view; }
  const from = +instant(input.date, input.startTime, timezone), to = +instant(input.date, input.endTime, timezone);
  const hours = hourly.data!.filter((p) => Date.parse(p.at) < to && Date.parse(p.at) + 3600000 > from);
  // Require contiguous coverage of the entire activity window, not merely one matching hour.
  let covered = from;
  for (const p of hours) { const at = Date.parse(p.at); if (at > covered) break; covered = Math.max(covered, at + 3600000); }
  if (!hours.length || covered < to) { view.reason = "逐小时预报未覆盖所选日期的完整活动时段；不使用当前天气代替。"; return view; }
  view.hours = hours; view.state = "available"; view.reason = "按所选活动时段的逐小时预报提供参考。";
  const min = Math.min(...hours.map((p) => p.feelsLike)), max = Math.max(...hours.map((p) => p.temperature));
  const windy = hours.some((p) => p.windSpeed >= 5), wet = hours.some((p) => p.precipitation > 0 || (p.probability ?? 0) >= 0.5);
  view.outfit = { ruleVersion: "outfit-b3-v1", categories: min < 10 ? ["保暖内层", "长裤", "可增减外套"] : min < 20 ? ["长袖内层", "长裤", "便于穿脱的外层"] : ["透气上衣", "便于活动的裤装"], basis: ["本地通用衣物类别规则，尚未做专业审核，实际增减由家人核对。", "体感最低 " + min.toFixed(1) + "°C，气温最高 " + max.toFixed(1) + "°C；<10°C 加保暖层，10–20°C 备外层，≥20°C 以透气衣物为参考。", "天气依据：" + hourly.id + "；取数 " + hourly.fetchedAt], reminders: [input.scene === "indoor" ? "室内温度可能与室外预报不同，进入室内后重新检查。" : "出门前核对现场天气、鞋袜与活动时裤脚是否合适。", ...(windy ? ["预报风速达到 5m/s，户外备挡风外层并由家人核对场地。"] : []), ...(wet ? ["预报有降水或降水概率≥50%，备防雨用品，由家人决定是否调整活动。"] : [])] };
  return view;
}
export async function getWeather(raw: string | undefined, householdId: string, input: WeatherInput) { return withHousehold(raw, householdId, (db, _actor, access) => readWeather(db, householdId, input, access.timezone)); }
