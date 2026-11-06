// Tenta quebrar o sistema de propósito: cliques duplos, avisos de pagamento
// repetidos ao mesmo tempo, duas portarias lendo o mesmo QR, compra antes da
// abertura, estorno depois da entrada. Roda no evento de ensaio (crie antes
// com scripts/ensaio-abertura.ts 0) e desfaz tudo no fim.
//
//   npx tsx --env-file=.env.local scripts/caos.ts
import { db } from "../lib/db";

const B = process.env.ALVO ?? "https://pec-ingressos.vercel.app";
const PIN = process.env.PORTARIA_PIN!;
const SLUG = "ensaio-abertura";
let falhas = 0;
const ok = (nome: string, c: boolean, detalhe = "") => {
  if (!c) falhas++;
  console.log(`${c ? "  ok   " : "  FALHA"} ${nome}${detalhe ? ` (${detalhe})` : ""}`);
};
const post = (p: string, b: unknown) =>
  fetch(B + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof b === "string" ? b : JSON.stringify(b) });
const comprador = (n: string) => ({ name: `Caos ${n}`, email: "caos@example.com", phone: "15977770000" });
const ingressosDe = async (compra: string) => {
  const { data: ps } = await db.from("orders").select("id").eq("compra_id", compra);
  const { data } = await db.from("tickets").select("qr_token,seat_id,revoked_at").in("order_id", (ps ?? []).map((p) => p.id));
  return data ?? [];
};

async function main() {
  const { data: ev } = await db.from("events").select("id").eq("slug", SLUG).single();
  if (!ev) throw new Error("crie o ensaio antes: scripts/ensaio-abertura.ts 0");
  const { data: real } = await db.from("events").select("id").eq("slug", "peckywest-06-11").single();

  console.log("Compra");
  {
    // clique duplo em "Pagar": duas requisições iguais ao mesmo tempo
    const cart = crypto.randomUUID();
    await post("/api/carrinho", { token: cart, eventId: ev.id, seatId: "D-5", acao: "pegar" });
    const corpo = { itens: [{ eventId: ev.id, seatIds: ["D-5"] }], cartToken: cart, method: "card", ...comprador("duplo") };
    const rs = await Promise.all([post("/api/orders", corpo), post("/api/orders", corpo), post("/api/orders", corpo)]);
    const st = rs.map((r) => r.status).sort();
    const { data: ords } = await db.from("orders").select("id").eq("buyer_name", "Caos duplo").neq("status", "expired");
    ok("clique triplo em pagar gera um pedido só", ords!.length === 1, `respostas ${st.join(",")}`);
  }
  {
    // 20 pessoas sem carrinho pedindo o mesmo lugar no mesmo instante
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      post("/api/orders", { itens: [{ eventId: ev.id, seatIds: ["D-6"] }], method: "card", ...comprador(`corrida${i}`) })));
    ok("20 pedidos simultâneos no mesmo lugar: só um leva", rs.filter((r) => r.ok).length === 1,
      `${rs.filter((r) => r.status === 409).length} recusados`);
  }
  {
    const r = await post("/api/orders", { itens: [{ eventId: real!.id, seatIds: ["P-1"] }], method: "card", ...comprador("cedo") });
    ok("compra na sessão real antes de abrir é recusada", r.status === 409, `${r.status}`);
    const h = await post("/api/carrinho", { token: crypto.randomUUID(), eventId: real!.id, seatId: "P-1", acao: "pegar" });
    ok("guardar lugar na sessão real antes de abrir é recusado", h.status === 409, `${h.status}`);
  }
  {
    const lixo = await Promise.all([
      post("/api/orders", "{isto não é json"),
      post("/api/orders", { itens: [{ eventId: ev.id, seatIds: ["D-7"] }, { eventId: ev.id, seatIds: ["D-8"] }], method: "pix", ...comprador("repetida") }),
      post("/api/orders", { itens: "abc", method: "pix", ...comprador("x") }),
      post("/api/orders", { itens: [{ eventId: ev.id, seatIds: Array(5000).fill("D-9") }], method: "pix", ...comprador("x") }),
      post("/api/carrinho", "null"),
      post("/api/checkin", "[]"),
    ]);
    ok("JSON quebrado, sessão repetida e listas gigantes são recusados sem erro 500",
      lixo.every((r) => r.status >= 400 && r.status < 500), lixo.map((r) => r.status).join(","));
  }

  console.log("Pagamento");
  {
    // o Mercado Pago repete o aviso: 6 confirmações do mesmo pagamento ao mesmo tempo
    const { data } = await db.rpc("create_compra", { p_itens: [{ event: ev.id, seats: ["E-5", "E-6"] }], p_name: "Caos aviso",
      p_email: "caos@example.com", p_phone: "15977770000", p_method: "pix" });
    const compra = data[0].compra_id;
    const rs = await Promise.all(Array.from({ length: 6 }, () => db.rpc("mark_compra_paid", { p_compra: compra, p_payment_id: "caos-1" })));
    const res = rs.map((r) => r.data ?? r.error?.message);
    const t = await ingressosDe(compra);
    ok("6 avisos de pagamento simultâneos: 2 ingressos, nenhum duplicado", t.length === 2,
      `${res.filter((x) => x === "paid").length} pagou, ${res.filter((x) => x === "already_paid").length} já pago`);

    // duas portarias lendo o mesmo QR no mesmo segundo
    const leituras = await Promise.all(Array.from({ length: 5 }, () =>
      post("/api/checkin", { pin: PIN, slug: SLUG, token: t[0].qr_token }).then((r) => r.json())));
    ok("5 leituras simultâneas do mesmo QR: só uma libera a entrada",
      leituras.filter((l) => l.result === "ok").length === 1, leituras.map((l) => l.result).join(","));

    // estorno depois de a pessoa ter entrado: ingresso cancelado, a portaria avisa
    await db.rpc("mark_compra_refunded", { p_compra: compra });
    const depois = await (await post("/api/checkin", { pin: PIN, slug: SLUG, token: t[1].qr_token })).json();
    ok("ingresso estornado não passa na portaria", depois.result === "revoked", depois.result);
    const { data: s } = await db.from("event_seats").select("status").eq("event_id", ev.id).in("seat_id", ["E-5", "E-6"]);
    ok("lugar estornado volta para a venda", s!.every((x) => x.status === "free"));
  }
  {
    // o pagamento chega depois do prazo e o lugar já foi de outra pessoa
    const { data } = await db.rpc("create_compra", { p_itens: [{ event: ev.id, seats: ["E-7"] }], p_name: "Caos atrasado",
      p_email: "caos@example.com", p_phone: "15977770000", p_method: "pix" });
    const compra = data[0].compra_id;
    await db.from("event_seats").update({ held_until: new Date(Date.now() - 1000).toISOString() }).eq("order_id", compra);
    await db.rpc("create_compra", { p_itens: [{ event: ev.id, seats: ["E-7"] }], p_name: "Caos chegou antes",
      p_email: "caos@example.com", p_phone: "15977770000", p_method: "pix" });
    const r = await db.rpc("mark_compra_paid", { p_compra: compra, p_payment_id: "caos-2" });
    ok("pagamento atrasado de lugar já tomado vira conflito (estorno), sem ingresso", r.data === "conflict"
      && (await ingressosDe(compra)).length === 0, String(r.data));
  }
  {
    // aviso falso: assinatura inválida e pagamento que não existe
    const semAssinatura = await post("/api/webhooks/mp?data.id=999&type=payment", { type: "payment", data: { id: "999" } });
    ok("aviso de pagamento forjado é recusado", semAssinatura.status === 401);
  }

  console.log("Equipe");
  {
    // força bruta no PIN da portaria
    const tentativas = await Promise.all(Array.from({ length: 15 }, (_, i) =>
      post("/api/checkin", { pin: String(100000 + i), slug: SLUG, code: "ABCDEF" })));
    const st = tentativas.map((r) => r.status);
    ok("chutar PIN em sequência é barrado", st.every((x) => x === 401 || x === 429), `${st.filter((x) => x === 429).length} bloqueadas por excesso`);
  }
  {
    const r = await fetch(`${B}/pedido/00000000-0000-4000-8000-000000000000`);
    const r2 = await fetch(`${B}/t/00000000-0000-4000-8000-000000000000`);
    ok("pedido e ingresso inexistentes dão 404, não erro", r.status === 404 && r2.status === 404, `${r.status},${r2.status}`);
  }

  await limpar(ev.id);
  console.log(`\n${falhas === 0 ? "Nada quebrou." : `${falhas} FALHA(S): ver acima.`}`);
  process.exitCode = falhas ? 1 : 0;
}

// Desfaz o que o teste criou. Roda também quando ele quebra no meio: antes,
// uma rodada interrompida deixava lugares presos e a seguinte falhava.
async function limpar(eventId: string) {
  const { data: meus } = await db.from("orders").select("id").like("buyer_name", "Caos %");
  const ids = (meus ?? []).map((m) => m.id);
  if (ids.length) {
    await db.from("tickets").delete().in("order_id", ids);
    await db.from("event_seats").update({ status: "free", held_until: null, order_id: null, cart_token: null }).in("order_id", ids);
    await db.from("orders").delete().in("id", ids);
  }
  await db.from("event_seats").update({ status: "free", held_until: null, order_id: null, cart_token: null })
    .eq("event_id", eventId).eq("status", "held");
  console.log(`${ids.length} pedidos de teste desfeitos.`);
}

main().catch(async (e) => {
  console.error(e);
  const { data: ev } = await db.from("events").select("id").eq("slug", SLUG).single();
  if (ev) await limpar(ev.id);
  process.exitCode = 1;
});
