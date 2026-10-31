import sharp from "sharp";
import type { PoolClient } from "pg";
import type { z } from "zod";
import { garmentCreate, garmentEdit, wardrobeLimits, type Garment, type GarmentFields, type OutfitInput, type Wardrobe } from "../shared/wardrobe";
import { matchOutfits } from "../shared/wardrobe-match";
import { withHousehold, expected, idempotent } from "./households";
import { audit } from "./content";
import { ensure, AppError } from "./errors";
import { readWeather } from "./weather";

interface Row { id: string; fields: GarmentFields; revision: number; photoVersion: number; updatedAt: string; updatedBy: string }
const columns = `i.id,i.fields,i.revision,i.photo_version AS "photoVersion",i.updated_at::text AS "updatedAt",u.display_name AS "updatedBy"`;
function garment(row: Row, householdId: string): Garment {
  const { fields, ...rest } = row;
  return { ...fields, ...rest, photoUrl: "/api/v1/households/" + householdId + "/wardrobe/" + row.id + "/photo?v=" + row.photoVersion };
}
export async function readWardrobe(db: PoolClient, householdId: string): Promise<Wardrobe> {
  const rows = await db.query<Row>(`SELECT ${columns} FROM wardrobe_items i JOIN users u ON u.id=i.updated_by WHERE i.household_id=$1 ORDER BY i.created_at DESC,i.id LIMIT $2`, [householdId, wardrobeLimits.items]);
  return { items: rows.rows.map((r) => garment(r, householdId)), limit: wardrobeLimits.items };
}
export async function wardrobe(raw: string | undefined, householdId: string) { return withHousehold(raw, householdId, (db) => readWardrobe(db, householdId)); }
export async function getGarment(raw: string | undefined, householdId: string, itemId: string) {
  return withHousehold(raw, householdId, (db) => readGarment(db, householdId, itemId));
}
async function readGarment(db: PoolClient, householdId: string, itemId: string) {
  const found = await db.query<Row>(`SELECT ${columns} FROM wardrobe_items i JOIN users u ON u.id=i.updated_by WHERE i.household_id=$1 AND i.id=$2`, [householdId, itemId]);
  ensure(found.rowCount, "NOT_FOUND", "这件衣物不存在或已无访问权限。", 404);
  return garment(found.rows[0], householdId);
}
export async function normalizeGarmentPhoto(data: string) {
  const [header, base64] = data.split(",");
  const photo = Buffer.from(base64, "base64");
  ensure(photo.length > 0 && photo.length <= wardrobeLimits.photoBytes, "INVALID_INPUT", "照片过大，请选择其他照片后重试。", 413);
  const format = header.includes("jpeg") ? "jpeg" : header.includes("png") ? "png" : "webp";
  try {
    const image = sharp(photo, { limitInputPixels: wardrobeLimits.imagePixels, failOn: "warning" });
    const metadata = await image.metadata();
    ensure(metadata.format === format && (metadata.pages ?? 1) === 1, "INVALID_INPUT", "请选择有效的单张 JPG、PNG 或 WebP 照片。", 422);
    // Re-encoding removes EXIF/location metadata; never serve the uploaded bytes directly.
    return await image.rotate().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).flatten({ background: "#f6f8f5" }).jpeg({ quality: 82 }).toBuffer();
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("INVALID_INPUT", "照片无法读取，请换一张 JPG、PNG 或 WebP 照片。", 422);
  }
}
export async function saveGarment(raw: string | undefined, householdId: string, input: z.infer<typeof garmentCreate> | z.infer<typeof garmentEdit>, key: string | undefined, itemId?: string) {
  return withHousehold(raw, householdId, (db, actor) => idempotent(db, actor, householdId + ":wardrobe:" + (itemId ?? "new"), key, input, async () => {
    if (itemId) { const old = await readGarment(db, householdId, itemId); expected(old.revision, (input as z.infer<typeof garmentEdit>).expectedRevision); }
    else {
      const count = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM wardrobe_items WHERE household_id=$1", [householdId]);
      ensure(count.rows[0].count < wardrobeLimits.items, "WARDROBE_FULL", "衣服库已达到 200 件，暂时无法新增；仍可编辑或替换已有衣物。", 422);
    }
    const { photo, ...rest } = input;
    const fields = { ...rest } as GarmentFields & { expectedRevision?: number }; delete fields.expectedRevision;
    const bytes = photo ? await normalizeGarmentPhoto(photo) : null;
    let saved;
    if (itemId) saved = await db.query<{ id: string }>("UPDATE wardrobe_items SET fields=$3,photo=COALESCE($4,photo),photo_version=photo_version+CASE WHEN $4::bytea IS NULL THEN 0 ELSE 1 END,revision=revision+1,updated_by=$5,updated_at=now() WHERE household_id=$1 AND id=$2 RETURNING id", [householdId, itemId, JSON.stringify(fields), bytes, actor.id]);
    else saved = await db.query<{ id: string }>("INSERT INTO wardrobe_items(household_id,fields,photo,updated_by) VALUES ($1,$2,$3,$4) RETURNING id", [householdId, JSON.stringify(fields), bytes, actor.id]);
    const value = await readGarment(db, householdId, saved.rows[0].id);
    await audit(db, householdId, actor, "wardrobe", value.id, itemId ? "update" : "create", value.revision);
    return value;
  }), true);
}
export async function garmentPhoto(raw: string | undefined, householdId: string, itemId: string) {
  return withHousehold(raw, householdId, async (db) => {
    const result = await db.query<{ photo: Buffer }>("SELECT photo FROM wardrobe_items WHERE household_id=$1 AND id=$2", [householdId, itemId]);
    ensure(result.rowCount, "NOT_FOUND", "衣物照片不存在或已无访问权限。", 404);
    return result.rows[0].photo;
  });
}
export async function outfits(raw: string | undefined, householdId: string, input: OutfitInput) {
  return withHousehold(raw, householdId, async (db, _actor, access) => {
    const weather = await readWeather(db, householdId, input, access.timezone);
    return matchOutfits((await readWardrobe(db, householdId)).items, weather, input);
  });
}
