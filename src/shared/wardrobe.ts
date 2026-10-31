import { z } from "zod";
import { revision } from "./contracts";
import { weatherInput, type WeatherView } from "./b3";

export const garmentCategories = { top: "上衣", bottom: "裤装", onepiece: "连体衣 / 裙装", outerwear: "外套", shoes: "鞋子", socks: "袜子", hat: "帽子" } as const;
export const garmentWarmth = { light: "轻薄", medium: "适中", warm: "保暖" } as const;
export const garmentStates = { ready: "可穿", laundry: "待洗", small: "不合身", archived: "已收起" } as const;
export const outfitActivities = { daily: "日常活动", active: "跑跳玩耍", stroller: "推车散步", quiet: "安静玩耍" } as const;
export const wardrobeLimits = { photoBytes: 2 * 1024 * 1024, bodyBytes: 3 * 1024 * 1024, items: 200, imagePixels: 20_000_000 };
const activities = z.enum(["daily", "active", "stroller", "quiet"]);
export const garmentFields = z.object({
  name: z.string().trim().min(1, "请给衣物起个名字").max(60),
  category: z.enum(["top", "bottom", "onepiece", "outerwear", "shoes", "socks", "hat"]),
  warmth: z.enum(["light", "medium", "warm"]),
  color: z.string().trim().max(30).default(""),
  size: z.string().trim().max(30).default(""),
  scene: z.enum(["indoor", "outdoor", "either"]).default("either"),
  activities: z.array(activities).min(1, "请至少选择一种适用活动").max(4).refine((v) => new Set(v).size === v.length, "活动不能重复"),
  status: z.enum(["ready", "laundry", "small", "archived"]).default("ready"),
  waterproof: z.boolean().default(false), windproof: z.boolean().default(false),
  notes: z.string().trim().max(500).default(""),
}).strict();
export const garmentPhoto = z.string().max(Math.ceil(wardrobeLimits.photoBytes / 3) * 4 + 40).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/, "请选择 JPG、PNG 或 WebP 照片");
export const garmentCreate = garmentFields.extend({ photo: garmentPhoto }).strict();
export const garmentEdit = garmentFields.extend({ expectedRevision: revision, photo: garmentPhoto.optional() }).strict();
export const outfitInput = weatherInput.safeExtend({ activity: activities.default("daily") });
export type GarmentFields = z.infer<typeof garmentFields>;
export type GarmentCategory = GarmentFields["category"];
export type OutfitInput = z.infer<typeof outfitInput>;
export interface Garment extends GarmentFields { id: string; revision: number; photoVersion: number; photoUrl: string; updatedAt: string; updatedBy: string }
export interface Wardrobe { items: Garment[]; limit: number }
export interface OutfitSuggestion { id: string; label: string; items: { garment: Garment; reason: string }[]; missing: string[] }
export interface OutfitResult { state: "available" | "weather_unavailable" | "empty"; weather: WeatherView; outfits: OutfitSuggestion[]; reminders: string[]; ruleVersion: string }
