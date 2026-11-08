import { DatabaseSync } from "node:sqlite";
import { getMigrations } from "better-auth/db/migration";
import { writeFile } from "node:fs/promises";
const database = new DatabaseSync(":memory:");
const migration = await getMigrations({
  database,
  rateLimit: { enabled: true, storage: "database" },
});
await writeFile(
  "migrations/auth/0001_better_auth.sql",
  await migration.compileMigrations(),
);
database.close();
