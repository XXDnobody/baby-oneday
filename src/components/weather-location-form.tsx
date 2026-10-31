"use client";

import { useEffect, useId, useRef, useState } from "react";
import Select from "react-select";
import { LocateFixed } from "lucide-react";
import type { WeatherLocation } from "@/shared/b3";
import citiesData from "@/shared/weather-cities.json";
import { currentWeatherCoordinates } from "@/shared/weather-location";
import cityStyles from "./city-picker.module.css";

type City = (typeof citiesData.cities)[number];
type Fields = Pick<WeatherLocation, "label" | "latitude" | "longitude" | "provenance">;

export function WeatherLocationForm({ initialLocation, householdCity, busy, onSave }: {
  initialLocation: WeatherLocation | null;
  householdCity: string;
  busy: boolean;
  onSave: (fields: Fields) => void;
}) {
  const id = useId();
  const savedCity = initialLocation?.provenance.startsWith("GeoNames") ? citiesData.cities.find((city) => city.label === initialLocation.label) ?? null : null;
  const homeCity = citiesData.cities.find((city) => city.label === householdCity || city.name === householdCity);
  const [selectedCity, setCity] = useState<City | null>(savedCity);
  const [label, setLabel] = useState(initialLocation?.label ?? householdCity);
  const [latitude, setLatitude] = useState(initialLocation?.latitude.toFixed(2) ?? "");
  const [longitude, setLongitude] = useState(initialLocation?.longitude.toFixed(2) ?? "");
  const [provenance, setProvenance] = useState(initialLocation?.provenance ?? "手动填写，经家人确认");
  const [kind, setKind] = useState<"device" | "city" | "manual" | null>(savedCity ? "city" : initialLocation ? "manual" : null);
  const [locating, setLocating] = useState(false), [error, setError] = useState("");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const locationRequest = useRef(0);
  useEffect(() => () => { locationRequest.current++; }, []);
  const disabled = busy || locating;
  const valid = !!label.trim() && !!latitude.trim() && !!longitude.trim() && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) && Math.abs(Number(latitude)) <= 90 && Math.abs(Number(longitude)) <= 180 && !!provenance.trim();

  function chooseCity(city: City) {
    setCity(city); setLabel(city.label); setLatitude(city.latitude.toFixed(2)); setLongitude(city.longitude.toFixed(2));
    setProvenance("GeoNames 城市参考点 " + city.id + "（CC BY 4.0），经家人确认");
    setKind("city"); setAccuracy(null); setError("");
  }
  function changeCoordinate(value: string, target: "latitude" | "longitude") {
    if (target === "latitude") setLatitude(value); else setLongitude(value);
    setCity(null); setKind("manual"); setAccuracy(null); setProvenance("手动填写，经家人确认");
  }
  async function locate() {
    const request = ++locationRequest.current;
    setLocating(true); setError("");
    try {
      const point = await currentWeatherCoordinates();
      if (request !== locationRequest.current) return;
      setCity(null); setLabel("设备当前位置"); setLatitude(point.latitude.toFixed(2)); setLongitude(point.longitude.toFixed(2));
      setProvenance("浏览器设备定位，经家人确认；仅保留两位小数"); setKind("device"); setAccuracy(point.accuracy);
    } catch (e) { if (request === locationRequest.current) setError(e instanceof Error ? e.message : "定位暂时不可用，请直接选择城市。"); }
    finally { if (request === locationRequest.current) setLocating(false); }
  }

  return <form className="form-stack weather-location-form" onSubmit={(e) => {
    e.preventDefault();
    if (!valid || disabled) return;
    onSave({ label: label.trim(), latitude: Number(latitude), longitude: Number(longitude), provenance: provenance.trim() });
  }}>
    <div className="weather-location-actions">
      <button type="button" className="primary" disabled={disabled} aria-busy={locating} onClick={() => void locate()}><LocateFixed size={18} aria-hidden />{locating ? "正在获取位置…" : "使用当前位置"}</button>
      {homeCity && <button type="button" className="secondary" disabled={disabled} onClick={() => chooseCity(homeCity)}>使用常住城市：{homeCity.name}</button>}
    </div>
    <p className="small muted">点击后由浏览器询问定位授权，确认保存后家人共用。定位不可用时，直接选择城市即可。</p>
    {locating && <div><p className="small muted" role="status">请在浏览器提示中允许定位，正在获取设备位置…</p><button type="button" className="text-button" onClick={() => { locationRequest.current++; setLocating(false); }}>取消等待，改选城市</button></div>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="weather-location-city">
      <label htmlFor={id + "-city"}>或选择天气城市</label>
      <Select<City> unstyled inputId={id + "-city"} instanceId={id + "-city"} className={cityStyles.select} classNamePrefix="city-select"
        options={citiesData.cities} value={selectedCity} getOptionValue={(city) => city.code} getOptionLabel={(city) => city.label}
        isDisabled={disabled} isSearchable placeholder="搜索城市，如南京、上海" maxMenuHeight={240} menuPlacement="auto"
        filterOption={({ data }, input) => data.search.toLowerCase().replace(/\s/g, "").includes(input.toLowerCase().replace(/\s/g, ""))}
        noOptionsMessage={() => "未找到城市，可换个名称或使用当前位置"}
        screenReaderStatus={({ count }) => "找到 " + count + " 个城市。"}
        ariaLiveMessages={{ guidance: ({ context }) => context === "menu" ? "使用上下方向键浏览，回车选择，Escape 关闭。" : "输入城市名称或拼音搜索。" }}
        aria-live="polite" onChange={(city) => { if (city) chooseCity(city); }} />
      <p className="small muted">城市参考点：<a href="https://www.geonames.org" target="_blank" rel="noreferrer">GeoNames</a> · <a href={citiesData.licenseUrl} target="_blank" rel="noreferrer">CC BY 4.0</a>。城市选择无需定位授权。</p>
    </div>
    {kind && valid && <div className="weather-location-preview" role="status">
      <strong>{kind === "device" ? "已获取当前位置" : kind === "city" ? "已选择城市参考点" : "地点已填写"}</strong>
      <p className="small">{kind === "device" ? "确认这是你要查看天气的地点，再保存。" : kind === "city" ? "按所选城市的参考位置获取天气。" : "确认地点后保存，家人可共同使用。"}</p>
      {kind === "device" && accuracy !== null && <p className="small muted">设备报告定位精度约 {accuracy >= 1000 ? Math.ceil(accuracy / 1000) + " 公里" : Math.max(10, Math.ceil(accuracy / 10) * 10) + " 米"}；可按需要改选城市。</p>}
    </div>}
    <label>地点名称<input name="label" required maxLength={80} value={label} disabled={disabled} onChange={(e) => setLabel(e.target.value)} /></label>
    <details className="weather-location-advanced">
      <summary>高级设置：查看或手动填写坐标</summary>
      <div className="form-stack"><div className="form-columns">
        <label>纬度<input name="latitude" type="number" min={-90} max={90} step="0.01" value={latitude} disabled={disabled} onChange={(e) => changeCoordinate(e.target.value, "latitude")} /></label>
        <label>经度<input name="longitude" type="number" min={-180} max={180} step="0.01" value={longitude} disabled={disabled} onChange={(e) => changeCoordinate(e.target.value, "longitude")} /></label>
      </div><label>坐标来源<input name="provenance" maxLength={200} value={provenance} disabled={disabled} onChange={(e) => setProvenance(e.target.value)} /></label>
      <p className="small muted">天气地点仅保存到小数点后两位。定位或选择城市后，会自动填写。</p></div>
    </details>
    <button className="primary" disabled={disabled || !valid}>{busy ? "正在保存…" : "保存天气地点"}</button>
  </form>;
}
