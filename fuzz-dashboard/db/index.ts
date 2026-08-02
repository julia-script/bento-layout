import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

const marksTableSql = `CREATE TABLE IF NOT EXISTS finding_marks (
  finding_id text PRIMARY KEY NOT NULL,
  fixed integer DEFAULT false NOT NULL,
  updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;

export async function getDb() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  await env.DB.prepare(marksTableSql).run();
  return drizzle(env.DB, { schema });
}
