import { NextResponse } from "next/server";
import { verifySignature } from "@/lib/mp";
import { confirmarPagamento } from "@/lib/confirm";
import { avisar } from "@/lib/alerta";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  // O manifesto assinado pelo MP usa o id que veio na query. Notificacao de
  // pagamento manda `data.id`; a de merchant_order manda `id`. Usar o corpo
  // aqui faria a assinatura nao bater quando os dois divergem.
  const dataId = String(url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? body?.data?.id ?? "");
  const type = url.searchParams.get("type") ?? body?.type;

  // O MP tambem manda merchant_order (topic=merchant_order, User-Agent "Feed
  // v2.0"), que este servico ignora por completo. Respondiam 401, entao o MP
  // reenviava sem parar e o painel mostrava 0% de entrega. Nada e feito com
  // essas notificacoes, entao confirmar o recebimento e seguro -- a assinatura
  // continua obrigatoria no unico caminho que age, o de pagamento.
  if (type !== "payment") return NextResponse.json({ ok: true });

  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  const ok = verifySignature({
    xSignature: req.headers.get("x-signature") ?? "",
    xRequestId: req.headers.get("x-request-id") ?? "",
    dataId,
    secret,
  });
  if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  if (dataId) {
    try {
      const r = await confirmarPagamento(dataId);
      console.log("webhook", dataId, r);
    } catch (e) {
      console.error("webhook", dataId, e);
      await avisar("webhook_erro", { pagamento: dataId, erro: String(e) });
      return NextResponse.json({ ok: false }, { status: 500 }); // MP reenvia
    }
  }
  return NextResponse.json({ ok: true });
}
