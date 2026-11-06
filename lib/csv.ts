/**
 * Célula de CSV segura para abrir no Excel. O nome vem do que a compradora
 * digitou: um "=" no começo vira fórmula ativa na planilha da portaria
 * (injeção de fórmula), e um ";" ou quebra de linha desalinha todas as
 * colunas. Neutraliza o primeiro caso com um apóstrofo e o segundo com aspas.
 */
export function celula(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
