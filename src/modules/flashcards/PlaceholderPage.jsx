// Shared empty-state used by every flash-card placeholder route. It matches
// the app's page container (centred max-width, generous vertical rhythm) and
// the muted dashed empty state used elsewhere, so the placeholders look like
// part of the product rather than raw stubs.
export default function PlaceholderPage({ title, hint }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        {title}
      </h1>
      <p className="mt-2 text-sm text-ink/50">{hint ?? "Coming soon."}</p>

      <div className="mt-8 rounded-2xl border border-dashed border-ink/15 bg-white/40 p-10 text-center text-sm text-ink/55">
        This screen is a placeholder.
      </div>
    </div>
  );
}
