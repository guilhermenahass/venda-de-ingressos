"use client";
import { useEffect, useState } from "react";

type Pedido = {
  id: string; status: string; nome: string; email: string; telefone: string; lugares: string[];
  total: number; metodo: string; criado: string; evento: string; data: string; link: string;
};
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function situacao(p: Pedido): { texto: string; cor: string } {
  if (p.status === "paid") return { texto: "PAGO", cor: "bg-green-700" };
  if (p.status === "refunded") return { texto: "ESTORNADO", cor: "bg-ferro-rebaixo" };
  if (p.status === "conflict") return { texto: "PAGOU TARDE, ESTORNADO", cor: "bg-red-800" };
  if (p.status === "expired") return { texto: "NÃO PAGOU (EXPIROU)", cor: "bg-ferro-rebaixo" };
  // cartão retido no antifraude do MP: lugares guardados, não precisa comprar de novo
  if (p.status === "em_analise") return { texto: "CARTÃO EM ANÁLISE NO MERCADO PAGO", cor: "bg-latao" };
  // prazo para pagar: o QR do Pix vale 30 min; o checkout do cartão, 10
  const prazo = p.metodo === "pix" ? 30 * 60_000 : 10 * 60_000;
  return Date.now() - new Date(p.criado).getTime() > prazo
    ? { texto: "NÃO PAGOU (EXPIROU)", cor: "bg-ferro-rebaixo" }
    : { texto: "AGUARDANDO PAGAMENTO", cor: "bg-latao" };
}

export default function Atendimento() {
  const [pin, setPin] = useState("");
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<Pedido[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => { try { setPin(sessionStorage.getItem("pin") ?? ""); } catch {} }, []);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null); setCarregando(true);
    try { sessionStorage.setItem("pin", pin); } catch {}
    try {
      const r = await fetch("/api/atendimento", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, busca }),
      });
      if (r.status === 401) setMsg("PIN incorreto.");
      else if (r.status === 429) setMsg("Muitas tentativas. Espere um minuto.");
      else if (r.status === 400) setMsg("Digite pelo menos 3 letras ou números.");
      else if (!r.ok) setMsg("Não deu certo agora. Tente de novo.");
      else setLista(await r.json());
    } catch { setMsg("Sem conexão. Confira a internet."); }
    setCarregando(false);
  }

  return (
    <main className="mx-auto w-full max-w-md flex-1 p-4">
      <h1 className="gravado text-lg text-latao-claro">Atendimento</h1>
      <p className="mt-1 text-sm text-leitura-fraca">
        Ache a compra pelo WhatsApp, e-mail ou nome de quem comprou e mande o link dos ingressos.
      </p>
      <form onSubmit={buscar} className="mt-3 grid gap-2">
        <input className="campo p-2" placeholder="PIN" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} />
        <div className="flex gap-2">
          <input className="campo min-w-0 flex-1 p-2" placeholder="WhatsApp, e-mail ou nome" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <button disabled={carregando} className="border border-latao bg-latao px-4 font-semibold text-ferro disabled:opacity-50">
            {carregando ? "..." : "Buscar"}
          </button>
        </div>
      </form>
      {msg && <p role="alert" className="mt-3 text-sm font-semibold text-alerta">{msg}</p>}
      {lista && lista.length === 0 && <p className="mt-4 text-leitura">Nenhuma compra encontrada com essa busca.</p>}
      <ul className="mt-4 grid gap-3">
        {(lista ?? []).map((p) => {
          const st = situacao(p);
          const fone = p.telefone.length <= 11 ? `55${p.telefone}` : p.telefone;
          const quando = new Date(p.data).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
          const texto = `Olá, ${p.nome}! Seus ingressos para ${p.evento} (${quando}): ${p.link}`;
          return (
            <li key={p.id} className="placa p-3">
              <span className={`inline-block px-2 py-0.5 text-xs font-bold text-white ${st.cor}`}>{st.texto}</span>
              <p className="mt-2 font-semibold text-papel">{p.nome}</p>
              <p className="text-sm text-leitura">{p.telefone} · {p.email}</p>
              <p className="mt-1 text-sm text-leitura">{quando} · {p.lugares.join(", ")} · {brl(p.total)} no {p.metodo === "pix" ? "Pix" : "cartão"}</p>
              <div className="mt-3 flex gap-2">
                <a href={p.link} target="_blank" rel="noopener" className="flex-1 border border-latao/60 p-2 text-center text-sm text-latao-claro">Abrir pedido</a>
                {p.status === "paid" && (
                  <a href={`https://wa.me/${fone}?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener"
                     className="flex-1 border border-latao bg-latao p-2 text-center text-sm font-semibold text-ferro">Mandar pelo WhatsApp</a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
