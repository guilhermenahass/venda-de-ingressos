// Simula a abertura das vendas: N compradoras ao mesmo tempo, todas
// disputando as fileiras da frente. Descartavel: cria o evento, mede, apaga.
import { db } from "../lib/db";

const N = Number(process.argv[2] ?? 200);

async function main() {
  const slug = `carga-${Date.now()}`;
  const { data: seats } = await db.from("seats").select("id,sector,\"row\",number").order("y").order("x");
  if (!seats?.length) throw new Error("rode npm run db:seed");
  const setores = [...new Set(seats.map((s) => s.sector))];

  const { data: ev } = await db.from("events")
    .insert({ slug, name: `Carga ${slug}`, date: new Date(Date.now() + 864e5).toISOString(), status: "open" })
    .select().single();
  const abriu = new Date(Date.now() - 60_000).toISOString();
  await db.from("event_sectors").insert(setores.map((s) => ({ event_id: ev!.id, sector: s, price_cents: 6000, sales_open_at: abriu })));
  await db.from("event_seats").insert(seats.map((s) => ({ event_id: ev!.id, seat_id: s.id })));
  console.log(`evento ${slug}: ${seats.length} assentos, ${setores.length} setores`);

  // frente = primeiro terco do mapa, que e onde a briga acontece de verdade
  const frente = seats.slice(0, Math.ceil(seats.length / 3)).map((s) => s.id);
  const compras = Array.from({ length: N }, () => {
    const qtd = 1 + Math.floor(Math.random() * 4);
    return Array.from({ length: qtd }, () => frente[Math.floor(Math.random() * frente.length)]);
  });

  const t0 = Date.now();
  const res = await Promise.all(compras.map(async (p_seats) => {
    const t = Date.now();
    const { data, error } = await db.rpc("create_order", {
      p_event: ev!.id, p_seats, p_name: "Mae Teste", p_email: "mae@example.com", p_phone: "15999990000", p_method: "pix",
    });
    return { ms: Date.now() - t, pedidos: p_seats, erro: error?.message, row: data?.[0] };
  }));
  const total = Date.now() - t0;

  const ok = res.filter((r) => !r.erro);
  const indisp = res.filter((r) => r.erro?.includes("SEATS_UNAVAILABLE"));
  const outros = res.filter((r) => r.erro && !r.erro.includes("SEATS_UNAVAILABLE"));
  const lat = res.map((r) => r.ms).sort((a, b) => a - b);
  const p = (q: number) => lat[Math.floor(lat.length * q)];

  console.log(`\n${N} compras simultaneas em ${total} ms`);
  console.log(`  vendidas .......... ${ok.length}`);
  console.log(`  SEATS_UNAVAILABLE . ${indisp.length}`);
  console.log(`  erro inesperado ... ${outros.length}`);
  for (const o of outros.slice(0, 5)) console.log(`      ${o.erro}`);
  console.log(`  latencia p50 ${p(0.5)} ms | p95 ${p(0.95)} ms | max ${lat.at(-1)} ms`);

  // A invariante que importa: nenhum assento pode estar em dois pedidos
  const { data: ordens } = await db.from("orders").select("id,seat_ids,status,total_cents").eq("event_id", ev!.id);
  const vivos = (ordens ?? []).filter((o) => o.status !== "expired");
  const visto = new Map<string, string>();
  const dupes: string[] = [];
  for (const o of vivos) for (const s of o.seat_ids ?? []) {
    if (visto.has(s)) dupes.push(`${s}: pedidos ${visto.get(s)} e ${o.id}`); else visto.set(s, o.id);
  }
  console.log(`\n  assentos reservados ... ${visto.size}`);
  console.log(`  ASSENTO EM DOIS PEDIDOS . ${dupes.length === 0 ? "nenhum (ok)" : dupes.length + " !!!"}`);
  for (const d of dupes.slice(0, 10)) console.log(`      ${d}`);

  // total cobrado bate com a quantidade de assentos?
  const errado = vivos.filter((o) => o.total_cents !== (o.seat_ids?.length ?? 0) * 6100);
  console.log(`  total errado em ......... ${errado.length} pedido(s)`);
  for (const e of errado.slice(0, 5)) console.log(`      ${e.id}: ${e.seat_ids?.length} assentos, total ${e.total_cents}`);

  // event_seats.order_id referencia orders: soltar o vinculo antes de apagar
  await db.from("event_seats").delete().eq("event_id", ev!.id);
  await db.from("orders").delete().eq("event_id", ev!.id);
  await db.from("event_sectors").delete().eq("event_id", ev!.id);
  await db.from("events").delete().eq("id", ev!.id);
  console.log(`\nevento ${slug} apagado`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
