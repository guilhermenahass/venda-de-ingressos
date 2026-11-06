import { db } from "./db";
import * as mp from "./mp";
import * as mail from "./mail";
import { avisar } from "./alerta";

/** Quanto os lugares ficam guardados enquanto o MP analisa um cartão. */
export const EM_ANALISE_MS = 3 * 86400_000;

export type Deps = {
  getPayment: typeof mp.getPayment;
  refundPayment: typeof mp.refundPayment;
  sendTicketsMail: typeof mail.sendTicketsMail;
  sendConflictMail: typeof mail.sendConflictMail;
  findPayment: typeof mp.findApprovedPaymentByOrder;
};
const defaultDeps: Deps = {
  getPayment: mp.getPayment, refundPayment: mp.refundPayment, findPayment: mp.findApprovedPaymentByOrder,
  sendTicketsMail: mail.sendTicketsMail, sendConflictMail: mail.sendConflictMail,
};

export type ConfirmResult = "paid" | "already_paid" | "conflict" | "refunded" | "ignored";

/**
 * Idempotente. Chamada pelo webhook, pelo retorno do checkout e por retries.
 * O external_reference do pagamento é o compra_id: um pagamento cobre os
 * pedidos de todas as sessões do carrinho.
 */
export async function confirmarPagamento(paymentId: string, partial: Partial<Deps> = {}): Promise<ConfirmResult> {
  const d = { ...defaultDeps, ...partial };
  const p = await d.getPayment(paymentId);
  const compraId = p.external_reference;
  if (!compraId) return "ignored";

  if (["refunded", "cancelled", "charged_back"].includes(p.status)) {
    const { data: ps } = await db.from("orders").select("id,status,mp_payment_id").eq("compra_id", compraId);
    // Só desfaz a compra se ESTE pagamento é o que pagou. Uma tentativa de
    // cartão cancelada não pode cancelar os ingressos de outra tentativa
    // aprovada da mesma compra.
    if ((ps ?? []).some((o) => o.status === "paid" && o.mp_payment_id === paymentId)) {
      await db.rpc("mark_compra_refunded", { p_compra: compraId });
      return "refunded";
    }
    // Pix que venceu sem pagar chega como "cancelled": nenhum dinheiro entrou,
    // então o pedido expira (não é estorno) e os lugares voltam para a venda.
    const pendentes = (ps ?? []).filter((o) => o.status === "pending").map((o) => o.id);
    if (p.status === "cancelled" && pendentes.length) {
      await db.from("event_seats").update({ status: "free", held_until: null, order_id: null })
        .in("order_id", pendentes).eq("status", "held");
      await db.from("orders").update({ status: "expired" }).in("id", pendentes);
    }
    return "ignored";
  }

  // Cartão em análise no antifraude do MP: o valor está reservado e a resposta
  // pode levar até 2 dias. Guarda os lugares até lá (o hold normal do cartão é
  // de 15 min, e a aprovação tardia viraria conflito e estorno).
  if (p.status === "in_process") {
    const { data: ps } = await db.from("orders").select("id,status").eq("compra_id", compraId);
    const pend = (ps ?? []).filter((o) => o.status === "pending").map((o) => o.id);
    if (pend.length) {
      const ate = new Date(Date.now() + EM_ANALISE_MS).toISOString();
      await db.from("orders").update({ em_analise_ate: ate, mp_payment_id: paymentId }).in("id", pend);
      await db.from("event_seats").update({ held_until: ate }).in("order_id", pend).eq("status", "held");
    }
    return "ignored";
  }
  // a análise recusou o pagamento que segurava os lugares: eles voltam à venda
  if (p.status === "rejected") {
    const { data: ps } = await db.from("orders").select("id,status,mp_payment_id,em_analise_ate").eq("compra_id", compraId);
    const pend = (ps ?? []).filter((o) => o.status === "pending" && o.em_analise_ate && o.mp_payment_id === paymentId)
      .map((o) => o.id);
    if (pend.length) {
      // A mãe pode ter tentado de novo enquanto a 1ª estava em análise: se outra
      // tentativa ainda está em análise (ou aprovada), os lugares passam para ela.
      let outra: Awaited<ReturnType<typeof mp.findApprovedPaymentByOrder>> = null;
      try { outra = await d.findPayment(compraId); } catch (e) {
        console.error("rejeitado: consulta ao MP falhou, pedido segue em análise", compraId, e);
        return "ignored"; // na dúvida não solta; a reconciliação tenta de novo
      }
      if (outra && outra.id !== paymentId) return confirmarPagamento(outra.id, partial);
      await db.from("event_seats").update({ status: "free", held_until: null, order_id: null })
        .in("order_id", pend).eq("status", "held");
      await db.from("orders").update({ status: "expired", em_analise_ate: null }).in("id", pend);
    }
    return "ignored";
  }
  if (p.status !== "approved") return "ignored";

  const { data: pedidos } = await db.from("orders")
    .select("id,status,total_cents,method,net_expected_cents,mp_payment_id").eq("compra_id", compraId);
  if (!pedidos?.length) return "ignored";
  if (pedidos.every((o) => o.status === "paid")) {
    // Segundo pagamento aprovado para uma compra já paga (ex.: a mãe tentou de
    // novo enquanto o primeiro estava em análise, e os dois passaram). O
    // ingresso é um só: devolve este.
    if (pedidos.some((o) => o.mp_payment_id && o.mp_payment_id !== paymentId)) {
      await d.refundPayment(paymentId);
      console.warn("pagamento duplicado estornado", compraId, paymentId);
      await avisar("pagamento_duplicado", { compra: compraId, estornado: paymentId });
    }
    return "already_paid";
  }
  // Este pagamento já virou conflito (e foi estornado) numa chamada anterior:
  // não estorna de novo. Sem isto, qualquer erro depois do estorno (e-mail
  // sem cota, por exemplo) fazia o MP reenviar o aviso e o estorno repetir.
  if (pedidos.some((o) => o.status === "conflict" && o.mp_payment_id === paymentId)) return "conflict";
  const total = pedidos.reduce((n, o) => n + o.total_cents, 0);

  if (Math.round(p.transaction_amount * 100) !== total) {
    // estorna primeiro e só então marca o conflito: se o estorno falhar, o
    // reenvio do aviso tenta de novo; se der certo, o "já virou conflito"
    // acima impede um segundo estorno
    await d.refundPayment(paymentId);
    await db.from("orders")
      .update({ status: "conflict", conflict_reason: "valor", mp_payment_id: paymentId }).eq("compra_id", compraId);
    // sem isto o comprador era estornado em silencio: nada na tela dizia o motivo
    // e nenhum e-mail saia
    try { await d.sendConflictMail(compraId, "valor"); } catch (e) { console.error("mail", e); }
    return "conflict";
  }

  // reconciliação: account_money não pode ser excluído do checkout (constraint do MP),
  // então um pedido cotado no Pix ainda pode ser pago com saldo em conta — e a taxa
  // real pode não bater com o fee_pix_bps assumido. Guarda o que a MP diz ter
  // repassado e loga divergência; nunca bloqueia ou estorna por causa disto, o
  // comprador já pagou o total certo (conferido acima). Bookkeeping não pode
  // derrubar a confirmação de um pagamento que já foi aprovado (mesma regra do
  // e-mail de tickets, mais abaixo). O líquido é da compra inteira, então fica
  // gravado só no pedido principal (id = compra_id), para não somar em dobro.
  try {
    const netReceivedCents = p.net_received_amount != null ? Math.round(p.net_received_amount * 100) : null;
    await db.from("orders").update({ mp_payment_method_id: p.payment_method_id }).eq("compra_id", compraId);
    await db.from("orders").update({ mp_net_received_cents: netReceivedCents }).eq("id", compraId);
    const esperado = pedidos.reduce((n, o) => n + (o.net_expected_cents ?? 0), 0);
    if (netReceivedCents != null && Math.abs(netReceivedCents - esperado) > 2) {
      console.warn("reconciliacao: liquido recebido diverge do esperado", {
        compraId, method: pedidos[0].method, expectedCents: esperado, receivedCents: netReceivedCents,
      });
    }
  } catch (e) { console.error("reconciliacao", compraId, e); }

  const { data: r, error } = await db.rpc("mark_compra_paid", { p_compra: compraId, p_payment_id: paymentId });
  if (error) throw error;
  if (r === "conflict") {
    await d.refundPayment(paymentId);
    await db.from("orders").update({ conflict_reason: "assento" }).eq("compra_id", compraId).eq("status", "conflict");
    // e-mail não pode derrubar o aviso: o estorno já foi feito
    try { await d.sendConflictMail(compraId, "assento"); } catch (e) { console.error("mail", e); }
    return "conflict";
  }
  if (r === "paid") {
    // e-mail não pode derrubar a confirmação: pedido já está pago no banco
    try { await d.sendTicketsMail(compraId); } catch (e) { console.error("mail", e); }
  }
  return r as ConfirmResult;
}

/** Consulta ativa: usada quando a compradora volta do checkout antes do webhook chegar. */
export async function checkPendingOrder(compraId: string) {
  const p = await mp.findApprovedPaymentByOrder(compraId);
  if (p) await confirmarPagamento(p.id);
}
