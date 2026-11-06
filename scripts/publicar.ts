// Publica os eventos de verdade a partir de data/peckywest.json.
//
//   npm run publicar -- --simular   mostra o que vai acontecer, sem gravar nada
//   npm run publicar                apaga os dados de teste e publica
//
// Tudo numa transação só: ou as duas sessões saem inteiras, com preços,
// abertura, parcelas, lugares guardados e indisponíveis, ou nada muda no banco.
//
// Antes da abertura da venda, qualquer pedido pago nos eventos é de teste
// (sandbox) e é apagado. Depois da abertura o script se recusa a mexer em
// sessão que tenha pedido pago: aquilo é dinheiro de verdade.
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { csvToSeats } from "../lib/seats-grid";
import { chargedCents } from "../lib/fees";

type Config = {
  nome: string;
  sessoes: { slug: string; data: string }[];
  abertura_da_venda: string;
  parcelas_no_cartao: number;
  /** os preços são de meia-entrada, para todo mundo e sem prazo */
  meia_para_todos: boolean;
  /** preço único por setor, sem virada (decisão da PEC em 16/10) */
  precos_liquidos_em_reais: Record<string, number | null>;
  /** por sessão: vendidos de antemão, aparecem ocupados (convidados da PEC) */
  lugares_guardados: Record<string, string[]>;
  /** em todas as sessões: aparecem no mapa como indisponíveis e não são vendidos;
   *  dá para liberar depois (as cadeiras ao lado da mesa de som) */
  lugares_indisponiveis: string[];
  /** em todas as sessões: não aparecem no mapa (o espaço da mesa de som) */
  lugares_fora_do_mapa: string[];
};
const TAXAS = { fee_pix_bps: 99, fee_card_bps: 498, rounding_cents: 1 }; // taxa ao centavo (0015)
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export function validar(c: Config, setoresDaPlanta: Set<string>, idsDaPlanta: Set<string>): string[] {
  const erros: string[] = [];
  for (const setor of setoresDaPlanta) {
    if (!(setor in c.precos_liquidos_em_reais)) { erros.push(`falta o preço do setor "${setor}"`); continue; }
    const v = c.precos_liquidos_em_reais[setor];
    if (typeof v !== "number" || !(v > 0)) erros.push(`"${setor}": preço não preenchido`);
  }
  for (const s of Object.keys(c.precos_liquidos_em_reais))
    if (!setoresDaPlanta.has(s)) erros.push(`setor "${s}" não existe na planta do teatro`);
  const abre = new Date(c.abertura_da_venda).getTime();
  if (Number.isNaN(abre)) erros.push("data de abertura da venda inválida");
  for (const s of c.sessoes)
    if (!(abre < new Date(s.data).getTime())) erros.push(`a abertura da venda precisa ser antes da sessão ${s.slug}`);
  if (!(c.parcelas_no_cartao >= 1 && c.parcelas_no_cartao <= 12)) erros.push("parcelas no cartão devem estar entre 1 e 12");
  const fora = new Set([...c.lugares_indisponiveis, ...c.lugares_fora_do_mapa]);
  for (const id of c.lugares_indisponiveis) if (!idsDaPlanta.has(id)) erros.push(`lugar indisponível "${id}" não existe na planta`);
  for (const id of c.lugares_fora_do_mapa) if (!idsDaPlanta.has(id)) erros.push(`lugar fora do mapa "${id}" não existe na planta`);
  for (const id of c.lugares_indisponiveis)
    if (c.lugares_fora_do_mapa.includes(id)) erros.push(`"${id}" está como indisponível e fora do mapa ao mesmo tempo`);
  const slugs = new Set(c.sessoes.map((s) => s.slug));
  for (const [slug, ids] of Object.entries(c.lugares_guardados)) {
    if (!slugs.has(slug)) erros.push(`lugares guardados de "${slug}": essa sessão não existe`);
    for (const id of ids) {
      if (!idsDaPlanta.has(id)) erros.push(`lugar guardado "${id}" (${slug}) não existe na planta`);
      if (fora.has(id)) erros.push(`lugar guardado "${id}" (${slug}) está indisponível`);
    }
    if (new Set(ids).size !== ids.length) erros.push(`há lugar guardado repetido em ${slug}`);
  }
  return erros;
}

async function main() {
  const simular = process.argv.includes("--simular");
  // PUBLICAR_CONFIG existe só para ensaiar com outro arquivo sem tocar no de verdade
  const c: Config = JSON.parse(readFileSync(process.env.PUBLICAR_CONFIG ?? "data/peckywest.json", "utf8"));
  const planta = csvToSeats(readFileSync("data/teatro.csv", "utf8"));
  const setores = new Set(planta.map((s) => s.sector));
  const erros = validar(c, setores, new Set(planta.map((s) => s.id)));
  if (erros.length) {
    console.error("Não dá para publicar ainda:\n" + erros.map((e) => "  - " + e).join("\n"));
    process.exit(1);
  }

  console.log(c.nome);
  console.log(`  venda abre ${quando(c.abertura_da_venda)} · preço único · até ${c.parcelas_no_cartao}x no cartão`);
  for (const s of c.sessoes) {
    const g = c.lugares_guardados[s.slug] ?? [];
    console.log(`  ${s.slug}: ${g.length} lugares guardados${g.length ? ": " + g.join(", ") : ""}`);
  }
  console.log(`  em todas as sessões: ${c.lugares_indisponiveis.length} indisponíveis, ${c.lugares_fora_do_mapa.length} fora do mapa\n`);
  console.log("  setor".padEnd(22) + "PEC recebe".padStart(12) + "Pix".padStart(12) + "cartão".padStart(12));
  for (const [setor, reais] of Object.entries(c.precos_liquidos_em_reais)) {
    const liq = Math.round(reais! * 100);
    console.log("  " + setor.padEnd(20) + brl(liq).padStart(12)
      + brl(chargedCents(liq, TAXAS.fee_pix_bps, TAXAS.rounding_cents)).padStart(12)
      + brl(chargedCents(liq, TAXAS.fee_card_bps, TAXAS.rounding_cents)).padStart(12));
  }
  // o que a PEC recebe com tudo vendido: sem taxa (vai para o comprador),
  // sem os guardados e sem os indisponíveis
  const precoDe = new Map(planta.map((x) => [x.id, Math.round(c.precos_liquidos_em_reais[x.sector]! * 100)]));
  let geral = 0;
  for (const s of c.sessoes) {
    const fora2 = new Set([...c.lugares_indisponiveis, ...c.lugares_fora_do_mapa, ...(c.lugares_guardados[s.slug] ?? [])]);
    const vendaveis = planta.filter((x) => !fora2.has(x.id));
    const tot = vendaveis.reduce((n, x) => n + precoDe.get(x.id)!, 0);
    geral += tot;
    console.log(`  ${s.slug}: ${vendaveis.length} à venda, ${brl(tot)} com tudo vendido`);
  }
  console.log(`  total: ${brl(geral)}`);

  const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 1 });
  try {
    const vendaAberta = Date.now() >= new Date(c.abertura_da_venda).getTime();
    for (const s of c.sessoes) {
      const [ev] = await sql`select id from events where slug = ${s.slug}`;
      const [{ pagos }] = ev
        ? await sql`select count(*)::int as pagos from orders where event_id = ${ev.id} and status = 'paid'`
        : [{ pagos: 0 }];
      if (vendaAberta && pagos > 0) {
        console.error(`\n${s.slug} já tem ${pagos} pedido(s) pago(s) depois da abertura da venda. Não mexo em venda real.`);
        process.exit(1);
      }
      console.log(`\n  ${s.slug} (${quando(s.data)}): ${ev ? `substitui o evento atual e apaga ${pagos} pedido(s) pago(s) de teste` : "cria do zero"}`);
    }
    if (simular) { console.log("\nSimulação: nada foi gravado."); return; }

    const assentos = await sql`select id from seats where id = any(${planta.map((x) => x.id)})`;
    if (assentos.length !== planta.length)
      throw new Error(`o banco tem ${assentos.length} lugares da planta e o CSV tem ${planta.length}: rode npm run db:seed`);

    await sql.begin(async (tx) => {
      for (const s of c.sessoes) {
        const [ev] = await tx`select id from events where slug = ${s.slug}`;
        if (ev) {
          await tx`delete from tickets where order_id in (select id from orders where event_id = ${ev.id})`;
          await tx`delete from event_seats where event_id = ${ev.id}`;
          await tx`delete from orders where event_id = ${ev.id}`;
          await tx`delete from event_sectors where event_id = ${ev.id}`;
          await tx`delete from events where id = ${ev.id}`;
        }
        const [novo] = await tx`
          insert into events (slug, name, date, status, fee_pix_bps, fee_card_bps, rounding_cents, max_installments, meia_para_todos)
          values (${s.slug}, ${c.nome}, ${s.data}, 'open', ${TAXAS.fee_pix_bps}, ${TAXAS.fee_card_bps},
                  ${TAXAS.rounding_cents}, ${c.parcelas_no_cartao}, ${c.meia_para_todos === true})
          returning id`;
        for (const [setor, p] of Object.entries(c.precos_liquidos_em_reais)) {
          await tx`
            insert into event_sectors (event_id, sector, price_cents, price2_cents, price_change_at, sales_open_at)
            values (${novo.id}, ${setor}, ${Math.round(p! * 100)}, null, null, ${c.abertura_da_venda})`;
        }
        const noMapa = planta.map((x) => x.id).filter((id) => !c.lugares_fora_do_mapa.includes(id));
        await tx`insert into event_seats (event_id, seat_id) select ${novo.id}, id from seats where id = any(${noMapa})`;
        if (c.lugares_indisponiveis.length)
          await tx`update event_seats set status = 'blocked' where event_id = ${novo.id} and seat_id = any(${c.lugares_indisponiveis})`;
        const guardados = c.lugares_guardados[s.slug] ?? [];
        if (guardados.length)
          await tx`update event_seats set status = 'sold' where event_id = ${novo.id} and seat_id = any(${guardados})`;
      }
    });
    console.log(`\nPublicado. ${c.sessoes.length} sessões, ${planta.length - c.lugares_fora_do_mapa.length} lugares no mapa cada, ${c.lugares_fora_do_mapa.length} fora do mapa e ${c.lugares_indisponiveis.length} indisponíveis.`);
    console.log("Confira o site publicado no celular antes de divulgar.");
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("publicar.ts")) main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
