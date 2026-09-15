export default function EmptyState({ icon, title, description, children }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-ink/15 bg-white/40 px-6 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-3xl">
        {icon}
      </div>
      <h2 className="font-display text-2xl font-semibold text-ink">{title}</h2>
      {description && (
        <p className="mt-2 max-w-md text-sm text-ink/55">{description}</p>
      )}
      {children && <div className="mt-6">{children}</div>}
    </div>
  );
}