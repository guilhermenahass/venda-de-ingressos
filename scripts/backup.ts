// Backup na hora, salvo no computador (o automático vai por e-mail todo dia).
//
//   npx tsx --env-file=.env.local scripts/backup.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { gerarBackup } from "../lib/backup";

gerarBackup().then((b) => {
  mkdirSync("backups", { recursive: true });
  const arquivo = `backups/pec-ingressos-${b.gerado_em.slice(0, 16).replace(/[:T]/g, "-")}.json`;
  writeFileSync(arquivo, JSON.stringify(b));
  console.log(arquivo, b.resumo, `${b.pedidos_pagos} pedidos pagos`);
});
