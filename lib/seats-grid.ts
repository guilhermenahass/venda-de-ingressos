export type Seat = { id: string; sector: string; row: string; number: number; x: number; y: number };

const STEP_X = 30;   // distância entre cadeiras
const STEP_Y = 30;   // distância entre fileiras
const GAP_AISLE = 30; // vão do corredor

/**
 * CSV: setor;fileira;cadeiras;corredor_apos;vao_antes
 *
 * `corredor_apos` é o número da última cadeira antes do corredor central.
 * `vao_antes` é um vão vertical extra antes desta fileira, em passos de fileira
 * (1 = uma fileira em branco). Serve para separar blocos que ficam fisicamente
 * afastados — no PEC, a fileira X fica no chão, à frente da arquibancada.
 *
 * O vão é declarado na planta, não deduzido da troca de setor: no PEC os dois
 * setores se alternam a cada fileira (A cara, B barata, C cara...), e deduzir
 * abriria um buraco entre todas elas.
 */
export function csvToSeats(csv: string): Seat[] {
  const lines = csv.trim().split(/\r?\n/).slice(1).filter(Boolean);
  const seats: Seat[] = [];
  let y = 0;

  for (const line of lines) {
    const [sector, row, range, aisleRaw, gapRaw] = line.split(";").map((s) => s.trim());
    const [from, to] = range.split("-").map(Number);
    const aisleAfter = aisleRaw ? Number(aisleRaw) : null;

    if (gapRaw) y += Number(gapRaw) * STEP_Y;

    for (let n = from; n <= to; n++) {
      const x = (n - from) * STEP_X + (aisleAfter !== null && n > aisleAfter ? GAP_AISLE : 0);
      seats.push({ id: `${row}-${n}`, sector, row, number: n, x, y });
    }
    y += STEP_Y;
  }
  return seats;
}

export type Nivel = {
  nivel: number;      // 1 a 9, contando a partir do mais perto do palco
  rows: string[];     // as fileiras daquele degrau, da frente para trás
  y0: number; y1: number;
  cotaCm: number;     // altura acima do chão
};

/**
 * Agrupa as fileiras nos degraus da arquibancada.
 *
 * A planta do PEC é um degrau a cada duas fileiras (a cara na frente, a barata
 * atrás), e a fileira X fica no chão, à frente da arquibancada, separada por um
 * vão. O vão é o que distingue as duas coisas: fileiras antes do primeiro salto
 * de y maior que o passo comum estão no chão e não formam degrau.
 */
export function niveis(seats: Seat[], alturaDegrauCm = 20): { chao: string[]; degraus: Nivel[] } {
  const porY = new Map<number, string>();
  for (const s of seats) if (!porY.has(s.y)) porY.set(s.y, s.row);
  const ys = [...porY.keys()].sort((a, b) => a - b);
  if (ys.length === 0) return { chao: [], degraus: [] };

  const saltos = ys.slice(1).map((y, i) => y - ys[i]);
  const passo = saltos.length ? Math.min(...saltos) : 0;
  const corte = saltos.findIndex((d) => d > passo);

  const chaoAte = corte === -1 ? -1 : corte;                 // índice da última fileira no chão
  const chao = ys.slice(0, chaoAte + 1).map((y) => porY.get(y)!);
  const arquibancada = ys.slice(chaoAte + 1);

  const degraus: Nivel[] = [];
  for (let i = 0; i < arquibancada.length; i += 2) {
    const par = arquibancada.slice(i, i + 2);
    degraus.push({
      nivel: degraus.length + 1,
      rows: par.map((y) => porY.get(y)!),
      y0: par[0], y1: par[par.length - 1],
      cotaCm: (degraus.length + 1) * alturaDegrauCm,
    });
  }
  return { chao, degraus };
}
