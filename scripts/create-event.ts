import { readFileSync } from "node:fs";
import { db } from "../lib/db";
import { csvToSeats } from "../lib/seats-grid";
import { chargedCents } from "../lib/fees";

const FEE_DEFAULTS = { fee_pix_bps: 99, fee_card_bps: 498, rounding_cents: 1, max_installments: 1 };

async function main() {
  const [slug, name, date, sectorsJson, feesJson] = process.argv.slice(2);
  if (!slug || !name || !date || !sectorsJson) {
    console.error(`uso: npm run event:create -- <slug> "<nome>" "<data ISO com offset>" '<json setores>' ['<json taxas>']
ATENCAO: price_cents e o valor LIQUIDO que a PEC recebe, nao o preco na tela.
O preco cobrado sai da tabela impressa no final deste comando.
ex.: npm run event:create -- natal-2026 "Espetáculo de Natal" "2026-12-05T20:00:00-03:00" '[{"sector":"Plateia VIP","price_cents":8000,"sales_open_at":"2026-10-01T10:00:00-03:00"},{"sector":"Plateia","price_cents":6000,"sales_open_at":"2026-10-03T10:00:00-03:00"},{"sector":"Balcão","price_cents":4000,"sales_open_at":"2026-10-05T10:00:00-03:00"}]'
taxas (opcional, padrão do schema se ausente): '{"fee_pix_bps":99,"fee_card_bps":498,"rounding_cents":1,"max_installments":1}'`);
    process.exit(1);
  }
  const sectors: {
    sector: string; price_cents: number; sales_open_at: string;
    price2_cents?: number; price_change_at?: string;
  }[] = JSON.parse(sectorsJson);
  const fees = { ...FEE_DEFAULTS, ...(feesJson ? JSON.parse(feesJson) : {}) };

  // O evento é montado a partir do mapa do teatro (data/teatro.csv), não de tudo
  // que estiver na tabela seats: assentos de outra planta ou de teste ficam de fora.
  const mapa = new Set(csvToSeats(readFileSync("data/teatro.csv", "utf8")).map((s) => s.sector));
  for (const s of sectors) if (!mapa.has(s.sector)) throw new Error(`setor desconhecido: ${s.sector}`);
  for (const sec of mapa) if (!sectors.some((s) => s.sector === sec)) throw new Error(`falta preço do setor: ${sec}`);

  const { data: seats, error: e0 } = await db.from("seats").select("id,sector").in("sector", [...mapa]);
  if (e0) throw e0;
  if (!seats?.length) throw new Error("nenhum assento no banco para esses setores: rode npm run db:seed");

  const { data: ev, error } = await db.from("events").insert({ slug, name, date, status: "open", ...fees }).select().single();
  if (error) throw error;

  const { error: e1 } = await db.from("event_sectors").insert(sectors.map((s) => ({ event_id: ev.id, ...s })));
  if (e1) throw e1;
  const { error: e2 } = await db.from("event_seats").insert(seats.map((s) => ({ event_id: ev.id, seat_id: s.id })));
  if (e2) throw e2;

  console.log(`evento ${slug} criado: ${seats.length} assentos, ${sectors.length} setores`);
  console.log(`${process.env.APP_URL}/evento/${slug}`);

  const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  console.log("\nsetor".padEnd(20) + "líquido".padStart(12) + "pix".padStart(12) + "cartão".padStart(12));
  for (const s of sectors) {
    const pix = chargedCents(s.price_cents, fees.fee_pix_bps, fees.rounding_cents);
    const card = chargedCents(s.price_cents, fees.fee_card_bps, fees.rounding_cents);
    console.log(s.sector.padEnd(20) + brl(s.price_cents).padStart(12) + brl(pix).padStart(12) + brl(card).padStart(12));
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
