import { NextResponse } from "next/server";
import { reconciliarPendentes } from "@/lib/reconciliar";
import { avisar } from "@/lib/alerta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  // A Vercel manda `Authorization: Bearer $CRON_SECRET` nos cron jobs. Sem o
  // segredo configurado a rota fica fechada, em vez de aberta por engano.
  const esperado = process.env.CRON_SECRET;
  if (!esperado || req.headers.get("authorization") !== `Bearer ${esperado}`) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }
  try {
    const r = await reconciliarPendentes();
    // uma linha por rodada: sem ela não dá para saber, pelos logs, se o cron
    // está rodando (a rede de segurança precisa ser vista funcionando)
    console.log(r.confirmados > 0 ? "reconciliacao: pedidos resgatados" : "reconciliacao: ok", r);
    if (r.confirmados > 0) await avisar("pagamento_resgatado", r);
    if (r.falhas > 0) await avisar("reconciliar_falha", r);
    return NextResponse.json(r);
  } catch (e) {
    console.error("reconciliacao", e);
    await avisar("reconciliar_falha", e);
    return NextResponse.json({ error: "falhou" }, { status: 500 });
  }
}
