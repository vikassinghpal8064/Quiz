export default function StarIcon({ starred, onToggle, className = "", size = 22 }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={starred ? "Unstar this question" : "Star this question for review"}
      aria-label={starred ? "Unstar question" : "Star question for review"}
      aria-pressed={starred}
      className={`inline-flex shrink-0 items-center justify-center rounded-full p-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
        starred ? "text-amber-500 hover:text-amber-600" : "text-ink/30 hover:text-amber-500"
      } ${className}`}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={starred ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.12 2.12 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.12 2.12 0 0 0 1.597-1.16z" />
      </svg>
    </button>
  );
}