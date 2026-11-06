import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checarPin } from "@/lib/pin";
import { tipoDe } from "@/lib/tipos";

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const negado = checarPin(req, b.pin);
  if (negado) return NextResponse.json({ error: negado.error }, { status: negado.status });

  const slug = typeof b.slug === "string" ? b.slug : null;
  if (!slug) return NextResponse.json({ error: "INVALID" }, { status: 400 });
  // Evento digitado errado faria todo ingresso aparecer "NÃO ENCONTRADO" em
  // vermelho, e a equipe barraria quem tem ingresso válido. Avisa à parte.
  const { data: ev } = await db.from("events").select("id").eq("slug", slug).maybeSingle();
  if (!ev) return NextResponse.json({ error: "EVENTO" }, { status: 404 });

  let token: string | null = typeof b.token === "string" ? b.token : null;
  if (!token && b.code) {
    const codigo = String(b.code).trim();
    const { data } = await db.rpc("token_by_code", { p_slug: slug, p_code: codigo });
    token = data ?? null;
    // não é desta sessão: procura nas outras à venda, para a portaria dizer
    // "ingresso de outro dia" também quando o código é digitado
    if (!token) {
      const { data: outros } = await db.from("events").select("slug").eq("status", "open").neq("slug", slug);
      for (const o of outros ?? []) {
        const { data: t } = await db.rpc("token_by_code", { p_slug: o.slug, p_code: codigo });
        if (t) { token = t; break; }
      }
    }
  }
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return NextResponse.json({ result: "not_found" });

  // p_slug amarra o ingresso ao evento desta portaria: com duas sessões no mesmo
  // dia, o ingresso da tarde não pode dar entrada na porta da noite
  const { data, error } = await db.rpc("checkin_ticket", { p_token: token, p_slug: slug });
  if (error) return NextResponse.json({ error: "db" }, { status: 500 });
  if (data[0]?.result === "not_found") {
    // Família com ingresso dos dois dias mostra o QR do dia errado: dizer qual
    // é o dia certo resolve na hora, em vez de um "não encontrado" que assusta.
    const { data: t } = await db.from("tickets")
      .select("seat_id,orders!inner(status,events!inner(slug,date))").eq("qr_token", token).maybeSingle();
    const outro = (t as any)?.orders?.events;
    if (outro && outro.slug !== slug && (t as any).orders.status === "paid") {
      const dia = new Date(outro.date).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
      return NextResponse.json({ result: "outro_dia", seat_id: t!.seat_id, dia });
    }
  }
  // meia-entrada: a portaria precisa pedir o documento
  if (data[0]?.result === "ok" || data[0]?.result === "already") {
    const { data: t } = await db.from("tickets").select("seat_id,orders(tipos)").eq("qr_token", token).maybeSingle();
    if (t) return NextResponse.json({ ...data[0], tipo: tipoDe((t as any).orders?.tipos, t.seat_id) });
  }
  return NextResponse.json(data[0]);
}
