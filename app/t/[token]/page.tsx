import { nomeTipo, tipoDe } from "@/lib/tipos";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import Assinatura from "@/components/Assinatura";
import BotaoWhatsApp from "@/components/BotaoWhatsApp";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data: t } = await db.from("tickets")
    .select("qr_token,seat_id,checked_in_at,revoked_at,seats(sector,\"row\",number),orders(buyer_name,status,tipos,events(name,date))")
    .eq("qr_token", token).single();
  if (!t) notFound();
  const o = t.orders as any, s = t.seats as any;
  const valid = o.status === "paid" && !t.revoked_at;
  const quandoCurto = new Date(o.events.date).toLocaleString("pt-BR",
    { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const quando = new Date(o.events.date).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit",
  });

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-5">
      {/* O ingresso é a chapa: papel citado, borda de latão, número gravado. */}
      <article className="papel relative p-6 text-center">
        <p className="gravado text-[0.7rem] uppercase tracking-[0.3em] text-tinta/60">PEC Studio apresenta</p>
        <h1 className="gravado mt-1 text-2xl leading-tight text-tinta">{o.events.name}</h1>
        <p className="mt-1 text-sm text-tinta/70 first-letter:uppercase">{quando}</p>

        <div className="my-5 border-y-2 border-dashed border-tinta/30 py-4">
          <p className="gravado text-3xl leading-none text-tinta">{s.row}-{s.number}</p>
          <p className="mt-1 text-sm uppercase tracking-[0.18em] text-tinta/70">{s.sector} · {nomeTipo(tipoDe(o.tipos, t.seat_id))}</p>
        </div>

        {valid ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/t/${token}/qr.png`} alt="QR code do ingresso, para conferência na entrada"
                 width={260} height={260} className="mx-auto" />
            <p className="mt-2 text-sm text-tinta/70">
              Código manual: <b className="gravado tracking-widest">{String(token).slice(-6).toUpperCase()}</b>
            </p>
            {t.checked_in_at && (
              <p className="mt-3 border border-tinta/40 p-2 text-sm font-semibold text-tinta">Entrada já registrada.</p>
            )}
          </>
        ) : (
          <p className="border-2 border-alerta p-3 font-semibold text-alerta">Ingresso cancelado.</p>
        )}

        {/* Ingresso ao portador, por decisão da PEC: vale quem apresentar o QR.
            O nome aqui é de quem comprou, para a portaria ter referência. */}
        <p className="mt-5 border-t border-tinta/20 pt-3 text-sm text-tinta/70">
          Comprado por {o.buyer_name}. Vale para quem apresentar este QR.
        </p>
      </article>
      {valid && (
        <div className="mt-4">
          {/* Cada QR vale por uma pessoa. Quem comprou para a família precisa
              conseguir mandar o ingresso de cada um para o dono dele. */}
          <BotaoWhatsApp
            rotulo="Mandar este ingresso pelo WhatsApp"
            texto={`Ingresso ${s.row}-${s.number} para ${o.events.name} — ${quandoCurto}: ${process.env.APP_URL}/t/${token}`}
          />
          <p className="mt-2 text-center text-xs leading-snug text-leitura-fraca">
            <strong className="text-leitura">Guarde no seu WhatsApp para não perder.</strong> Este QR vale
            por uma pessoa: se o lugar é de outra, mande este link para ela.
          </p>
        </div>
      )}
      <p className="mt-4 text-center text-xs text-leitura-fraca">
        Apresente o QR na entrada do teatro.
      </p>
      <Assinatura className="mt-6" />
    </main>
  );
}
