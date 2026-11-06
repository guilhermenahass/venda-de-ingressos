import postgres from "postgres";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const sql = postgres(process.env.SUPABASE_DB_URL!, { ssl: "require", max: 1 });
  const dir = join(process.cwd(), "supabase", "migrations");

  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    process.stdout.write(`aplicando ${f}... `);
    await sql.unsafe(readFileSync(join(dir, f), "utf8"));
    console.log("ok");
  }
  await sql.end();
}

main().catch(err => { console.error(err); process.exitCode = 1; });
