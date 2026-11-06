"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Na página do pedido: enquanto o pagamento não confirma, atualiza sozinha a
 * cada 4 s (a mãe volta do app do banco e os ingressos aparecem sem ela
 * precisar recarregar). Quando o pedido sai de "aguardando", esquece o aviso
 * de "pagamento em andamento" que o mapa mostra.
 */
export default function AcompanharPedido({ status, criadoEm, limiteMs }: { status: string; criadoEm: string; limiteMs: number }) {
  const router = useRouter();
  useEffect(() => {
    if (status !== "pending") {
      try { localStorage.removeItem("pec:pedido"); } catch {}
      return;
    }
    // depois do prazo o lugar já foi liberado; não adianta continuar perguntando
    if (Date.now() - new Date(criadoEm).getTime() > limiteMs) return;
    const t = setInterval(() => { if (!document.hidden) router.refresh(); }, 4000);
    return () => clearInterval(t);
  }, [status, criadoEm, limiteMs, router]);
  return null;
}
