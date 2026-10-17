import { linePath, niceCeil, scaleLinear } from "../../lib/statsModel";

// A compact SVG line chart. Days with no reading are null and break the line, so
// a gap shows a gap rather than a dip to zero. Layout maths is in statsModel.
//
// data: [{ label, value }] where value is a number or null.

const W = 720;

export default function LineChart({
  data = [],
  height = 170,
  color = "var(--color-sage)",
  labelEvery = 5,
  formatValue = (v) => v,
  ariaLabel = "Line chart",
}) {
  const H = height;
  const pad = { top: 10, right: 10, bottom: 22, left: 38 };
  const plotH = H - pad.top - pad.bottom;

  const present = data.map((d) => Number(d.value)).filter((v) => Number.isFinite(v));
  const max = niceCeil(Math.max(1, ...present));
  const y = scaleLinear([0, max], [pad.top + plotH, pad.top]);
  const x = scaleLinear([0, Math.max(1, data.length - 1)], [pad.left, W - pad.right]);

  const points = data.map((d, i) => ({
    x: x(i),
    y: Number.isFinite(Number(d.value)) && d.value != null ? y(Number(d.value)) : null,
  }));
  const path = linePath(points);

  const gridLines = [0, 0.5, 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="xMidYMid meet"
    >
      {gridLines.map((t) => {
        const gy = y(max * t);
        return (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={gy} y2={gy} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
            <text x={pad.left - 6} y={gy + 3} textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.4)">
              {formatValue(Math.round(max * t))}
            </text>
          </g>
        );
      })}

      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

      {data.map((d, i) =>
        Number.isFinite(Number(d.value)) && d.value != null ? (
          <circle key={d.label ?? i} cx={x(i)} cy={y(Number(d.value))} r="2.4" fill={color}>
            <title>{`${d.label}: ${formatValue(d.value)}`}</title>
          </circle>
        ) : null
      )}

      {data.map((d, i) =>
        i % labelEvery === 0 ? (
          <text
            key={`l-${d.label ?? i}`}
            x={x(i)}
            y={H - 6}
            textAnchor="middle"
            fontSize="10"
            fill="rgba(255,255,255,0.4)"
          >
            {d.label}
          </text>
        ) : null
      )}
    </svg>
  );
}
