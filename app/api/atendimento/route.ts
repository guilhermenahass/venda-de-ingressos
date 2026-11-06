import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checarPin } from "@/lib/pin";

/**
 * Busca de pedidos para a equipe da PEC responder "paguei e não recebi" no
 * WhatsApp: acha a compra por telefone, e-mail ou nome e devolve o link dos
 * ingressos. Protegida pelo mesmo PIN da portaria.
 */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const negado = checarPin(req, b.pin);
  if (negado) return NextResponse.json({ error: negado.error }, { status: negado.status });

  const busca = String(b.busca ?? "").trim().slice(0, 80);
  if (busca.length < 3) return NextResponse.json({ error: "curta" }, { status: 400 });

  let q = db.from("orders")
    // só eventos à venda: pedido de espetáculo encerrado só confundiria a equipe
    .select("id,compra_id,status,buyer_name,email,phone,seat_ids,tipos,em_analise_ate,total_cents,method,created_at,events!inner(name,date,status)")
    .eq("events.status", "open")
    // expirados aparecem também: "eu comprei" de quem deixou o Pix vencer
    // precisa ser respondido com "não pagou", não com "não achei nada"
    .order("created_at", { ascending: false })
    .limit(20);
  let digitos = busca.replace(/\D/g, "");
  // "+55 15 9..." chega com o 55 do país; o telefone foi gravado como digitado
  // na compra, quase sempre sem ele
  if (digitos.length >= 12 && digitos.startsWith("55")) digitos = digitos.slice(2);
  if (busca.includes("@")) q = q.eq("email", busca.toLowerCase());
  else if (digitos.length >= 8) q = q.like("phone", `%${digitos}%`);
  // % e _ são curingas do ilike; fora da busca para ela não virar "tudo"
  else q = q.ilike("buyer_name", `%${busca.replace(/[%_\\]/g, "")}%`);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: "db" }, { status: 500 });
  return NextResponse.json((data ?? []).map((o: any) => ({
    id: o.id, status: o.status === "pending" && o.em_analise_ate && new Date(o.em_analise_ate) > new Date() ? "em_analise" : o.status, nome: o.buyer_name, email: o.email, telefone: o.phone,
    // "A-1 (meia)": a equipe vê o tipo sem abrir o pedido
    lugares: (o.seat_ids as string[]).map((s) => o.tipos?.[s] ? `${s} (${o.tipos[s]})` : s), total: o.total_cents, metodo: o.method, criado: o.created_at,
    evento: o.events?.name, data: o.events?.date,
    link: `${process.env.APP_URL}/pedido/${o.compra_id}`,
  })));
}
