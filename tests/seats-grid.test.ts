import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { csvToSeats, niveis } from "../lib/seats-grid";

const csv = `setor;fileira;cadeiras;corredor_apos;vao_antes
VIP;A;1-4;2;
Plateia;B;1-3;;1
`;

test("gera um assento por cadeira com id fileira-numero", () => {
  const seats = csvToSeats(csv);
  expect(seats).toHaveLength(7);
  expect(seats[0]).toMatchObject({ id: "A-1", sector: "VIP", row: "A", number: 1 });
  expect(seats[6]).toMatchObject({ id: "B-3", sector: "Plateia", row: "B", number: 3 });
});

test("corredor abre um vão no x e vao_antes abre um vão no y", () => {
  const seats = csvToSeats(csv);
  const a2 = seats.find((s) => s.id === "A-2")!;
  const a3 = seats.find((s) => s.id === "A-3")!;
  const b1 = seats.find((s) => s.id === "B-1")!;
  expect(a3.x - a2.x).toBeGreaterThan(seats[1].x - seats[0].x);
  expect(b1.y - a2.y).toBeGreaterThan(30);
});

// no PEC os dois setores se alternam a cada fileira; a versão anterior abria um
// vão sempre que o setor mudava, o que furava a arquibancada inteira
test("setores alternados não abrem vão sozinhos", () => {
  const alternado = csvToSeats(`setor;fileira;cadeiras;corredor_apos;vao_antes
verde;A;1-2;;
amarela;B;1-2;;
verde;C;1-2;;
`);
  const y = ["A", "B", "C"].map((r) => alternado.find((s) => s.row === r)!.y);
  expect(y[1] - y[0]).toBe(30);
  expect(y[2] - y[1]).toBe(30);
});

test("planta real do PEC: 19 fileiras de 24, corredor no meio", () => {
  const seats = csvToSeats(readFileSync("data/teatro.csv", "utf8"));
  expect(seats).toHaveLength(456);

  const porSetor = seats.reduce<Record<string, number>>((a, s) => ({ ...a, [s.sector]: (a[s.sector] ?? 0) + 1 }), {});
  expect(porSetor).toEqual({ "Fileira do chão": 24, "Fileira da frente": 216, "Fileira de trás": 216 });

  const fileiras = [...new Set(seats.map((s) => s.row))];
  expect(fileiras).toHaveLength(19);
  expect(fileiras[0]).toBe("X");

  // corredor central: o vão entre a cadeira 12 e a 13 é maior que entre vizinhas
  const a12 = seats.find((s) => s.id === "A-12")!;
  const a13 = seats.find((s) => s.id === "A-13")!;
  const a11 = seats.find((s) => s.id === "A-11")!;
  expect(a13.x - a12.x).toBeGreaterThan(a12.x - a11.x);

  // X fica no chão, afastada da arquibancada
  const x1 = seats.find((s) => s.id === "X-1")!;
  const a1 = seats.find((s) => s.id === "A-1")!;
  expect(a1.y - x1.y).toBeGreaterThan(30);
});

test("niveis: a arquibancada do PEC dá 9 degraus de duas fileiras, com X no chão", () => {
  const { chao, degraus } = niveis(csvToSeats(readFileSync("data/teatro.csv", "utf8")));
  expect(chao).toEqual(["X"]);
  expect(degraus).toHaveLength(9);
  expect(degraus[0]).toMatchObject({ nivel: 1, rows: ["A", "B"], cotaCm: 20 });
  expect(degraus[8]).toMatchObject({ nivel: 9, rows: ["Q", "R"], cotaCm: 180 });
  // cada degrau sobe 20 cm sobre o anterior
  expect(degraus.map((d) => d.cotaCm)).toEqual([20, 40, 60, 80, 100, 120, 140, 160, 180]);
});

test("niveis: planta sem vão nenhum não inventa fileira no chão", () => {
  const { chao, degraus } = niveis(csvToSeats(`setor;fileira;cadeiras;corredor_apos;vao_antes
v;A;1-2;;
a;B;1-2;;
v;C;1-2;;
a;D;1-2;;
`));
  expect(chao).toEqual([]);
  expect(degraus.map((d) => d.rows)).toEqual([["A", "B"], ["C", "D"]]);
});
