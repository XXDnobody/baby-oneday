import { readFileSync, writeFileSync } from "node:fs";
import { areaList } from "@vant/area-data";

// Input: cities15000.txt from GeoNames' CC BY 4.0 gazetteer export.
// Keep only a single reference point for each matched city in our existing city list.
const input = process.argv[2];
if (!input) throw new Error("请提供 GeoNames cities15000.txt 的本地路径");
const municipalities = new Set(["110000", "120000", "310000", "500000", "810000", "820000"]);
const known = [
  ...Object.entries(areaList.city_list).filter(([code, name]) => !municipalities.has(code.slice(0, 2) + "0000") && !name.includes("直辖")),
  ...Object.entries(areaList.county_list).filter(([code]) => ["4190", "4290", "4690", "6590"].includes(code.slice(0, 4))),
  ...Object.entries(areaList.province_list).filter(([code]) => municipalities.has(code)),
];
const normalize = (name: string) => name.replace(/市$/, "");
const selected = new Map<string, { code: string; id: string; name: string; label: string; search: string; latitude: number; longitude: number; score: number }>();
for (const line of readFileSync(input, "utf8").split("\n")) {
  const row = line.split("\t");
  if (!["CN", "HK", "MO", "TW"].includes(row[8]) || row[6] !== "P") continue;
  const aliases = new Set([row[1], ...row[3].split(",")].map(normalize));
  const latitude = Math.round(Number(row[4]) * 100) / 100, longitude = Math.round(Number(row[5]) * 100) / 100;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
  for (const [code, name] of known) {
    if (!aliases.has(normalize(name))) continue;
    const province = areaList.province_list[code.slice(0, 2) + "0000"];
    const label = province && province !== name ? province + " " + name : name;
    const rank = row[7] === "PPLC" ? 4 : row[7] === "PPLA" ? 3 : row[7] === "PPLA2" ? 2 : 1;
    const score = rank * 1e12 + Number(row[14] || 0);
    if ((selected.get(label)?.score ?? -1) >= score) continue;
    selected.set(label, { code, id: row[0], name, label, search: [name, province, row[2]].filter(Boolean).join(" "), latitude, longitude, score });
  }
}
const cities = [...selected.values()].sort((a, b) => a.code.localeCompare(b.code)).map(({ score, ...city }) => { void score; return city; });
if (cities.length < 250) throw new Error("城市参考数据不完整，未更新正式文件");
writeFileSync("src/shared/weather-cities.json", JSON.stringify({
  source: "https://download.geonames.org/export/dump/cities15000.zip",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  updatedOn: new Date().toISOString().slice(0, 10),
  cities,
}, null, 2) + "\n");
console.log("已生成 " + cities.length + " 个城市参考点；坐标保留两位小数。");
