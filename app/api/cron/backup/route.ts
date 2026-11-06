import { NextResponse } from "next/server";
import { Resend } from "resend";
import { gerarBackup } from "@/lib/backup";
import { avisar } from "@/lib/alerta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Todo dia (vercel.json): backup do banco, por e-mail, para fora do Supabase. */
export async function GET(req: Request) {
  const esperado = process.env.CRON_SECRET;
  if (!esperado || req.headers.get("authorization") !== `Bearer ${esperado}`) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }
  try {
    const b = await gerarBackup();
    const quando = new Date(b.gerado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const arquivo = `pec-ingressos-backup-${b.gerado_em.slice(0, 16).replace(/[:T]/g, "-")}.json`;
    const { error } = await new Resend(process.env.RESEND_API_KEY!).emails.send({
      from: process.env.MAIL_FROM!,
      to: process.env.BACKUP_EMAIL ?? "alertas@example.com",
      subject: `Backup PEC Ingressos — ${quando} — ${b.pedidos_pagos} pedidos pagos`,
      text: `Backup automático do banco (${quando}).\n\n${Object.entries(b.resumo).map(([t, n]) => `${t}: ${n}`).join("\n")}\n\nGuarde este e-mail. Para restaurar, fale com a GG Code.`,
      attachments: [{ filename: arquivo, content: Buffer.from(JSON.stringify(b)).toString("base64") }],
    });
    if (error) throw new Error(error.message);
    console.log("backup: enviado", b.resumo);
    return NextResponse.json({ ok: true, ...b.resumo });
  } catch (e) {
    console.error("backup", e);
    await avisar("backup_falhou", e);
    return NextResponse.json({ error: "falhou" }, { status: 500 });
  }
}
