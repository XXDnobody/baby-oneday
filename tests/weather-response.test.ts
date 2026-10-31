import { afterEach, expect, test, vi } from "vitest";
import * as services from "../src/server/services";
import { fetchWeather } from "../src/server/weather";
import hourly from "./fixtures/qweather-hourly.json";

afterEach(() => { vi.restoreAllMocks(); });

async function replay(response: unknown) {
  const current = { metadata: { attributions: ["https://developer.qweather.com/attribution.html"] }, condition: { text: "测试多云" }, temperature: { value: 20, unit: "°C" }, feelsLike: { value: 19, unit: "°C" }, wind: { speed: { value: 1, unit: "m/s" } }, precipitation: { amount: { value: 0, unit: "mm" } } };
  let parseFailure = "";
  vi.spyOn(services, "weatherCall").mockImplementation(async (_job, product, _latitude, _longitude, parse) => {
    try { return parse(product === "hourly" ? response : current); }
    catch (e) { if (product === "hourly") parseFailure = String(e); throw e; }
  });
  const result = await fetchWeather({ id: "public-replay", householdId: "public-replay", ownerId: null, leaseToken: "public-replay" }, { label: "官方公开示例坐标", latitude: 39.92, longitude: 116.41, provenance: "QWeather official example", revision: 1, confirmedAt: "2026-10-31T00:00:00Z" });
  return { hourly: result.products.find((product) => product.product === "hourly")!, parseFailure };
}

test.each(["2026-10-31T10:00Z", "2026-10-31T10:00:00Z", "2026-10-31T18:00+08:00", "2026-10-31T18:00:00+08:00"])("公开逐小时响应时间 %s 通过生产解析并提供可用预报", async (forecastTime) => {
  const result = await replay({ ...hourly, hours: [{ ...hourly.hours[0], forecastTime }] });
  expect(result.hourly, result.parseFailure).toMatchObject({ state: "available" });
  expect(result.hourly.data?.[0]).toMatchObject({ at: "2026-10-31T10:00:00.000Z", temperature: hourly.hours[0].temperature.value, probability: hourly.hours[0].precipitation.probability });
});

test("公开响应整体通过生产解析，保留每个小时及来源", async () => {
  const result = await replay(hourly);
  expect(result.hourly, result.parseFailure).toMatchObject({ state: "available", attributions: hourly.metadata.attributions });
  expect(result.hourly.data).toHaveLength(hourly.hours.length);
});

test.each(["2026-02-30T10:00Z", "2026-10-31T24:00Z", "2026-10-31T10:00", "2026-10-31T10:00+25:00", "not-a-date"])("无效预报时间 %s 继续明确降级", async (forecastTime) => {
  const result = await replay({ ...hourly, hours: [{ ...hourly.hours[0], forecastTime }] });
  expect(result.hourly).toMatchObject({ state: "unavailable", data: null });
});
