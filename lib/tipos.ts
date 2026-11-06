/** Tipos de ingresso (ver supabase/migrations/0022_tipo_de_ingresso.sql). */
export type Tipo = "meia" | "antecipado" | "inteira";

export const TIPOS: { id: Tipo; nome: string; fator: number; nota: string }[] = [
  { id: "meia", nome: "Meia-entrada", fator: 1, nota: "destinada aos beneficiários previstos em lei (apresentar documento na entrada)" },
  { id: "antecipado", nome: "Antecipado", fator: 1, nota: "valor promocional disponível para todos, sem necessidade de comprovação" },
  { id: "inteira", nome: "Inteira", fator: 2, nota: "valor integral do ingresso, correspondente ao dobro da meia-entrada" },
];

export const fatorDe = (t: Tipo) => (t === "inteira" ? 2 : 1);

/** orders.tipos guarda só o que não é antecipado. */
export function tipoDe(tipos: Record<string, string> | null | undefined, seatId: string): Tipo {
  const t = tipos?.[seatId];
  return t === "meia" || t === "inteira" ? t : "antecipado";
}

export const nomeTipo = (t: Tipo) => TIPOS.find((x) => x.id === t)!.nome;
