import type { TrendPoint } from "@/domain/metrics/series-view";
import { lineGeometry } from "./line-geometry";

/**
 * Linha de tendência em SVG, sem biblioteca. O valor de cada mês vem do motor; aqui só se desenha.
 * Mês sem valor interrompe a linha e aparece como indisponível na tabela de apoio (nunca vira zero).
 * O último trecho, quando o mês ainda não fechou, é tracejado. A tabela escondida dá o mesmo conteúdo a leitor de tela.
 */
export function LineChart({ points, ariaLabel, monthLabel, formatValue, unavailableText, openMonthText }: {
  points: readonly TrendPoint[];
  ariaLabel: string;
  monthLabel: (key: string) => string;
  formatValue: (value: string, currency?: string) => string;
  unavailableText: string;
  openMonthText: string;
}) {
  const g = lineGeometry(points.map((p) => ({ key: p.key, value: p.value, closed: p.closed })));
  return (
    <figure className="line-chart" data-testid="line-chart">
      <svg viewBox={`0 0 ${g.width} ${g.height}`} role="img" aria-label={ariaLabel} preserveAspectRatio="none">
        <line className="line-chart-base" x1="0" x2={g.width} y1={g.baselineY} y2={g.baselineY} />
        {g.solid.map((d) => <path key={d} className="line-chart-path" d={d} />)}
        {g.open ? <path className="line-chart-path line-chart-open" d={g.open} /> : null}
        {g.dots.map((dot) => <circle key={dot.key} className="line-chart-dot" data-open={!dot.closed} cx={dot.x} cy={dot.y} r="3" />)}
      </svg>
      <div className="line-chart-months" aria-hidden="true">
        {points.map((p) => <span key={p.key} data-open={!p.closed}>{monthLabel(p.key)}</span>)}
      </div>
      <div className="sr-only">
      <table>
        <caption>{ariaLabel}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.key}>
              <th scope="row">{monthLabel(p.key)}{p.closed ? "" : ` (${openMonthText})`}</th>
              <td>{p.value === null ? unavailableText : formatValue(p.value, p.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  );
}
