import { describe, expect, test, vi } from "vitest";
import { db } from "../lib/db";
import { confirmarPagamento } from "../lib/confirm";
import { buyer, makeEvent } from "./helpers";

async function pendingOrder(seats = 1) {
  const ev = await makeEvent({ seats });
  const { data } = await db.rpc("create_order", { p_event: ev.eventId, p_seats: ev.seatIds, ...buyer });
  const orderId = data[0].order_id as string;
  const { data: order } = await db.from("orders").select("net_expected_cents").eq("id", orderId).single();
  return { ...ev, orderId, total: data[0].total_cents as number, netExpected: order!.net_expected_cents as number };
}

function deps(payment: Partial<{ status: string; amount: number; ref: string; paymentMethodId: string; netReceivedAmount: number }>) {
  return {
    getPayment: vi.fn(async (id: string) => ({
      id, status: payment.status ?? "approved",
      transaction_amount: payment.amount!, external_reference: payment.ref ?? null,
      payment_method_id: payment.paymentMethodId ?? null,
      net_received_amount: payment.netReceivedAmount ?? null,
    })),
    refundPayment: vi.fn(async () => {}),
    sendTicketsMail: vi.fn(async () => {}),
    sendConflictMail: vi.fn(async () => {}),
    findPayment: vi.fn(async () => null as any),
  };
}

describe("confirmarPagamento", () => {
  test("aprovado com valor certo: paid, tickets, e-mail", async () => {
    const o = await pendingOrder(2);
    const d = deps({ amount: o.total / 100, ref: o.orderId });
    expect(await confirmarPagamento("p1", d)).toBe("paid");
    expect(await confirmarPagamento("p1", d)).toBe("already_paid");
    expect(d.sendTicketsMail).toHaveBeenCalledTimes(1);
    const { data: t } = await db.from("tickets").select("id").eq("order_id", o.orderId);
    expect(t).toHaveLength(2);
  });

  test("valor divergente: estorna e marca conflict", async () => {
    const o = await pendingOrder(1);
    const d = deps({ amount: 1, ref: o.orderId });
    expect(await confirmarPagamento("p2", d)).toBe("conflict");
    expect(d.refundPayment).toHaveBeenCalledWith("p2");
    // antes o comprador era estornado em silencio neste caminho
    expect(d.sendConflictMail).toHaveBeenCalledWith(o.orderId, "valor");
    const { data: ord } = await db.from("orders").select("conflict_reason").eq("id", o.orderId).single();
    expect(ord!.conflict_reason).toBe("valor");
  });

  test("assento perdido: estorna, conflict, e-mail de conflito", async () => {
    const o = await pendingOrder(1);
    await db.from("event_seats").update({ held_until: new Date(Date.now() - 1000).toISOString() })
      .eq("event_id", o.eventId);
    await db.rpc("create_order", { p_event: o.eventId, p_seats: o.seatIds, ...buyer });
    const d = deps({ amount: o.total / 100, ref: o.orderId });
    expect(await confirmarPagamento("p3", d)).toBe("conflict");
    expect(d.refundPayment).toHaveBeenCalledWith("p3");
    expect(d.sendConflictMail).toHaveBeenCalledWith(o.orderId, "assento");
  });

  test("aviso repetido de pagamento que virou conflito não estorna duas vezes, mesmo com e-mail falhando", async () => {
    const o = await pendingOrder(1);
    await db.from("event_seats").update({ held_until: new Date(Date.now() - 1000).toISOString() })
      .eq("event_id", o.eventId);
    await db.rpc("create_order", { p_event: o.eventId, p_seats: o.seatIds, ...buyer });
    const d = deps({ amount: o.total / 100, ref: o.orderId });
    d.sendConflictMail.mockRejectedValue(new Error("cota de e-mail esgotada"));
    expect(await confirmarPagamento("p3b", d)).toBe("conflict"); // sem lançar erro
    expect(await confirmarPagamento("p3b", d)).toBe("conflict"); // o MP reenviou
    expect(d.refundPayment).toHaveBeenCalledTimes(1);
  });

  test("refunded depois de pago: libera assento e revoga", async () => {
    const o = await pendingOrder(1);
    const d = deps({ amount: o.total / 100, ref: o.orderId });
    await confirmarPagamento("p4", d);
    const d2 = deps({ status: "refunded", amount: o.total / 100, ref: o.orderId });
    expect(await confirmarPagamento("p4", d2)).toBe("refunded");
    const { data: s } = await db.from("event_seats").select("status").eq("event_id", o.eventId).single();
    expect(s!.status).toBe("free");
  });

  test("Pix que venceu sem pagar: pedido expira (não é estorno) e o lugar volta", async () => {
    const o = await pendingOrder(1);
    expect(await confirmarPagamento("p7c", deps({ status: "cancelled", amount: o.total / 100, ref: o.orderId }))).toBe("ignored");
    const { data: ord } = await db.from("orders").select("status").eq("id", o.orderId).single();
    expect(ord!.status).toBe("expired");
    const { data: s } = await db.from("event_seats").select("status").eq("event_id", o.eventId).single();
    expect(s!.status).toBe("free");
  });

  test("tentativa cancelada não derruba a compra que outra tentativa pagou", async () => {
    const o = await pendingOrder(1);
    await confirmarPagamento("aprovado", deps({ amount: o.total / 100, ref: o.orderId }));
    expect(await confirmarPagamento("outra", deps({ status: "cancelled", amount: o.total / 100, ref: o.orderId }))).toBe("ignored");
    const { data: ord } = await db.from("orders").select("status").eq("id", o.orderId).single();
    expect(ord!.status).toBe("paid");
    const { data: t } = await db.from("tickets").select("revoked_at").eq("order_id", o.orderId);
    expect(t!.every((x) => x.revoked_at === null)).toBe(true);
  });

  test("cartão em análise: lugares guardados por dias; recusado depois, lugares voltam", async () => {
    const o = await pendingOrder(1);
    expect(await confirmarPagamento("an1", deps({ status: "in_process", amount: o.total / 100, ref: o.orderId }))).toBe("ignored");
    const { data: ord } = await db.from("orders").select("status,em_analise_ate").eq("id", o.orderId).single();
    expect(ord!.status).toBe("pending");
    expect(new Date(ord!.em_analise_ate).getTime()).toBeGreaterThan(Date.now() + 2 * 86400_000);
    const { data: s } = await db.from("event_seats").select("status,held_until").eq("event_id", o.eventId).single();
    expect(new Date(s!.held_until).getTime()).toBeGreaterThan(Date.now() + 2 * 86400_000);
    // outra tentativa recusada não mexe na que está em análise
    await confirmarPagamento("outra", deps({ status: "rejected", amount: o.total / 100, ref: o.orderId }));
    expect((await db.from("orders").select("status").eq("id", o.orderId).single()).data!.status).toBe("pending");
    await confirmarPagamento("an1", deps({ status: "rejected", amount: o.total / 100, ref: o.orderId }));
    expect((await db.from("orders").select("status").eq("id", o.orderId).single()).data!.status).toBe("expired");
    expect((await db.from("event_seats").select("status").eq("event_id", o.eventId).single()).data!.status).toBe("free");
  });

  test("1ª tentativa recusada na análise, 2ª ainda em análise: pedido não expira", async () => {
    const o = await pendingOrder(1);
    await confirmarPagamento("t1", deps({ status: "in_process", amount: o.total / 100, ref: o.orderId }));
    const d = deps({ status: "rejected", amount: o.total / 100, ref: o.orderId });
    d.getPayment.mockImplementation(async (id: string) => ({ id, status: id === "t1" ? "rejected" : "in_process",
      transaction_amount: o.total / 100, external_reference: o.orderId, payment_method_id: null, net_received_amount: null }));
    d.findPayment.mockResolvedValue({ id: "t2", status: "in_process" } as any);
    await confirmarPagamento("t1", d);
    const { data: ord } = await db.from("orders").select("status,mp_payment_id").eq("id", o.orderId).single();
    expect(ord).toMatchObject({ status: "pending", mp_payment_id: "t2" });
    expect((await db.from("event_seats").select("status").eq("event_id", o.eventId).single()).data!.status).toBe("held");
  });

  test("cartão em análise aprovado depois: ingresso emitido", async () => {
    const o = await pendingOrder(1);
    await confirmarPagamento("an2", deps({ status: "in_process", amount: o.total / 100, ref: o.orderId }));
    // passa do hold normal de 15 min: continua sendo dela
    expect(await confirmarPagamento("an2", deps({ amount: o.total / 100, ref: o.orderId }))).toBe("paid");
  });

  test("segundo pagamento aprovado numa compra já paga é estornado", async () => {
    const o = await pendingOrder(1);
    await confirmarPagamento("dup1", deps({ amount: o.total / 100, ref: o.orderId }));
    const d = deps({ amount: o.total / 100, ref: o.orderId });
    expect(await confirmarPagamento("dup2", d)).toBe("already_paid");
    expect(d.refundPayment).toHaveBeenCalledWith("dup2");
    // o mesmo aviso repetido do primeiro não estorna nada
    const d1 = deps({ amount: o.total / 100, ref: o.orderId });
    expect(await confirmarPagamento("dup1", d1)).toBe("already_paid");
    expect(d1.refundPayment).not.toHaveBeenCalled();
  });

  test("pending ou sem referência: ignorado", async () => {
    const o = await pendingOrder(1);
    expect(await confirmarPagamento("p5", deps({ status: "pending", amount: 60, ref: o.orderId }))).toBe("ignored");
    expect(await confirmarPagamento("p6", deps({ amount: 60 }))).toBe("ignored");
  });
});

describe("reconciliação do líquido recebido", () => {
  test("líquido recebido abaixo do esperado gera aviso, mas o pedido fica pago", async () => {
    const o = await pendingOrder(1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // account_money não pode ser excluído do checkout: simula esse meio pagando
    // menos líquido do que o price_cents assumia (R$5 de diferença)
    const receivedCents = o.netExpected - 500;
    const d = deps({ amount: o.total / 100, ref: o.orderId, paymentMethodId: "account_money", netReceivedAmount: receivedCents / 100 });
    expect(await confirmarPagamento("p7", d)).toBe("paid");
    expect(warn).toHaveBeenCalledWith(
      "reconciliacao: liquido recebido diverge do esperado",
      expect.objectContaining({ compraId: o.orderId, expectedCents: o.netExpected, receivedCents }),
    );
    const { data: order } = await db.from("orders")
      .select("status,mp_payment_method_id,mp_net_received_cents").eq("id", o.orderId).single();
    expect(order).toMatchObject({ status: "paid", mp_payment_method_id: "account_money", mp_net_received_cents: receivedCents });
    warn.mockRestore();
  });

  test("líquido recebido bate com o esperado: sem aviso", async () => {
    const o = await pendingOrder(1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = deps({ amount: o.total / 100, ref: o.orderId, paymentMethodId: "pix", netReceivedAmount: o.netExpected / 100 });
    expect(await confirmarPagamento("p8", d)).toBe("paid");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test("falha ao gravar a reconciliação não impede a confirmação do pagamento", async () => {
    const o = await pendingOrder(1);
    // db não é injetável via Deps (é importado direto em confirm.ts); para simular
    // uma falha de escrita sem reestruturar o módulo, troca só o .update() dos
    // builders de "orders" por algo que estoura — .select()/.rpc() (usados pelo
    // resto do fluxo: a leitura do pedido e o mark_order_paid) continuam reais.
    const realFrom = db.from.bind(db);
    const fromSpy = vi.spyOn(db, "from").mockImplementation((table: any) => {
      const qb: any = realFrom(table);
      if (table === "orders") qb.update = () => { throw new Error("falha de rede simulada"); };
      return qb;
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({ amount: o.total / 100, ref: o.orderId, paymentMethodId: "pix", netReceivedAmount: o.netExpected / 100 });
    try {
      expect(await confirmarPagamento("p9", d)).toBe("paid");
    } finally {
      fromSpy.mockRestore();
    }
    expect(errSpy).toHaveBeenCalledWith("reconciliacao", o.orderId, expect.any(Error));
    expect(d.sendTicketsMail).toHaveBeenCalledTimes(1);
    const { data: t } = await db.from("tickets").select("id").eq("order_id", o.orderId);
    expect(t).toHaveLength(1);
    errSpy.mockRestore();
  });
});
