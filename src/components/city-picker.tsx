"use client";

import { useId, useState } from "react";
import Select, { type AriaLiveMessages, type GroupBase } from "react-select";
import { areaList } from "@vant/area-data";
import styles from "./city-picker.module.css";

type RegionOption = { value: string; label: string };

const provinces: RegionOption[] = Object.entries(areaList.province_list).map(([value, label]) => ({ value, label }));
const cities = Object.entries(areaList.city_list);
const counties = Object.entries(areaList.county_list);
const municipalities = new Set(["110000", "120000", "310000", "500000"]);

function citiesIn(province: RegionOption): RegionOption[] {
  // Municipalities are cities themselves; their districts are not city choices.
  if (municipalities.has(province.value)) return [{ value: province.value, label: province.label }];
  return cities.filter(([code]) => code.slice(0, 2) === province.value.slice(0, 2)).flatMap(([value, label]) => {
    // Expose actual places such as 济源市 and 仙桃市 instead of administrative groups.
    if (label.includes("直辖")) {
      return counties.filter(([code]) => code.slice(0, 4) === value.slice(0, 4)).map(([value, label]) => ({ value, label }));
    }
    return [{ value, label }];
  });
}

const ariaLiveMessages: AriaLiveMessages<RegionOption, false, GroupBase<RegionOption>> = {
  guidance: ({ context }) => context === "menu" ? "使用上下方向键浏览，回车选择，Escape 关闭。" : "输入名称筛选，或按下方向键展开选项。",
  onChange: ({ label }) => label ? "已选择" + label : "选择已清空。",
  onFocus: ({ label }) => label,
  onFilter: ({ resultsMessage }) => resultsMessage,
};

export function CityPicker({ onChange, disabled = false }: { onChange: (city: string) => void; disabled?: boolean }) {
  const id = useId();
  const [province, setProvince] = useState<RegionOption | null>(null);
  const [city, setCity] = useState<RegionOption | null>(null);
  const options = province ? citiesIn(province) : [];
  const shared = {
    unstyled: true,
    className: styles.select,
    classNamePrefix: "city-select",
    isSearchable: true,
    required: true,
    maxMenuHeight: 240,
    menuPlacement: "auto" as const,
    noOptionsMessage: () => "没有匹配结果，请换个名称搜索",
    screenReaderStatus: ({ count }: { count: number }) => "找到 " + count + " 个选项。",
    ariaLiveMessages,
    "aria-describedby": id + "-hint",
  };

  return <fieldset className={styles.picker}>
    <legend>常住城市</legend>
    <div className={styles.columns}>
      <div className={styles.field}>
        <label htmlFor={id + "-province"}>省份 / 直辖市</label>
        <Select<RegionOption> {...shared} inputId={id + "-province"} instanceId={id + "-province"} name="province" placeholder="请选择省份" options={provinces} value={province} isDisabled={disabled} onChange={(next) => {
          setProvince(next);
          const nextCities = next ? citiesIn(next) : [];
          const onlyCity = nextCities.length === 1 ? nextCities[0] : null;
          setCity(onlyCity);
          onChange(next && onlyCity ? (next.label === onlyCity.label ? onlyCity.label : next.label + " " + onlyCity.label) : "");
        }} />
      </div>
      <div className={styles.field}>
        <label htmlFor={id + "-city"}>城市</label>
        <Select<RegionOption> {...shared} inputId={id + "-city"} instanceId={id + "-city"} name="city" placeholder={province ? "请选择城市" : "请先选择省份"} options={options} value={city} isDisabled={disabled || !province} onChange={(next) => {
          setCity(next);
          onChange(province && next ? (province.label === next.label ? next.label : province.label + " " + next.label) : "");
        }} />
      </div>
    </div>
    <p id={id + "-hint"} className="small muted">先选省份，再选城市；支持输入名称搜索。当前使用北京时间。</p>
  </fieldset>;
}
