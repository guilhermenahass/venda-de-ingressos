import { describe, expect, test } from "vitest";
import { db } from "../lib/db";
import { buyer, makeEvent } from "./helpers";

async function comLote(precoAgora: number, precoDepois: number, viraEmMin: number) {
  const ev = await makeEvent({ seats: 2, priceCents: precoAgora });
  await db.from("event_sectors").update({
    price2_cents: precoDepois,
    price_change_at: new Date(Date.now() + viraEmMin * 60_000).toISOString(),
  }).eq("event_id", ev.eventId);
  return ev;
}

describe("preco por lote", () => {
  test("antes da virada cobra o preco promocional", async () => {
    const ev = await comLote(5000, 7000, 60);
    const { data } = await db.rpc("create_order", { p_event: ev.eventId, p_seats: [ev.seatIds[0]], ...buyer });
    expect(data[0].total_cents).toBe(5050); // 5000 liquido + 0,99% de Pix, ao centavo
  });

  test("depois da virada cobra o preco cheio", async () => {
    const ev = await comLote(5000, 7000, -60);
    const { data } = await db.rpc("create_order", { p_event: ev.eventId, p_seats: [ev.seatIds[0]], ...buyer });
    expect(data[0].total_cents).toBe(7070);
  });

  test("sem lote configurado nada muda", async () => {
    const ev = await makeEvent({ seats: 1, priceCents: 5000 });
    const { data } = await db.rpc("create_order", { p_event: ev.eventId, p_seats: ev.seatIds, ...buyer });
    expect(data[0].total_cents).toBe(5050);
  });

  test("o liquido esperado acompanha o lote, senao a reconciliacao acusa divergencia falsa", async () => {
    const ev = await comLote(5000, 7000, -60);
    const { data } = await db.rpc("create_order", { p_event: ev.eventId, p_seats: [ev.seatIds[0]], ...buyer });
    const { data: o } = await db.from("orders").select("net_expected_cents").eq("id", data[0].order_id).single();
    expect(o!.net_expected_cents).toBe(7000);
  });

  test("preco novo sem data (ou data sem preco) e recusado pelo banco", async () => {
    const ev = await makeEvent({ seats: 1 });
    const { error } = await db.from("event_sectors").update({ price2_cents: 9000 }).eq("event_id", ev.eventId);
    expect(error).not.toBeNull();
  });
});
