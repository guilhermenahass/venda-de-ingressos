import { expect, test } from "vitest";
import { db } from "../lib/db";
import { buyer, makeEvent } from "./helpers";

const { p_name, p_email, p_phone, p_method } = buyer;
const hold = (token: string, ev: string, seat: string) =>
  db.rpc("cart_hold", { p_token: token, p_event: ev, p_seat: seat });

test("toque guarda a cadeira: outro carrinho não pega, desmarcar solta", async () => {
  const ev = await makeEvent({ seats: 2 });
  const mae = crypto.randomUUID(), outra = crypto.randomUUID();
  expect((await hold(mae, ev.eventId, ev.seatIds[0])).error).toBeNull();
  expect((await hold(mae, ev.eventId, ev.seatIds[0])).error).toBeNull(); // toque repetido
  expect((await hold(outra, ev.eventId, ev.seatIds[0])).error?.message).toContain("SEAT_UNAVAILABLE");

  await db.rpc("cart_release", { p_token: outra, p_event: ev.eventId, p_seat: ev.seatIds[0] }); // não é dela
  expect((await hold(outra, ev.eventId, ev.seatIds[0])).error?.message).toContain("SEAT_UNAVAILABLE");

  await db.rpc("cart_release", { p_token: mae, p_event: ev.eventId, p_seat: ev.seatIds[0] });
  expect((await hold(outra, ev.eventId, ev.seatIds[0])).error).toBeNull();
});

test("o prazo é do carrinho inteiro, nas duas sessões, e não renova a cada toque", async () => {
  const a = await makeEvent({ seats: 1 }), b = await makeEvent({ seats: 1 });
  const mae = crypto.randomUUID();
  const { data: t1 } = await hold(mae, a.eventId, a.seatIds[0]);
  await new Promise((r) => setTimeout(r, 1100));
  const { data: t2 } = await hold(mae, b.eventId, b.seatIds[0]);
  expect(t2).toBe(t1);
  const { data: v } = await db.rpc("cart_view", { p_token: mae });
  expect(v.map((x: any) => x.seat_ids[0])).toEqual([a.seatIds[0], b.seatIds[0]]);
});

test("prazo vencido: a cadeira volta para a venda", async () => {
  const ev = await makeEvent({ seats: 1 });
  const mae = crypto.randomUUID(), outra = crypto.randomUUID();
  await hold(mae, ev.eventId, ev.seatIds[0]);
  await db.from("event_seats").update({ held_until: new Date(Date.now() - 1000).toISOString() })
    .eq("event_id", ev.eventId);
  expect((await hold(outra, ev.eventId, ev.seatIds[0])).error).toBeNull();
  const { data: v } = await db.rpc("cart_view", { p_token: mae });
  expect(v).toHaveLength(0);
});

test("pagar leva as cadeiras guardadas; sem o token do carrinho, ninguém leva", async () => {
  const ev = await makeEvent({ seats: 1 });
  const mae = crypto.randomUUID();
  await hold(mae, ev.eventId, ev.seatIds[0]);
  const itens = [{ event: ev.eventId, seats: ev.seatIds }];
  const intrusa = await db.rpc("create_compra", { p_itens: itens, p_name, p_email, p_phone, p_method });
  expect(intrusa.error?.message).toContain("SEATS_UNAVAILABLE");
  const { data, error } = await db.rpc("create_compra", { p_itens: itens, p_name, p_email, p_phone, p_method, p_cart: mae });
  expect(error).toBeNull();
  const { data: s } = await db.from("event_seats").select("order_id").eq("event_id", ev.eventId).single();
  expect(s!.order_id).toBe(data[0].compra_id);
  // já virou pedido: sai do carrinho
  expect((await db.rpc("cart_view", { p_token: mae })).data).toHaveLength(0);
});

test("teto de 30 lugares no carrinho", async () => {
  const ev = await makeEvent({ seats: 31 });
  const mae = crypto.randomUUID();
  for (const id of ev.seatIds.slice(0, 30)) expect((await hold(mae, ev.eventId, id)).error).toBeNull();
  expect((await hold(mae, ev.eventId, ev.seatIds[30])).error?.message).toContain("LIMIT");
});

test("teto de 150 lugares guardados por IP, somando carrinhos", async () => {
  const ev = await makeEvent({ seats: 151 });
  const ip = `teste-${crypto.randomUUID()}`;
  const tokens = Array.from({ length: 6 }, () => crypto.randomUUID());
  for (let i = 0; i < 150; i++) {
    const { error } = await db.rpc("cart_hold", { p_token: tokens[Math.floor(i / 30)], p_event: ev.eventId, p_seat: ev.seatIds[i], p_ip: ip });
    expect(error).toBeNull();
  }
  const { error } = await db.rpc("cart_hold", { p_token: tokens[5], p_event: ev.eventId, p_seat: ev.seatIds[150], p_ip: ip });
  expect(error?.message).toContain("LIMIT_IP");
  await db.from("carts").delete().eq("ip", ip);
});

test("cadeira indisponível (fileiras Q e R) não pode ser guardada nem comprada", async () => {
  const ev = await makeEvent({ seats: 1 });
  await db.from("event_seats").update({ status: "blocked" }).eq("event_id", ev.eventId);
  expect((await hold(crypto.randomUUID(), ev.eventId, ev.seatIds[0])).error?.message).toContain("SEAT_UNAVAILABLE");
  const { error } = await db.rpc("create_compra", { p_itens: [{ event: ev.eventId, seats: ev.seatIds }], ...buyer });
  expect(error?.message).toContain("SEATS_UNAVAILABLE");
});
