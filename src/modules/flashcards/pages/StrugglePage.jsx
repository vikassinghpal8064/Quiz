import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import EmptyState from "../../../components/EmptyState";
import { getStruggleList } from "../lib/api";
import { sideText, formatDuration, isStruggling } from "../lib/format";
import FlashBreadcrumbs from "../components/FlashBreadcrumbs";
import { ListSkeleton, ErrorState } from "../components/FlashStates";

// /flash/category/:categoryId/struggle - the category's hardest cards.
//
// Ordered by struggle score (the scheduler's 0-1 "this card is fighting me"
// signal) with the average think time for each. A nested category's children
// are included, matching what a study session would cover.
function ScoreBar({ score }) {
  const pct = Math.round(Math.max(0, Math.min(1, score ?? 0)) * 100);
  return (
    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-stone-200" aria-hidden="true">
      <div
        className={`h-full rounded-full ${isStruggling(score) ? "bg-pink" : "bg-amber-400"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function StrugglePage() {
  const { categoryId } = useParams();

  const [category, setCategory] = useState(null);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    getStruggleList(categoryId)
      .then((data) => {
        if (cancelled) return;
        setCategory(data.category);
        setCards(data.cards ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        if (/not found/i.test(err.message)) setNotFound(true);
        else setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  const crumbs = [{ label: "Flash Cards", to: "/flash" }];
  if (category?.folder_id) {
    crumbs.push({ label: "Folder", to: `/flash/folder/${category.folder_id}` });
  }
  if (category) crumbs.push({ label: category.name, to: `/flash/category/${categoryId}` });
  crumbs.push({ label: "Struggle list" });

  if (notFound) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <FlashBreadcrumbs items={[{ label: "Flash Cards", to: "/flash" }]} />
        <EmptyState
          icon="🔍"
          title="Category not found"
          description="This category may have been deleted."
        >
          <Link
            to="/flash"
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            Back to Flash Cards
          </Link>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <FlashBreadcrumbs items={crumbs} />

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            Struggle list
          </h1>
          <p className="mt-1 text-sm text-ink/55">
            {category?.name ? `${category.name} · ` : ""}
            your hardest cards, hardest first, with the average time they take.
          </p>
        </div>
        <Link
          to={`/flash/category/${categoryId}`}
          className="shrink-0 rounded-xl border border-ink/15 bg-white px-4 py-2 text-sm font-semibold text-ink/75 transition hover:bg-stone-100"
        >
          Back to category
        </Link>
      </div>

      {error && (
        <div className="mb-6">
          <ErrorState message={error} />
        </div>
      )}

      {loading ? (
        <ListSkeleton rows={5} />
      ) : cards.length === 0 ? (
        <EmptyState
          icon="🌱"
          title="No cards to work on"
          description="None of this category's cards are struggling right now. Nice work."
        >
          <Link
            to={`/flash/category/${categoryId}`}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            Back to category
          </Link>
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {cards.map((card) => {
            const front = sideText(card.front);
            const back = sideText(card.back);
            const tags = card.tags ?? [];
            const score = typeof card.struggle_score === "number" ? card.struggle_score : 0;
            return (
              <li
                key={card.id}
                className="rounded-2xl border border-ink/10 bg-white p-4 shadow-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium leading-relaxed text-ink">
                      {front || <span className="text-ink/40">Untitled card</span>}
                    </p>
                    {back && (
                      <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-ink/55">
                        {back}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800"
                        >
                          #{tag}
                        </span>
                      ))}
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-ink/55">
                        {card.lapses ?? 0} {card.lapses === 1 ? "lapse" : "lapses"}
                      </span>
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-ink/55">
                        avg {formatDuration(card.avg_think_ms)}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span
                      className={`text-xs font-semibold ${
                        isStruggling(score) ? "text-pink" : "text-ink/50"
                      }`}
                    >
                      {score.toFixed(2)}
                    </span>
                    <ScoreBar score={score} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
