import type { NextRequest } from "next/server";
import { handle } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
async function route(request: NextRequest, context: Context) { return handle(request, (await context.params).path); }
export { route as GET, route as POST, route as PUT, route as PATCH, route as DELETE };
