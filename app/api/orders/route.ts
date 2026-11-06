import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createPixPayment, createPreference } from "@/lib/mp";
import { avisar } from "@/lib/alerta";

// UUID antes de chegar ao banco: um id malformado viraria erro de cast no meio
// da transação, e a resposta seria um 400 genérico sem dizer o quê
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  // carrinho: um item por sessão. eventId + seatIds sozinhos é o formato de
  // antes (uma sessão só) e continua aceito.
  const brutos: unknown[] = Array.isArray(b?.itens) ? b.itens : [{ eventId: b?.eventId, seatIds: b?.seatIds }];
  const itens = brutos.map((i: any) => ({
    event: String(i?.eventId ?? ""),
    seats: Array.isArray(i?.seatIds) ? i.seatIds.filter((s: unknown) => typeof s === "string") as string[] : [],
    // { "A-1": "meia" }: o banco recusa tipo desconhecido e ignora lugar de fora
    tipos: i?.tipos && typeof i.tipos === "object" && !Array.isArray(i.tipos) ? i.tipos : {},
  })).filter((i) => i.seats.length > 0);
  const totalLugares = itens.reduce((n, i) => n + i.seats.length, 0);
  // caracteres de controle não têm uso num nome e só servem para bagunçar o
  // e-mail, a tela da portaria e a lista impressa
  const name = String(b?.name ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  const email = String(b?.email ?? "").trim();
  const phone = String(b?.phone ?? "").replace(/\D/g, "");
  const method = b?.method;
  // teto de tamanho: as colunas são `text` sem limite, e nome/e-mail entram no
  // e-mail e na lista impressa da portaria
  if (itens.length === 0 || itens.length > 5 || !itens.every((i) => UUID.test(i.event))
      || totalLugares > 30
      || name.length < 3 || name.length > 120 || email.length > 160 || phone.length > 20
      || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || phone.length < 10
      || (method !== "pix" && method !== "card")) {
    return NextResponse.json({ error: "INVALID" }, { status: 400 });
  }

  // lugares que o carrinho já guardou (no toque) entram no pedido
  const cart = UUID.test(String(b?.cartToken ?? "")) ? String(b.cartToken) : null;
  const { data, error } = await db.rpc("create_compra", {
    p_itens: itens, p_name: name, p_email: email, p_phone: phone, p_method: method, p_cart: cart,
  });
  if (error) {
    const m = /SEATS_UNAVAILABLE:([0-9a-f-]{36}):(.+)/.exec(error.message);
    if (m) return NextResponse.json({ error: "SEATS_UNAVAILABLE", eventId: m[1], seats: m[2].split(",") }, { status: 409 });
    if (error.message.includes("EVENT_CLOSED")) return NextResponse.json({ error: "EVENT_CLOSED" }, { status: 409 });
    // INVALID_QTY e afins são do comprador; o resto é problema nosso
    if (!/INVALID_/.test(error.message)) await avisar("pedido_erro", error.message);
    return NextResponse.json({ error: "INVALID" }, { status: 400 });
  }

  const { compra_id, total_cents } = data[0];
  const { data: evs } = await db.from("events").select("id,name,date,max_installments").in("id", itens.map((i) => i.event));
  // "07 de nov.": o Mercado Pago apaga a barra de "07/11" e mostra "0711"
  const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "short" });
  const descricao = itens.map((i) => {
    const ev = evs!.find((e) => e.id === i.event)!;
    return `${dia(ev.date)}: ${i.seats.map((s) => i.tipos[s] === "inteira" || i.tipos[s] === "meia" ? `${s} (${i.tipos[s]})` : s).join(", ")}`;
  }).join(" | ");
  try {
    if (method === "pix") {
      const pix = await createPixPayment({ id: compra_id, total_cents, email, descricao: `${evs![0].name} — ${descricao}` });
      await db.from("orders").update({ mp_payment_id: pix.paymentId }).eq("compra_id", compra_id);
      await db.from("orders").update({ pix_qr: pix.qr, pix_qr_base64: pix.qrBase64 }).eq("id", compra_id);
      // o QR aparece na página do pedido; nada de checkout do Mercado Pago
      return NextResponse.json({ orderId: compra_id, initPoint: `/pedido/${compra_id}` });
    }
    const pref = await createPreference({
      id: compra_id, total_cents, event_name: evs![0].name, email, descricao, quantidade: totalLugares,
      method, max_installments: Math.min(...evs!.map((e) => e.max_installments)),
    });
    await db.from("orders").update({ mp_preference_id: pref.id, mp_init_point: pref.init_point }).eq("compra_id", compra_id);
    return NextResponse.json({ orderId: compra_id, initPoint: pref.init_point });
  } catch (e) {
    console.error("mp", method, e);
    await avisar("mp_fora", e);
    const { data: ps } = await db.from("orders").select("id").eq("compra_id", compra_id);
    await db.from("event_seats")
      .update({ status: "free", held_until: null, order_id: null }).in("order_id", (ps ?? []).map((p) => p.id));
    await db.from("orders").update({ status: "expired" }).eq("compra_id", compra_id);
    return NextResponse.json({ error: "MP_UNAVAILABLE" }, { status: 503 });
  }
}
