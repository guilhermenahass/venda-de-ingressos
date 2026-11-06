import { expect, test, vi } from "vitest";
import { db } from "../lib/db";
import { confirmarPagamento } from "../lib/confirm";
import { buyer, makeEvent } from "./helpers";

const { p_name, p_email, p_phone, p_method } = buyer;
const compra = (itens: { event: string; seats: string[] }[]) =>
  db.rpc("create_compra", { p_itens: itens, p_name, p_email, p_phone, p_method });

function deps(amount: number, ref: string) {
  return {
    getPayment: vi.fn(async (id: string) => ({
      id, status: "approved", transaction_amount: amount, external_reference: ref,
      payment_method_id: "pix", net_received_amount: null,
    })),
    refundPayment: vi.fn(async () => {}),
    sendTicketsMail: vi.fn(async () => {}),
    sendConflictMail: vi.fn(async () => {}),
  };
}

test("duas sessões, um pagamento: os dois pedidos pagos, ingressos de cada sessão", async () => {
  const a = await makeEvent({ seats: 2 }), b = await makeEvent({ seats: 2 });
  const { data, error } = await compra([
    { event: a.eventId, seats: a.seatIds }, { event: b.eventId, seats: [b.seatIds[0]] },
  ]);
  expect(error).toBeNull();
  const { compra_id, total_cents } = data[0];
  const { data: pedidos } = await db.from("orders").select("id,event_id,total_cents").eq("compra_id", compra_id);
  expect(pedidos).toHaveLength(2);
  expect(pedidos!.reduce((n, p) => n + p.total_cents, 0)).toBe(total_cents);

  const d = deps(total_cents / 100, compra_id);
  expect(await confirmarPagamento("c1", d)).toBe("paid");
  expect(await confirmarPagamento("c1", d)).toBe("already_paid");
  for (const p of pedidos!) {
    const { data: t } = await db.from("tickets").select("id").eq("order_id", p.id);
    expect(t).toHaveLength(p.event_id === a.eventId ? 2 : 1);
  }
});

test("lugar tomado numa sessão: nada fica reservado na outra, e o erro diz qual sessão", async () => {
  const a = await makeEvent({ seats: 1 }), b = await makeEvent({ seats: 1 });
  await db.from("event_seats").update({ status: "sold" }).eq("event_id", b.eventId);
  const { error } = await compra([{ event: a.eventId, seats: a.seatIds }, { event: b.eventId, seats: b.seatIds }]);
  expect(error?.message).toContain(`SEATS_UNAVAILABLE:${b.eventId}:${b.seatIds[0]}`);
  const { data: s } = await db.from("event_seats").select("status").eq("event_id", a.eventId).single();
  expect(s!.status).toBe("free");
});

test("mais de 30 lugares somando as sessões é recusado", async () => {
  const a = await makeEvent({ seats: 1 });
  const muitos = Array.from({ length: 16 }, (_, i) => `X-${i + 1}`);
  const { error } = await compra([{ event: a.eventId, seats: muitos }, { event: crypto.randomUUID(), seats: muitos.map((x) => x + "b") }]);
  expect(error?.message).toContain("INVALID_QTY");
});

test("pagamento atrasado que perdeu lugar numa sessão: compra inteira estornada, nenhum ingresso", async () => {
  const a = await makeEvent({ seats: 1 }), b = await makeEvent({ seats: 1 });
  const { data } = await compra([{ event: a.eventId, seats: a.seatIds }, { event: b.eventId, seats: b.seatIds }]);
  const { compra_id, total_cents } = data[0];
  // o hold da sessão b venceu e outra pessoa levou o lugar
  await db.from("event_seats").update({ status: "sold", order_id: null }).eq("event_id", b.eventId);

  const d = deps(total_cents / 100, compra_id);
  expect(await confirmarPagamento("c2", d)).toBe("conflict");
  expect(d.refundPayment).toHaveBeenCalledWith("c2");
  const { data: pedidos } = await db.from("orders").select("id,status,conflict_reason").eq("compra_id", compra_id);
  expect(pedidos!.map((p) => p.status)).toEqual(["conflict", "conflict"]);
  expect(pedidos!.every((p) => p.conflict_reason === "assento")).toBe(true);
  const { data: t } = await db.from("tickets").select("id").in("order_id", pedidos!.map((p) => p.id));
  expect(t).toHaveLength(0);
});

test("avisos de pagamento simultâneos: só um responde 'paid' (um e-mail só)", async () => {
  const a = await makeEvent({ seats: 2 });
  const { data } = await compra([{ event: a.eventId, seats: a.seatIds }]);
  const rs = await Promise.all(Array.from({ length: 6 }, () =>
    db.rpc("mark_compra_paid", { p_compra: data[0].compra_id, p_payment_id: "x" })));
  expect(rs.filter((r) => r.data === "paid")).toHaveLength(1);
  expect(rs.filter((r) => r.data === "already_paid")).toHaveLength(5);
});

test("tipos de ingresso: inteira cobra o dobro, meia e antecipado o preço do setor; tipo inventado é recusado", async () => {
  const ev = await makeEvent({ seats: 3 });
  const [s1, s2, s3] = ev.seatIds;
  const base = await compra([{ event: ev.eventId, seats: [s1] }]);
  const umLugar = base.data[0].total_cents;
  const { data: o1 } = await db.from("orders").select("net_expected_cents").eq("id", base.data[0].compra_id).single();
  await db.from("event_seats").update({ status: "free", held_until: null, order_id: null }).eq("event_id", ev.eventId);

  const { data, error } = await db.rpc("create_compra", {
    p_itens: [{ event: ev.eventId, seats: [s1, s2, s3], tipos: { [s1]: "meia", [s2]: "inteira", [s3]: "antecipado", "Z-99": "inteira" } }],
    p_name, p_email, p_phone, p_method,
  });
  expect(error).toBeNull();
  const { data: o } = await db.from("orders").select("net_expected_cents,tipos").eq("id", data[0].compra_id).single();
  expect(o!.net_expected_cents).toBe(o1!.net_expected_cents * 4);
  // só o que não é antecipado, e só lugares do pedido
  expect(o!.tipos).toEqual({ [s1]: "meia", [s2]: "inteira" });
  expect(data[0].total_cents).toBeGreaterThan(umLugar * 3);

  const ruim = await db.rpc("create_compra", {
    p_itens: [{ event: ev.eventId, seats: [s1], tipos: { [s1]: "gratis" } }], p_name, p_email, p_phone, p_method,
  });
  expect(ruim.error?.message).toContain("INVALID_TIPO");
});
