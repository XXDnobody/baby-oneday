import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hash, verify, type Algorithm } from "@node-rs/argon2";

export const token = () => randomBytes(32).toString("base64url");
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const protectedDigest = (secret: string, value: string) => createHmac("sha256", secret).update(value).digest("hex");
export function equals(a: string, b: string) {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export const hashPassword = (password: string) => hash(password, { algorithm: 2 as Algorithm, memoryCost: 19456, timeCost: 2, parallelism: 1 }); // 2 = Argon2id
export const verifyPassword = async (password: string, encoded: string) => {
  try { return await verify(encoded, password); } catch { return false; }
};
