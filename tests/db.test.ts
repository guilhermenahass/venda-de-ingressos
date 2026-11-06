import { describe, expect, test } from "vitest";
import { db } from "../lib/db";
import { buyer, makeEvent } from "./helpers";

describe("create_order", () => {
  test("reserva e calcula total no servidor", async () => {
    const { eventId } = await makeEvent({ seats: 3, priceCents: 6000 });
    const { data, error } = await db.rpc("create_order", {
      p_event: eventId, p_seats: ["ZZTEST-1", "ZZTEST-2"], ...buyer,
    });
    expect(error).toBeNull();
    // price_cents (6000) é o líquido; total cobrado no Pix (default 99bps, arred. 50) = 6100 por assento
    expect(data[0].total_cents).toBe(6060 * 2); // 6000 + 0,99% de Pix, ao centavo
    const { data: es } = await db.from("event_seats")
      .select("seat_id,status,order_id").eq("event_id", eventId).eq("status", "held");
    expect(es).toHaveLength(2);
    expect(es!.every((r) => r.order_id === data[0].order_id)).toBe(true);
  });

  test("corrida: 10 pedidos simultâneos no mesmo assento, só 1 vence", async () => {
    const { eventId } = await makeEvent({ seats: 1 });
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        db.rpc("create_order", { p_event: eventId, p_seats: ["ZZTEST-1"], ...buyer })),
    );
    const ok = results.filter((r) => !r.error);
    const fail = results.filter((r) => r.error);
    expect(ok).toHaveLength(1);
    expect(fail).toHaveLength(9);
    expect(fail[0].error!.message).toContain("SEATS_UNAVAILABLE:ZZTEST-1");
  });

  test("tudo ou nada: um assento ocupado derruba o pedido inteiro", async () => {
    const { eventId } = await makeEvent({ seats: 3 });
    await db.rpc("create_order", { p_event: eventId, p_seats: ["ZZTEST-2"], ...buyer });
    const { error } = await db.rpc("create_order", {
      p_event: eventId, p_seats: ["ZZTEST-1", "ZZTEST-2", "ZZTEST-3"], ...buyer,
    });
    expect(error!.message).toContain("SEATS_UNAVAILABLE:ZZTEST-2");
    const { data: held } = await db.from("event_seats")
      .select("seat_id").eq("event_id", eventId).eq("status", "held");
    expect(held!.map((r) => r.seat_id)).toEqual(["ZZTEST-2"]);
  });

  test("setor ainda fechado é recusado", async () => {
    const { eventId } = await makeEvent({ seats: 1, opensInMinutes: 60 });
    const { error } = await db.rpc("create_order", { p_event: eventId, p_seats: ["ZZTEST-1"], ...buyer });
    expect(error!.message).toContain("SEATS_UNAVAILABLE:ZZTEST-1");
  });

  test("hold vencido é retomado por outro pedido", async () => {
    const { eventId } = await makeEvent({ seats: 1 });
    const { data: first } = await db.rpc("create_order", { p_event: eventId, p_seats: ["ZZTEST-1"], ...buyer });
    await db.from("event_seats")
      .update({ held_until: new Date(Date.now() - 60_000).toISOString() })
      .eq("event_id", eventId).eq("seat_id", "ZZTEST-1");
    const { data: second, error } = await db.rpc("create_order", { p_event: eventId, p_seats: ["ZZTEST-1"], ...buyer });
    expect(error).toBeNull();
    expect(second[0].order_id).not.toBe(first[0].order_id);
  });

  test("30 ingressos passam, 31 são recusados", async () => {
    const { eventId } = await makeEvent({ seats: 31 });
    const seats = Array.from({ length: 31 }, (_, i) => `ZZTEST-${i + 1}`);
    const { error } = await db.rpc("create_order", { p_event: eventId, p_seats: seats, ...buyer });
    expect(error!.message).toContain("INVALID_QTY");
    const { data, error: e30 } = await db.rpc("create_order", { p_event: eventId, p_seats: seats.slice(0, 30), ...buyer });
    expect(e30).toBeNull();
    expect(data[0].order_id).toBeTruthy();
  });
});
