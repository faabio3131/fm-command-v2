export interface DonutInput { readonly id: string; readonly label: string; readonly valueText: string | null; readonly sharePercent: string | null }
export interface DonutSlice {
  readonly id: string;
  readonly label: string;
  readonly valueText: string;
  readonly sharePercent: string;
  /** Comprimento do arco em um círculo de circunferência 100. */
  readonly dash: number;
  /** Deslocamento do início do arco (negativo = sentido horário a partir do topo). */
  readonly offset: number;
  readonly colorIndex: number;
}
export interface DonutGeometry {
  readonly slices: readonly DonutSlice[];
  /** Soma das participações das filiais agrupadas em "outras". */
  readonly othersPercent: string | null;
  readonly othersCount: number;
  /** Filiais sem participação (sem valor): ficam só na legenda, nunca ganham fatia. */
  readonly unavailable: readonly DonutInput[];
}

/** Rosca de participação: usa a participação que o motor já calculou. Sem total comparável (sharePercent nulo), não há fatia. */
export function donutGeometry(items: readonly DonutInput[], maxSlices = 5): DonutGeometry {
  const withShare = items.filter((i): i is DonutInput & { valueText: string; sharePercent: string } => i.valueText !== null && i.sharePercent !== null)
    .sort((a, b) => Number(b.sharePercent) - Number(a.sharePercent));
  const unavailable = items.filter((i) => i.valueText === null);
  const main = withShare.slice(0, maxSlices);
  const rest = withShare.slice(maxSlices);
  let acc = 0;
  const slices = main.map((item, colorIndex) => {
    const dash = Math.max(0, Number(item.sharePercent));
    const slice: DonutSlice = { id: item.id, label: item.label, valueText: item.valueText, sharePercent: item.sharePercent, dash: Math.round(dash * 10) / 10, offset: -Math.round(acc * 10) / 10, colorIndex };
    acc += dash;
    return slice;
  });
  const others = rest.reduce((s, i) => s + Number(i.sharePercent), 0);
  return { slices, othersPercent: rest.length ? (Math.round(others * 10) / 10).toFixed(1) : null, othersCount: rest.length, unavailable };
}
