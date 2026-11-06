import Image from "next/image";
import { WHATSAPP_PEC_EXIBICAO, WHATSAPP_PEC_LINK } from "@/lib/contato";

/** Assinatura da casa: o espetáculo é do PECkywest, a bilheteria é da PEC. */
export default function Assinatura({ className = "" }: { className?: string }) {
  return (
    <footer className={`text-center ${className}`}>
      <p className="text-sm text-leitura-fraca">
        Dúvidas? Fale com a PEC no WhatsApp{" "}
        <a href={WHATSAPP_PEC_LINK} className="whitespace-nowrap text-latao-claro underline">{WHATSAPP_PEC_EXIBICAO}</a>
      </p>
      <div className="mt-4 flex items-center justify-center gap-3">
        <span className="text-[0.68rem] uppercase tracking-[0.22em] text-leitura-fraca">Uma realização</span>
        <Image src="/arte/pec-studio.png" alt="PEC Studio — dança, música e arte" width={120} height={36} className="h-7 w-auto opacity-90" />
      </div>
    </footer>
  );
}
