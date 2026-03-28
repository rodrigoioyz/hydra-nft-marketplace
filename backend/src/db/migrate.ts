// Run all migrations in order
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { getPool } from "./pool";

export async function migrate(): Promise<void> {
  const pool = getPool();

  // Create migrations tracking table if not exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         SERIAL PRIMARY KEY,
      filename   TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const migrationsDir = join(__dirname, "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const { rows } = await pool.query(
      "SELECT 1 FROM _migrations WHERE filename = $1",
      [file]
    );
    if (rows.length > 0) {
      console.log(`[migrate] Skipping ${file} (already applied)`);
      continue;
    }

    console.log(`[migrate] Applying ${file}...`);
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    await pool.query(sql);
    await pool.query("INSERT INTO _migrations (filename) VALUES ($1)", [file]);
    console.log(`[migrate] Applied ${file}`);
  }

  console.log("[migrate] All migrations up to date");
}
