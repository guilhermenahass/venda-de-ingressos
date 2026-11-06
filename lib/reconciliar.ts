import { db } from "./db";
import { checkPendingOrder } from "./confirm";

// O webhook e a consulta ativa em /pedido/{id} cobrem o caso normal, mas os dois
// falham juntos num cenario simples: a pessoa paga, fecha o navegador, e a
// notificacao do Mercado Pago nao chega (401 de assinatura, instabilidade,
// retry esgotado). Sem isto o pedido fica `pending` para sempre: dinheiro
// debitado, nenhum ingresso, nenhum e-mail, nenhum estorno, e ninguem sabe.
//
// Esta varredura pergunta ao proprio Mercado Pago se existe pagamento aprovado
// para cada pedido pendente. E a mesma pergunta que /pedido/{id} faz, so que
// sem depender de alguem abrir a pagina.

const IDADE_MINIMA_MS = 2 * 60_000;   // da tempo do fluxo normal terminar sozinho
// O Pix vence em 30 min e o checkout do cartão em 10: depois de 3 h nenhum
// pagamento novo chega. Pedido pendente mais velho que isso é compra
// abandonada; ele expira, para não ocupar a vez dos que ainda podem ter
// sido pagos. (Antes a janela era de 7 dias, do mais antigo para o mais
// novo: com 50 compras abandonadas, um pagamento perdido nunca era visto.)
const IDADE_MAXIMA_MS = 3 * 3600_000;
const MAXIMO_POR_RODADA = 50;         // teto de chamadas ao MP por execucao

export type Resultado = { verificados: number; confirmados: number; falhas: number };
export type Deps = { checkPendingOrder: typeof checkPendingOrder };

export type Opcoes = {
  agora?: number;
  deps?: Deps;
  /**
   * Restringe a varredura a um evento. Em produção fica de fora, porque a
   * rede de segurança precisa alcançar todos. Em teste é OBRIGATÓRIO: sem
   * isto a suíte varre os pedidos de verdade do banco e marca como pagos
   * pedidos que ninguém pagou. Aconteceu.
   */
  eventId?: string;
};

export async function reconciliarPendentes(o: Opcoes = {}): Promise<Resultado> {
  const agora = o.agora ?? Date.now();
  const deps = o.deps ?? { checkPendingOrder };

  let q = db.from("orders")
    .select("compra_id")
    .eq("status", "pending")
    .lt("created_at", new Date(agora - IDADE_MINIMA_MS).toISOString())
    // cartão em análise no MP continua sendo conferido até a análise acabar
    .or(`created_at.gt.${new Date(agora - IDADE_MAXIMA_MS).toISOString()},em_analise_ate.gt.${new Date(agora).toISOString()}`);
  if (o.eventId) q = q.eq("event_id", o.eventId);

  // abandonados: expiram (se um pagamento ainda aparecer, o aviso dele vira
  // conflito e é estornado sozinho, como qualquer pagamento atrasado)
  let velhos = db.from("orders").update({ status: "expired" })
    .eq("status", "pending").lt("created_at", new Date(agora - IDADE_MAXIMA_MS).toISOString())
    .or(`em_analise_ate.is.null,em_analise_ate.lt.${new Date(agora).toISOString()}`);
  if (o.eventId) velhos = velhos.eq("event_id", o.eventId);
  await velhos;

  // os mais novos primeiro: são os que ainda podem ter um pagamento chegando
  const { data, error } = await q.order("created_at", { ascending: false }).limit(MAXIMO_POR_RODADA);
  if (error) throw error;

  // o pagamento é da compra, que pode juntar pedidos das duas sessões
  const pendentes = [...new Set((data ?? []).map((o) => o.compra_id as string))];
  let confirmados = 0, falhas = 0;
  for (const compraId of pendentes) {
    try {
      await deps.checkPendingOrder(compraId);
      const { data: depois } = await db.from("orders").select("status").eq("id", compraId).single();
      // conflict tambem conta: o pagamento foi achado e estornado, o pedido saiu do limbo
      if (depois && depois.status !== "pending") confirmados += 1;
    } catch (e) {
      // um pedido problematico nao pode impedir a varredura dos outros
      falhas += 1;
      console.error("reconciliar", compraId, e);
    }
  }
  return { verificados: pendentes.length, confirmados, falhas };
}
