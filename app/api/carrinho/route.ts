import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { avisar } from "@/lib/alerta";

/**
 * Carrinho guardado no servidor: cada toque numa cadeira reserva o lugar por
 * 10 minutos para este carrinho (ver 0013_carrinho_reserva.sql). O token é
 * gerado no celular da pessoa e só ela conhece; sem ele não dá para soltar
 * nem ver o carrinho de ninguém.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASSENTO = /^[A-Z]{1,3}-\d{1,3}$/;
const semCache = { "Cache-Control": "no-store" };
// na Vercel o primeiro endereço de x-forwarded-for é o do visitante (a borda
// sobrescreve o cabeçalho; o cliente não consegue forjar)
const ip = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null;

async function ver(token: string) {
  const { data, error } = await db.rpc("cart_view", { p_token: token });
  if (error) throw error;
  const itens = (data ?? []).map((r: any) => ({
    eventId: r.event_id, slug: r.slug, seats: r.seat_ids as string[], net: r.net_cents, pix: r.pix_cents, card: r.card_cents,
    rotulo: new Date(r.date).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }),
  }));
  return { restaSeg: data?.length ? Math.min(...data.map((r: any) => r.resta_seg)) : null, itens };
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!UUID.test(token)) return NextResponse.json({ error: "INVALID" }, { status: 400 });
  try { return NextResponse.json(await ver(token), { headers: semCache }); }
  catch (e) { console.error("carrinho", e); return NextResponse.json({ error: "DB" }, { status: 500 }); }
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  const token = String(b?.token ?? ""), eventId = String(b?.eventId ?? "");
  const seatId = b?.seatId == null ? null : String(b.seatId);
  if (!UUID.test(token) || !UUID.test(eventId) || (seatId !== null && !ASSENTO.test(seatId))
      || (b?.acao !== "pegar" && b?.acao !== "soltar") || (b.acao === "pegar" && seatId === null)) {
    return NextResponse.json({ error: "INVALID" }, { status: 400 });
  }

  const { error } = b.acao === "pegar"
    ? await db.rpc("cart_hold", { p_token: token, p_event: eventId, p_seat: seatId, p_ip: ip(req) })
    : await db.rpc("cart_release", { p_token: token, p_event: eventId, p_seat: seatId });
  if (error) {
    for (const codigo of ["SEAT_UNAVAILABLE", "LIMIT_IP", "LIMIT", "EVENT_CLOSED"])
      if (error.message.includes(codigo)) return NextResponse.json({ error: codigo, ...(await ver(token)) }, { status: 409, headers: semCache });
    console.error("carrinho", error);
    await avisar("carrinho_erro", error.message);
    return NextResponse.json({ error: "DB" }, { status: 500 });
  }
  return NextResponse.json(await ver(token), { headers: semCache });
}
