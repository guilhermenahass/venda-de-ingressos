import { db } from "./db";

// Cópia de tudo que não se recupera de outro lugar: quem comprou, o que
// pagou, quais ingressos existem e quais lugares estão ocupados. O plano
// gratuito do Supabase não tem backup; esta cópia sai do banco todo dia
// (cron) e vai por e-mail, então sobrevive a qualquer problema nele.
const TABELAS = ["events", "event_sectors", "orders", "tickets", "event_seats"] as const;

async function tudo(tabela: string) {
  // o Supabase devolve no máximo 1000 linhas por consulta
  const linhas: unknown[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db.from(tabela).select("*").range(de, de + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    linhas.push(...data);
    if (data.length < 1000) return linhas;
  }
}

export async function gerarBackup() {
  const dados: Record<string, unknown[]> = {};
  for (const t of TABELAS) dados[t] = await tudo(t);
  const pagos = (dados.orders as { status: string }[]).filter((o) => o.status === "paid").length;
  return {
    gerado_em: new Date().toISOString(),
    resumo: Object.fromEntries(TABELAS.map((t) => [t, dados[t].length])) as Record<string, number>,
    pedidos_pagos: pagos,
    dados,
  };
}
