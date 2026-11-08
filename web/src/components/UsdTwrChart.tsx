import type { UsdTwrPoint } from "../domain/calculateUsdTwrSeries";

const width = 640;
const height = 240;
const left = 54;
const right = 18;
const top = 18;
const bottom = 40;

interface UsdTwrChartProps {
  points: readonly UsdTwrPoint[];
}

export function UsdTwrChart({ points }: UsdTwrChartProps) {
  if (points.length < 2) return null;

  const firstDate = points[0].date;
  const lastDate = points.at(-1)!.date;
  const firstTime = Date.parse(`${firstDate}T00:00:00Z`);
  const timeRange = Date.parse(`${lastDate}T00:00:00Z`) - firstTime;
  const values = points.map((point) => point.growthIndex);
  const lowest = Math.min(100, ...values);
  const highest = Math.max(100, ...values);
  const spread = Math.max(highest - lowest, 1);
  const lowerBound = lowest - spread * 0.1;
  const upperBound = highest + spread * 0.1;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const x = (date: string) =>
    left + ((Date.parse(`${date}T00:00:00Z`) - firstTime) / timeRange) * chartWidth;
  const y = (value: number) =>
    top + ((upperBound - value) / (upperBound - lowerBound)) * chartHeight;
  const coordinates = points.map((point) =>
    `${x(point.date).toFixed(2)},${y(point.growthIndex).toFixed(2)}`,
  ).join(" ");

  return (
    <figure className="performance-twr-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`USD TWR growth index from ${firstDate} to ${lastDate}, starting at 100 and ending at ${points.at(-1)!.growthIndex.toFixed(2)}`}
      >
        <line className="performance-chart-reference" x1={left} y1={y(100)} x2={width - right} y2={y(100)} />
        <text x={left - 8} y={y(100) + 4} textAnchor="end">100</text>
        <polyline className="performance-chart-line" points={coordinates} />
        {points.map((point) => (
          <circle key={point.date} className="performance-chart-point" cx={x(point.date)} cy={y(point.growthIndex)} r="3">
            <title>{`${point.date}: ${point.growthIndex.toFixed(2)}`}</title>
          </circle>
        ))}
        <text x={left} y={height - 10} textAnchor="start">{firstDate}</text>
        <text x={width - right} y={height - 10} textAnchor="end">{lastDate}</text>
      </svg>
      <figcaption>
        USD TWR growth index · 100 at the first close · dates spaced by calendar time.
        Only completed, fully valued snapshot dates are shown.
      </figcaption>
    </figure>
  );
}
