export interface BarChartItem {
  readonly id: string;
  readonly label: string;
  /** Texto já formatado do valor; nulo = indisponível (sem barra, nunca zero). */
  readonly valueText: string | null;
  /** Largura da barra em % (0 a 100). Ignorada quando o valor é indisponível. */
  readonly widthPercent: string;
}

/**
 * Gráfico de barras horizontais em HTML/CSS, sem biblioteca. Os números vêm prontos do motor de métricas;
 * aqui só se desenha. Valor indisponível mostra o texto, nunca uma barra vazia que pareça zero.
 */
export function BarChart({ items, ariaLabel, unavailableText }: { items: readonly BarChartItem[]; ariaLabel: string; unavailableText: string }) {
  return (
    <ul className="bar-chart" aria-label={ariaLabel}>
      {items.map((item) => (
        <li key={item.id} className="bar-chart-row" data-available={item.valueText !== null}>
          <span className="bar-chart-label">{item.label}</span>
          <span className="bar-chart-track" aria-hidden="true">
            {item.valueText !== null ? <span className="bar-chart-bar" style={{ width: `${item.widthPercent}%` }} /> : null}
          </span>
          <strong className="bar-chart-value">{item.valueText ?? unavailableText}</strong>
        </li>
      ))}
    </ul>
  );
}
