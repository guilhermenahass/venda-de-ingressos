// Cria (ou apaga, com --apagar) um evento de ensaio com a planta real, que
// abre a venda daqui a N segundos. Serve para ensaiar a abertura, a carga e
// os testes de segurança sem mexer nas sessões de verdade.
//
//   npx tsx --env-file=.env.local scripts/ensaio-abertura.ts [segundos]
//   npx tsx --env-file=.env.local scripts/ensaio-abertura.ts --apagar
import postgres from "postgres";

// ENSAIO_SLUG cria um segundo ensaio (para testar o carrinho com duas sessões)
const SLUG = process.env.ENSAIO_SLUG ?? "ensaio-abertura";
const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 1 });

async function apagar() {
  const [ev] = await sql`select id from events where slug = ${SLUG}`;
  if (!ev) return;
  await sql.begin(async (tx) => {
    await tx`delete from tickets where order_id in (select id from orders where event_id = ${ev.id})`;
    await tx`delete from event_seats where event_id = ${ev.id}`;
    await tx`delete from orders where event_id = ${ev.id}`;
    await tx`delete from event_sectors where event_id = ${ev.id}`;
    await tx`delete from events where id = ${ev.id}`;
  });
  console.log("ensaio apagado");
}

async function criar(segundos: number) {
  await apagar();
  // copia a sessão real de 06/11: mesma planta (sem a mesa de som), mesmos preços
  const [real] = await sql`select * from events where slug = 'peckywest-06-11'`;
  const [ev] = await sql`
    insert into events (slug, name, date, status, fee_pix_bps, fee_card_bps, rounding_cents, max_installments)
    values (${SLUG}, ${"TESTE — ensaio da abertura"}, now() + interval '20 days', 'open',
            ${real.fee_pix_bps}, ${real.fee_card_bps}, ${real.rounding_cents}, ${real.max_installments})
    returning id`;
  await sql`
    insert into event_sectors (event_id, sector, price_cents, price2_cents, price_change_at, sales_open_at)
    select ${ev.id}, sector, price_cents, price2_cents, price_change_at, now() + ${segundos + " seconds"}::interval
      from event_sectors where event_id = ${real.id}`;
  await sql`insert into event_seats (event_id, seat_id, status)
            select ${ev.id}, seat_id, status from event_seats where event_id = ${real.id}`;
  console.log(ev.id);
}

(process.argv.includes("--apagar") ? apagar() : criar(Number(process.argv[2] ?? 120)))
  .finally(() => sql.end());
