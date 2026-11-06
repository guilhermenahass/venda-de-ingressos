"use client";
import { useState } from "react";

/**
 * O Pix da compra, na nossa página: QR para quem paga de outro aparelho e o
 * "copia e cola" para quem paga no mesmo celular (o caso comum: a mãe copia,
 * abre o app do banco e cola).
 */
export default function PixQr({ qr, qrBase64 }: { qr: string; qrBase64: string | null }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try { await navigator.clipboard.writeText(qr); }
    catch {
      // navegador sem permissão de área de transferência: seleciona o texto
      const t = document.getElementById("pix-copia") as HTMLTextAreaElement | null;
      t?.select();
      document.execCommand("copy");
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 4000);
  }
  return (
    <section className="papel mt-4 p-4 text-center">
      {/* os três passos em ordem; o 3º é o que mais se perde: depois de pagar
          no app do banco, voltar aqui para ver os ingressos */}
      <ol className="mb-3 space-y-1.5 text-left text-sm text-tinta">
        <li><strong>1.</strong> Toque em <strong>Copiar código do Pix</strong>.</li>
        <li><strong>2.</strong> Abra o app do seu banco, escolha <strong>Pix copia e cola</strong>, cole e pague.</li>
        <li><strong>3.</strong> <strong>Volte para esta página</strong>: seus ingressos aparecem aqui sozinhos.</li>
      </ol>
      <button type="button" onClick={copiar}
              className="w-full border border-tinta bg-tinta p-3 font-semibold text-papel">
        {copiado ? "Código copiado! Agora cole no app do banco" : "Copiar código do Pix"}
      </button>
      {qrBase64 && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`data:image/png;base64,${qrBase64}`} alt="QR do Pix" width={220} height={220} className="mx-auto mt-3" />
      )}
      <p className="text-xs text-tinta/70">Ou leia o QR com a câmera do app do banco, em outro aparelho.</p>
      <textarea id="pix-copia" readOnly value={qr} rows={3}
                className="mt-3 w-full resize-none border border-tinta/30 bg-papel-sombra/30 p-2 text-xs text-tinta" />
    </section>
  );
}
