import { createHmac, timingSafeEqual } from "node:crypto";
import { MercadoPagoConfig, Payment, PaymentRefund, Preference } from "mercadopago";

const PAYMENT_WINDOW_MS = 10 * 60_000;

export type PrefInput = {
  id: string; total_cents: number; event_name: string; email: string;
  /** "06/11: A-1, A-2 | 07/11: J-5" */ descricao: string; quantidade: number;
  method: "pix" | "card"; max_installments: number;
};
export type MpPayment = {
  id: string; status: string; transaction_amount: number; external_reference: string | null;
  // payment_method_id: ex. "visa", "pix", "bolbradesco" (top-level no retorno da API).
  // net_received_amount: em transaction_details, líquido já descontada a taxa do MP
  // (SDK: PaymentResponse.transaction_details?.net_received_amount, confirmado em
  // node_modules/mercadopago/dist/clients/payment/commonTypes.d.ts).
  payment_method_id: string | null; net_received_amount: number | null;
};

const client = () => new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN! });
const appUrl = () => process.env.APP_URL!;

/** ISO 8601 com offset -03:00 (formato exigido pelo MP). */
export function toMpDate(d: Date): string {
  return new Date(d.getTime() - 3 * 3600_000).toISOString().replace("Z", "-03:00");
}

export function buildPreference(o: PrefInput, now = new Date()) {
  const exp = toMpDate(new Date(now.getTime() + PAYMENT_WINDOW_MS));
  const back = `${appUrl()}/pedido/${o.id}`;
  return {
    external_reference: o.id,
    items: [{
      id: o.id,
      title: `${o.event_name} — ${o.quantidade} ingresso(s): ${o.descricao}`,
      quantity: 1,
      unit_price: o.total_cents / 100,
      currency_id: "BRL",
    }],
    // Sem payer.email de propósito: quando o e-mail digitado já tem conta no
    // Mercado Pago, o checkout exige login em vez de deixar pagar como
    // convidado. O e-mail da compradora fica no nosso pedido, não precisa ir.
    expires: true,
    expiration_date_from: toMpDate(now),
    expiration_date_to: exp,
    date_of_expiration: exp,
    payment_methods: {
      // ids conferidos na documentação do Mercado Pago (payment_type_id):
      // bank_transfer = Pix no Brasil; ticket = boleto. pix exclui cartão
      // (credit_card, debit_card e prepaid_card — este último é um
      // payment_type_id à parte desde 2025, não coberto por excluir só
      // credit_card/debit_card). account_money (saldo em conta) NÃO entra:
      // a doc do MP diz que não pode ser excluído e, testado na prática, a API
      // rejeita a preference inteira com "account_money cannot be excluded".
      excluded_payment_types: o.method === "pix"
        ? [{ id: "credit_card" }, { id: "debit_card" }, { id: "prepaid_card" }, { id: "ticket" }]
        : [{ id: "bank_transfer" }, { id: "ticket" }],
      // Não dá para abrir o checkout já no Pix: account_money não pode ser
      // excluído, e default_payment_method_id: "pix" é recusado pelo próprio MP
      // com "the default payment method is excluded". Quem estiver logado numa
      // conta MP pode cair em "Saldo em conta" e precisa tocar em Alterar.
      installments: o.max_installments,
    },
    back_urls: { success: back, pending: back, failure: back },
    ...(appUrl().startsWith("https://") ? { auto_return: "approved" as const } : {}),
    notification_url: `${appUrl()}/api/webhooks/mp`,
    statement_descriptor: "PEC STUDIO",
  };
}

export async function createPreference(o: PrefInput) {
  const r = await new Preference(client()).create({ body: buildPreference(o) });
  return { id: r.id!, init_point: r.init_point! };
}

export const PIX_WINDOW_MS = 30 * 60_000; // mínimo que o Mercado Pago aceita para o QR

/**
 * Pix pela API: o checkout do Mercado Pago só aceita Pix com login, e a
 * maioria das mães não tem conta. Aqui o QR volta na resposta e aparece na
 * nossa página do pedido. O payer.email é obrigatório na API e não pede login.
 */
export async function createPixPayment(o: { id: string; total_cents: number; descricao: string; email: string }, now = new Date()) {
  const criar = (email: string, chave: string) => new Payment(client()).create({
    body: {
      transaction_amount: o.total_cents / 100,
      payment_method_id: "pix",
      description: o.descricao,
      external_reference: o.id,
      date_of_expiration: toMpDate(new Date(now.getTime() + PIX_WINDOW_MS)),
      notification_url: `${appUrl()}/api/webhooks/mp`,
      payer: { email },
    },
    // a mesma compra nunca gera dois Pix, nem se a requisição for repetida
    requestOptions: { idempotencyKey: chave },
  });
  let p;
  try {
    p = await criar(o.email, o.id);
  } catch (e: any) {
    // O MP recusa alguns e-mails de comprador (digitado errado, domínio que
    // ele não aceita). Sem isto essa pessoa nunca conseguiria pagar no Pix.
    // O e-mail ali só serve de recibo do MP; o nosso pedido guarda o dela.
    if (!(e?.status === 400 && /payer|email/i.test(JSON.stringify(e)))) throw e;
    console.warn("pix: MP recusou o e-mail do comprador, usando o da PEC", e?.message);
    p = await criar(process.env.MAIL_REPLY_TO ?? "contato@example.com", `${o.id}-email-pec`);
  }
  const t = p.point_of_interaction?.transaction_data;
  if (!t?.qr_code) throw new Error(`pix sem QR (status ${p.status})`);
  return { paymentId: String(p.id), qr: t.qr_code, qrBase64: t.qr_code_base64 ?? null };
}

export async function getPayment(id: string): Promise<MpPayment> {
  const p = await new Payment(client()).get({ id });
  return {
    id: String(p.id), status: p.status!, transaction_amount: p.transaction_amount!,
    external_reference: p.external_reference ?? null,
    payment_method_id: p.payment_method_id ?? null,
    net_received_amount: p.transaction_details?.net_received_amount ?? null,
  };
}

export async function findApprovedPaymentByOrder(orderId: string): Promise<MpPayment | null> {
  const r = await new Payment(client()).search({ options: { external_reference: orderId } });
  // aprovado primeiro; senão, um cartão em análise (o chamador guarda os lugares)
  const hit = (r.results ?? []).find((p) => p.status === "approved")
    ?? (r.results ?? []).find((p) => p.status === "in_process");
  return hit ? {
    id: String(hit.id), status: hit.status!, transaction_amount: hit.transaction_amount!,
    external_reference: hit.external_reference ?? null,
    payment_method_id: hit.payment_method_id ?? null,
    net_received_amount: hit.transaction_details?.net_received_amount ?? null,
  } : null;
}

export async function refundPayment(id: string) {
  await new PaymentRefund(client()).create({ payment_id: id });
}

/** Header x-signature: "ts=...,v1=..."; manifest = id:<data.id>;request-id:<x-request-id>;ts:<ts>; */
export function verifySignature(a: { xSignature: string; xRequestId: string; dataId: string; secret: string }) {
  const parts = Object.fromEntries(a.xSignature.split(",").map((p) => p.trim().split("=") as [string, string]));
  if (!parts.ts || !parts.v1) return false;
  const manifest = `id:${a.dataId.toLowerCase()};request-id:${a.xRequestId};ts:${parts.ts};`;
  const expected = createHmac("sha256", a.secret).update(manifest).digest("hex");
  return expected.length === parts.v1.length && timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}
