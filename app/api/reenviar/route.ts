import { NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { sendTicketsMail } from "@/lib/mail";

// ponytail: contador em memória, por instância; se for pra várias instâncias, mover pro banco
// A chave é o contato, não o IP: o abuso aqui é encher a caixa de entrada de uma
// compradora conhecida, e trocar de IP não ajudaria a vítima.
const ultimoEnvio = new Map<string, number>();
const INTERVALO_MS = 5 * 60_000;

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const contact = String(b.contact ?? "").trim().toLowerCase();

  const agora = Date.now();
  if (ultimoEnvio.size > 5000) for (const [k, t] of ultimoEnvio) if (agora - t > INTERVALO_MS) ultimoEnvio.delete(k);
  const anterior = ultimoEnvio.get(contact);
  // resposta idêntica à do caminho normal: continua sem revelar quem comprou
  if (anterior && agora - anterior < INTERVALO_MS) return NextResponse.json({ ok: true });
  ultimoEnvio.set(contact, agora);
  const q = db.from("orders").select("compra_id").eq("status", "paid").order("created_at", { ascending: false }).limit(5);
  const { data } = contact.includes("@") ? await q.eq("email", contact) : await q.eq("phone", contact.replace(/\D/g, ""));
  const compras = [...new Set((data ?? []).map((o) => o.compra_id as string))];
  // after(): garante que os envios rodem até o fim mesmo se a função for congelada logo após a resposta (Vercel)
  after(async () => {
    await Promise.allSettled(compras.map((c) => sendTicketsMail(c).catch((e) => console.error("reenviar", e))));
  });
  return NextResponse.json({ ok: true }); // resposta imediata e igual com ou sem pedido: não revela quem comprou nem vaza timing
}
