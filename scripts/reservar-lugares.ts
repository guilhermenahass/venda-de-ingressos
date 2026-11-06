// Bloqueia lugares que a PEC guarda para familia, patrocinador ou equipe: eles
// somem da venda sem existir pedido nenhum por tras. Reversivel.
//
//   npm run lugares:reservar -- <slug> A-1 A-2 B-13
//   npm run lugares:reservar -- <slug> --liberar A-1
import { db } from "../lib/db";

async function main() {
  const args = process.argv.slice(2);
  const liberar = args.includes("--liberar");
  const [slug, ...resto] = args.filter((a) => a !== "--liberar");
  const ids = resto;
  if (!slug || !ids.length) {
    console.error(`uso: npm run lugares:reservar -- <slug> <assento...> [--liberar]
ex.: npm run lugares:reservar -- peckywest-06-11 A-1 A-2 A-3`);
    process.exit(1);
  }

  const { data: ev } = await db.from("events").select("id").eq("slug", slug).single();
  if (!ev) throw new Error(`evento nao encontrado: ${slug}`);

  const { data: atual } = await db.from("event_seats")
    .select("seat_id,status,order_id").eq("event_id", ev.id).in("seat_id", ids);
  const achados = new Set((atual ?? []).map((s) => s.seat_id));
  for (const id of ids) if (!achados.has(id)) throw new Error(`assento nao existe neste evento: ${id}`);

  // vendido de verdade tem pedido atras; bloqueio nosso nao tem. Nunca mexer
  // num assento que alguem comprou.
  const vendidos = (atual ?? []).filter((s) => s.order_id !== null);
  if (vendidos.length) throw new Error(`estes ja foram vendidos a alguem, nao da para mexer: ${vendidos.map((s) => s.seat_id).join(", ")}`);

  const { error } = await db.from("event_seats")
    .update(liberar ? { status: "free", held_until: null } : { status: "sold", held_until: null })
    .eq("event_id", ev.id).in("seat_id", ids).is("order_id", null);
  if (error) throw error;

  console.log(`${ids.length} lugar(es) ${liberar ? "liberados para venda" : "reservados"} em ${slug}: ${ids.join(", ")}`);
}

main().catch((e) => { console.error(String(e.message ?? e)); process.exitCode = 1; });
