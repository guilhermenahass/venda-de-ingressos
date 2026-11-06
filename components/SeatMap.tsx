"use client";
import Panzoom from "@panzoom/panzoom";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Seat } from "@/lib/seats-grid";
import { niveis } from "@/lib/seats-grid";
import { chargedCents, precoVigente } from "@/lib/fees";
import { WHATSAPP_PEC_EXIBICAO, WHATSAPP_PEC_LINK } from "@/lib/contato";
import { TIPOS, fatorDe, type Tipo } from "@/lib/tipos";

type Sector = {
  sector: string; price_cents: number; sales_open_at: string;
  price2_cents: number | null; price_change_at: string | null;
};
type Status = "free" | "held" | "sold" | "blocked";
type Fees = { fee_pix_bps: number; fee_card_bps: number; rounding_cents: number };
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const MAX = 30; // o banco é quem garante; aqui só evita a viagem inútil

// A chapa é desenhada quadrada, não redonda: é uma peça estampada, e o número
// gravado cabe melhor. 26 de lado em coordenadas do mapa (passo de 30).
const LADO = 26;
const TRILHO = 132; // largura da régua de níveis, à esquerda do mapa

// Cores das cadeiras, uma por faixa de preço, da mais cara para a mais
// barata: pátina (o chão, fileira X), latão (frente) e aço (trás). Todas
// claras e de matiz diferente; vendido é vermelho e indisponível é ferro
// apagado, então nenhuma cadeira livre lembra uma que não está à venda.
type Chapa = { cor: [string, string]; aresta: string; numero: string };
const PATINA: Chapa = { cor: ["#5fb89b", "#2e7a63"], aresta: "#b8ecd9", numero: "#0b1f19" };
const LATAO: Chapa = { cor: ["#d9a54a", "#9a6a22"], aresta: "#f6d58e", numero: "#1a1209" };
const ACO: Chapa = { cor: ["#8d9aa6", "#5d6a76"], aresta: "#c9d3dc", numero: "#0f1418" };
const COR = {
  vendido: "#9b2c22", vendidoNumero: "#f0bdb3",
  indisponivel: "#26221d", indisponivelNumero: "#5f574c",
};
const degrade = (c: Chapa) => `linear-gradient(${c.cor[0]}, ${c.cor[1]})`;

// Carrinho guardado no servidor (ver /api/carrinho): cada toque reserva a
// cadeira por 10 minutos, para as duas sessões juntas. O celular só guarda o
// token que identifica o carrinho.
type ItemCarrinho = { eventId: string; slug: string; rotulo: string; seats: string[]; net: number; pix: number; card: number };
type Servidor = { restaSeg: number | null; itens: ItemCarrinho[] };
const CHAVE_TOKEN = "pec:cart";
function tokenDoCarrinho(): string {
  try {
    let t = localStorage.getItem(CHAVE_TOKEN);
    if (!t) { t = crypto.randomUUID(); localStorage.setItem(CHAVE_TOKEN, t); }
    return t;
  } catch { return crypto.randomUUID(); }
}

export default function SeatMap({ event, sectors, seats, fees, rotulo, outrasSessoes }: {
  event: { id: string; name: string; meia_para_todos?: boolean }; sectors: Sector[]; seats: Seat[]; fees: Fees;
  rotulo: string; slug: string; outrasSessoes: { slug: string; rotulo: string }[];
}) {
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [cart, setCart] = useState<string[]>([]);
  const [servidor, setServidor] = useState<Servidor>({ restaSeg: null, itens: [] });
  // fim do prazo no relógio deste celular: agora + o que o banco disse que resta
  const [fimLocal, setFimLocal] = useState<number | null>(null);
  const [relogio, setRelogio] = useState(() => Date.now());
  const token = useRef("");
  // toques ainda sem resposta: enquanto houver, a resposta do servidor não
  // sobrescreve o que a pessoa acabou de marcar
  const emVoo = useRef(0);
  // Cadeiras que este celular acabou de soltar. A ocupação vem de um cache de
  // até ~8 s (s-maxage=3 + stale-while-revalidate=5 em /api/events/[id]/seats),
  // então por alguns segundos ela ainda diria "guardada" (a nossa própria
  // reserva) e a cadeira desmarcada piscaria em vermelho. Nesse intervalo, o
  // que vale é o que a pessoa acabou de fazer.
  const soltos = useRef<Record<string, number>>({});
  const SOLTO_MS = 10_000;
  const carregou = useRef(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  // tipo de cada lugar, por "eventId:seatId"; o que não está aqui é antecipado
  const [tipos, setTipos] = useState<Record<string, Tipo>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aberto, setAberto] = useState(false); // folha do pedido aberta sobre o mapa
  const [now, setNow] = useState(() => Date.now());
  // Diferença entre o relógio do servidor e o do celular. A abertura da venda
  // e a virada de preço são decididas pelo relógio da tela; um celular dois
  // minutos atrasado veria o setor fechado dois minutos depois de abrir.
  const desvio = useRef(0);
  const [pedidoAberto, setPedidoAberto] = useState<{ id: string; t: number } | null>(null);
  const [nivelAtivo, setNivelAtivo] = useState<number | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const pz = useRef<ReturnType<typeof Panzoom> | null>(null);

  // O setor mais caro é o que ganha latão na chapa; o mais barato fica em ferro
  // puro. A diferença de preço vira diferença de material, não uma cor a mais.
  const ordemPreco = useMemo(
    () => [...sectors].sort((a, b) => b.price_cents - a.price_cents).map((s) => s.sector),
    [sectors]);
  // com três faixas o chão ganha a pátina; com duas, frente e trás como antes
  const paleta = sectors.length >= 3 ? [PATINA, LATAO, ACO] : [LATAO, ACO];
  const chapaDe = (sector: string) => paleta[Math.min(Math.max(ordemPreco.indexOf(sector), 0), paleta.length - 1)];

  const sectorInfo = useMemo(() => Object.fromEntries(sectors.map((s) => {
    // `now` entra aqui de propósito: o preço vira sozinho na data marcada, sem
    // recarregar a página, pelo mesmo ciclo de 5s que destrava setor fechado
    const liquido = precoVigente(s.price_cents, s.price2_cents, s.price_change_at, now);
    return [s.sector, {
      ...s, liquido, subiu: liquido !== s.price_cents, 
      pix: chargedCents(liquido, fees.fee_pix_bps, fees.rounding_cents),
      card: chargedCents(liquido, fees.fee_card_bps, fees.rounding_cents),
      pixDepois: s.price2_cents == null ? null
        : chargedCents(s.price2_cents, fees.fee_pix_bps, fees.rounding_cents),
    }];
  })), [sectors, fees, now, ordemPreco]);

  // setor desconhecido nunca abre: sem isto, um assento fora dos setores do
  // evento cairia em `new Date(0)` e apareceria clicável e sem preço
  const isOpen = (sector: string) => sector in sectorInfo && new Date(sectorInfo[sector].sales_open_at).getTime() <= now;
  const itensOutros = servidor.itens.filter((i) => i.eventId !== event.id);
  const qtdTotal = cart.length + itensOutros.reduce((n, i) => n + i.seats.length, 0);
  const todosItens = [...(cart.length ? [{ eventId: event.id, rotulo, seats: cart }] : []), ...itensOutros];
  const tipoDoLugar = (eventId: string, seatId: string): Tipo => tipos[`${eventId}:${seatId}`] ?? "antecipado";
  // Exibição apenas: o total que vale é o que a rpc create_order calcula no servidor.
  // ponytail: o preço das outras sessões sai dos setores desta página (o
  // teatro e a tabela são os mesmos nos dois dias); se um dia mudar, cart_view
  // precisa devolver o preço de cada lugar.
  const precoBase = (seatId: string) => sectorInfo[seats.find((s) => s.id === seatId)?.sector ?? ""]?.liquido ?? 0;
  const somar = (f: (net: number) => number) => todosItens.reduce((n, i) =>
    n + i.seats.reduce((m, id) => m + f(precoBase(id) * fatorDe(tipoDoLugar(i.eventId, id))), 0), 0);
  // preço dos ingressos sem taxa: é o que a PEC recebe; a taxa vem separada
  const netTotal = somar((v) => v);
  const pixTotal = somar((v) => chargedCents(v, fees.fee_pix_bps, fees.rounding_cents));
  const cardTotal = somar((v) => chargedCents(v, fees.fee_card_bps, fees.rounding_cents));
  // carrinho esvaziou (tempo acabou, tirou a outra sessão): volta para o mapa
  useEffect(() => { if (qtdTotal === 0) setAberto(false); }, [qtdTotal]);
  const restaMs = fimLocal !== null && qtdTotal > 0 ? fimLocal - relogio : null;

  // o degrau de cada fileira, para a régua e para o realce do nível
  const { chao, degraus } = useMemo(() => niveis(seats), [seats]);
  const nivelDaFileira = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of degraus) for (const r of d.rows) m[r] = d.nivel;
    return m;
  }, [degraus]);

  function aplicar(s: Servidor) {
    setServidor(s);
    setFimLocal(s.restaSeg !== null ? Date.now() + s.restaSeg * 1000 : null);
    setRelogio(Date.now());
    if (emVoo.current === 0) setCart(s.itens.find((i) => i.eventId === event.id)?.seats ?? []);
  }

  async function lerServidor() {
    try {
      const r = await fetch(`/api/carrinho?token=${token.current}`, { cache: "no-store" });
      if (r.ok) aplicar(await r.json());
    } catch {}
  }

  async function refresh() {
    try {
      const r = await fetch(`/api/events/${event.id}/seats`, { cache: "no-store" });
      const data = r.headers.get("date");
      if (data) desvio.current = new Date(data).getTime() + Number(r.headers.get("age") ?? 0) * 1000 - Date.now();
      if (r.ok) {
        const mapa: Record<string, Status> = await r.json();
        const agora = Date.now();
        for (const [id, t] of Object.entries(soltos.current)) {
          if (agora - t > SOLTO_MS) delete soltos.current[id];
          else if (mapa[id] === "held") mapa[id] = "free";
        }
        setStatus(mapa);
      }
    } catch {}
    setNow(Date.now() + desvio.current);
  }
  // Só consulta com a aba na tela. Uma aba esquecida aberta perguntaria ~720
  // vezes por hora sem ninguém olhando, e isso conta na cota de tráfego da
  // Vercel. Ao voltar para a aba, atualiza na hora (e o carrinho também: ela
  // pode ter mexido na outra sessão, em outra aba).
  useEffect(() => {
    refresh();
    const t = setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    const aoVoltar = () => { if (!document.hidden) { refresh(); lerServidor(); } };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [event.id]);

  // relógio do prazo: só anda de segundo em segundo enquanto há lugar guardado
  useEffect(() => {
    if (fimLocal === null) return;
    const t = setInterval(() => setRelogio(Date.now()), 1000);
    return () => clearInterval(t);
  }, [fimLocal]);

  // prazo acabou: o banco já devolveu as cadeiras; a tela acompanha
  useEffect(() => {
    if (restaMs !== null && restaMs <= 0) {
      setServidor({ restaSeg: null, itens: [] });
      setFimLocal(null);
      // venceram: livres já, sem esperar o cache da ocupação
      const agora = Date.now();
      for (const id of cart) soltos.current[id] = agora;
      setStatus((st) => ({ ...st, ...Object.fromEntries(cart.map((id) => [id, "free" as Status])) }));
      setCart([]);
      setMsg("O tempo acabou e os lugares voltaram para a venda. Marque de novo.");
      // um respiro para o banco passar do prazo antes de perguntar de novo
      setTimeout(refresh, 1500);
    }
  }, [restaMs !== null && restaMs <= 0]);

  // Safari (e outros) guardam a página "congelada" ao ir para o pagamento; ao
  // voltar, ela reapareceria com o carrinho antigo, que já virou pedido.
  // Recarrega para mostrar o estado de verdade.
  useEffect(() => {
    const aoVoltar = (e: PageTransitionEvent) => { if (e.persisted) window.location.reload(); };
    window.addEventListener("pageshow", aoVoltar);
    return () => window.removeEventListener("pageshow", aoVoltar);
  }, []);

  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem("pec:pedido") ?? "null");
      const desta = p && (p.ev === event.id || (Array.isArray(p.evs) && p.evs.includes(event.id)));
      // 35 min: o prazo do lugar de quem pagou no Pix (ver 0014)
      if (desta && Date.now() - p.t < 35 * 60_000) setPedidoAberto(p);
    } catch {}
  }, [event.id]);

  // Volta o que já estava guardado. Os dados da pessoa ficam na aba
  // (sessionStorage) para ela não digitar de novo ao trocar de sessão; somem
  // quando ela fecha a aba.
  useEffect(() => {
    token.current = tokenDoCarrinho();
    lerServidor();
    try { const f = JSON.parse(sessionStorage.getItem("pec:dados") ?? "null"); if (f) setForm(f); } catch {}
    try { const t = JSON.parse(sessionStorage.getItem("pec:tipos") ?? "null"); if (t) setTipos(t); } catch {}
    carregou.current = true;
  }, [event.id]);

  useEffect(() => {
    if (!carregou.current) return;
    try { sessionStorage.setItem("pec:dados", JSON.stringify(form)); } catch {}
  }, [form]);
  useEffect(() => {
    if (!carregou.current) return;
    try { sessionStorage.setItem("pec:tipos", JSON.stringify(tipos)); } catch {}
  }, [tipos]);

  async function mexer(corpo: { acao: "pegar" | "soltar"; eventId: string; seatId: string | null }) {
    emVoo.current += 1;
    let r: Response | null = null, j: any = {};
    try {
      r = await fetch("/api/carrinho", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.current, ...corpo }),
      });
      j = await r.json().catch(() => ({}));
    } catch {}
    emVoo.current -= 1;
    if (r && j.itens) aplicar(j);
    else if (emVoo.current === 0) lerServidor();
    return { ok: !!r?.ok, erro: r ? j.error : "REDE", status: r?.status };
  }

  function tirarDeOutraSessao(eventId: string) {
    setServidor((s) => ({ ...s, itens: s.itens.filter((i) => i.eventId !== eventId) }));
    mexer({ acao: "soltar", eventId, seatId: null });
  }

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    pz.current = Panzoom(svg, { maxScale: 8, minScale: 0.6, contain: "outside" });
    const parent = svg.parentElement!;
    parent.addEventListener("wheel", pz.current.zoomWithWheel);
    return () => {
      parent.removeEventListener("wheel", pz.current!.zoomWithWheel);
      pz.current?.destroy();
    };
  }, []);

  async function toggle(seat: Seat) {
    const tinha = cart.includes(seat.id);
    // a cadeira guardada por este carrinho vem como "held" do servidor: é ela
    // mesma, então pode desmarcar
    if (!tinha && (!isOpen(seat.sector) || (status[seat.id] ?? "free") !== "free")) return;
    setMsg(null);
    if (!tinha && qtdTotal >= MAX) {
      setMsg(`Máximo de ${MAX} ingressos por compra, somando as sessões.`);
      return;
    }
    // marca na hora; se o servidor recusar, desfaz
    setCart((c) => tinha ? c.filter((x) => x !== seat.id) : [...c, seat.id]);
    if (tinha) {
      soltos.current[seat.id] = Date.now();
      setStatus((st) => ({ ...st, [seat.id]: "free" }));
    } else delete soltos.current[seat.id];
    const r = await mexer({ acao: tinha ? "soltar" : "pegar", eventId: event.id, seatId: seat.id });
    if (r.ok || tinha) return;
    setCart((c) => c.filter((x) => x !== seat.id));
    if (r.erro === "SEAT_UNAVAILABLE") setMsg(`${seat.row}-${seat.number} acabou de ser escolhido por outra pessoa.`);
    else if (r.erro === "LIMIT_IP") setMsg("Há muitos lugares guardados nesta rede de internet. Pague os que já marcou ou espere alguns minutos.");
    else if (r.erro === "LIMIT") setMsg(`Máximo de ${MAX} ingressos por compra, somando as sessões.`);
    else if (r.erro === "EVENT_CLOSED") setMsg("As vendas deste espetáculo estão fechadas.");
    else if (r.status === 429) setMsg("Muitos toques seguidos. Espere alguns segundos e tente de novo.");
    else setMsg("Sem conexão. Confira a internet e toque no lugar de novo.");
    refresh();
  }

  function conferirDados(): string | null {
    if (form.name.trim().length < 3) return "Escreva seu nome completo.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) return "Confira o e-mail: ele está incompleto.";
    const tel = form.phone.replace(/\D/g, "");
    if (tel.length < 10 || tel.length > 13) return "Confira o WhatsApp com DDD, por exemplo (15) 99999-9999.";
    return null;
  }

  async function pay(method: "pix" | "card") {
    const erro = conferirDados();
    if (erro) { setMsg(erro); return; }
    setBusy(true); setMsg(null);
    // Rede de celular caindo no meio, ou resposta que não é JSON, não pode
    // deixar o botão preso em "Reservando...": a pessoa não teria como tentar
    // de novo sem recarregar e perder o carrinho.
    let r: Response;
    try {
      r = await fetch("/api/orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itens: todosItens.map((i) => ({
            eventId: i.eventId, seatIds: i.seats,
            tipos: Object.fromEntries(i.seats.map((id) => [id, tipoDoLugar(i.eventId, id)])),
          })),
          cartToken: token.current, method, ...form,
        }),
      });
    } catch {
      setMsg("Sem conexão. Confira a internet e toque em pagar de novo.");
      setBusy(false);
      return;
    }
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      const evs = [event.id, ...itensOutros.map((i) => i.eventId)];
      try {
        localStorage.setItem("pec:pedido", JSON.stringify({ id: j.orderId, t: Date.now(), evs }));
        // os lugares agora são do pedido; a próxima compra começa outro carrinho
        localStorage.removeItem(CHAVE_TOKEN);
      } catch {}
      window.location.href = j.initPoint;
      return;
    }
    if (j.error === "SEATS_UNAVAILABLE") {
      // o que ainda está guardado é o que o servidor disser
      await lerServidor();
      const n = j.seats.length;
      const desta = j.eventId === event.id;
      const onde = desta ? "" : `Na sessão de ${itensOutros.find((i) => i.eventId === j.eventId)?.rotulo ?? "outro dia"}: `;
      setMsg(`${onde}${j.seats.join(", ")} ${n > 1 ? "não estão mais guardados" : "não está mais guardado"}. Escolha outro lugar.`);
      refresh();
    } else if (j.error === "EVENT_CLOSED") setMsg("As vendas deste espetáculo estão fechadas.");
    else if (r.status === 429) setMsg("Muitas tentativas seguidas. Espere um minuto e tente de novo.");
    else if (r.status === 503 || j.error === "MP_UNAVAILABLE") {
      // a rota soltou as cadeiras ao falhar; o carrinho precisa saber
      await lerServidor();
      setMsg("Pagamento indisponível no momento. Marque os lugares de novo e tente em instantes.");
    }
    else setMsg("Não deu certo. Confira nome, e-mail e WhatsApp e toque em pagar de novo.");
    setBusy(false);
  }

  const X0 = Math.min(...seats.map((s) => s.x)), X1 = Math.max(...seats.map((s) => s.x));
  const Y0 = Math.min(...seats.map((s) => s.y)), Y1 = Math.max(...seats.map((s) => s.y));
  const vb = { x: X0 - TRILHO - 24, y: Y0 - 78, w: (X1 - X0) + TRILHO + 72, h: (Y1 - Y0) + 118 };
  const degrauMax = degraus.length || 1;

  // O corredor central é o único vão vazio do mapa: é onde a letra da fileira
  // cabe sem tapar cadeira. Aproximado, as letras das pontas saem da tela, e
  // sem referência de fileira a cadeira 9 de uma vira igual à da outra.
  const xCorredor = useMemo(() => {
    const linha = seats.filter((s) => s.row === seats[0].row).map((s) => s.x).sort((a, b) => a - b);
    let maior = 0, meio: number | null = null;
    for (let i = 1; i < linha.length; i++) {
      const d = linha[i] - linha[i - 1];
      if (d > maior) { maior = d; meio = (linha[i] + linha[i - 1]) / 2; }
    }
    return maior > LADO + 8 ? meio : null;
  }, [seats]);


  const fmtQuando = (iso: string) => new Date(iso).toLocaleString("pt-BR",
    { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  const temFechado = sectors.some((s) => !isOpen(s.sector));
  const relogio2 = restaMs !== null && restaMs > 0 ? (
    <p className={`text-xs font-semibold ${restaMs < 60_000 ? "text-alerta" : "text-tinta/80"}`} aria-live="polite">
      Guardados por{" "}
      <span className="gravado tabular-nums">
        {Math.floor(restaMs / 60_000)}:{String(Math.floor(restaMs / 1000) % 60).padStart(2, "0")}
      </span>
    </p>
  ) : null;
  const temIndisponivel = Object.values(status).includes("blocked");
  // só quando nenhum setor abriu ainda: é o aviso de "ainda não começou"
  const proximaAbertura = sectors.length > 0 && sectors.every((s) => !isOpen(s.sector))
    ? Math.min(...sectors.map((s) => new Date(s.sales_open_at).getTime())) : null;
  const fmtAbertura = (t: number) => new Date(t).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).replace(/, (\d{2}):(\d{2})$/, ", às $1h$2").replace(/h00$/, "h"); // "domingo, 18/10, às 10h"

  return (
    <div className="mt-3 pb-28">
      {/* Antes da abertura: quem chega cedo no domingo fica nesta página. O
          relógio usado é o do servidor e o mapa se atualiza a cada 5 s, então
          ela libera sozinha na hora, sem recarregar. */}
      {proximaAbertura !== null && (
        <p className="mb-3 border-2 border-latao bg-ferro-face p-3 text-center text-leitura" role="status">
          <strong className="gravado block text-lg text-latao-claro first-letter:uppercase">
            A venda abre {fmtAbertura(proximaAbertura)}
          </strong>
          Pode deixar esta página aberta: os lugares são liberados sozinhos na hora, sem precisar recarregar.
        </p>
      )}
      {pedidoAberto && (
        <a href={`/pedido/${pedidoAberto.id}`}
           className="mb-3 block border-2 border-latao bg-latao p-3 text-center font-semibold text-ferro">
          Você tem um pagamento em andamento. Os lugares dele continuam guardados para você.
          <span className="mt-1 block underline">Continuar o pagamento →</span>
        </a>
      )}

      <div className="placa relative w-full overflow-hidden" style={{
               aspectRatio: `${vb.w} / ${vb.h}`,
               maxHeight: "72vh",
               touchAction: "none",
             }}>
        {/* O mapa abre sempre com o teatro inteiro na tela. No celular a cadeira
            fica pequena, e a pessoa aproxima com os dedos para ler o número.
            Quem não sabe "pinçar" usa os botões: a cadeira fica do tamanho do
            dedo e o toque não cai na vizinha. */}
        <div className="absolute right-2 top-2 z-[1] flex flex-col gap-1.5">
          {([["+", "Aproximar o mapa", () => pz.current?.zoomIn()],
             ["−", "Afastar o mapa", () => pz.current?.zoomOut()],
             ["⤢", "Ver o teatro inteiro", () => pz.current?.reset()]] as const).map(([rotulo, nome, acao]) => (
            <button key={nome} type="button" aria-label={nome} onClick={acao}
                    className="h-10 w-10 border border-latao bg-ferro-face/90 text-xl font-bold leading-none text-latao-claro">
              {rotulo}
            </button>
          ))}
        </div>
        <svg ref={svgRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="h-full w-full"
             role="group" aria-label={`Mapa de lugares de ${event.name}`}>
          <defs>
            <pattern id="fechado" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--ferro-espelho)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ferro-rebaixo)" strokeWidth="2.5" />
            </pattern>
            {/* uma chapa por faixa de preço (ver PATINA, LATAO, ACO) */}
            {paleta.map((c, i) => (
              <linearGradient key={i} id={`chapa-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c.cor[0]} />
                <stop offset="100%" stopColor={c.cor[1]} />
              </linearGradient>
            ))}
            <linearGradient id="tread" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2e251a" />
              <stop offset="100%" stopColor="#171208" />
            </linearGradient>
          </defs>

          {/* palco, gravado no alto */}
          <g>
            <rect x={X0 - 14} y={vb.y + 12} width={(X1 - X0) + 28} height={30} fill="var(--ferro-espelho)"
                  stroke="var(--latao)" strokeWidth={1} />
            <text x={(X0 + X1) / 2} y={vb.y + 32} textAnchor="middle" fontSize={17}
                  fill="var(--latao-claro)" letterSpacing="6" style={{ fontFamily: "var(--font-rye)" }}>PALCO</text>
          </g>

          {/* Régua de níveis: a arquibancada vista de lado. O quanto cada degrau
              avança para a direita é a altura dele — por isso a cota vai escrita
              em cada um, senão "mais largo" não significa "mais alto". Dentro do
              degrau, as duas faixas mostram que a fileira da frente é a de cima. */}
          <g aria-hidden="true">
            {degraus.map((d) => {
              const avanco = 30 + (d.nivel / degrauMax) * (TRILHO - 62);
              const x = X0 - TRILHO - 10;
              // cada degrau começa em cima da sua primeira fileira e termina onde
              // o próximo começa: encostados, e alinhados com as fileiras que
              // eles representam
              const bordas = degraus.map((g) => g.y0 - LADO / 2 - 2);
              const y = bordas[d.nivel - 1];
              const fim = d.nivel === degrauMax ? d.y1 + LADO / 2 + 2 : bordas[d.nivel];
              const h = fim - y;
              const ativo = nivelAtivo === d.nivel;
              const meioDegrau = d.rows.length > 1 ? (d.y0 + d.y1) / 2 : null;
              return (
                <g key={d.nivel}>
                  <rect x={x} y={y} width={avanco} height={h} fill="url(#tread)"
                        opacity={ativo ? 1 : 0.92} />
                  {/* a metade de cima do degrau é a fileira da frente, a cara */}
                  {meioDegrau !== null && (
                    <rect x={x} y={y} width={avanco} height={meioDegrau - y} fill="var(--latao)" opacity={0.16} />
                  )}
                  {/* piso do degrau: a aresta que pega a luz de cima */}
                  <line x1={x} y1={y} x2={x + avanco} y2={y}
                        stroke={ativo ? "var(--latao-claro)" : "var(--latao)"} strokeWidth={2.5} />
                  {/* espelho do degrau, na sombra */}
                  <line x1={x + avanco} y1={y} x2={x + avanco} y2={y + h}
                        stroke="var(--ferro-espelho)" strokeWidth={3} />
                  <text x={x + 7} y={y + 20} fontSize={15} fill="var(--latao-claro)"
                        style={{ fontFamily: "var(--font-rye)" }}>Nível {d.nivel}</text>
                  <text x={x + 7} y={y + 36} fontSize={12} fill="var(--leitura-fraca)">+{d.cotaCm} cm</text>
                </g>
              );
            })}
            {chao.length > 0 && (
              <>
                <rect x={X0 - TRILHO - 10} y={Y0 - LADO / 2 - 4} width={30 + (TRILHO - 62) / degrauMax / 2}
                      height={LADO + 8} fill="var(--ferro-espelho)" />
                <text x={X0 - TRILHO - 3} y={Y0 + 3} fontSize={12} fill="var(--leitura-fraca)">no chão</text>
              </>
            )}
          </g>

          {seats.map((s) => {
            const st = status[s.id] ?? "free";
            const open = isOpen(s.sector);
            const sel = cart.includes(s.id);
            const info = sectorInfo[s.sector];
            const nivel = nivelDaFileira[s.row];
            const livre = open && st === "free";
            const chapa = chapaDe(s.sector);
            // escolhido é inversão absoluta: papel claro com número escuro.
            // Nada de "será que cliquei?" no meio da correria.
            // vendido aparece vermelho mesmo antes de abrir (os lugares guardados da PEC);
            // indisponível (fileiras Q e R) é ferro apagado, sempre
            const fill = sel ? "var(--papel)" : st === "blocked" ? COR.indisponivel : st === "sold" ? COR.vendido
              : !open ? "url(#fechado)" : st !== "free" ? COR.vendido : `url(#chapa-${paleta.indexOf(chapa)})`;
            const label = `${s.sector}, fileira ${s.row}, lugar ${s.number}`
              + (nivel ? `, nível ${nivel}, ${nivel * 20} centímetros acima do chão` : ", no chão")
              + (st === "blocked" ? ", indisponível" : `, ingresso ${brl(info?.liquido ?? 0)}, `
              + (st === "sold" ? "ocupado" : !open ? "ainda não abriu" : st === "free" ? (sel ? "escolhido" : "livre") : "ocupado"));
            return (
              <g key={s.id} role="button" tabIndex={livre || sel ? 0 : -1} aria-label={label} aria-pressed={sel}
                 onClick={() => toggle(s)}
                 onMouseEnter={() => setNivelAtivo(nivel ?? null)}
                 onFocus={() => setNivelAtivo(nivel ?? null)}
                 onMouseLeave={() => setNivelAtivo(null)}
                 onBlur={() => setNivelAtivo(null)}
                 onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(s); } }}
                 style={{ cursor: livre || sel ? "pointer" : "not-allowed" }}>
                <rect x={s.x - LADO / 2} y={s.y - LADO / 2} width={LADO} height={LADO} fill={fill}
                      stroke={sel ? "var(--latao-quente)" : "var(--ferro-espelho)"} strokeWidth={sel ? 3 : 1} />
                {/* aresta superior: a luz de cima que dá relevo à chapa */}
                {!sel && livre && <line x1={s.x - LADO / 2} y1={s.y - LADO / 2 + 1} x2={s.x + LADO / 2} y2={s.y - LADO / 2 + 1}
                               stroke={chapa.aresta} strokeWidth={2} />}
                <text x={s.x} y={s.y + 4} fontSize={12} fontWeight={700} textAnchor="middle" pointerEvents="none"
                      fill={sel ? "var(--tinta)" : st === "blocked" ? COR.indisponivelNumero : st === "sold" ? COR.vendidoNumero
                    : !open ? "var(--leitura-fraca)" : st !== "free" ? COR.vendidoNumero : chapa.numero}>
                  {s.number}
                </text>
              </g>
            );
          })}

          {/* letra da fileira: nas duas pontas e no corredor central */}
          {[...new Set(seats.map((s) => s.row))].map((row) => {
            const linha = seats.filter((s) => s.row === row);
            const y = linha[0].y + 5;
            return (
              <g key={`f-${row}`} aria-hidden="true">
                <text x={X0 - 22} y={y} fontSize={13} textAnchor="end" fill="var(--latao)"
                      style={{ fontFamily: "var(--font-rye)" }}>{row}</text>
                <text x={X1 + 22} y={y} fontSize={13} fill="var(--latao)"
                      style={{ fontFamily: "var(--font-rye)" }}>{row}</text>
                {xCorredor !== null && (
                  <text x={xCorredor} y={y} fontSize={13} textAnchor="middle" fill="var(--latao)"
                        style={{ fontFamily: "var(--font-rye)" }}>{row}</text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <p className="mt-2 text-xs text-leitura-fraca">
        <strong className="text-leitura">Toque no + (ou pince com dois dedos)</strong> para aproximar e ver o número de cada cadeira.
        Arraste para percorrer o mapa.
      </p>

      {/* Legenda, embaixo do mapa: primeiro o que cada cor quer dizer, depois
          o preço. Cada amostra é a mesma chapa desenhada no mapa. */}
      <section className="placa mt-4 p-3 sm:p-4" aria-label="Legenda e preços">
        <h2 className="gravado text-base text-latao-claro">Legenda</h2>
        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-leitura sm:grid-cols-4">
          {ordemPreco.map((setor) => (
            <li key={setor} className="flex items-center gap-2"><Amostra cor={degrade(chapaDe(setor))} />{setor}</li>
          ))}
          <li className="flex items-center gap-2"><Amostra cor="var(--papel)" borda="var(--latao-quente)" />Escolhido por você</li>
          <li className="flex items-center gap-2"><Amostra cor={COR.vendido} />Ocupado</li>
          {temIndisponivel && (
            <li className="flex items-center gap-2"><Amostra cor={COR.indisponivel} borda="#4a4339" />Indisponível</li>
          )}
          {temFechado && (
            <li className="col-span-2 flex items-center gap-2">
              <Amostra cor="repeating-linear-gradient(45deg, var(--ferro-espelho) 0 3px, var(--ferro-rebaixo) 3px 5px)" />
              Venda ainda não abriu
            </li>
          )}
        </ul>

        {/* os três tipos, escolhidos lugar por lugar no pedido (ver lib/tipos.ts) */}
        <ul className="mt-4 space-y-1 border-2 border-latao bg-ferro-face px-3 py-2 text-sm text-leitura">
          {TIPOS.map((t) => (
            <li key={t.id}><strong className="text-latao-claro">{t.nome}:</strong> {t.nota}.</li>
          ))}
        </ul>

        <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {[...sectors].sort((a, b) => b.price_cents - a.price_cents).map((s) => {
            const info = sectorInfo[s.sector];
            return (
              <li key={s.sector} className="flex items-start gap-3">
                <Amostra cor={degrade(chapaDe(s.sector))} grande />
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight text-papel">{s.sector}</p>
                  <p className="flex flex-wrap gap-x-3 text-sm leading-snug text-leitura">
                    {TIPOS.map((t) => (
                      <span key={t.id} className="whitespace-nowrap">
                        {t.nome} <strong className="text-papel">{brl(info.liquido * t.fator)}</strong>
                      </span>
                    ))}
                  </p>
                  {/* a taxa do meio de pagamento, à parte e às claras */}
                  <p className="text-xs text-leitura">
                    + taxa de conveniência
                  </p>
                  {!isOpen(s.sector) && (
                    <p className="text-xs text-leitura-fraca">abre {fmtQuando(s.sales_open_at)}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 border-t border-latao/20 pt-2 text-xs text-leitura-fraca">
          O valor é o do ingresso. A taxa de conveniência é somada no pagamento, e o total aparece
          antes de pagar. No cartão dá para parcelar em até 5x.
          A plateia é uma arquibancada: cada nível fica 20&nbsp;cm acima do anterior e tem duas fileiras.
          A da frente de cada nível custa mais, e a fileira X fica no chão, colada ao palco.
        </p>
        {/* sem este aviso a mãe compra lugar para o bebê que ia no colo */}
        <p className="mt-3 border border-latao/40 bg-ferro-face px-3 py-2 text-sm text-leitura">
          <strong className="text-latao-claro">Crianças menores de 3 anos não pagam</strong> e assistem no colo,
          sem ocupar lugar. A partir de 3 anos, cada criança precisa do próprio ingresso.
        </p>
        <p className="mt-2 border border-latao/40 bg-ferro-face px-3 py-2 text-sm text-leitura">
          <strong className="text-latao-claro">Cancelamento:</strong> você pode desistir da compra em até
          7 dias depois de pagar e recebe o valor de volta. É só pedir pelo WhatsApp da PEC.
        </p>
      </section>

      <p className="mt-3 text-xs text-leitura-fraca">
        Dúvidas? WhatsApp da PEC:{" "}
        <a href={WHATSAPP_PEC_LINK} className="whitespace-nowrap text-latao-claro underline">{WHATSAPP_PEC_EXIBICAO}</a>
      </p>

      {/* O pedido em dois estágios, como nos apps de ingresso. Enquanto a
          pessoa escolhe, uma barra de uma linha: quantos, quanto, o relógio e
          "Continuar". O mapa fica livre para tocar e aproximar. Ao continuar,
          sobe a folha do pedido com os dados e o pagamento. */}
      {!aberto && (
        <div className="papel fixed inset-x-0 bottom-0 z-10 border-t-2 border-tinta/20 px-4 py-3">
          <div className="mx-auto max-w-3xl">
            {msg && <p role="alert" className="mb-2 text-sm font-semibold text-alerta">{msg}</p>}
            {qtdTotal === 0 ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-tinta">Toque nas cadeiras para escolher.</p>
                {outrasSessoes.map((o) => (
                  <a key={o.slug} href={`/evento/${o.slug}`}
                     className="shrink-0 border border-dashed border-tinta/50 px-2 py-1.5 text-xs font-semibold text-tinta">
                    + dia {o.rotulo}
                  </a>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1 text-tinta">
                  <p className="text-sm leading-tight">
                    <strong>{qtdTotal} {qtdTotal === 1 ? "lugar" : "lugares"}</strong> · {brl(netTotal)} + taxa de conveniência
                  </p>
                  {relogio2}
                </div>
                <button type="button" onClick={() => { setMsg(null); setAberto(true); }}
                        className="shrink-0 border border-tinta bg-tinta px-5 py-3 font-semibold text-papel">
                  Continuar →
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {aberto && (
        <>
          <div className="fixed inset-0 z-20 bg-black/60" onClick={() => setAberto(false)} aria-hidden="true" />
          <form role="dialog" aria-modal="true" aria-label="Seu pedido"
                className="papel fixed inset-x-0 bottom-0 z-30 max-h-[92dvh] overflow-y-auto border-t-2 border-tinta/20 p-4"
                onSubmit={(e) => e.preventDefault()}
                onKeyDown={(e) => { if (e.key === "Escape") setAberto(false); }}>
            <div className="mx-auto max-w-3xl">
              <button type="button" onClick={() => setAberto(false)}
                      className="text-sm font-semibold text-tinta underline">← Escolher mais lugares</button>
              <h2 className="gravado mt-2 text-xl text-tinta">Seu pedido</h2>
              {relogio2}
              <p className="mt-1 text-sm text-tinta">Escolha o tipo de cada ingresso:</p>
              <ul className="mt-2 space-y-3 text-sm text-tinta">
                {/* em ordem de data, esta sessão no meio das outras */}
                {[...todosItens]
                  .sort((x, y) => x.rotulo.split("/").reverse().join().localeCompare(y.rotulo.split("/").reverse().join()))
                  .map((i) => (
                  <li key={i.eventId}>
                    <strong>Dia {i.rotulo}</strong>{" "}
                    {i.eventId !== event.id && (
                      <button type="button" onClick={() => tirarDeOutraSessao(i.eventId)}
                              className="text-xs text-tinta/70 underline">tirar</button>
                    )}
                    <ul className="mt-1 space-y-1.5">
                      {[...i.seats].sort().map((id) => (
                        <li key={id} className="flex items-center gap-2">
                          <span className="gravado w-12 shrink-0">{id}</span>
                          <select aria-label={`Tipo do ingresso ${id}, dia ${i.rotulo}`}
                                  value={tipoDoLugar(i.eventId, id)}
                                  onChange={(e) => setTipos((t) => ({ ...t, [`${i.eventId}:${id}`]: e.target.value as Tipo }))}
                                  className="min-w-0 flex-1 border border-tinta/30 bg-papel-sombra/30 p-2 text-tinta">
                            {TIPOS.map((t) => (
                              <option key={t.id} value={t.id}>{t.nome} — {brl(precoBase(id) * t.fator)}</option>
                            ))}
                          </select>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              {todosItens.some((i) => i.seats.some((id) => tipoDoLugar(i.eventId, id) === "meia")) && (
                <p className="mt-2 text-xs font-semibold text-tinta">
                  Meia-entrada: leve o documento que dá direito ao benefício. Ele será pedido na entrada.
                </p>
              )}
              {/* A família que vai nos dois dias compra tudo de uma vez: troca de
                  sessão sem perder o que já marcou, e paga uma vez só. */}
              {outrasSessoes.map((o) => (
                <a key={o.slug} href={`/evento/${o.slug}`}
                   className="mt-2 block border border-dashed border-tinta/50 p-2 text-center text-sm font-semibold text-tinta">
                  {itensOutros.some((i) => i.slug === o.slug)
                    ? `Ver ou trocar os lugares do dia ${o.rotulo} →`
                    : `+ Adicionar ingressos do dia ${o.rotulo}`}
                </a>
              ))}
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <input required minLength={3} maxLength={120} placeholder="Nome completo" autoComplete="name"
                       className="border border-tinta/30 bg-papel-sombra/30 p-2.5 text-tinta placeholder:text-tinta/50"
                       value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <input required type="email" maxLength={160} placeholder="E-mail" autoComplete="email"
                       className="border border-tinta/30 bg-papel-sombra/30 p-2.5 text-tinta placeholder:text-tinta/50"
                       value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                <input required type="tel" inputMode="numeric" maxLength={20} placeholder="WhatsApp com DDD" autoComplete="tel"
                       className="border border-tinta/30 bg-papel-sombra/30 p-2.5 text-tinta placeholder:text-tinta/50"
                       value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <p className="mt-3 text-center text-sm text-tinta">
                Ingressos: <strong>{brl(netTotal)}</strong>
                {/* no pedido a taxa aparece em reais (na legenda, só "+ taxa"); ela depende do meio de pagamento */}
                <span className="block">
                  + taxa de conveniência: <strong>{brl(pixTotal - netTotal)}</strong> no Pix
                  ou <strong>{brl(cardTotal - netTotal)}</strong> no cartão
                </span>
              </p>
              {msg && <p role="alert" className="mt-2 text-sm font-semibold text-alerta">{msg}</p>}
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <button type="button" disabled={busy} onClick={() => pay("pix")}
                        className="w-full border border-tinta bg-tinta p-3 font-semibold text-papel disabled:opacity-40">
                  {busy ? "Reservando..." : `Pagar ${brl(pixTotal)} no Pix`}
                </button>
                <button type="button" disabled={busy} onClick={() => pay("card")}
                        className="w-full border border-tinta p-3 font-semibold text-tinta disabled:opacity-40">
                  {busy ? "Reservando..." : `Pagar ${brl(cardTotal)} no cartão`}
                </button>
              </div>
              <p className="mt-1.5 text-center text-xs text-tinta/70">
                Depois de tocar em pagar, você tem 30 minutos para pagar no Pix, ou 10 minutos no cartão.
              </p>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

function Amostra({ cor, borda, grande }: { cor: string; borda?: string; grande?: boolean }) {
  return (
    <span aria-hidden="true" className={`inline-block shrink-0 ${grande ? "mt-0.5 h-6 w-6" : "h-5 w-5"}`}
          style={{ background: cor, border: `${borda ? 2 : 1}px solid ${borda ?? "var(--ferro-espelho)"}` }} />
  );
}
