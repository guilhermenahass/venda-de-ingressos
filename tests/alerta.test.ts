import { expect, test } from "vitest";
import { db } from "../lib/db";

test("alerta do mesmo tipo sai uma vez a cada 30 min, mesmo com chamadas simultâneas", async () => {
  const tipo = `teste-${crypto.randomUUID()}`;
  const rs = await Promise.all(Array.from({ length: 8 }, () => db.rpc("alerta_pode", { p_tipo: tipo })));
  expect(rs.filter((r) => r.data === true)).toHaveLength(1);
  await db.from("alertas").update({ enviado_em: new Date(Date.now() - 31 * 60_000).toISOString() }).eq("tipo", tipo);
  expect((await db.rpc("alerta_pode", { p_tipo: tipo })).data).toBe(true);
  await db.from("alertas").delete().eq("tipo", tipo);
});
