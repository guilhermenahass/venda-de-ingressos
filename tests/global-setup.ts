import { db } from "../lib/db";

// Cada rodada de testes cria um evento `t-<timestamp>` por chamada de makeEvent e
// assentos no setor ZZTEST. Sem esta limpeza eles se acumulam no banco: já houve
// 252 eventos abertos e 11 assentos de teste convivendo com o mapa real.
export async function teardown() {
  const { data } = await db.from("events").select("id").like("slug", "t-%");
  const ids = (data ?? []).map((e) => e.id);
  if (ids.length) {
    const { data: ords } = await db.from("orders").select("id").in("event_id", ids);
    const orderIds = (ords ?? []).map((o) => o.id);
    if (orderIds.length) await db.from("tickets").delete().in("order_id", orderIds);
    await db.from("event_seats").delete().in("event_id", ids);
    await db.from("orders").delete().in("event_id", ids);
    await db.from("event_sectors").delete().in("event_id", ids);
    await db.from("events").delete().in("id", ids);
  }
  await db.from("seats").delete().eq("sector", "ZZTEST");
  console.log(`\nlimpeza: ${ids.length} evento(s) de teste e os assentos ZZTEST removidos`);
}
