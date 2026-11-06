// Confere um segredo de webhook contra uma notificacao real que o Mercado Pago
// ja mandou, sem precisar esperar a proxima. Le a notificacao do inspetor do
// ngrok (http://127.0.0.1:4040), que guarda as ultimas requisicoes recebidas.
//
//   npm run mp:assinatura -- <segredo>
//
// Sem argumento, usa MP_WEBHOOK_SECRET do .env.local.
import { createHmac } from "node:crypto";

type Captura = { uri: string; xSignature: string; xRequestId: string; quando: string };

async function capturas(): Promise<Captura[]> {
  const r = await fetch("http://127.0.0.1:4040/api/requests/http?limit=50").catch(() => null);
  if (!r?.ok) throw new Error("inspetor do ngrok fora do ar: rode o tunel e tente de novo");
  const d = await r.json();
  const h = (hs: Record<string, string[]>, k: string) =>
    Object.entries(hs).find(([n]) => n.toLowerCase() === k)?.[1]?.[0] ?? "";
  return (d.requests ?? [])
    .filter((x: any) => String(x.request?.uri ?? "").includes("/api/webhooks/mp"))
    .map((x: any) => ({
      uri: x.request.uri,
      xSignature: h(x.request.headers, "x-signature"),
      xRequestId: h(x.request.headers, "x-request-id"),
      quando: x.start,
    }))
    .filter((c: Captura) => c.xSignature);
}

function confere(c: Captura, secret: string) {
  const qs = new URL(`http://x${c.uri}`).searchParams;
  const dataId = (qs.get("data.id") ?? qs.get("id") ?? "").toLowerCase();
  const parts = Object.fromEntries(c.xSignature.split(",").map((p) => p.trim().split("=")));
  const manifest = `id:${dataId};request-id:${c.xRequestId};ts:${parts.ts};`;
  const calc = createHmac("sha256", secret).update(manifest).digest("hex");
  return { bate: calc === parts.v1, manifest };
}

async function main() {
  const secret = process.argv[2] ?? process.env.MP_WEBHOOK_SECRET ?? "";
  if (!secret) throw new Error("passe o segredo como argumento ou defina MP_WEBHOOK_SECRET");

  const cs = await capturas();
  if (!cs.length) throw new Error("nenhuma notificacao do Mercado Pago no historico do ngrok");

  console.log(`segredo de ${secret.length} caracteres, contra ${cs.length} notificacao(oes):\n`);
  let algum = false;
  for (const c of cs) {
    const { bate, manifest } = confere(c, secret);
    console.log(`${bate ? "BATE  " : "nao   "} ${c.quando}  ${c.uri}`);
    if (!bate) console.log(`         manifesto: ${manifest}`);
    algum ||= bate;
  }
  console.log(algum
    ? "\nEste e o segredo certo: coloque em MP_WEBHOOK_SECRET no .env.local e na Vercel."
    : "\nEste segredo nao assinou nenhuma delas. Pegue o de OUTRA aplicacao ou do outro modo no painel do Mercado Pago.");
}

main().catch((e) => { console.error(String(e.message ?? e)); process.exitCode = 1; });
