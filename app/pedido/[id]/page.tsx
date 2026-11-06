import { nomeTipo, tipoDe } from "@/lib/tipos";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { checkPendingOrder } from "@/lib/confirm";
import Assinatura from "@/components/Assinatura";
import BotaoWhatsApp from "@/components/BotaoWhatsApp";
import AcompanharPedido from "@/components/AcompanharPedido";
import PixQr from "@/components/PixQr";
import { emailAtivo } from "@/lib/mail";

export const dynamic = "force-dynamic";
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const METHOD_LABEL: Record<string, string> = { pix: "Pix", card: "cartão" };
// prazo para pagar e prazo do lugar no banco (ver 0014): Pix tem o QR de 30
// min do Mercado Pago; cartão, os 10 min do checkout. Depois do hold nenhum
// pagamento aprovado ainda vale.
const PRAZO = { pix: { pagar: 30 * 60_000, lugar: 35 * 60_000 }, card: { pagar: 10 * 60_000, lugar: 15 * 60_000 } };

export default async function PedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  // o id da página é o da compra: junta os pedidos de todas as sessões que
  // foram pagas juntas. Compra de uma sessão só tem um pedido, com o mesmo id.
  const load = async () => {
    const { data } = await db.from("orders")
      .select("id,status,buyer_name,email,total_cents,net_expected_cents,method,created_at,mp_init_point,pix_qr,pix_qr_base64,conflict_reason,seat_ids,tipos,em_analise_ate,events(name,date)")
      .eq("compra_id", id);
    const pedidos = ((data ?? []) as any[]).sort((a, b) => a.events.date.localeCompare(b.events.date));
    const lider = pedidos.find((p) => p.id === id);
    return lider ? {
      ...lider, pedidos,
      total_cents: pedidos.reduce((n, p) => n + p.total_cents, 0),
      // preço dos ingressos, sem taxa: o que a PEC recebe
      net_cents: pedidos.reduce((n, p) => n + (p.net_expected_cents ?? p.total_cents), 0),
    } : null;
  };

  let o = await load();
  if (!o) notFound();
  const age = Date.now() - new Date(o.created_at).getTime();
  const { pagar: WINDOW_MS, lugar: HOLD_WINDOW_MS } = PRAZO[o.method === "pix" ? "pix" : "card"];
  // cartão em análise no antifraude do MP (ver 0023): os lugares seguem guardados
  const emAnaliseAgora = (x: any) => x.status === "pending" && x.em_analise_ate && new Date(x.em_analise_ate).getTime() > Date.now();
  if (o.status === "pending" && (age <= HOLD_WINDOW_MS || emAnaliseAgora(o))) {
    // consulta ativa: cobre o caso de voltar do checkout antes do webhook
    // no máximo uma consulta ao MP a cada 15 s por compra (0021)
    const { data: pode } = await db.rpc("pode_consultar_mp", { p_compra: id });
    if (pode) {
      try { await checkPendingOrder(id); } catch (e) { console.error(e); }
      o = (await load())!;
    }
  }
  const ev = o.events as any;
  const emAnalise = emAnaliseAgora(o);
  const expired = o.status === "pending" && !emAnalise && age > WINDOW_MS;
  // o hold no banco dura 15 min; entre o minuto 10 e o 15 o assento ainda e deste
  // pedido, entao dizer que "foi liberado" antes disso e falso
  const released = age > HOLD_WINDOW_MS;
  const curto = (iso: string) => new Date(iso).toLocaleString("pt-BR",
    { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const quandoCurto = o.pedidos.map((p: any) => curto(p.events.date)).join(" e ");
  const deadline = new Date(new Date(o.created_at).getTime() + WINDOW_MS)
    .toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

  const { data: tickets } = o.status === "paid"
    ? await db.from("tickets").select("qr_token,seat_id,order_id,seats(sector,\"row\",number)")
        // cancelado (troca ou devolução parcial) não aparece: só confundiria na porta
        .in("order_id", o.pedidos.map((p: any) => p.id)).is("revoked_at", null).order("seat_id")
    : { data: [] as any[] };

  return (
    <main className="mx-auto w-full max-w-md flex-1 p-5">
      <AcompanharPedido status={o.status} criadoEm={o.created_at} limiteMs={emAnalise ? age + 30 * 60_000 : HOLD_WINDOW_MS} />
      <header className="placa p-4">
        <h1 className="gravado text-lg leading-tight text-papel">{ev.name}</h1>
        <p className="mt-1 text-sm text-leitura-fraca">
          Pedido <span className="gravado tracking-widest text-latao-claro">{id.slice(0, 8).toUpperCase()}</span> · {o.buyer_name}
        </p>
        {o.pedidos.map((p: any) => (
          <p key={p.id} className="mt-1 text-sm text-leitura">
            <span className="text-latao-claro">{curto(p.events.date)}</span> · {p.seat_ids.join(", ")}
          </p>
        ))}
        <p className="mt-1 text-sm text-leitura">
          {brl(o.total_cents)} no {METHOD_LABEL[o.method] ?? o.method}
          <span className="block text-xs text-leitura-fraca">
            ingressos {brl(o.net_cents)} + taxa de conveniência {brl(o.total_cents - o.net_cents)}
          </span>
        </p>
      </header>

      {o.status === "paid" && (
        <>
          <p className="mt-4 border border-latao/50 bg-ferro-face p-3 text-latao-claro">
            Pagamento confirmado. {(tickets ?? []).length === 1 ? "Seu ingresso:" : "Seus ingressos:"}
          </p>
          {/* O ingresso vive nesta página, não no e-mail. Mandar para o próprio
              WhatsApp é o jeito mais barato e mais confiável de a pessoa não
              perder o link: custa zero, não depende de entrega de e-mail e fica
              no aparelho que ela vai levar para o teatro. */}
          <section className="papel mt-5 p-4 text-center">
            <BotaoWhatsApp
              rotulo="Mandar os ingressos para o meu WhatsApp"
              texto={`Meus ingressos para ${ev.name} — ${quandoCurto}: ${process.env.APP_URL}/pedido/${id}`}
            />
            <p className="mt-2.5 text-sm leading-snug text-tinta/80">
              <strong>Recomendamos fazer isso agora.</strong> Assim você não perde os ingressos se fechar
              esta página, limpar o navegador ou trocar de celular até o dia do espetáculo.
            </p>
          </section>
          {o.pedidos.map((p: any) => (
            <section key={p.id}>
              {o.pedidos.length > 1 && (
                <h2 className="gravado mt-6 text-lg text-latao-claro">Sessão de {curto(p.events.date)}</h2>
              )}
          {(tickets as any[]).filter((t) => t.order_id === p.id).map((t) => (
            <a key={t.qr_token} href={`/t/${t.qr_token}`} className="papel mt-4 block p-4 text-center">
              <strong className="gravado text-2xl text-tinta">{t.seats.row}-{t.seats.number}</strong>
              <span className="mt-0.5 block text-xs uppercase tracking-[0.18em] text-tinta/70">{t.seats.sector} · {nomeTipo(tipoDe(p.tipos, t.seat_id))}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/t/${t.qr_token}/qr.png`} alt={`QR do ingresso ${t.seats.row}-${t.seats.number}`}
                   width={200} height={200} className="mx-auto mt-3" />
              <small className="mt-1 block text-tinta/70">
                Código manual: <b className="gravado tracking-widest">{String(t.qr_token).slice(-6).toUpperCase()}</b>
              </small>
            </a>
          ))}
            </section>
          ))}
          <p className="mt-4 text-sm text-leitura-fraca">
            Precisa cancelar? Você pode desistir em até 7 dias depois de pagar e recebe o valor de volta.
            É só pedir pelo WhatsApp da PEC.
          </p>
          {/* sem domínio verificado o e-mail não chega a ninguém além do dono
              da conta Resend; prometer a cópia seria mentir */}
          {emailAtivo() && (
            <p className="mt-4 text-sm text-leitura-fraca">
              Também enviamos uma cópia para {o.email}. Se não chegar, use o botão acima.
            </p>
          )}
        </>
      )}

      {emAnalise && (
        <>
          <p className="mt-4 border border-latao/50 bg-ferro-face p-3 text-leitura">
            <strong className="text-latao-claro">Pagamento em análise pelo Mercado Pago.</strong>{" "}
            Isso é uma conferência de segurança do cartão. Seus lugares continuam guardados para você.
          </p>
          <p className="mt-2 text-sm text-leitura-fraca">
            Normalmente sai em alguns minutos, mas pode levar até 2 dias. Assim que for aprovado, os ingressos
            aparecem nesta página e chegam por e-mail. Se for recusado, o valor não é cobrado.
            <strong className="text-leitura"> Não precisa comprar de novo.</strong>
          </p>
        </>
      )}

      {o.status === "pending" && !expired && !emAnalise && (
        <>
          <p className="mt-4 border border-latao/50 bg-ferro-face p-3 text-leitura">
            Aguardando pagamento. Seus lugares estão reservados até{" "}
            <strong className="gravado text-latao-claro">{deadline}</strong>.
          </p>
          {o.pix_qr && <PixQr qr={o.pix_qr} qrBase64={o.pix_qr_base64} />}
          {!o.pix_qr && o.mp_init_point && (
            <a href={o.mp_init_point} className="mt-4 block border border-latao bg-latao p-3 text-center font-semibold text-ferro">
              Continuar pagamento
            </a>
          )}
          <p className="mt-2 text-sm text-leitura-fraca">Já pagou? Fique nesta página: os ingressos aparecem aqui sozinhos em alguns segundos.</p>
        </>
      )}

      {/* "expired" no banco: Pix que venceu, compra abandonada há horas ou
          Mercado Pago fora do ar na hora de pagar. Sem este caso a página
          ficava só com o cabeçalho, sem dizer nada. */}
      {((o.status === "pending" && expired) || o.status === "expired") && (
        <>
          <p className="mt-4 border border-latao/25 bg-ferro-face p-3 text-leitura">
            O prazo de pagamento expirou{released || o.status === "expired" ? " e os lugares foram liberados" : ""}.
            Nenhum valor foi cobrado.
          </p>
          <a href="/" className="mt-4 block border border-latao bg-latao p-3 text-center font-semibold text-ferro">
            Escolher lugares de novo
          </a>
        </>
      )}

      {o.status === "conflict" && (
        <p className="mt-4 border-2 border-alerta p-3 text-papel">
          {o.conflict_reason === "valor"
            ? "O valor pago não conferiu com o total do pedido, então a compra não pôde ser concluída."
            : "O pagamento chegou depois do prazo e o lugar já tinha sido liberado."}{" "}
          O valor foi estornado automaticamente. <a className="underline" href="/">Escolher outro lugar</a>.
        </p>
      )}

      {o.status === "refunded" && (
        <p className="mt-4 border border-latao/25 bg-ferro-face p-3 text-leitura">
          Este pedido foi estornado. Os ingressos não são mais válidos.
        </p>
      )}

      <Assinatura className="mt-8" />
    </main>
  );
}
