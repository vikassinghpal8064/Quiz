// Loading / error building blocks for the flash screens. The empty state reuses
// the shared EmptyState component; these two cover the other two states.

// A column of pulse rows matching the card / category list height.
export function ListSkeleton({ rows = 5 }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-2xl bg-stone-200/70" />
      ))}
    </div>
  );
}

// Inline error banner styled like the rest of the app, with an optional retry.
export function ErrorState({ message, onRetry }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
      <p className="font-semibold">Something went wrong</p>
      <p className="mt-1">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50"
        >
          Try again
        </button>
      )}
    </div>
  );
}
