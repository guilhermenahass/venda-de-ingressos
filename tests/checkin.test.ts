import { describe, expect, test } from "vitest";
import { db } from "../lib/db";
import { buyer, makeEvent } from "./helpers";

async function paidOrder(seats = 2) {
  const ev = await makeEvent({ seats });
  const { data } = await db.rpc("create_order", {
    p_event: ev.eventId, p_seats: ev.seatIds.slice(0, seats), ...buyer,
  });
  const orderId = data[0].order_id as string;
  const { data: r } = await db.rpc("mark_order_paid", { p_order: orderId, p_payment_id: "pay-1" });
  expect(r).toBe("paid");
  const { data: tickets } = await db.from("tickets").select("qr_token,seat_id").eq("order_id", orderId);
  return { ...ev, orderId, tickets: tickets! };
}

describe("mark_order_paid", () => {
  test("vende assentos, gera tickets e é idempotente", async () => {
    const { orderId, tickets, eventId } = await paidOrder(2);
    expect(tickets).toHaveLength(2);
    const { data: sold } = await db.from("event_seats").select("status").eq("event_id", eventId);
    expect(sold!.filter((s) => s.status === "sold")).toHaveLength(2);
    const { data: again } = await db.rpc("mark_order_paid", { p_order: orderId, p_payment_id: "pay-1" });
    expect(again).toBe("already_paid");
  });

  test("conflito: assento já foi para outro pedido", async () => {
    const ev = await makeEvent({ seats: 1 });
    const { data: a } = await db.rpc("create_order", { p_event: ev.eventId, p_seats: ["ZZTEST-1"], ...buyer });
    await db.from("event_seats").update({ held_until: new Date(Date.now() - 1000).toISOString() })
      .eq("event_id", ev.eventId).eq("seat_id", "ZZTEST-1");
    const { data: b } = await db.rpc("create_order", { p_event: ev.eventId, p_seats: ["ZZTEST-1"], ...buyer }); // outro pedido pega
    const { data: r } = await db.rpc("mark_order_paid", { p_order: a[0].order_id, p_payment_id: "pay-late" });
    expect(r).toBe("conflict");
    const { data: o } = await db.from("orders").select("status").eq("id", a[0].order_id).single();
    expect(o!.status).toBe("conflict");
    // regressão: nenhum ticket deve ser emitido para o pedido que perdeu a posse,
    // e o assento continua com o pedido B (não sobrescrito nem liberado)
    const { data: tk } = await db.from("tickets").select("id").eq("order_id", a[0].order_id);
    expect(tk).toHaveLength(0);
    const { data: seat } = await db.from("event_seats").select("order_id")
      .eq("event_id", ev.eventId).eq("seat_id", "ZZTEST-1").single();
    expect(seat!.order_id).toBe(b[0].order_id);
  });
});

describe("mark_order_refunded", () => {
  test("revoga tickets e libera assentos", async () => {
    const { orderId, eventId, tickets, slug } = await paidOrder(1);
    await db.rpc("mark_order_refunded", { p_order: orderId });
    const { data: t } = await db.from("tickets").select("revoked_at").eq("order_id", orderId).single();
    expect(t!.revoked_at).not.toBeNull();
    const { data: s } = await db.from("event_seats").select("status,order_id").eq("event_id", eventId).single();
    expect(s).toMatchObject({ status: "free", order_id: null });
    const { data: c } = await db.rpc("checkin_ticket", { p_token: tickets[0].qr_token, p_slug: slug });
    expect(c[0].result).toBe("revoked");
  });
});

describe("checkin_ticket", () => {
  test("ok na primeira, already na segunda", async () => {
    const { tickets, slug } = await paidOrder(1);
    const { data: first } = await db.rpc("checkin_ticket", { p_token: tickets[0].qr_token, p_slug: slug });
    expect(first[0]).toMatchObject({ result: "ok", seat_id: "ZZTEST-1", buyer_name: "Maria Teste" });
    const { data: second } = await db.rpc("checkin_ticket", { p_token: tickets[0].qr_token, p_slug: slug });
    expect(second[0].result).toBe("already");
    expect(second[0].checked_in_at).not.toBeNull();
  });

  test("token desconhecido", async () => {
    const { data } = await db.rpc("checkin_ticket", { p_token: "00000000-0000-4000-8000-000000000000", p_slug: "qualquer" });
    expect(data[0].result).toBe("not_found");
  });

  // duas sessoes no mesmo dia: o ingresso da tarde nao pode entrar na porta da noite
  test("ingresso de outro evento nao entra nesta portaria", async () => {
    const { tickets } = await paidOrder(1);
    const outra = await paidOrder(1);
    const { data } = await db.rpc("checkin_ticket", { p_token: tickets[0].qr_token, p_slug: outra.slug });
    expect(data[0].result).toBe("not_found");
  });

  test("token_by_code acha pelo sufixo dentro do evento", async () => {
    const { slug, tickets } = await paidOrder(1);
    const code = String(tickets[0].qr_token).slice(-6);
    const { data } = await db.rpc("token_by_code", { p_slug: slug, p_code: code });
    expect(data).toBe(tickets[0].qr_token);
  });

  // 6 caracteres hex colidem de vez em quando. Devolver um dos dois faria a
  // portaria dar entrada na pessoa errada e recusar a dona do codigo.
  test("codigo repetido em dois ingressos nao resolve para nenhum", async () => {
    const { slug, orderId, tickets, seatIds } = await paidOrder(2);
    const code = String(tickets[0].qr_token).slice(-6);
    const gemeo = String(tickets[1].qr_token).slice(0, -6) + code;
    await db.from("tickets").update({ qr_token: gemeo }).eq("qr_token", tickets[1].qr_token);

    const { data } = await db.rpc("token_by_code", { p_slug: slug, p_code: code });
    expect(data).toBeNull();

    // o QR continua resolvendo: so a digitacao do sufixo fica ambigua
    const { data: porToken } = await db.rpc("checkin_ticket", { p_token: tickets[0].qr_token, p_slug: slug });
    expect(porToken[0].result).toBe("ok");
    expect(orderId).toBeTruthy();
    expect(seatIds.length).toBe(2);
  });
});
