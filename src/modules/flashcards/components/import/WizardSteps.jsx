// The step indicator across the top of /flash/import.
//
// Pure presentation: it takes the step list and the current step id and renders
// a horizontal pill per step - done (with a tick), current, or still ahead. The
// current step is also marked aria-current="step" so the wizard's position is
// announced to screen readers rather than only shown by colour.
export default function WizardSteps({ steps, current }) {
  return (
    <ol className="flex flex-wrap gap-2">
      {steps.map((step) => {
        const done = step.id < current;
        const active = step.id === current;

        return (
          <li
            key={step.id}
            aria-current={active ? "step" : undefined}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              active
                ? "bg-lavender text-on-accent shadow-sm"
                : done
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-stone-100 text-ink/40"
            }`}
          >
            <span
              className={`grid h-4 w-4 place-items-center rounded-full text-[10px] ${
                active
                  ? "bg-on-accent text-lavender"
                  : done
                    ? "bg-emerald-500 text-white"
                    : "bg-white text-ink/40"
              }`}
            >
              {done ? "\u2713" : step.id}
            </span>
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}
