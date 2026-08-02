import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { findingMarks } from "@/db/schema";

export async function GET() {
  try {
    const db = await getDb();
    const marks = await db.select().from(findingMarks);
    return Response.json({ marks });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { findingId?: string; fixed?: boolean };
    const findingId = payload.findingId?.trim() ?? "";
    if (!/^[a-f0-9]{8}$/.test(findingId) || typeof payload.fixed !== "boolean") {
      return Response.json({ error: "A valid finding ID and fixed state are required." }, { status: 400 });
    }

    const db = await getDb();
    const [mark] = await db
      .insert(findingMarks)
      .values({ findingId, fixed: payload.fixed })
      .onConflictDoUpdate({
        target: findingMarks.findingId,
        set: { fixed: payload.fixed, updatedAt: sql`CURRENT_TIMESTAMP` },
      })
      .returning();
    return Response.json({ mark });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unexpected database error";
  if (message.includes("no such table") || message.includes("finding_marks")) {
    return "The saved-marks table is not ready yet.";
  }
  return message;
}
