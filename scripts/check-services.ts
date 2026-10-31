import { loadEnvironment } from "./load-env";
import { serviceStatus } from "../src/server/services";
loadEnvironment();
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...serviceStatus(), realWeatherVerified: false, realAiVerified: false, note: "仅核对配置完整性；不输出凭据，不进行外部请求，不核销额度。实际费用以供应商账单为准。" }, null, 2));
