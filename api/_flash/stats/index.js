import sql from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import {
  flashUserId,
  optionalInt,
  sendMissingFlashTable,
} from "../../_lib/flashCards.js";
import { settingsFromRows } from "../../_lib/flashStudy.js";
import {
  DEFAULT_HARDEST,
  FORECAST_DAYS,
  HEATMAP_DAYS,
  MAX_HARDEST,
  dailyReviewsQuery,
  dueForecastQuery,
  hardestCardsQuery,
  parseScope,
  retentionQuery,
  stateBreakdownQuery,
  thinkTimeTrendQuery,
} from "../../_lib/flashStats.js";
import {
  MAX_RANGE_DAYS,
  MIN_RANGE_DAYS,
  buildForecast,
  buildHeatmap,
  buildTrend,
  summarizeRetention,
  summarizeStates,
} from "../../../src/modules/flashcards/lib/statsModel.js";

// GET /api/flash/stats?folderId=&categoryId=&days=&limit=
//
// Everything the /flash/stats screen draws, in one round trip: the reviews-per-
// day calendar with its streak, the true retention of mature cards, the 30-day
// due forecast, the new/learning/review/mastered breakdown, the average think-
// time trend and the hardest-cards table.
//
// Served entirely from fc_review_logs and fc_card_state (joined to fc_cards only
// to resolve the folder / category filter), backed by db/flash_004.sql.
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

  const scope = parseScope(req.query ?? {});
  if (scope.error) return res.status(400).json({ error: scope.error });

  const days = optionalInt(req.query?.days, "days", { min: MIN_RANGE_DAYS, max: MAX_RANGE_DAYS });
  if (days.error) return res.status(400).json({ error: days.error });
  const rangeDays = days.value ?? 30;

  const limit = optionalInt(req.query?.limit, "limit", { min: 1, max: MAX_HARDEST });
  if (limit.error) return res.status(400).json({ error: limit.error });
  const hardestLimit = limit.value ?? DEFAULT_HARDEST;

  try {
    const daily = dailyReviewsQuery({ uid, scope, days: HEATMAP_DAYS });
    const retention = retentionQuery({ uid, scope, days: rangeDays });
    const forecast = dueForecastQuery({ uid, scope, days: FORECAST_DAYS });
    const states = stateBreakdownQuery({ uid, scope });
    const trend = thinkTimeTrendQuery({ uid, scope, days: rangeDays });
    const hardest = hardestCardsQuery({ uid, scope, limit: hardestLimit });

    const [dailyRows, retentionRows, forecastRows, stateRows, trendRows, hardestRows, settingRows] =
      await sql.transaction((txn) => [
        txn.query(daily.text, daily.params),
        txn.query(retention.text, retention.params),
        txn.query(forecast.text, forecast.params),
        txn.query(states.text, states.params),
        txn.query(trend.text, trend.params),
        txn.query(hardest.text, hardest.params),
        txn`SELECT key, value FROM fc_settings WHERE user_id = ${uid}`,
      ]);

    const settings = settingsFromRows(settingRows);
    const now = new Date();

    const heatmap = buildHeatmap(dailyRows, { now });
    const forecastModel = buildForecast(forecastRows, { days: FORECAST_DAYS, now });
    const trendModel = buildTrend(trendRows, { days: rangeDays, now });

    return res.status(200).json({
      generated_at: now.toISOString(),
      scope: { folderId: scope.folderId ?? null, categoryId: scope.categoryId ?? null },
      range_days: rangeDays,
      daily_goal: Number(settings.daily_goal) || null,
      heatmap,
      retention: summarizeRetention(retentionRows),
      due_forecast: forecastModel,
      states: summarizeStates(stateRows),
      think_trend: trendModel,
      hardest: hardestRows,
    });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("GET /api/flash/stats", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
