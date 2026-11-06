import { NextResponse } from "next/server";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Só leitura: o que o Mercado Pago registrou para as compras das últimas horas
// (recusas do antifraude, cartão negado, etc.). Mesmo segredo dos crons.
// Sem dados pessoais na resposta: só método, status e motivo.
export async function GET(req: Request) {
  const esperado = process.env.CRON_SECRET;
  if (!esperado || req.headers.get("authorization") !== `Bearer ${esperado}`) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }
  const horas = Math.min(Number(new URL(req.url).searchParams.get("horas") ?? 2), 24);
  const { data: pedidos } = await db.from("orders").select("id,compra_id,method,status")
    .gte("created_at", new Date(Date.now() - horas * 3600_000).toISOString()).limit(1000);
  // um por compra (o pedido principal tem id = compra_id)
  const lideres = (pedidos ?? []).filter((p) => p.id === p.compra_id);
  const mp = new Payment(new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN! }));
  const resumo: Record<string, number> = {};
  // ?compras=id1,id2: as tentativas de cada uma, uma por uma
  const ids = new URL(req.url).searchParams.get("compras");
  if (ids) {
    const det = await Promise.all(ids.split(",").slice(0, 20).map(async (id) => {
      const r = await mp.search({ options: { external_reference: id } }).catch(() => null);
      return { compra: id, tentativas: (r?.results ?? []).map((x) => ({ id: String(x.id), status: x.status, detalhe: x.status_detail, criado: x.date_created })) };
    }));
    return NextResponse.json(det);
  }
  await Promise.all(lideres.map(async (c) => {
    const r = await mp.search({ options: { external_reference: c.compra_id } }).catch(() => null);
    const ps = (r?.results ?? []).map((x) => `${x.payment_type_id}:${x.status}/${x.status_detail}`);
    for (const s of ps.length ? ps : ["nenhuma tentativa"]) {
      const k = `${c.method} (${c.status}) -> ${s}`;
      resumo[k] = (resumo[k] ?? 0) + 1;
    }
  }));
  return NextResponse.json({ compras: lideres.length, resumo });
}
