// Simula a abertura da venda contra o site de verdade (Vercel + Supabase +
// Mercado Pago sandbox): N pessoas chegam no mesmo instante, abrem a entrada e
// o mapa, disputam os lugares da frente e tentam pagar. Quem perde o lugar olha
// o mapa de novo e tenta outros, até 3 vezes. No fim confere a integridade no
// banco e desfaz tudo.
//
//   npx tsx --env-file=.env.local scripts/carga-producao.ts [pessoas] [slug]
//
// Todas as requisições saem de um IP só: a regra de limite de pedidos do
// firewall precisa estar em modo "log" durante o teste, senão ela barra a
// simulação a partir do 30º pedido.
import { db } from "../lib/db";
import { chargedCents, precoVigente } from "../lib/fees";

const ALVO = process.env.ALVO ?? "https://pec-ingressos.vercel.app";
const N = Number(process.argv[2] ?? 250);
const SLUG = process.argv[3] ?? "peckywest-07-11";
const MARCA = `Carga Teste ${Date.now().toString(36)}`;

type Resultado = "comprou" | "perdeu_todas" | "esgotado" | "limite" | "mp_indisponivel" | "erro_http" | "erro_rede";
type Pessoa = { tempos: Record<string, number>; resultado: Resultado; tentativas: number; detalhe?: string };

const agora = () => performance.now();
const ms = (x: number) => Math.round(x);
function perc(v: number[], q: number) {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}

async function main() {
  const { data: ev } = await db.from("events")
    .select("id,fee_pix_bps,fee_card_bps,rounding_cents").eq("slug", SLUG).single();
  if (!ev) throw new Error(`evento ${SLUG} não existe`);
  const { data: vinc } = await db.from("event_seats").select("seats!inner(id,row,number,x,y,sector)").eq("event_id", ev.id);
  const assentos = (vinc ?? []).map((v: any) => v.seats).sort((a: any, b: any) => a.y - b.y || a.x - b.x);
  const linhas = [...new Set(assentos.map((s: any) => s.row))];
  const frente = new Set(linhas.slice(0, Math.ceil(linhas.length / 3))); // o terço da frente
  const porFileira = new Map<string, any[]>();
  for (const s of assentos) porFileira.set(s.row, [...(porFileira.get(s.row) ?? []), s]);

  const inicio = new Date();
  console.log(`${N} pessoas contra ${ALVO}/evento/${SLUG} · disputando as fileiras ${[...frente].join(", ")}\n`);

  // Todo mundo tenta a frente primeiro. Esgotada, a pessoa aceita qualquer
  // fileira, como faria uma mãe de verdade.
  const escolher = (livres: Set<string>) => {
    const qtd = 1 + Math.floor(Math.random() * 4);
    const embaralha = (xs: string[]) => xs.sort(() => Math.random() - 0.5);
    const todas = [...porFileira.keys()];
    const fileiras = [...embaralha(todas.filter((f) => frente.has(f))), ...embaralha(todas.filter((f) => !frente.has(f)))];
    for (const f of fileiras) {
      const linha = porFileira.get(f)!;
      const ini = Math.floor(Math.random() * linha.length);
      for (let k = 0; k < linha.length; k++) {
        const bloco = [];
        for (let j = 0; j < qtd; j++) {
          const s = linha[(ini + k + j) % linha.length];
          if (!livres.has(s.id)) break;
          bloco.push(s.id);
        }
        if (bloco.length === qtd) return bloco;
      }
    }
    return null;
  };

  const lerLivres = async () => {
    const r = await fetch(`${ALVO}/api/events/${ev.id}/seats`, { cache: "no-store" });
    const m = r.ok ? await r.json() : {};
    return new Set(assentos.map((s: any) => s.id).filter((id: string) => (m[id] ?? "free") === "free"));
  };

  const pessoa = async (i: number): Promise<Pessoa> => {
    const p: Pessoa = { tempos: {}, resultado: "erro_rede", tentativas: 0 };
    try {
      let t = agora();
      let r = await fetch(`${ALVO}/`);
      p.tempos.entrada = agora() - t;
      if (!r.ok) return { ...p, resultado: "erro_http", detalhe: `entrada ${r.status}` };

      t = agora();
      r = await fetch(`${ALVO}/evento/${SLUG}`);
      await r.text();
      p.tempos.mapa = agora() - t;
      if (!r.ok) return { ...p, resultado: "erro_http", detalhe: `mapa ${r.status}` };

      t = agora();
      let livres = await lerLivres();
      p.tempos.ocupacao = agora() - t;

      for (let tentativa = 1; tentativa <= 8; tentativa++) {
        p.tentativas = tentativa;
        const escolha = escolher(livres);
        if (!escolha) return { ...p, resultado: "esgotado" };
        // como no site: cada toque guarda a cadeira no carrinho; se alguma
        // já foi, solta as outras e escolhe de novo
        const cart = crypto.randomUUID();
        const carrinho = (seatId: string | null, acao: string) => fetch(`${ALVO}/api/carrinho`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: cart, eventId: ev.id, seatId, acao }),
        });
        t = agora();
        let perdeu = false;
        for (const seatId of escolha) {
          const h = await carrinho(seatId, "pegar");
          if (h.status === 429) return { ...p, resultado: "limite" };
          if (!h.ok) { perdeu = true; break; }
        }
        p.tempos[`toques${tentativa}`] = agora() - t;
        if (perdeu) { await carrinho(null, "soltar"); livres = await lerLivres(); continue; }
        t = agora();
        r = await fetch(`${ALVO}/api/orders`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId: ev.id, seatIds: escolha, cartToken: cart,
            // Pix agora cria uma cobrança de verdade no Mercado Pago a cada
            // pedido; a carga usa cartão, que só cria a tela de pagamento
            method: process.env.METODO ?? "card",
            name: MARCA, email: `carga+${i}@example.com`, phone: "15999990000",
          }),
        });
        const j: any = await r.json().catch(() => ({}));
        p.tempos[`pedido${tentativa}`] = agora() - t;
        if (r.ok && j.initPoint) return { ...p, resultado: "comprou" };
        if (r.status === 409 && j.error === "SEATS_UNAVAILABLE") { livres = await lerLivres(); continue; }
        if (r.status === 429) return { ...p, resultado: "limite" };
        if (r.status === 503) return { ...p, resultado: "mp_indisponivel" };
        return { ...p, resultado: "erro_http", detalhe: `pedido ${r.status} ${JSON.stringify(j).slice(0, 80)}` };
      }
      return { ...p, resultado: "perdeu_todas" };
    } catch (e: any) {
      return { ...p, resultado: "erro_rede", detalhe: String(e.message ?? e).slice(0, 80) };
    }
  };

  const t0 = agora();
  const pessoas = await Promise.all(Array.from({ length: N }, (_, i) => pessoa(i)));
  const duracao = agora() - t0;

  // ---- relatório do que as pessoas viveram
  const conta = (r: Resultado) => pessoas.filter((p) => p.resultado === r).length;
  console.log(`Tudo em ${(duracao / 1000).toFixed(1)} s\n`);
  console.log(`  compraram (chegaram ao checkout) ... ${conta("comprou")}`);
  console.log(`  teatro esgotou antes delas ........ ${conta("esgotado")}`);
  console.log(`  desistiram após 8 disputas ........ ${conta("perdeu_todas")}`);
  console.log(`  barradas pelo limite ............... ${conta("limite")}`);
  console.log(`  Mercado Pago indisponível .......... ${conta("mp_indisponivel")}`);
  console.log(`  erro do site ....................... ${conta("erro_http")}`);
  console.log(`  erro de rede ....................... ${conta("erro_rede")}`);
  const detalhes = pessoas.filter((p) => p.detalhe).map((p) => p.detalhe);
  for (const d of [...new Set(detalhes)].slice(0, 6)) console.log(`      ${d}`);

  const tempos = (k: string) => pessoas.map((p) => p.tempos[k]).filter((x) => x !== undefined) as number[];
  const pedidos = pessoas.flatMap((p) => Object.entries(p.tempos).filter(([k]) => k.startsWith("pedido")).map(([, v]) => v));
  console.log(`\n  tempo de resposta (mediana | 95% | pior):`);
  for (const [nome, v] of [["página de entrada", tempos("entrada")], ["página do mapa", tempos("mapa")],
    ["ocupação dos lugares", tempos("ocupacao")],
    ["guardar lugares (toques)", pessoas.flatMap((p) => Object.entries(p.tempos).filter(([k]) => k.startsWith("toques")).map(([, v]) => v))],
    ["criar pedido + checkout MP", pedidos]] as const) {
    console.log(`    ${nome.padEnd(28)} ${ms(perc(v, 0.5))} ms | ${ms(perc(v, 0.95))} ms | ${ms(Math.max(...v))} ms`);
  }
  const tent = pessoas.filter((p) => p.resultado === "comprou").map((p) => p.tentativas);
  console.log(`    tentativas até comprar: ${[1,2,3,4,5,6,7,8].map((n) => `${n}ª=${tent.filter((x) => x === n).length}`).join(" ")}`);

  // ---- integridade no banco
  const { data: ords } = await db.from("orders")
    .select("id,status,seat_ids,total_cents,method,mp_preference_id,created_at")
    .eq("event_id", ev.id).eq("buyer_name", MARCA);
  const vivos = (ords ?? []).filter((o) => o.status !== "expired");
  const dono = new Map<string, string>();
  const duplicados: string[] = [];
  for (const o of vivos) for (const s of o.seat_ids) { if (dono.has(s)) duplicados.push(s); else dono.set(s, o.id); }

  const { data: setores } = await db.from("event_sectors")
    .select("sector,price_cents,price2_cents,price_change_at").eq("event_id", ev.id);
  const setorDe = new Map(assentos.map((s: any) => [s.id, s.sector]));
  const agoraMs = Date.now();
  const precoCerto = (o: any) => o.seat_ids.reduce((soma: number, id: string) => {
    const sec: any = setores!.find((x) => x.sector === setorDe.get(id));
    const liq = precoVigente(sec.price_cents, sec.price2_cents, sec.price_change_at, agoraMs);
    return soma + chargedCents(liq, o.method === "pix" ? ev.fee_pix_bps : ev.fee_card_bps, ev.rounding_cents);
  }, 0);
  const totalErrado = vivos.filter((o) => o.total_cents !== precoCerto(o));
  const semCheckout = vivos.filter((o) => o.method === "card" && !o.mp_preference_id);

  const ids = vivos.map((o) => o.id);
  const { data: presos } = ids.length
    ? await db.from("event_seats").select("seat_id,order_id,status").eq("event_id", ev.id).in("order_id", ids)
    : { data: [] as any[] };
  const esperado = vivos.reduce((s, o) => s + o.seat_ids.length, 0);

  console.log(`\n  integridade no banco:`);
  console.log(`    pedidos criados ................... ${vivos.length} (compraram: ${conta("comprou")})`);
  console.log(`    lugar em dois pedidos ............. ${duplicados.length === 0 ? "nenhum ✓" : duplicados.length + " ✗ " + duplicados.slice(0, 5).join(",")}`);
  console.log(`    total cobrado errado .............. ${totalErrado.length === 0 ? "nenhum ✓" : totalErrado.length + " ✗"}`);
  console.log(`    pedido sem checkout do MP ......... ${semCheckout.length === 0 ? "nenhum ✓" : semCheckout.length + " ✗"}`);
  console.log(`    lugares reservados no mapa ........ ${presos!.length} de ${esperado} esperados ${presos!.length === esperado ? "✓" : "✗"}`);

  // ---- desfaz tudo
  const todos = (ords ?? []).map((o) => o.id);
  for (let k = 0; k < todos.length; k += 100) {
    const lote = todos.slice(k, k + 100);
    await db.from("event_seats").update({ status: "free", held_until: null, order_id: null }).in("order_id", lote);
    await db.from("orders").update({ status: "expired" }).in("id", lote);
  }
  console.log(`\n  ${todos.length} pedidos de teste desfeitos, lugares devolvidos à venda`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
