import { expect, test } from "vitest";
import { celula } from "../lib/csv";

test("fórmula digitada no nome não vira fórmula na planilha", () => {
  expect(celula('=HYPERLINK("http://x";"clique")')).toBe(`"'=HYPERLINK(""http://x"";""clique"")"`);
  expect(celula("+5511")).toBe(`"'+5511"`);
  expect(celula("@SOMA(1)")).toBe(`"'@SOMA(1)"`);
});

test("ponto e vírgula e quebra de linha não desalinham as colunas", () => {
  expect(celula("Ana; Silva")).toBe(`"Ana; Silva"`);
  expect(celula("Ana\nSilva")).toBe(`"Ana\nSilva"`);
});

test("valor comum sai só entre aspas", () => {
  expect(celula("Maria Souza")).toBe(`"Maria Souza"`);
  expect(celula(12)).toBe(`"12"`);
});
