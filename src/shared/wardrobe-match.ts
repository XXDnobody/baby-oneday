import type { WeatherView } from "./b3";
import { garmentCategories, garmentWarmth, outfitActivities, type Garment, type GarmentCategory, type OutfitInput, type OutfitResult, type OutfitSuggestion } from "./wardrobe";

/** Match only recorded, wearable clothes. Weather validity is decided by readWeather. */
export function matchOutfits(items: Garment[], weather: WeatherView, input: OutfitInput): OutfitResult {
  const result: OutfitResult = { state: "available", weather, outfits: [], reminders: [], ruleVersion: "wardrobe-v1 / outfit-b3-v1" };
  if (weather.state !== "available" || !weather.hours.length) {
    return { ...result, state: "weather_unavailable", reminders: [weather.reason || "所选时段尚无有效天气，请刷新后再搭配。"] };
  }
  const minimum = Math.min(...weather.hours.map((p) => p.feelsLike));
  const wet = weather.hours.some((p) => p.precipitation > 0 || (p.probability ?? 0) >= 0.5);
  const windy = weather.hours.some((p) => p.windSpeed >= 5);
  const outdoor = input.scene !== "indoor";
  const needsOuter = minimum < 20 || outdoor && (wet || windy);
  const target = minimum < 10 ? 2 : minimum < 20 ? 1 : 0;
  const weight = { light: 0, medium: 1, warm: 2 };
  const eligible = items.filter((g) => g.status === "ready" && g.activities.includes(input.activity) && (g.scene === "either" || input.scene !== "either" && g.scene === input.scene));
  const suitable = eligible.filter((g) => {
    if (["hat", "socks", "shoes"].includes(g.category)) return true;
    // Do not fill a weather gap with a clearly unsuitable garment just to complete a set.
    if (target === 0 && g.warmth === "warm") return false;
    if (target === 2 && g.warmth === "light") return false;
    return true;
  });
  const ranked = (category: GarmentCategory) => suitable.filter((g) => g.category === category).sort((a, b) => {
    const score = (g: Garment) => -Math.abs(weight[g.warmth] - (input.activity === "active" ? Math.max(0, target - 1) : target)) * 3 + (outdoor && wet && g.waterproof ? 4 : 0) + (outdoor && windy && g.windproof ? 3 : 0);
    return score(b) - score(a) || a.id.localeCompare(b.id);
  });
  const tops = ranked("top"), bottoms = ranked("bottom"), onepieces = ranked("onepiece");
  const bases: Garment[][] = [];
  for (let i = 0; i < Math.min(3, Math.max(tops.length, bottoms.length)); i++) bases.push([tops[i % tops.length], bottoms[i % bottoms.length]].filter((g): g is Garment => !!g));
  // Include both separates and one-piece alternatives when the wardrobe has them.
  const candidates = [bases[0], onepieces[0] ? [onepieces[0]] : undefined, bases[1], bases[2], ...onepieces.slice(1, 3).map((g) => [g])].filter((v): v is Garment[] => !!v);
  if (!candidates.length) candidates.push([]);
  const keys = new Set<string>();
  for (const base of candidates) {
    if (result.outfits.length >= 3) break;
    const picked = [...base];
    for (const category of [...(needsOuter ? ["outerwear" as const] : []), "shoes", "socks", ...(outdoor && (minimum < 10 || windy) ? ["hat"] : [])] as GarmentCategory[]) {
      const choices = ranked(category); if (choices[0]) picked.push(choices[0]);
    }
    const key = picked.map((g) => g.id).sort().join(":");
    if (keys.has(key)) continue; keys.add(key);
    const missing: string[] = [];
    if (!base.some((g) => g.category === "onepiece")) {
      if (!base.some((g) => g.category === "top")) missing.push("缺少适用的上衣或连体衣");
      if (!base.some((g) => g.category === "bottom")) missing.push("缺少适用的裤装或连体衣");
    }
    for (const category of [...(needsOuter ? ["outerwear" as const] : []), ...(outdoor ? ["shoes" as const] : [])]) {
      if (!picked.some((g) => g.category === category)) missing.push("缺少适用的" + garmentCategories[category]);
    }
    const suggestion: OutfitSuggestion = {
      id: key || "missing", label: "搭配 " + (result.outfits.length + 1), missing,
      items: picked.map((g) => ({ garment: g, reason: [garmentWarmth[g.warmth] + garmentCategories[g.category], "已标记适合" + outfitActivities[input.activity], outdoor && wet && g.waterproof ? "已标记防水" : "", outdoor && windy && g.windproof ? "已标记挡风" : ""].filter(Boolean).join(" · ") })),
    };
    result.outfits.push(suggestion);
  }
  if (!suitable.length) result.state = "empty";
  result.reminders = [
    "根据家人填写的衣物资料和所选时段天气筛选，穿前核对厚薄、合身情况与实际体感。",
    ...(weather.outfit?.reminders ?? []),
    ...(input.scene === "indoor" ? ["室外预报仅作准备参考，请按室内实际温度增减，鞋子可按场地选择。"] : []),
    ...(input.scene === "either" ? ["室内外尚待核对，仅筛选标记为室内外通用的衣物。"] : []),
    ...(input.activity === "active" ? ["跑跳时优先便于活动与穿脱的衣物，热了或出汗时及时调整。"] : []),
    ...(input.activity === "stroller" ? ["推车时留意久坐体感，检查裤脚、袜口是否合适。"] : []),
    ...(outdoor && wet && !suitable.some((g) => g.waterproof && ["outerwear", "shoes"].includes(g.category)) ? ["库中没有适用且标记防水的外套或鞋子，出门前另行确认防雨准备。"] : []),
  ];
  return result;
}
