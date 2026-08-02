import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const findingMarks = sqliteTable("finding_marks", {
  findingId: text("finding_id").primaryKey(),
  fixed: integer("fixed", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
