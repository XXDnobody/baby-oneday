import { createServer } from "node:http";
import { readConfig } from "../src/server/config";

export async function startB3TestServices() {
  if (readConfig().APP_ENV !== "test") throw new Error("B3 fixtures require the isolated test environment");
  const state: { weatherMode: string; aiMode: string; output: unknown; usage: unknown; paths: string[]; modelOptions: Array<{ model: string; thinking?: { type: string }; response_format: { type: string } }>; prompts: Array<Array<{ role: string; content: string }>>; onModel?: () => Promise<void>; onWeather?: () => Promise<void>; respondToPrompt?: (messages: Array<{ role: string; content: string }>) => unknown } = { weatherMode: "ok", aiMode: "ok", output: { answer: "这是仅供本人查看的测试讨论。正式改动须预览后确认。", operations: [] }, usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 }, paths: [], modelOptions: [], prompts: [] };
  const server = createServer(async (req, res) => {
    const path = req.url ?? ""; state.paths.push(path);
    res.setHeader("Content-Type", "application/json");
    if (path.includes("/chat/completions")) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")); state.prompts.push(body.messages);
      state.modelOptions.push({ model: body.model, thinking: body.thinking, response_format: body.response_format });
      await state.onModel?.();
      if (state.aiMode === "timeout") await new Promise((resolve) => setTimeout(resolve, 400));
      if (state.aiMode === "limited") { res.writeHead(429); res.end("{}"); return; }
      if (state.aiMode === "bad") { res.end("invalid json"); return; }
      res.end(JSON.stringify({ model: "b3-test-model", choices: [{ finish_reason: state.aiMode === "truncated" ? "length" : "stop", message: { content: JSON.stringify(state.respondToPrompt?.(body.messages) ?? state.output) } }], usage: state.usage })); return;
    }
    await state.onWeather?.();
    if (state.weatherMode === "timeout") await new Promise((resolve) => setTimeout(resolve, 400));
    if (state.weatherMode === "limited") { res.writeHead(429); res.end("{}"); return; }
    if (state.weatherMode === "bad") { res.end('{"temperature":{}}'); return; }
    const point = { condition: { text: "测试小雨" }, temperature: { value: 17, unit: "°C" }, feelsLike: { value: 15, unit: "°C" }, wind: { speed: { value: 6, unit: "m/s" } }, precipitation: { amount: { value: 0.2, unit: "mm" }, probability: 0.6 } };
    const metadata = { attributions: ["https://developer.qweather.com/attribution.html", "B3 deterministic test fixture"] };
    const hour = Math.floor(Date.now() / 3600000) * 3600000 - 3600000;
    res.end(JSON.stringify(path.includes("/hourly/") ? { metadata, hours: Array.from({ length: 73 }, (_, i) => ({ ...point, forecastTime: new Date(hour + i * 3600000).toISOString().slice(0, 16) + "Z" })) } : { ...point, metadata }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing fixture address");
  const env = { B3_TEST_WEATHER_URL: "http://127.0.0.1:" + address.port, WEATHER_DAILY_REQUEST_LIMIT: "10000", AI_PROVIDER: "b3-test-fixture", AI_BASE_URL: "http://127.0.0.1:" + address.port, AI_API_KEY: "test-fixture-not-a-real-key", AI_MODEL: "b3-test-model", AI_REGION: "loopback-test", AI_DAILY_REQUEST_LIMIT: "10000", AI_DAILY_TOKEN_LIMIT: "100000000", AI_TIMEOUT_MS: "2000", AI_THINKING_MODE: "disabled", SERVICE_TIMEOUT_MS: "2000" };
  return { state, env, url: env.AI_BASE_URL, close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve())); } };
}
