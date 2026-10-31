import { z } from "zod";

export const id = z.uuid();
export const revision = z.number().int().positive();
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "请输入有效日期");
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "请输入有效时间");
export const email = z.string().trim().max(254).email("请输入有效邮箱").regex(/^[\x21-\x7e]+$/, "首版请使用英文邮箱地址");
export const password = z.string().min(12, "密码至少 12 个字符").max(128, "密码不能超过 128 个字符");
export const name = z.string().trim().min(1).max(40);
export const role = z.enum(["admin", "member"]);
export const verificationInput = z.object({ email, registrationToken: z.string().min(30).max(200) }).strict();
export const verifyInput = z.object({ challengeId: id, code: z.string().regex(/^\d{6}$/) }).strict();
export const registerInput = z.object({ emailVerificationTicket: z.string().min(30).max(200), displayName: name, password, registrationToken: z.string().min(30).max(200) }).strict();
export const loginInput = z.object({ email, password: z.string().min(1).max(128), remember: z.boolean().default(false) }).strict();
export const resetInput = z.object({ token: z.string().min(30).max(200), password }).strict();
export const householdInput = z.object({ name, city: z.string().trim().min(1).max(80), timezone: z.literal("Asia/Shanghai").default("Asia/Shanghai") }).strict();
export const childFields = z.object({
  name, birthDate: date.nullable(), ageMonths: z.number().int().min(0).max(216).nullable(),
  foodStatus: z.enum(["unknown", "none", "restricted"]),
  foodRestrictions: z.string().trim().max(1000).default(""),
}).strict();
export const setupInput = z.object({ child: childFields, expectedRevision: revision }).strict();
export const templateInput = z.object({
  expectedRevision: revision,
  slots: z.array(z.object({ label: name, time }).strict()).max(30),
}).strict();
export const itemFields = z.object({
  kind: z.enum(["meal", "activity", "routine"]),
  title: z.string().trim().min(1, "请填写安排").max(120),
  time, notes: z.string().trim().max(2000).default(""), caregiverId: id.nullable().default(null),
  contentId: id.nullable().default(null), contentVersion: revision.nullable().default(null),
  scene: z.enum(["indoor", "outdoor", "either"]).default("either"),
}).strict();
export const itemInput = itemFields.extend({ expectedRevision: revision }).strict();

export type Role = z.infer<typeof role>;
export type ItemFields = z.infer<typeof itemFields>;
export interface Person { id: string; displayName: string; email: string; canCreateHousehold: boolean }
export interface HouseholdSummary { id: string; name: string; role: Role; setupComplete: boolean }
export interface Me { user: Person; households: HouseholdSummary[] }
export interface Child {
  id: string; name: string; birthDate: string | null; ageMonths: number | null;
  ageAsOf: string; foodStatus: "unknown" | "none" | "restricted"; foodRestrictions: string; revision: number;
}
export interface Member { id: string; userId: string; displayName: string; role: Role; revision: number }
export interface Household {
  id: string; name: string; city: string; timezone: string; role: Role; setupComplete: boolean;
  revision: number; child: Child | null; members: Member[];
}
export interface PlanItem extends ItemFields {
  id: string; revision: number; caregiverName: string | null; updatedBy: string; updatedAt: string;
  status: "active" | "cancelled"; contentSnapshot: import("./b2").ContentVersion | null; needsReview?: boolean;
}
export interface DayPlan { id: string; date: string; revision: number; items: PlanItem[] }
export interface Day { date: string; plan: DayPlan | null; householdRevision: number; shopping?: import("./b2").ShoppingNeed[] }
export interface Invite { id: string; role: Role; expiresAt: string; status: "active" | "accepted" | "revoked" | "expired" }
export interface DeviceSession { id: string; device: string; current: boolean; lastSeenAt: string; expiresAt: string; remembered: boolean }
export interface ApiEnvelope<T> { data: T; meta: { requestId: string; serverTime: string } }
