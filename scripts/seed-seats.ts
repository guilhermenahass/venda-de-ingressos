import { readFileSync } from "node:fs";
import { db } from "../lib/db";
import { csvToSeats } from "../lib/seats-grid";

async function main() {
  const file = process.argv[2] ?? "data/teatro.csv";
  const seats = csvToSeats(readFileSync(file, "utf8"));
  const { error } = await db.from("seats").upsert(seats, { onConflict: "id" });
  if (error) throw error;
  console.log(`${seats.length} assentos gravados`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
