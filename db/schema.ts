import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const apiCache = sqliteTable("api_cache", {
  key: text("key").primaryKey(),
  payload: text("payload").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
export const apiUsage = sqliteTable("api_usage", {
  bucket: text("bucket").primaryKey(),
  count: integer("count").notNull().default(0),
});
