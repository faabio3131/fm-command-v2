import { donutGeometry, type DonutInput } from "./donut-geometry";

/**
 * Rosca de participação por filial em SVG. A participação vem do motor; filial sem valor não ganha fatia e aparece na legenda
 * como indisponível. A legenda repete o dado em texto, então a cor nunca é a única informação.
 */
export function DonutChart({ items, ariaLabel, unavailableText, othersLabel, formatPercent }: {
  items: readonly DonutInput[];
  ariaLabel: string;
  unavailableText: string;
  othersLabel: (count: number) => string;
  /** Participação no idioma da pessoa (vírgula ou ponto decimal). */
  formatPercent: (percent: string) => string;
}) {
  const g = donutGeometry(items);
  return (
    <div className="donut-chart" data-testid="donut-chart">
      <svg viewBox="0 0 42 42" role="img" aria-label={ariaLabel}>
        <circle className="donut-track" cx="21" cy="21" r="15.9155" />
        {g.slices.map((s) => (
          <circle key={s.id} className="donut-slice" data-color={s.colorIndex} cx="21" cy="21" r="15.9155"
            strokeDasharray={`${s.dash} ${Math.round((100 - s.dash) * 10) / 10}`} strokeDashoffset={s.offset} />
        ))}
      </svg>
      <ul className="donut-legend">
        {g.slices.map((s) => (
          <li key={s.id}><i data-color={s.colorIndex} aria-hidden="true" /><span>{s.label}</span><strong>{formatPercent(s.sharePercent)}</strong></li>
        ))}
        {g.othersPercent ? <li><i data-color="others" aria-hidden="true" /><span>{othersLabel(g.othersCount)}</span><strong>{formatPercent(g.othersPercent)}</strong></li> : null}
        {g.unavailable.map((u) => <li key={u.id} data-available="false"><i aria-hidden="true" /><span>{u.label}</span><strong>{unavailableText}</strong></li>)}
      </ul>
    </div>
  );
}
