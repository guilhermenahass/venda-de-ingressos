"use client";
import { Html5Qrcode } from "html5-qrcode";
import { useEffect, useRef, useState } from "react";

type Res = {
  result: "ok" | "already" | "revoked" | "not_found" | "outro_dia" | "evento" | "erro" | "lento";
  seat_id?: string; buyer_name?: string; checked_in_at?: string; dia?: string; tipo?: string;
};
const TEXT: Record<Res["result"], string> = {
  ok: "PODE ENTRAR", already: "JÁ ENTROU", revoked: "INGRESSO CANCELADO", not_found: "NÃO ENCONTRADO",
  // Falha de conexão ou limite de leituras NÃO é recusa do ingresso. Antes
  // aparecia como caixa vermelha sem texto, e a equipe barraria quem tem
  // ingresso válido. Agora fica neutra e diz para ler de novo.
  erro: "NÃO CONFERIDO — LEIA DE NOVO", lento: "ESPERE ALGUNS SEGUNDOS E LEIA DE NOVO",
  outro_dia: "INGRESSO DE OUTRO DIA",
  evento: "EVENTO ERRADO — ABRA O LINK DO DIA",
};

export default function Portaria() {
  const [pin, setPin] = useState("");
  const [slug, setSlug] = useState("");
  const [res, setRes] = useState<Res | null>(null);
  const [code, setCode] = useState("");
  const [count, setCount] = useState(0);
  const [camErr, setCamErr] = useState<string | null>(null);
  const scanner = useRef<Html5Qrcode | null>(null);
  const lock = useRef(false);

  useEffect(() => {
    // /portaria?evento=peckywest-06-11: o link de cada dia já vem com a sessão,
    // a equipe só digita o PIN
    const doLink = new URLSearchParams(window.location.search).get("evento");
    try { setPin(sessionStorage.getItem("pin") ?? ""); setSlug(doLink ?? sessionStorage.getItem("slug") ?? ""); } catch { if (doLink) setSlug(doLink); }
  }, []);

  async function send(body: Record<string, string>) {
    // Sem rede, o fetch lança erro. Antes isso deixava a leitura travada
    // (lock nunca liberava) e a câmera parava de ler até recarregar a página.
    let r: Response;
    try {
      r = await fetch("/api/checkin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, pin, slug }) });
    } catch {
      setRes({ result: "erro" });
      setTimeout(() => { lock.current = false; }, 1500);
      return;
    }
    if (r.status === 401) { alert("PIN incorreto"); lock.current = false; return; }
    if (r.status === 404) { setRes({ result: "evento" }); setTimeout(() => { lock.current = false; }, 1500); return; }
    if (!r.ok) {
      setRes({ result: r.status === 429 ? "lento" : "erro" });
      setTimeout(() => { lock.current = false; }, 1500);
      return;
    }
    const j: Res = await r.json().catch(() => ({ result: "erro" as const }));
    setRes(j);
    if (j.result === "ok") setCount((c) => c + 1);
    if (navigator.vibrate) navigator.vibrate(j.result === "ok" ? 100 : [100, 50, 100, 50, 100]);
    setTimeout(() => { lock.current = false; }, 1500); // evita ler o mesmo QR 10x por segundo
  }

  async function start() {
    try { sessionStorage.setItem("pin", pin); sessionStorage.setItem("slug", slug); } catch {}
    // tocar em "Câmera" de novo não pode abrir um segundo leitor por cima
    if (scanner.current) { await scanner.current.stop().catch(() => {}); scanner.current = null; }
    setCamErr(null);
    const s = new Html5Qrcode("reader");
    scanner.current = s;
    try {
      await s.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (text) => {
        const m = /\/t\/([0-9a-f-]{36})/i.exec(text);
        if (!m) return;
        if (lock.current) return;
        lock.current = true;
        send({ token: m[1] });
      }, () => {});
    } catch (err) {
      console.error(err);
      setRes(null);
      setCamErr("Não foi possível abrir a câmera. Use o código manual.");
    }
  }
  useEffect(() => () => { scanner.current?.stop().catch(() => {}); }, []);

  // Cores de semáforo, não do tema: no escuro e com fila, quem confere precisa
  // decidir pela cor antes de ler a palavra.
  const neutro = res?.result === "erro" || res?.result === "lento" || res?.result === "evento";
  const bg = res?.result === "ok" ? "bg-green-600" : neutro ? "bg-ferro-face" : res ? "bg-red-700" : "bg-ferro-espelho";

  return (
    <main className="mx-auto w-full max-w-sm flex-1 p-4">
      <h1 className="gravado text-lg text-latao-claro">Portaria</h1>
      <div className="mt-2 flex gap-2">
        <input className="campo w-24 p-2" placeholder="PIN" type="password" inputMode="numeric"
               value={pin} onChange={(e) => setPin(e.target.value)} />
        <input className="campo min-w-0 flex-1 p-2" placeholder="evento (ex.: peckywest-06-11)"
               value={slug} onChange={(e) => setSlug(e.target.value)} />
        <button className="border border-latao bg-latao px-3 font-semibold text-ferro" onClick={start}>Câmera</button>
      </div>
      {camErr && <p className="mt-2 text-sm font-semibold text-alerta">{camErr}</p>}
      <div id="reader" className="mt-2 overflow-hidden" />
      <div className={`mt-3 border border-latao/30 p-5 text-center text-white ${bg}`} role="status" aria-live="assertive">
        {res ? (
          <>
            <div className="text-3xl font-black uppercase tracking-wide">{TEXT[res.result]}</div>
            {res.result === "outro_dia" && <div className="mt-1 text-xl">{res.seat_id} — vale para o dia {res.dia}</div>}
            {res.seat_id && res.result !== "outro_dia" && <div className="mt-1 text-xl">{res.seat_id} — {res.buyer_name}</div>}
            {res.tipo === "meia" && (
              <div className="mt-2 border-2 border-white px-2 py-1 text-xl font-black uppercase">Meia-entrada: pedir documento</div>
            )}
            {res.result === "already" && res.checked_in_at && (
              <div className="mt-1 text-sm opacity-90">
                às {new Date(res.checked_in_at).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" })}
              </div>
            )}
          </>
        ) : <span className="text-leitura-fraca">Aponte para o QR</span>}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); send({ code }); setCode(""); }}>
        <input className="campo min-w-0 flex-1 p-2 uppercase tracking-widest" placeholder="Código manual (6 caracteres)"
               maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="border border-latao px-4 font-semibold text-latao-claro">OK</button>
      </form>
      <p className="mt-3 text-sm text-leitura-fraca">Entradas nesta sessão: {count}</p>
    </main>
  );
}
