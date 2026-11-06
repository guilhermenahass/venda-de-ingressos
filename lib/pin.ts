import { timingSafeEqual } from "node:crypto";

// PIN da equipe da PEC: vale para a portaria e para o atendimento.
//
// ponytail: contadores em memória, por instância. O limite que vale de verdade
// é o do firewall da Vercel, por IP e compartilhado entre instâncias; este é a
// segunda camada.
const tentativas = new Map<string, { n: number; ate: number }>();
// Não depende de nada que o cliente controle: trocar o x-forwarded-for a cada
// tentativa não escapa deste contador.
let global = { n: 0, ate: 0 };
const GLOBAL_MAX = 30; // por minuto; deixa folga para erro de digitação da equipe

function confere(enviado: string) {
  const esperado = process.env.PORTARIA_PIN ?? "";
  const a = Buffer.from(enviado), b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** null quando o PIN confere; senão o status HTTP e o erro para responder. */
export function checarPin(req: Request, pin: unknown): { status: number; error: string } | null {
  // PIN curto é adivinhável da internet. Falha fechada em vez de aceitar um
  // PIN fraco em produção.
  if ((process.env.PORTARIA_PIN ?? "").length < 6) {
    console.error("PORTARIA_PIN ausente ou com menos de 6 caracteres");
    return { status: 500, error: "config" };
  }
  const chave = req.headers.get("x-forwarded-for") ?? "local";
  const agora = Date.now();
  const a = tentativas.get(chave);
  if (a && agora > a.ate) tentativas.delete(chave);
  if (agora > global.ate) global = { n: 0, ate: agora + 60_000 };

  if (typeof pin === "string" && confere(pin)) { tentativas.delete(chave); return null; }

  global.n += 1;
  if (global.n > GLOBAL_MAX) return { status: 429, error: "muitas tentativas" };
  let e = tentativas.get(chave);
  if (!e && tentativas.size > 5000) { for (const [k, v] of tentativas) if (v.ate < agora) tentativas.delete(k); }
  e ??= { n: 0, ate: agora + 60_000 };
  e.n += 1;
  tentativas.set(chave, e);
  if (e.n > 10) return { status: 429, error: "muitas tentativas" };
  return { status: 401, error: "pin" };
}
