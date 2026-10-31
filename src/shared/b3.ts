import { z } from "zod";
import { date, id, itemFields, revision, time, templateInput } from "./contracts";
import { pantryInput, preferenceInput } from "./b2";

export const b3Limits = { defaultRunTime: "20:00", leaseSeconds: 120, maxAttempts: 3, previewMinutes: 15, weatherRetentionHours: 24, currentMinutes: 20, hourlyMinutes: 45 };
export const automationInput = z.object({ expectedRevision: revision, enabled: z.boolean(), runTime: time }).strict();
export const locationInput = z.object({ expectedRevision: revision, label: z.string().trim().min(1).max(80), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), provenance: z.string().trim().min(1).max(200) }).strict();
export const weatherInput = z.object({ date, startTime: time, endTime: time, scene: z.enum(["indoor", "outdoor", "either"]).default("outdoor") }).strict().refine((v) => v.endTime > v.startTime, "结束时间须晚于开始时间");
export const conversationInput = z.object({ from: date, to: date }).strict().refine((v) => v.to >= v.from && Date.parse(v.to) - Date.parse(v.from) <= 30 * 86400000, "每次讨论最多 31 天");
export const messageInput = z.object({ expectedRevision: revision, text: z.string().trim().min(1).max(4000), refineProposalId: id.optional() }).strict();
export const confirmInput = z.object({ turn: revision }).strict();
export const aiSuggestion = z.object({
  ingredients: z.array(z.object({ name: z.string().trim().min(1).max(40), amountText: z.string().trim().max(100), formText: z.string().trim().min(1).max(200), quantity: z.number().positive().max(100000).optional(), unit: z.enum(["g", "kg", "ml", "L", "个", "片", "块", "根", "份", "包", "盒", "茶匙", "汤匙"]).optional(), basis: z.enum(["raw", "cooked", "as_purchased", "count"]).optional() }).strict().refine((v) => [v.quantity, v.unit, v.basis].every((x) => x === undefined) || [v.quantity, v.unit, v.basis].every((x) => x !== undefined), "量化备料须同时提供数量、单位和生熟口径")).max(16),
  steps: z.array(z.string().trim().min(1).max(600)).min(1).max(12),
  materials: z.string().trim().max(200),
  assumptions: z.array(z.string().trim().min(1).max(120)).max(4),
  weatherCondition: z.string().trim().max(200),
  indoorAlternative: z.string().trim().max(240),
  servings: z.number().int().min(1).max(20).optional(),
  servingNote: z.string().trim().max(120).optional(),
  prepMinutes: z.number().int().min(0).max(240).optional(),
  cookMinutes: z.number().int().min(0).max(360).optional(),
  yieldText: z.string().trim().max(160).optional(),
}).strict();
export const recipeRefinementOutput = z.object({ answer: z.string().trim().min(1).max(4000), recipes: z.array(z.object({ key: z.string().regex(/^r\d+$/), suggestion: aiSuggestion }).strict()).min(1).max(40) }).strict();
export const aiOperation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("plan.add"), date, repeatOn: z.array(date).max(30).optional(), item: itemFields, suggestion: aiSuggestion.optional() }).strict(),
  z.object({ type: z.literal("plan.update"), itemId: id, item: itemFields, suggestion: aiSuggestion.optional() }).strict(),
  z.object({ type: z.literal("pantry.set"), items: pantryInput.shape.items }).strict(),
  z.object({ type: z.literal("preference.add"), preference: preferenceInput }).strict(),
  z.object({ type: z.literal("preference.end"), preferenceId: id }).strict(),
  z.object({ type: z.literal("template.set"), kind: z.enum(["weekday", "weekend"]), slots: templateInput.shape.slots }).strict(),
]);
export const modelOutput = z.object({ answer: z.string().trim().min(1).max(8000), operations: z.array(aiOperation).max(200) }).strict();
export type AiOperation = z.infer<typeof aiOperation>;
export type AiSuggestion = z.infer<typeof aiSuggestion>;
export type WeatherInput = z.infer<typeof weatherInput>;
export interface WeatherLocation { label: string; latitude: number; longitude: number; provenance: string; revision: number; confirmedAt: string }
export interface Automation { enabled: boolean; runTime: string; revision: number }
export interface WeatherPoint { at: string; temperature: number; feelsLike: number; text: string; windSpeed: number; precipitation: number; probability: number | null }
export interface WeatherProduct { id: string; product: "current" | "hourly"; state: string; reason: string; fetchedAt: string; providerTime: string | null; validFrom: string | null; validTo: string | null; staleAfter: string; data: WeatherPoint[] | null; attributions: string[]; sourceUrl: string; testService: boolean; provider: string }
export interface WeatherView { location: WeatherLocation | null; request: WeatherInput; current: WeatherProduct | null; hourly: WeatherProduct | null; state: string; reason: string; hours: WeatherPoint[]; outfit: { ruleVersion: string; categories: string[]; basis: string[]; reminders: string[] } | null }
export interface Job { id: string; kind: "automatic" | "weather" | "ai"; state: string; attempts: number; result: Record<string, unknown> | null; errorCode: string | null; errorMessage: string | null; durationMs: number | null }
export interface PreviewChange { type: string; target: string; date?: string; before: unknown; after: unknown; impact: string; suggestion?: AiSuggestion }
export interface Proposal { id: string; turn: number; state: string; expiresAt: string; preview: PreviewChange[] }
export interface Conversation { id: string; from: string; to: string; revision: number; messages: { id: string; role: string; text: string; turn: number }[]; proposals: Proposal[]; jobs: Job[] }
export interface ServiceStatus { weather: { ready: boolean; missing: string[]; testService: boolean }; ai: { ready: boolean; missing: string[]; testService: boolean; provider: string | null; model: string | null; region: string | null } }
