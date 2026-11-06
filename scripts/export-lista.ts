import { writeFileSync } from "node:fs";
import { db } from "../lib/db";
import { celula } from "../lib/csv";

async function main() {
  const slug = process.argv[2];
  if (!slug) { console.error("uso: npm run event:export -- <slug>"); process.exit(1); }

  const { data, error } = await db.from("tickets")
    .select("checked_in_at,revoked_at,seats(sector,\"row\",number),orders!inner(buyer_name,phone,status,events!inner(slug))")
    .eq("orders.events.slug", slug).eq("orders.status", "paid").is("revoked_at", null);
  if (error) throw error;

  const rows = (data as any[])
    .sort((a, b) => a.seats.sector.localeCompare(b.seats.sector) || a.seats.row.localeCompare(b.seats.row) || a.seats.number - b.seats.number)
    .map((t) => [t.seats.sector, t.seats.row, t.seats.number, t.orders.buyer_name, t.orders.phone, t.checked_in_at ? "sim" : ""]
      .map(celula).join(";"));

  const out = `lista-${slug}.csv`;
  writeFileSync(out, "﻿setor;fileira;cadeira;nome;telefone;entrou\n" + rows.join("\n"), "utf8");
  console.log(`${rows.length} ingressos em ${out}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
