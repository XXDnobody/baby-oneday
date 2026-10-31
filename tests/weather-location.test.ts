import { afterEach, expect, test, vi } from "vitest";
import { currentWeatherCoordinates } from "../src/shared/weather-location";
import citiesData from "../src/shared/weather-cities.json";
import { locationInput } from "../src/shared/b3";

afterEach(() => { vi.unstubAllGlobals(); });

function browser(getCurrentPosition: Geolocation["getCurrentPosition"], secure = true) {
  vi.stubGlobal("window", { isSecureContext: secure });
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
}

test("设备定位使用有限等待，并在返回前将位置降至天气所需精度", async () => {
  const get = vi.fn<Geolocation["getCurrentPosition"]>((success) => {
    success({ coords: { latitude: 32.06167, longitude: 118.77778, accuracy: 47.4 } } as GeolocationPosition);
  });
  browser(get);
  const point = await currentWeatherCoordinates();
  expect(point).toEqual({ latitude: 32.06, longitude: 118.78, accuracy: 47 });
  expect(get).toHaveBeenCalledOnce();
  expect(get.mock.calls[0][2]).toEqual({ enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
});

test.each([
  [1, "定位未获授权"],
  [2, "暂时无法获取位置"],
  [3, "获取位置超时"],
])("定位失败 %s 时给出城市选择的可继续操作提示", async (code, message) => {
  browser((_success, failure) => { failure?.({ code } as GeolocationPositionError); });
  await expect(currentWeatherCoordinates()).rejects.toThrow(message);
  await expect(currentWeatherCoordinates()).rejects.toThrow("选择城市");
});

test("非安全页面不会尝试索取设备位置", async () => {
  const get = vi.fn(); browser(get, false);
  await expect(currentWeatherCoordinates()).rejects.toThrow("HTTPS");
  expect(get).not.toHaveBeenCalled();
});

test("不支持定位的设备仍可通过城市选项继续", async () => {
  vi.stubGlobal("window", { isSecureContext: true }); vi.stubGlobal("navigator", {});
  await expect(currentWeatherCoordinates()).rejects.toThrow("直接选择城市");
});

test.each([NaN, 91, -91])("设备返回无效纬度 %s 时不将其作为天气地点", async (latitude) => {
  browser((success) => { success({ coords: { latitude, longitude: 118.78, accuracy: 50 } } as GeolocationPosition); });
  await expect(currentWeatherCoordinates()).rejects.toThrow("未取得有效位置");
});

test("城市参考点可直接用于已有地点接口，并保留来源和许可", () => {
  expect(citiesData.license).toBe("CC BY 4.0");
  expect(citiesData.cities.length).toBeGreaterThan(250);
  expect(new Set(citiesData.cities.map((city) => city.code)).size).toBe(citiesData.cities.length);
  for (const city of citiesData.cities) {
    expect(() => locationInput.parse({ expectedRevision: 1, label: city.label, latitude: city.latitude, longitude: city.longitude, provenance: "GeoNames 城市参考点 " + city.id + "（CC BY 4.0），经家人确认" })).not.toThrow();
  }
  const nanjing = citiesData.cities.find((city) => city.label === "江苏省 南京市");
  expect(nanjing).toMatchObject({ id: "1799962", latitude: 32.06, longitude: 118.78 });
});
