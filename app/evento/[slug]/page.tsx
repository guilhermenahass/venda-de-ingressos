import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import SeatMap from "@/components/SeatMap";

type Seat = { id: string; sector: string; row: string; number: number; x: number; y: number };

export const revalidate = 60;

// Sem isto, Next 16 trata a rota dinâmica [slug] como sempre-dinâmica e ignora
// `revalidate`. Lista vazia registra a rota para ISR sem pré-gerar nada no build:
// cada evento é gerado na primeira visita e cacheado pelos 60s seguintes.
export function generateStaticParams() {
  return [];
}

export default async function EventoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { data: ev } = await db.from("events")
    .select("id,name,date,status,fee_pix_bps,fee_card_bps,rounding_cents,meia_para_todos").eq("slug", slug).single();
  if (!ev || ev.status !== "open") notFound();
  // Os assentos vêm pelo vínculo com o evento: a tabela `seats` é global e pode
  // conter assentos de outra planta. Sem este filtro eles apareceriam no mapa,
  // fora de qualquer setor, sem preço e derrubando o pedido inteiro ao entrar
  // no carrinho (create_order recusa assento que não é do evento).
  const [{ data: sectors }, { data: vinculo }, { data: sessoes }] = await Promise.all([
    db.from("event_sectors").select("sector,price_cents,sales_open_at,price2_cents,price_change_at").eq("event_id", ev.id),
    db.from("event_seats").select("seats!inner(id,sector,\"row\",number,x,y)").eq("event_id", ev.id),
    // as outras sessões à venda: o carrinho junta ingressos de todas
    db.from("events").select("slug,date").eq("status", "open").neq("slug", slug).not("slug", "like", "ensaio%").order("date"),
  ]);
  const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR",
    { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
  const seats = (vinculo ?? [])
    .flatMap((v) => v.seats as unknown as Seat[])
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const quando = new Date(ev.date).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit",
  });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4">
      <a href="/" className="sr-only focus:not-sr-only focus:mt-2 focus:inline-block focus:text-latao-claro">
        Voltar e escolher outra sessão
      </a>
      {/* Quem chega aqui já escolheu a data: o mapa vem direto, logo no alto. */}
      <header className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4">
        <p className="text-sm text-leitura-fraca">
          <a href="/" className="text-latao-claro underline">{ev.name}</a>
        </p>
        <p className="text-sm text-latao-claro first-letter:uppercase">{quando}</p>
      </header>
      <h1 className="gravado mt-1 text-2xl text-papel sm:text-3xl">Escolha seu assento</h1>

      <SeatMap event={ev} sectors={sectors ?? []} seats={seats} fees={ev}
               slug={slug} rotulo={dia(ev.date)}
               outrasSessoes={(sessoes ?? []).map((o) => ({ slug: o.slug, rotulo: dia(o.date) }))} />
    </main>
  );
}
