// Flag button that sits next to the star. Filled when the caller has an
// active flag on the question; clicking it opens the flag / withdraw modal.
export default function FlagIcon({ flagged, onToggle, className = "", size = 22 }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={flagged ? "You flagged this question" : "Flag this question"}
      aria-label={flagged ? "You flagged this question" : "Flag this question"}
      aria-pressed={flagged}
      className={`inline-flex shrink-0 items-center justify-center rounded-full p-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${
        flagged ? "text-red-500 hover:text-red-600" : "text-ink/30 hover:text-red-500"
      } ${className}`}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={flagged ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <line x1="4" x2="4" y1="22" y2="15" />
      </svg>
    </button>
  );
}
