import { arcPath, donutSegments } from "../../lib/statsModel";

// A donut built from SVG arcs (no chart library). Segments come straight from
// statsModel.donutSegments so the geometry is unit-tested; this component only
// maps them to <path>s and draws the legend outside.
//
// segments: [{ label, value, color }].

const SIZE = 180;

export default function DonutChart({ segments = [], ariaLabel = "Donut chart", centerLabel, centerValue }) {
  const values = segments.map((s) => Number(s.value) || 0);
  const slices = donutSegments(values);
  const total = values.reduce((sum, v) => sum + v, 0);

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-[150px] w-[150px] shrink-0"
        role="img"
        aria-label={ariaLabel}
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={(SIZE - 36) / 2}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="24"
        />
        {slices.map((slice, i) => {
          if (!slice) return null;
          const segment = segments[i];
          const r = (SIZE - 36) / 2;
          const inner = r - 24;
          return (
            <path
              key={segment.label ?? i}
              d={arcPath(SIZE / 2, SIZE / 2, r, inner, slice.start, slice.end)}
              fill={segment.color}
            >
              <title>{`${segment.label}: ${segment.value}`}</title>
            </path>
          );
        })}
        {(centerValue != null || centerLabel) && total > 0 && (
          <g>
            <text
              x={SIZE / 2}
              y={SIZE / 2 - 2}
              textAnchor="middle"
              fontSize="24"
              fontWeight="800"
              fill="#fff"
            >
              {centerValue ?? total}
            </text>
            {centerLabel && (
              <text x={SIZE / 2} y={SIZE / 2 + 16} textAnchor="middle" fontSize="11" fill="rgba(255,255,255,0.5)">
                {centerLabel}
              </text>
            )}
          </g>
        )}
      </svg>

      <ul className="grid w-full grid-cols-2 gap-x-4 gap-y-2 sm:flex-1">
        {segments.map((segment) => {
          const value = Number(segment.value) || 0;
          const pct = total > 0 ? Math.round((value / total) * 100) : 0;
          return (
            <li key={segment.label} className="flex items-center gap-2 text-sm">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />
              <span className="text-ink/60">{segment.label}</span>
              <span className="ml-auto font-semibold text-ink">{value}</span>
              <span className="w-8 text-right text-xs text-ink/35">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
