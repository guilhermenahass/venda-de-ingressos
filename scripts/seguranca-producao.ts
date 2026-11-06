// Tenta, contra o site no ar, os ataques e abusos que o sistema precisa
// recusar. Não deixa rastro: pedidos criados aqui são desfeitos no fim.
//
//   npx tsx --env-file=.env.local scripts/seguranca-producao.ts
//
// Rode na véspera da abertura e depois de qualquer deploy grande.
import { db } from "../lib/db";

const ALVO = process.env.ALVO ?? "https://pec-ingressos.vercel.app";
const SLUG = process.argv[2] ?? "peckywest-06-11";
const MARCA = `Seguranca ${Date.now().toString(36)}`;
let falhas = 0;

function confere(nome: string, ok: boolean, detalhe = "") {
  if (!ok) falhas++;
  console.log(`${ok ? "  ok   " : "  FALHA"} ${nome}${detalhe ? ` (${detalhe})` : ""}`);
}
const post = (rota: string, corpo: unknown, headers: Record<string, string> = {}) =>
  fetch(`${ALVO}${rota}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(corpo) });

async function main() {
  const { data: ev } = await db.from("events").select("id").eq("slug", SLUG).single();
  const { data: livres } = await db.from("event_seats").select("seat_id").eq("event_id", ev!.id).eq("status", "free").limit(1000);
  const lugar = livres!.map((s) => s.seat_id).filter((id) => /^[N-R]-/.test(id));
  if (lugar.length < 5) throw new Error("poucos lugares livres no fundo para testar");
  const comprador = { name: MARCA, email: "seguranca@example.com", phone: "15999990000" };

  console.log("Pedidos");
  let r = await post("/api/orders", { eventId: ev!.id, seatIds: [lugar[0]], method: "pix", ...comprador, total_cents: 1, price: 1, totalCents: 1 });
  let j: any = await r.json();
  const { data: o } = await db.from("orders").select("total_cents").eq("id", j.orderId ?? "00000000-0000-0000-0000-000000000000").maybeSingle();
  confere("preço mandado pelo navegador é ignorado", r.ok && (o?.total_cents ?? 0) > 100, `cobrado R$ ${(o?.total_cents ?? 0) / 100}`);
  confere("método de pagamento inventado é recusado", (await post("/api/orders", { eventId: ev!.id, seatIds: [lugar[1]], method: "boleto", ...comprador })).status === 400);
  confere("31 lugares num pedido é recusado", (await post("/api/orders", { eventId: ev!.id, seatIds: Array.from({ length: 31 }, (_, i) => `R-${i + 1}`), method: "pix", ...comprador })).status === 400);
  confere("evento inexistente é recusado", !(await post("/api/orders", { eventId: "00000000-0000-4000-8000-000000000000", seatIds: [lugar[2]], method: "pix", ...comprador })).ok);
  confere("injeção de SQL no evento é recusada", (await post("/api/orders", { eventId: "' or 1=1 --", seatIds: [lugar[2]], method: "pix", ...comprador })).status === 400);
  confere("nome gigante é recusado", (await post("/api/orders", { eventId: ev!.id, seatIds: [lugar[3]], method: "pix", ...comprador, name: "a".repeat(500) })).status === 400);
  r = await post("/api/orders", { eventId: ev!.id, seatIds: [lugar[4]], method: "pix", ...comprador, name: `<img src=x onerror=alert(1)> ${MARCA}` });
  j = await r.json();
  const html = j.orderId ? await (await fetch(`${ALVO}/pedido/${j.orderId}`)).text() : "";
  confere("nome com código HTML é exibido como texto, não executado", !!j.orderId && !html.includes("<img src=x") && html.includes("&lt;img"));

  console.log("Pagamento (webhook do Mercado Pago)");
  const wh = (h: Record<string, string>) => post("/api/webhooks/mp?data.id=123&type=payment", { type: "payment", data: { id: "123" } }, h);
  confere("aviso de pagamento sem assinatura é recusado", (await wh({})).status === 401);
  confere("aviso de pagamento com assinatura falsa é recusado", (await wh({ "x-signature": "ts=1,v1=" + "0".repeat(64), "x-request-id": "x" })).status === 401);

  console.log("Equipe");
  confere("portaria sem PIN é recusada", (await post("/api/checkin", { slug: SLUG, code: "ABCDEF" })).status === 401);
  confere("portaria com o PIN antigo (1234) é recusada", (await post("/api/checkin", { pin: "1234", slug: SLUG, code: "ABCDEF" })).status === 401);
  confere("atendimento sem PIN é recusado", (await post("/api/atendimento", { busca: "seguranca@example.com" })).status === 401);
  confere("rede de segurança (cron) sem a senha é recusada", (await fetch(`${ALVO}/api/cron/reconciliar`)).status === 401);

  console.log("Site");
  confere("id malformado na ocupação não chega ao banco", (await fetch(`${ALVO}/api/events/nao-e-uuid/seats`)).status === 404);
  const occ = await (await fetch(`${ALVO}/api/events/${ev!.id}/seats`)).text();
  confere("ocupação não expõe dado de comprador", !/@|order_id|buyer|phone/.test(occ));
  const cab = (await fetch(`${ALVO}/`)).headers;
  for (const h of ["content-security-policy", "x-frame-options", "x-content-type-options", "strict-transport-security", "referrer-policy", "permissions-policy"])
    confere(`cabeçalho ${h}`, !!cab.get(h));
  confere("site não anuncia a tecnologia (x-powered-by)", !cab.get("x-powered-by"));
  const cors = await fetch(`${ALVO}/api/orders`, { method: "OPTIONS", headers: { Origin: "https://site-malicioso.com", "Access-Control-Request-Method": "POST" } });
  confere("outro site não consegue chamar a API (CORS)", !cors.headers.get("access-control-allow-origin"));
  const pedidoPriv = await fetch(`${ALVO}/atendimento`);
  confere("páginas da equipe fora dos buscadores", (pedidoPriv.headers.get("x-robots-tag") ?? "").includes("noindex"));

  // desfaz os pedidos criados aqui
  const { data: meus } = await db.from("orders").select("id").like("buyer_name", `%${MARCA}%`);
  const ids = (meus ?? []).map((x) => x.id);
  if (ids.length) {
    await db.from("event_seats").update({ status: "free", held_until: null, order_id: null }).in("order_id", ids);
    await db.from("orders").update({ status: "expired" }).in("id", ids);
  }
  console.log(`\n${falhas === 0 ? "Tudo recusado como devia." : `${falhas} FALHA(S): ver acima.`} ${ids.length} pedido(s) de teste desfeito(s).`);
  process.exitCode = falhas ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
