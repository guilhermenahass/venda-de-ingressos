"use client";
import { useState } from "react";
import { WHATSAPP_PEC_EXIBICAO, WHATSAPP_PEC_LINK } from "@/lib/contato";

export default function MeusIngressos() {
  const [contact, setContact] = useState("");
  const [estado, setEstado] = useState<"form" | "enviando" | "feito" | "erro">("form");
  return (
    <main className="mx-auto w-full max-w-sm flex-1 p-5">
      <h1 className="gravado text-xl text-latao-claro">Recuperar ingressos</h1>
      <p className="mt-2 text-sm text-leitura">
        Informe o e-mail ou o WhatsApp usado na compra. Os ingressos são enviados de novo para o e-mail cadastrado.
      </p>
      {estado === "feito" ? (
        <p className="mt-4 border border-latao/50 bg-ferro-face p-3 text-leitura">
          Se houver compra com esse contato, os ingressos foram reenviados. Confira também a caixa de spam.
        </p>
      ) : (
        <form className="mt-4 grid gap-2" onSubmit={async (e) => {
          e.preventDefault();
          setEstado("enviando");
          try {
            const r = await fetch("/api/reenviar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contact }) });
            setEstado(r.ok ? "feito" : "erro");
          } catch { setEstado("erro"); }
        }}>
          <input required className="campo p-2" placeholder="E-mail ou WhatsApp usado na compra" autoComplete="email"
                 value={contact} onChange={(e) => setContact(e.target.value)} />
          <button disabled={estado === "enviando"} className="border border-latao bg-latao p-3 font-semibold text-ferro disabled:opacity-50">
            {estado === "enviando" ? "Enviando..." : "Reenviar ingressos"}
          </button>
          {estado === "erro" && (
            <p role="alert" className="text-sm font-semibold text-alerta">Não deu certo agora. Tente de novo em um minuto.</p>
          )}
        </form>
      )}
      {/* plano B que não depende de e-mail: a PEC acha o pedido e manda o link */}
      <p className="mt-6 text-sm text-leitura-fraca">
        Não chegou? Fale com a PEC no WhatsApp{" "}
        <a href={WHATSAPP_PEC_LINK} className="whitespace-nowrap text-latao-claro underline">{WHATSAPP_PEC_EXIBICAO}</a>
        {" "}que a equipe envia seus ingressos por lá.
      </p>
    </main>
  );
}
