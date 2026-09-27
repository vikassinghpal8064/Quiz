import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const overlay = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const panel = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.95, y: 10 },
};

const fieldClass =
  "mt-1 block w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

const labelClass = "block text-sm font-medium text-ink/70";

const DEFAULT_MINUTES = 30;

/**
 * Asked right before a quiz attempt starts. onStart receives the chosen
 * duration in seconds, or null when the user opts out of a timer.
 */
export default function QuizTimerModal({ open, onClose, onStart }) {
  const [picking, setPicking] = useState(false);
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState(String(DEFAULT_MINUTES));
  const [seconds, setSeconds] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setPicking(false);
      setHours("");
      setMinutes(String(DEFAULT_MINUTES));
      setSeconds("");
      setError(null);
    }
  }, [open]);

  function handleStartTimed() {
    const h = hours === "" ? 0 : Number(hours);
    const m = minutes === "" ? 0 : Number(minutes);
    const s = seconds === "" ? 0 : Number(seconds);

    if (![h, m, s].every((n) => Number.isInteger(n)) || h < 0 || m < 0 || s < 0) {
      setError("Enter whole numbers for hours, minutes and seconds.");
      return;
    }
    if (m > 59 || s > 59) {
      setError("Minutes and seconds must be 0-59. Use hours for longer quizzes.");
      return;
    }

    const total = h * 3600 + m * 60 + s;
    if (total <= 0) {
      setError("Set a duration greater than zero to use a timer.");
      return;
    }

    onStart(total);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          variants={overlay}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <div
            className="absolute inset-0 bg-ink/50 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            className="relative w-full max-w-md rounded-2xl border border-ink/10 bg-white p-6 shadow-card-hover"
            variants={panel}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <h2 className="text-xl font-semibold text-ink">
              Do you want to set a timer for this quiz?
            </h2>

            {!picking ? (
              <>
                <p className="mt-2 text-sm leading-relaxed text-ink/60">
                  Take as long as you need, or give yourself a countdown. A timed
                  quiz submits itself the moment the clock runs out.
                </p>

                <div className="mt-6 flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-ink/60 transition-colors hover:bg-stone-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => onStart(null)}
                    className="rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-semibold text-ink/80 shadow-sm transition-colors hover:bg-stone-100"
                  >
                    No Timer
                  </button>
                  <button
                    type="button"
                    onClick={() => setPicking(true)}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                  >
                    Set Timer
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="timer-hours" className={labelClass}>
                      Hours
                    </label>
                    <input
                      id="timer-hours"
                      type="number"
                      min="0"
                      max="23"
                      step="1"
                      inputMode="numeric"
                      value={hours}
                      onChange={(e) => {
                        setHours(e.target.value);
                        setError(null);
                      }}
                      className={fieldClass}
                      placeholder="0"
                    />
                  </div>

                  <div>
                    <label htmlFor="timer-minutes" className={labelClass}>
                      Minutes
                    </label>
                    <input
                      id="timer-minutes"
                      type="number"
                      min="0"
                      max="59"
                      step="1"
                      inputMode="numeric"
                      value={minutes}
                      onChange={(e) => {
                        setMinutes(e.target.value);
                        setError(null);
                      }}
                      className={fieldClass}
                      placeholder="0"
                    />
                  </div>

                  <div>
                    <label htmlFor="timer-seconds" className={labelClass}>
                      Seconds
                    </label>
                    <input
                      id="timer-seconds"
                      type="number"
                      min="0"
                      max="59"
                      step="1"
                      inputMode="numeric"
                      value={seconds}
                      onChange={(e) => {
                        setSeconds(e.target.value);
                        setError(null);
                      }}
                      className={fieldClass}
                      placeholder="0"
                    />
                  </div>
                </div>

                {error && (
                  <p className="mt-3 text-sm font-medium text-red-600">{error}</p>
                )}

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setPicking(false);
                      setError(null);
                    }}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-ink/60 transition-colors hover:bg-stone-100"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleStartTimed}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                  >
                    Start Quiz
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
