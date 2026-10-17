import sql from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import { flashUserId, sendMissingFlashTable } from "../../_lib/flashCards.js";
import { settingsFromRows } from "../../_lib/flashStudy.js";
import {
  HEATMAP_DAYS,
  activityDaysQuery,
  dueTodayQuery,
  newTodayQuery,
  reviewsTodayQuery,
} from "../../_lib/flashStats.js";
import { computeStreak } from "../../../src/modules/flashcards/lib/statsModel.js";

// GET /api/flash/stats/overview
//
// The small slice of the stats the flash home dashboard needs: how many reviews
// were answered today against the daily goal, the current and longest streak,
// and what is due today. Cheaper than the full /api/flash/stats payload (no
// per-day calendar, forecast or hardest table), so the home screen can load it
// alongside the folder list.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;
  const uid = flashUserId(user);

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const reviews = reviewsTodayQuery({ uid });
    const fresh = newTodayQuery({ uid });
    const due = dueTodayQuery({ uid });
    const activity = activityDaysQuery({ uid, days: HEATMAP_DAYS });

    const [reviewRows, newRows, dueRows, activityRows, settingRows] = await sql.transaction((txn) => [
      txn.query(reviews.text, reviews.params),
      txn.query(fresh.text, fresh.params),
      txn.query(due.text, due.params),
      txn.query(activity.text, activity.params),
      txn`SELECT key, value FROM fc_settings WHERE user_id = ${uid}`,
    ]);

    const settings = settingsFromRows(settingRows);
    const dailyGoal = Number(settings.daily_goal) || null;
    const reviewsToday = reviewRows?.[0]?.n ?? 0;
    const streak = computeStreak(activityRows.map((row) => row.day), new Date());

    return res.status(200).json({
      reviews_today: reviewsToday,
      new_today: newRows?.[0]?.n ?? 0,
      due_today: dueRows?.[0]?.n ?? 0,
      daily_goal: dailyGoal,
      goal_progress: dailyGoal ? Math.min(1, reviewsToday / dailyGoal) : 0,
      studied_today: reviewsToday > 0,
      current_streak: streak.current,
      longest_streak: streak.longest,
    });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("GET /api/flash/stats/overview", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
