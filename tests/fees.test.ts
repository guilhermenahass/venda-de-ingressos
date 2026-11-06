import { describe, expect, test } from "vitest";
import { db } from "../lib/db";
import { buildPreference } from "../lib/mp";
import { chargedCents } from "../lib/fees";
import { buyer, makeEvent } from "./helpers";

describe("charged_cents: a PEC recebe o preço inteiro, nenhum centavo a menos", () => {
  // a taxa do MP sobre o total, arredondada para cima (o pior caso)
  const sobra = (total: number, fee: number) => total - Math.ceil((total * fee) / 10000);

  test("para todo preço até R$ 300, no Pix e no cartão, sobra exatamente o preço", () => {
    for (const fee of [99, 498])
      for (let net = 1; net <= 30000; net++) {
        const c = chargedCents(net, fee);
        expect(sobra(c, fee)).toBeGreaterThanOrEqual(net);
        // e é o menor total possível: um centavo a menos já faltaria
        expect(sobra(c - 1, fee)).toBeLessThan(net);
      }
  });

  test("somar 5% em cima não basta: R$ 100 no cartão é R$ 105,25, não R$ 105", () => {
    expect(chargedCents(10000, 498)).toBe(10525);
    expect(sobra(10500, 498)).toBeLessThan(10000);
  });

  test.each([[10000, 99], [10000, 498], [5000, 99], [5000, 498], [3500, 498], [99, 498], [6000, 0]])(
    "o banco calcula igual ao site: charged_cents(%i, %i)", async (net, fee) => {
      const { data, error } = await db.rpc("charged_cents", { p_net: net, p_fee_bps: fee, p_rounding: 1 });
      expect(error).toBeNull();
      expect(data).toBe(chargedCents(net, fee));
    });
});

describe("create_order por método", () => {
  // makeEvent não define taxas: usa os defaults do schema (pix 99bps, cartão 498bps, ao centavo)
  test("pix: total = soma dos preços no Pix", async () => {
    const { eventId } = await makeEvent({ seats: 2, priceCents: 6000 });
    const { data, error } = await db.rpc("create_order", {
      p_event: eventId, p_seats: ["ZZTEST-1", "ZZTEST-2"], ...buyer, p_method: "pix",
    });
    expect(error).toBeNull();
    expect(data[0].total_cents).toBe(chargedCents(6000, 99) * 2);
  });

  test("cartão: total = soma dos preços no cartão", async () => {
    const { eventId } = await makeEvent({ seats: 2, priceCents: 6000 });
    const { data, error } = await db.rpc("create_order", {
      p_event: eventId, p_seats: ["ZZTEST-1", "ZZTEST-2"], ...buyer, p_method: "card",
    });
    expect(error).toBeNull();
    expect(data[0].total_cents).toBe(chargedCents(6000, 498) * 2);
  });

  test("método inválido é recusado", async () => {
    const { eventId } = await makeEvent({ seats: 1 });
    const { error } = await db.rpc("create_order", {
      p_event: eventId, p_seats: ["ZZTEST-1"], ...buyer, p_method: "boleto",
    });
    expect(error!.message).toContain("INVALID_METHOD");
  });

  test("orders.method grava o método escolhido", async () => {
    const { eventId } = await makeEvent({ seats: 1 });
    const { data } = await db.rpc("create_order", {
      p_event: eventId, p_seats: ["ZZTEST-1"], ...buyer, p_method: "card",
    });
    const { data: order } = await db.from("orders").select("method").eq("id", data[0].order_id).single();
    expect(order!.method).toBe("card");
  });
});

describe("buildPreference exclui métodos pelo lado escolhido", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    total_cents: 12000, event_name: "Espetáculo 2026", email: "maria@example.com",
    descricao: "06/11: A-1, A-2", quantidade: 2, max_installments: 1,
  };

  test("pix exclui cartão (crédito, débito, pré-pago) e boleto", () => {
    const p: any = buildPreference({ ...base, method: "pix" });
    expect(p.payment_methods.excluded_payment_types).toEqual(
      expect.arrayContaining([{ id: "credit_card" }, { id: "debit_card" }, { id: "prepaid_card" }, { id: "ticket" }]),
    );
    expect(p.payment_methods.excluded_payment_types).not.toContainEqual({ id: "bank_transfer" });
  });

  test("cartão exclui Pix (bank_transfer) e boleto", () => {
    const p: any = buildPreference({ ...base, method: "card" });
    expect(p.payment_methods.excluded_payment_types).toEqual(
      expect.arrayContaining([{ id: "bank_transfer" }, { id: "ticket" }]),
    );
    expect(p.payment_methods.excluded_payment_types).not.toContainEqual({ id: "credit_card" });
  });

  test("installments vem do max_installments do evento", () => {
    const p: any = buildPreference({ ...base, method: "pix", max_installments: 3 });
    expect(p.payment_methods.installments).toBe(3);
  });
});

test("compra de vários ingressos: a PEC recebe a soma exata dos preços", async () => {
  for (const [metodo, fee] of [["pix", 99], ["card", 498]] as const) {
    const { eventId, seatIds } = await makeEvent({ seats: 5, priceCents: 3500 });
    const { data, error } = await db.rpc("create_order", { p_event: eventId, p_seats: seatIds, ...buyer, p_method: metodo });
    expect(error).toBeNull();
    const total = data[0].total_cents;
    expect(total - Math.ceil((total * fee) / 10000)).toBeGreaterThanOrEqual(5 * 3500);
  }
});
