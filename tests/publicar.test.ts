import { expect, test } from "vitest";
import { validar } from "../scripts/publicar";

const setores = new Set(["Fileira do chão", "Fileira da frente", "Fileira de trás"]);
const ids = new Set(["A-1", "A-2", "X-1", "R-9"]);
const base = () => ({
  nome: "PECkywest",
  sessoes: [{ slug: "s1", data: "2026-11-06T19:30:00-03:00" }],
  abertura_da_venda: "2026-10-16T00:00:00-03:00",
  parcelas_no_cartao: 5,
  meia_para_todos: true,
  precos_liquidos_em_reais: {
    "Fileira do chão": 249, "Fileira da frente": 219, "Fileira de trás": 179,
  } as Record<string, number | null>,
  lugares_guardados: { s1: ["A-1"] } as Record<string, string[]>,
  lugares_indisponiveis: ["R-9"],
  lugares_fora_do_mapa: [] as string[],
});

test("configuração completa passa", () => {
  expect(validar(base(), setores, ids)).toEqual([]);
});

test("preço vazio barra a publicação", () => {
  const c = base();
  c.precos_liquidos_em_reais["Fileira de trás"] = null;
  expect(validar(c, setores, ids).join()).toContain("preço não preenchido");
});

test("setor faltando ou com nome errado é barrado", () => {
  const c = base();
  delete c.precos_liquidos_em_reais["Fileira de trás"];
  c.precos_liquidos_em_reais["Fileira de tras"] = 179;
  const erros = validar(c, setores, ids).join(" | ");
  expect(erros).toContain('falta o preço do setor "Fileira de trás"');
  expect(erros).toContain('"Fileira de tras" não existe');
});

test("abertura depois da sessão é barrada", () => {
  const c = base();
  c.abertura_da_venda = "2026-11-08T00:00:00-03:00";
  expect(validar(c, setores, ids).join()).toContain("antes da sessão s1");
});

test("lugar guardado inexistente, repetido ou indisponível é barrado", () => {
  const c = base();
  c.lugares_guardados = { s1: ["A-1", "Z-99", "A-1", "R-9"] };
  const erros = validar(c, setores, ids).join(" | ");
  expect(erros).toContain('"Z-99" (s1) não existe');
  expect(erros).toContain("repetido");
  expect(erros).toContain('"R-9" (s1) está indisponível');
});

test("lugares guardados de sessão que não existe são barrados", () => {
  const c = base();
  c.lugares_guardados = { "peckywest-31-12": ["A-1"] };
  expect(validar(c, setores, ids).join()).toContain("essa sessão não existe");
});

test("lugar indisponível que não existe na planta é barrado", () => {
  const c = base();
  c.lugares_indisponiveis = ["R-99"];
  expect(validar(c, setores, ids).join()).toContain('"R-99" não existe');
});

test("lugar fora do mapa não pode estar também como indisponível ou guardado", () => {
  const c = base();
  c.lugares_fora_do_mapa = ["R-9", "A-1"];
  const erros = validar(c, setores, ids).join(" | ");
  expect(erros).toContain('"R-9" está como indisponível e fora do mapa');
  expect(erros).toContain('"A-1" (s1) está indisponível');
});
