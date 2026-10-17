import { parseDecimal } from "@/domain/core/decimal";

export interface LineInput { readonly key: string; readonly value: string | null; readonly closed: boolean }
export interface LineDot { readonly key: string; readonly x: number; readonly y: number; readonly closed: boolean }
export interface LineGeometry {
  readonly width: number;
  readonly height: number;
  /** Trechos contínuos de meses com valor; mês sem valor interrompe a linha (lacuna, nunca zero). */
  readonly solid: readonly string[];
  /** Trecho até o mês em andamento, tracejado, porque o mês ainda não fechou. */
  readonly open: string | null;
  readonly dots: readonly LineDot[];
  /** Posição X de cada mês (inclui os sem valor) para os rótulos. */
  readonly ticks: readonly { readonly key: string; readonly x: number }[];
  /** Linha de base (y do zero) e de topo, para as guias. */
  readonly baselineY: number;
}

const PAD = { left: 8, right: 8, top: 14, bottom: 8 };
const r = (n: number) => Math.round(n * 10) / 10;

/**
 * Converte a série em coordenadas SVG. O número só serve para desenhar (o valor mostrado vem do texto do motor).
 * Eixo começa em zero quando todos os valores são positivos; com negativos, inclui o menor valor.
 */
export function lineGeometry(input: readonly LineInput[], width = 320, height = 120): LineGeometry {
  const nums = input.map((p) => (p.value === null ? null : parseDecimal(p.value)));
  const vals = nums.map((d) => (d === null ? null : Number(d.units) / 10 ** d.scale));
  const present = vals.filter((v): v is number => v !== null);
  const max = present.length ? Math.max(...present, 0) : 1;
  const min = present.length ? Math.min(...present, 0) : 0;
  const span = max - min || 1;
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const x = (i: number) => r(PAD.left + (input.length === 1 ? innerW / 2 : (i * innerW) / (input.length - 1)));
  const y = (v: number) => r(PAD.top + innerH - ((v - min) / span) * innerH);

  const dots: LineDot[] = [];
  const runs: { i: number; x: number; y: number }[][] = [];
  let current: { i: number; x: number; y: number }[] = [];
  vals.forEach((v, i) => {
    if (v === null) { if (current.length) runs.push(current); current = []; return; }
    const pt = { i, x: x(i), y: y(v) };
    current.push(pt);
    dots.push({ key: input[i].key, x: pt.x, y: pt.y, closed: input[i].closed });
  });
  if (current.length) runs.push(current);

  const solid: string[] = [];
  let open: string | null = null;
  for (const run of runs) {
    const lastIdx = run[run.length - 1].i;
    const endsOpen = !input[lastIdx].closed && run.length > 1;
    const solidPts = endsOpen ? run.slice(0, -1) : run;
    if (solidPts.length > 1) solid.push(solidPts.map((p, k) => `${k === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" "));
    if (endsOpen) {
      const a = run[run.length - 2]; const b = run[run.length - 1];
      open = `M${a.x} ${a.y} L${b.x} ${b.y}`;
    }
  }
  return { width, height, solid, open, dots, ticks: input.map((p, i) => ({ key: p.key, x: x(i) })), baselineY: y(0) };
}
