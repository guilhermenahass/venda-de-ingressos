import { Resend } from "resend";
import { db } from "./db";

const TEXTO: Record<string, string> = {
  mp_fora: "O Mercado Pago recusou criar pagamentos. Compradores estão vendo \"Pagamento indisponível\".",
  webhook_erro: "Um aviso de pagamento do Mercado Pago falhou ao ser processado. O MP vai reenviar e a conferência automática também cobre, mas vale olhar.",
  pagamento_resgatado: "A conferência automática achou pagamento aprovado que não tinha chegado pelo aviso do Mercado Pago, e emitiu os ingressos. Tudo resolvido; se repetir muito, o aviso do MP pode estar com problema.",
  reconciliar_falha: "A conferência automática de pagamentos falhou ao consultar o Mercado Pago.",
  pedido_erro: "Erro inesperado do banco ao criar pedidos.",
  carrinho_erro: "Erro inesperado do banco ao guardar lugares.",
  backup_falhou: "O backup diário falhou.",
  pagamento_duplicado: "Uma compra já paga recebeu um segundo pagamento aprovado (comum depois de cartão em análise). O segundo foi estornado automaticamente; vale conferir no painel do Mercado Pago.",
};

/**
 * Avisa a GG Code por e-mail que algo deu errado em produção. No máximo um
 * por tipo a cada 30 min (alerta_pode, no banco). Nunca derruba quem chamou:
 * alerta que falha só vai para o log.
 */
export async function avisar(tipo: keyof typeof TEXTO, detalhe: unknown) {
  try {
    const { data: pode } = await db.rpc("alerta_pode", { p_tipo: tipo });
    if (!pode) return;
    const quando = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    await new Resend(process.env.RESEND_API_KEY!).emails.send({
      from: process.env.MAIL_FROM!,
      to: process.env.BACKUP_EMAIL ?? "alertas@example.com",
      subject: `⚠️ PEC Ingressos: ${TEXTO[tipo].split(".")[0]}`,
      text: `${quando}\n\n${TEXTO[tipo]}\n\nDetalhe técnico:\n${detalhe instanceof Error ? detalhe.message : JSON.stringify(detalhe)}\n\n(Novo alerta deste tipo só daqui a 30 min.)`,
    });
  } catch (e) { console.error("alerta", tipo, e); }
}
