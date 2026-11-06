import { nomeTipo, tipoDe } from "./tipos";
import { Resend } from "resend";
import { db } from "./db";
import { WHATSAPP_PEC_EXIBICAO } from "./contato";

const resend = () => new Resend(process.env.RESEND_API_KEY!);
const appUrl = () => process.env.APP_URL!;

// onboarding@resend.dev so entrega para o dono da conta Resend: em producao
// nenhuma compradora receberia o ingresso, e a falha seria silenciosa
if (process.env.MAIL_FROM?.includes("resend.dev") && process.env.NODE_ENV === "production") {
  console.error("MAIL_FROM ainda usa o dominio de teste do Resend: so o dono da conta recebe e-mail");
}

// E-mail não tem variável de CSS: as cores do mundo Ferro e Chapa vão inline.
const FERRO = "#14110d", FERRO_FACE = "#221c15", LATAO = "#c08a2e";
const PAPEL = "#e7dcc4", PAPEL_SOMBRA = "#cdbf9f", TINTA = "#1a1512", LEITURA = "#d8caac";

/** Moldura do e-mail: chão de ferro, cabeçalho gravado, miolo no conteúdo. */
function moldura(titulo: string, corpo: string) {
  return `<div style="margin:0;padding:24px 12px;background:${FERRO}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto">
      <tr><td style="background:${FERRO_FACE};border:1px solid ${LATAO}66;padding:18px 20px;text-align:center">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:19px;color:${PAPEL}">${titulo}</div>
      </td></tr>
      <tr><td style="padding:20px 20px 4px;color:${LEITURA};font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55">
        ${corpo}
      </td></tr>
      <tr><td style="padding:18px 20px 0;text-align:center;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${LEITURA}80;font-family:Arial,Helvetica,sans-serif">
        Dúvidas: WhatsApp da PEC ${WHATSAPP_PEC_EXIBICAO}<br>PEC Studio · dança · música · arte
      </td></tr>
    </table>
  </div>`;
}

/** O e-mail só chega a qualquer compradora com um domínio verificado. No
 * domínio de teste do Resend ele chega apenas ao dono da conta. */
export function emailAtivo(): boolean {
  const de = process.env.MAIL_FROM ?? "";
  return de.length > 0 && !de.includes("resend.dev");
}

export function esc(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(s).replace(/[&<>"']/g, (c) => map[c]);
}

/** Uma compra pode ter pedidos de mais de uma sessão; o e-mail é um só. */
async function loadCompra(compraId: string) {
  const { data: pedidos, error } = await db.from("orders")
    .select("id,buyer_name,email,events(name,date)").eq("compra_id", compraId).order("id");
  if (error) throw error;
  if (!pedidos?.length) throw new Error(`compra ${compraId} não existe`);
  const { data: tickets, error: e2 } = await db.from("tickets")
    .select("qr_token,seat_id,seats(sector,\"row\",number),orders(tipos,events(date))")
    .in("order_id", pedidos.map((p) => p.id)).is("revoked_at", null);
  if (e2) throw e2;
  const ts = ((tickets ?? []) as any[])
    .sort((a, b) => a.orders.events.date.localeCompare(b.orders.events.date) || a.seat_id.localeCompare(b.seat_id));
  return { order: { ...(pedidos[0] as any), id: compraId }, pedidos: pedidos as any[], tickets: ts };
}

const sessao = (iso: string) => new Date(iso).toLocaleString("pt-BR",
  { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export async function sendTicketsMail(compraId: string) {
  const { order, pedidos, tickets } = await loadCompra(compraId);
  if (tickets.length === 0) throw new Error(`compra ${compraId} sem tickets`);
  const date = pedidos.map((p) => sessao(p.events.date)).join(" e ");
  const items = tickets.map((t) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0">
      <tr><td style="background:${PAPEL};padding:20px 16px;text-align:center;border:1px solid ${PAPEL_SOMBRA}">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1;color:${TINTA}">${esc(t.seats.row)}-${t.seats.number}</div>
        <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${TINTA}99;margin-top:4px">${esc(t.seats.sector)}${" · " + nomeTipo(tipoDe(t.orders.tipos, t.seat_id))} · ${sessao(t.orders.events.date)}</div>
        <img src="${appUrl()}/t/${t.qr_token}/qr.png" width="200" height="200" alt="QR do ingresso ${esc(t.seats.row)}-${t.seats.number}" style="display:block;margin:14px auto 0">
        <div style="font-size:13px;color:${TINTA}b3;margin-top:6px">Código manual: <b style="letter-spacing:2px">${String(t.qr_token).slice(-6).toUpperCase()}</b></div>
        <a href="${appUrl()}/t/${t.qr_token}" style="display:inline-block;margin-top:12px;font-size:13px;color:${TINTA}">Abrir ingresso</a>
      </td></tr>
    </table>`).join("");

  await resend().emails.send({
    from: process.env.MAIL_FROM!,
    // o remetente não tem caixa de entrada; resposta de compradora vai para cá
    ...(process.env.MAIL_REPLY_TO ? { replyTo: process.env.MAIL_REPLY_TO } : {}),
    to: order.email,
    subject: `Seus ingressos — ${order.events.name}`,
    html: moldura(esc(order.events.name), `
      <p style="margin:0 0 10px">Olá, ${esc(order.buyer_name)}!</p>
      <p style="margin:0 0 4px">Pagamento confirmado. ${date}.</p>
      ${items}
      <p style="margin:14px 0 0;font-size:14px">Apresente o QR na entrada. Cada QR vale para uma pessoa.</p>
      <p style="margin:8px 0 0;font-size:14px">
        Todos os ingressos também estão em
        <a href="${appUrl()}/pedido/${order.id}" style="color:${LATAO}">${appUrl()}/pedido/${order.id}</a>.
      </p>`),
  });
}

export type ConflictReason = "assento" | "valor";

const CONFLICT_TEXT: Record<ConflictReason, string> = {
  assento: "Seu pagamento chegou depois do prazo e o assento já havia sido liberado para outra pessoa.",
  valor: "O valor pago não conferiu com o total do pedido, então a compra não pôde ser concluída.",
};

export async function sendConflictMail(compraId: string, reason: ConflictReason = "assento") {
  const { order } = await loadCompra(compraId);
  await resend().emails.send({
    from: process.env.MAIL_FROM!,
    // o remetente não tem caixa de entrada; resposta de compradora vai para cá
    ...(process.env.MAIL_REPLY_TO ? { replyTo: process.env.MAIL_REPLY_TO } : {}),
    to: order.email,
    subject: `Pedido não concluído — ${order.events.name}`,
    html: moldura(esc(order.events.name), `
      <p style="margin:0 0 10px">Olá, ${esc(order.buyer_name)}.</p>
      <p style="margin:0 0 10px">${CONFLICT_TEXT[reason]}
      O valor foi <strong style="color:${PAPEL}">estornado automaticamente</strong> pelo Mercado Pago
      (o prazo de devolução depende do seu banco ou cartão).</p>
      <p style="margin:0">Você pode escolher outro lugar em
        <a href="${appUrl()}" style="color:${LATAO}">${appUrl()}</a>.</p>`),
  });
}
