import { niceCeil, scaleLinear } from "../../lib/statsModel";

// A compact SVG bar chart with a light grid and value axis. Pure presentation:
// layout maths comes from statsModel so it can be unit-tested.
//
// data: [{ label, value }]. `max` overrides the auto ceiling (useful to keep a
// goal line fixed). The SVG scales with its container, so the panel decides the
// width.

const W = 720;

export default function BarChart({
  data = [],
  height = 170,
  color = "var(--color-lavender)",
  labelEvery = 5,
  max: maxProp,
  formatValue = (v) => v,
  ariaLabel = "Bar chart",
}) {
  const H = height;
  const pad = { top: 10, right: 6, bottom: 22, left: 30 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const values = data.map((d) => Number(d.value) || 0);
  const max = maxProp != null ? maxProp : niceCeil(Math.max(1, ...values));
  const y = scaleLinear([0, max], [pad.top + plotH, pad.top]);
  const step = data.length > 0 ? plotW / data.length : plotW;
  const barW = Math.max(2, Math.min(step * 0.7, 34));

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
            <line
              x1={pad.left}
              x2={W - pad.right}
              y1={gy}
              y2={gy}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1"
            />
            <text x={pad.left - 6} y={gy + 3} textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.4)">
              {formatValue(Math.round(max * t))}
            </text>
          </g>
        );
      })}

      {data.map((d, i) => {
        const value = Number(d.value) || 0;
        const bx = pad.left + i * step + (step - barW) / 2;
        const by = y(value);
        const bh = Math.max(value > 0 ? 1.5 : 0, pad.top + plotH - by);
        return (
          <g key={d.label ?? i}>
            <title>{`${d.label}: ${formatValue(value)}`}</title>
            <rect x={bx} y={by} width={barW} height={bh} rx="2" fill={color} />
            {i % labelEvery === 0 && (
              <text
                x={pad.left + i * step + step / 2}
                y={H - 6}
                textAnchor="middle"
                fontSize="10"
                fill="rgba(255,255,255,0.4)"
              >
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
