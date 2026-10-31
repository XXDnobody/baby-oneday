import { z } from "zod";
import { date, id, name, revision, time, type PlanItem } from "./contracts";

export const scene = z.enum(["indoor", "outdoor", "either"]);
export const pantryEntry = z.object({ name: z.string().trim().min(1).max(60), status: z.enum(["available", "missing", "unknown"]), quantity: z.enum(["unknown", "low", "enough"]), priority: z.boolean() }).strict();
export const pantryInput = z.object({ expectedRevision: revision, items: z.array(pantryEntry).max(100).refine((items) => new Set(items.map((i) => i.name.toLowerCase())).size === items.length, "食材名称不能重复") }).strict();
export const preferenceFields = z.object({ kind: z.enum(["like", "avoid", "note"]), scope: z.enum(["meal", "activity", "all"]), text: z.string().trim().min(1).max(300), startsOn: date, endsOn: date }).strict();
export const preferenceInput = preferenceFields.refine((v) => v.endsOn >= v.startsOn, "结束日期不能早于开始日期");
export const preferenceEdit = preferenceFields.extend({ expectedRevision: revision }).strict().refine((v) => v.endsOn >= v.startsOn, "结束日期不能早于开始日期");
const source = z.object({ title: z.string().trim().max(200), author: z.string().trim().max(120), url: z.union([z.literal(""), z.url().regex(/^https?:\/\//)]), edition: z.string().trim().max(100), locator: z.string().trim().max(300), summary: z.string().trim().max(3000), adaptation: z.string().trim().max(3000), verification: z.enum(["pending", "checked"]).default("pending"), professionalReview: z.enum(["not_performed", "reviewed"]).default("not_performed"), professionalNote: z.string().trim().max(500).default("") }).strict();
export const contentFields = z.object({
  kind: z.enum(["recipe", "activity"]), title: z.string().trim().min(1).max(120), summary: z.string().trim().max(1000),
  ingredients: z.array(z.object({ name: name, amountText: z.string().max(120), formText: z.string().max(200) }).strict()).max(100),
  steps: z.array(z.string().trim().min(1).max(4000)).min(1).max(100), tips: z.array(z.string().max(2000)).max(50),
  materials: z.string().trim().max(1000), scene, purpose: z.string().trim().max(1000), observations: z.string().trim().max(1000), variation: z.string().trim().max(1000),
  minAgeMonths: z.number().int().min(0).max(216).nullable(), maxAgeMonths: z.number().int().min(0).max(216).nullable(),
  applicability: z.string().trim().max(2000), preparation: z.string().trim().max(2000), quantityBasis: z.string().trim().max(2000),
  source, familyConfirmed: z.boolean().default(false), applicabilityConfirmed: z.boolean().default(false), ingredientsConfirmed: z.boolean().default(false),
  foodProfileRevision: revision.nullable().default(null), reviewIssues: z.array(z.string().max(2000)).max(100),
}).strict().refine((v) => v.minAgeMonths === null || v.maxAgeMonths === null || v.maxAgeMonths >= v.minAgeMonths, "最大月龄不能小于最小月龄");
export const contentEdit = z.object({ expectedRevision: revision, content: contentFields }).strict();
export const contentSettingsInput = z.object({ expectedRevision: revision, enabled: z.array(z.object({ id, version: revision }).strict()).max(200) }).strict();
export const importInput = z.object({ ids: z.array(z.string().regex(/^(R(0[1-9]|1[01])|A0[12])$/)).min(1).max(13) }).strict();
const feedback = z.object({ occurredOn: date, occurredTime: time.nullable().default(null), text: z.string().trim().max(6000).default(""), participation: z.enum(["joined", "partial", "not_joined"]).nullable().default(null), interest: z.enum(["interested", "neutral", "not_interested"]).nullable().default(null) }).strict();
const meaningful = (v: { text: string; participation: string | null; interest: string | null }) => !!(v.text || v.participation || v.interest);
export const recordInput = feedback.extend({ planItemId: id.nullable().default(null), planItemRevision: revision.nullable().default(null) }).strict().refine(meaningful, "文字、参与情况、兴趣至少填写一项");
export const recordEdit = feedback.extend({ expectedRevision: revision, correctionNote: z.string().trim().max(1000).default("") }).strict().refine(meaningful, "文字、参与情况、兴趣至少填写一项");
export const expectedInput = z.object({ expectedRevision: revision }).strict();
export const agreementsInput = z.object({ expectedRevision: revision, items: z.array(z.object({ text: z.string().trim().min(1).max(300), enabled: z.boolean() }).strict()).max(30) }).strict();
export interface Agreements { revision: number; items: Array<{ text: string; enabled: boolean }>; confirmedBy: string | null; confirmedAt: string | null }
export interface ShoppingNeed { name: string; amountText: string; recipeTitle: string; recipeVersion: number; status: "missing" | "unknown" | "check-amount"; confirmedAt: string | null }
export const restoreInput = expectedInput.extend({ expectedPlanRevision: revision }).strict();
export const rangeInput = z.object({ from: date, to: date }).refine((v) => v.to >= v.from && (Date.parse(v.to) - Date.parse(v.from)) / 86400000 <= 92, "每次最多查看 93 天");
export const printInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("day"), date, expectedRevision: revision, items: z.array(z.object({ id, revision }).strict()).min(1).max(100) }).strict(),
  z.object({ kind: z.literal("recipe"), date, contentId: id, contentVersion: revision }).strict(),
]);
export type ContentFields = z.infer<typeof contentFields>;
export interface ContentVersion extends ContentFields { id: string; version: number; revision: number; enabled: boolean; createdAt: string; legacy?: unknown; illustration?: string }
export interface Candidate extends ContentVersion { eligible: boolean; reasons: string[]; score: number }
export interface Pantry { revision: number; confirmedAt: string | null; items: Array<z.infer<typeof pantryEntry> & { confirmedAt: string }> }
export interface Preference extends z.infer<typeof preferenceFields> { id: string; revision: number; ended: boolean; active: boolean }
export interface ContentLibrary { items: Candidate[]; nextCursor: string | null }
export interface ContentSettings { revision: number; enabled: Array<{ id: string; version: number }> }
export interface ImportResult { importKey: string; status: "imported" | "existing" | "failed"; contentId?: string; error?: string; attempts: number }
export interface RecordEntry { id: string; occurredOn: string; occurredTime: string | null; text: string; participation: "joined" | "partial" | "not_joined" | null; interest: "interested" | "neutral" | "not_interested" | null; authorId: string; authorName: string; updatedBy: string; editorName: string; revision: number; createdAt: string; updatedAt: string; planItemId: string | null; planSnapshot: (PlanItem & { date: string; planRevision: number }) | null }
export interface RecordRevision { revision: number; snapshot: RecordEntry; editorName: string; correctionNote: string; createdAt: string }
export interface CalendarDay { date: string; planCount: number; cancelledCount: number; recordCount: number }
export interface TrashItem { id: string; kind: "plan-item" | "record"; title: string; date: string; revision: number; deletedAt: string; restoreUntil: string }
export interface PrintSnapshot { id: string; kind: "day" | "recipe"; date: string; generatedAt: string; householdName: string; childName: string; planRevision: number | null; items: PlanItem[]; recipes: ContentVersion[]; reminders: string[] }
