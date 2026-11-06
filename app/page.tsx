import Image from "next/image";
import Link from "next/link";
import { db } from "@/lib/db";
import Assinatura from "@/components/Assinatura";

// a porta de entrada também não precisa de consulta por visitante na abertura
export const revalidate = 60;

export default async function Home() {
  const { data: eventos } = await db.from("events")
    // ensaio (scripts/ensaio-abertura.ts) só abre pelo link direto, nunca na vitrine
    .select("id,slug,name,date,meia_para_todos").eq("status", "open").not("slug", "like", "ensaio%").order("date");

  const sessoes = await Promise.all((eventos ?? []).map(async (ev) => {
    // livres = tudo menos o vendido. Uma consulta GET comum, contada aqui: as
    // duas contagens HEAD de antes ficavam presas no cache de dados da Vercel
    // (a página mostrou 449 livres muito depois do reset), enquanto os GET da
    // página do evento se renovam normalmente a cada 60 s.
    const { data: lugares } = await db.from("event_seats").select("status").eq("event_id", ev.id);
    // indisponíveis (fileiras Q e R) não contam: não estão à venda
    const aVenda = (lugares ?? []).filter((l) => l.status !== "blocked");
    const total = aVenda.length;
    return { ...ev, livres: total - aVenda.filter((l) => l.status === "sold").length, total };
  }));

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-10">
      <div className="-mx-4 sm:mx-0">
        <Image
          src="/arte/peckywest-couro.jpg"
          alt="PECkywest — O Mistério de Daisy Belle. Dias 06 e 07 de novembro, Floresta Eventos"
          width={1365} height={768} priority sizes="(max-width: 640px) 100vw, 768px"
          className="w-full sm:mt-6"
        />
      </div>

      <p className="mt-6 text-base leading-relaxed text-leitura sm:text-lg">
        PECkywest está em festa! Daisy Belle, a jovem mais querida da cidade, está prestes a se casar.
        Mas, na véspera do grande dia, ela desaparece misteriosamente, deixando para trás uma cidade em
        choque e um suposto fora da lei como principal suspeito. Começa então uma busca eletrizante,
        repleta de pistas, confusões e reviravoltas, em uma aventura divertida e surpreendente pelo Velho
        Oeste. Afinal, onde está Daisy Belle — e quem está por trás desse mistério?
      </p>

      {sessoes.length === 0 ? (
        <section className="placa mt-8 p-8 text-center">
          <h1 className="gravado text-2xl text-latao-claro">Bilheteria fechada</h1>
          <p className="mt-2 text-leitura-fraca">
            Nenhuma sessão com venda aberta agora. Assim que abrir, o aviso sai no Instagram da PEC.
          </p>
        </section>
      ) : (
        <section className="mt-8">
          <h1 className="gravado text-center text-xl text-latao-claro sm:text-2xl">Escolha a sessão</h1>
          {(eventos ?? []).some((e) => e.meia_para_todos) && (
            <p className="mt-1 text-center text-sm text-leitura">Ingresso antecipado com valor promocional para todos, sem necessidade de comprovação.</p>
          )}
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {sessoes.map((s) => {
              const d = new Date(s.date);
              const fmt = (o: Intl.DateTimeFormatOptions) =>
                d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", ...o });
              const esgotado = s.livres === 0;
              return (
                <li key={s.id}>
                  <Link
                    href={esgotado ? "#" : `/evento/${s.slug}`}
                    aria-disabled={esgotado}
                    tabIndex={esgotado ? -1 : undefined}
                    className={`placa block p-5 transition-colors ${esgotado ? "pointer-events-none opacity-50" : "hover:border-latao"}`}
                  >
                    <span className="block text-[0.68rem] uppercase tracking-[0.22em] text-leitura-fraca">
                      {fmt({ weekday: "long" })}
                    </span>
                    <span className="gravado mt-1 block text-3xl text-papel">
                      {fmt({ day: "2-digit", month: "2-digit" })}
                    </span>
                    <span className="mt-1 block text-lg text-latao-claro">{fmt({ hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="mt-3 block border-t border-latao/25 pt-3 text-sm text-leitura-fraca">
                      {esgotado ? "Esgotado" : `${s.livres} de ${s.total} lugares disponíveis`}
                    </span>
                    {/* sem isto o cartão não parece tocável: ninguém sabia onde tocar */}
                    {!esgotado && (
                      <span className="mt-3 block border border-latao bg-latao p-2.5 text-center font-semibold text-ferro">
                        Escolher lugares →
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-6 text-center text-sm text-leitura-fraca">
            Cada sessão tem o próprio mapa de lugares. O pagamento é por Pix ou cartão, direto para a PEC Studio.
          </p>
        </section>
      )}

      <Assinatura className="mt-10" />
    </main>
  );
}
