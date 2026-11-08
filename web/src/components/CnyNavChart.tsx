import type { CnyPerformancePoint } from "../domain/calculateCnyPerformanceSeries";

const width = 640;
const height = 240;
const left = 60;
const right = 18;
const top = 18;
const bottom = 40;
const cny = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" });

interface CnyNavChartProps {
  points: readonly CnyPerformancePoint[];
}

export function CnyNavChart({ points }: CnyNavChartProps) {
  if (points.length < 2) return null;

  const firstDate = points[0].date;
  const lastDate = points.at(-1)!.date;
  const firstTime = Date.parse(`${firstDate}T00:00:00Z`);
  const timeRange = Date.parse(`${lastDate}T00:00:00Z`) - firstTime;
  const values = points.flatMap((point) => [point.navCny, point.cumulativeNetContributionsCny]);
  const lowest = Math.min(0, ...values);
  const highest = Math.max(0, ...values);
  const spread = Math.max(highest - lowest, 1);
  const lowerBound = lowest - spread * 0.1;
  const upperBound = highest + spread * 0.1;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const x = (date: string) =>
    left + ((Date.parse(`${date}T00:00:00Z`) - firstTime) / timeRange) * chartWidth;
  const y = (value: number) =>
    top + ((upperBound - value) / (upperBound - lowerBound)) * chartHeight;
  const line = (value: (point: CnyPerformancePoint) => number) =>
    points.map((point) => `${x(point.date).toFixed(2)},${y(value(point)).toFixed(2)}`).join(" ");

  return (
    <figure className="performance-twr-chart performance-nav-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`CNY portfolio value and cumulative net contributions from ${firstDate} to ${lastDate}. Ending value ${cny.format(points.at(-1)!.navCny)}; ending net contributions ${cny.format(points.at(-1)!.cumulativeNetContributionsCny)}.`}
      >
        <line className="performance-chart-reference" x1={left} y1={y(0)} x2={width - right} y2={y(0)} />
        <text x={left - 8} y={y(0) + 4} textAnchor="end">0</text>
        <polyline className="performance-chart-line" points={line((point) => point.navCny)} />
        <polyline className="performance-chart-contributions" points={line((point) => point.cumulativeNetContributionsCny)} />
        {points.map((point) => (
          <circle key={point.date} className="performance-chart-point" cx={x(point.date)} cy={y(point.navCny)} r="3">
            <title>{`${point.date}: NAV ${cny.format(point.navCny)}; net contributions ${cny.format(point.cumulativeNetContributionsCny)}`}</title>
          </circle>
        ))}
        <text x={left} y={height - 10} textAnchor="start">{firstDate}</text>
        <text x={width - right} y={height - 10} textAnchor="end">{lastDate}</text>
      </svg>
      <figcaption>
        <span className="performance-chart-legend"><span className="performance-chart-legend-nav" /> Portfolio value</span>
        <span className="performance-chart-legend"><span className="performance-chart-legend-contributions" /> Net contributions</span>
        <span className="performance-chart-note">{firstDate} to {lastDate} · Ending value {cny.format(points.at(-1)!.navCny)} · Net contributions {cny.format(points.at(-1)!.cumulativeNetContributionsCny)}</span>
        <span className="performance-chart-note">CNY amounts at completed closes; deposits and withdrawals change value, so this line is not an investment return.</span>
      </figcaption>
    </figure>
  );
}
