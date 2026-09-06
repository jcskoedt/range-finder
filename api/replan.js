import Anthropic from "@anthropic-ai/sdk";
import {
  MODEL, MAX_TOKENS, MAX_TOTAL_SESSIONS, CLAUDE_TIMEOUT_MS, GOAL_EVENT_MAX_CHARS,
  SPORT_ALIASES, SYSTEM, VALID_FITNESS_LEVELS, VALID_PHASES,
  VALID_LANGUAGES, DEFAULT_LANGUAGE, extractJson,
} from "./generate.js";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  ...(process.env.ANTHROPIC_WORKSPACE_ID
    ? { defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } }
    : {}),
});

// Same pattern as the other two endpoints: in-memory, resets per cold start.
const rateLimitMap = new Map();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

// Past this many skipped weeks the athlete needs an easier way back in rather
// than picking up where the plan left off.
const EASE_IN_THRESHOLD = 2;
const MAX_REMAINING_WEEKS = 24;

function badWeeks(weeks) {
  if (!Array.isArray(weeks) || weeks.length === 0) return "remaining_weeks is empty";
  if (weeks.length > MAX_REMAINING_WEEKS) return `remaining_weeks has ${weeks.length} weeks, max ${MAX_REMAINING_WEEKS}`;
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    if (!w || !VALID_PHASES.includes(w.phase)) return `week ${i + 1}: phase "${w && w.phase}" is not a known phase`;
    if (!Array.isArray(w.items) || w.items.length === 0) return `week ${i + 1}: no sessions`;
    for (let k = 0; k < w.items.length; k++) {
      const it = w.items[k];
      if (!Array.isArray(it) || it.length < 2) return `week ${i + 1} session ${k + 1}: not a [name, km, note] tuple`;
      if (typeof it[0] !== "string" || !it[0].trim()) return `week ${i + 1} session ${k + 1}: empty name`;
      if (typeof it[1] !== "number" || !Number.isFinite(it[1]) || it[1] < 0) return `week ${i + 1} session ${k + 1}: km is ${JSON.stringify(it[1])}`;
    }
  }
  return null;
}

// Deliberately narrower than the CEO spec, which let the model relabel phases
// and append a week. Both are structural decisions, and B1's prompt validation
// showed structure belongs in code: the phase sequence stays exactly as given,
// and the plan keeps its length so a fixed race date does not silently move.
// The model only rewrites session content.
function buildUserMessage({ sport, fitness_level, target_km, goal_event, language }, weeks, skippedCount, easeIn) {
  const lang = language === "en" ? "en" : "da";
  // Session counts are per week, not per plan: a race week legitimately has
  // fewer sessions than a build week. Handing the model each week's own count
  // is the same rule as the phases - structure in code, content from the model.
  const phaseList = weeks
    .map((w, i) => {
      const n = w.items.length;
      const noun = lang === "en" ? (n === 1 ? "session" : "sessions") : (n === 1 ? "session" : "sessioner");
      return `${lang === "en" ? "Week" : "Uge"} ${i + 1}: ${w.phase} - ${n} ${noun}`;
    })
    .join("\n");
  const current = JSON.stringify(weeks.map((w) => ({ phase: w.phase, items: w.items })));

  if (lang === "en") {
    return `An athlete skipped ${skippedCount} week${skippedCount === 1 ? "" : "s"} of their training plan and is picking it up again.

- Sport: ${sport}
- Fitness level: ${fitness_level}
${target_km ? `- Target distance: ${target_km} km\n` : ""}- Goal: ${goal_event}

These are the ${weeks.length} weeks that remain. Keep EXACTLY this many weeks, EXACTLY these phases and EXACTLY the session count listed for each week — do not add, remove or relabel any:
${phaseList}

The plan as it stands:
${current}

Rewrite the sessions so the plan still works after the break:
- Scale the km down where the athlete has lost fitness, and build back up across the remaining weeks.
- Give each week exactly the number of sessions listed for it above.
${easeIn ? "- Week 1 is a deliberate return week: clearly lighter than the plan called for, to ease back in without injury.\n" : ""}- The final week still ends with the goal.
- Coach note: explain WHY this session changed, max 15 words.

Return EXACTLY this JSON and nothing else, with exactly ${weeks.length} weeks in the same order:
{
  "weeks": [
    { "phase": "<the phase for week 1 from the list above>", "items": [["Session name", km_number, "coach_note"]] }
  ]
}`;
  }

  return `En atlet har sprunget ${skippedCount} uge${skippedCount === 1 ? "" : "r"} over i sin træningsplan og tager fat igen.

- Sport: ${sport}
- Fitnessniveau: ${fitness_level}
${target_km ? `- Måldistance: ${target_km} km\n` : ""}- Mål: ${goal_event}

Her er de ${weeks.length} uger der er tilbage. Behold PRÆCIS dette antal uger, PRÆCIS disse faser og PRÆCIS det antal sessioner der står ved hver uge — tilføj, fjern eller omdøb ingen:
${phaseList}

Planen som den ser ud nu:
${current}

Skriv sessionerne om, så planen stadig hænger sammen efter pausen:
- Skru km ned hvor atleten har mistet form, og byg op igen hen over de resterende uger.
- Giv hver uge præcis det antal sessioner der står ved den ovenfor.
${easeIn ? "- Uge 1 er en bevidst tilbagevenden: tydeligt lettere end planen lagde op til, så atleten kommer i gang uden skader.\n" : ""}- Sidste uge slutter stadig med målet.
- Coach-note: forklar HVORFOR denne session er ændret, max 15 ord.

Returnér PRÆCIS denne JSON og intet andet, med nøjagtig ${weeks.length} uger i samme rækkefølge:
{
  "weeks": [
    { "phase": "<fasen for uge 1 fra listen ovenfor>", "items": [["Sessionsnavn", km_tal, "coach_note"]] }
  ]
}`;
}

function validateWeeks(out, phases, counts) {
  if (!Array.isArray(out?.weeks) || out.weeks.length !== phases.length) return false;
  return out.weeks.every((w, i) => {
    if (w.phase !== phases[i]) return false;
    if (!Array.isArray(w.items) || w.items.length !== counts[i]) return false;
    return w.items.every(
      (it) =>
        Array.isArray(it) && it.length === 3 &&
        typeof it[0] === "string" && it[0].trim() &&
        typeof it[1] === "number" && Number.isFinite(it[1]) && it[1] >= 0 &&
        typeof it[2] === "string" && it[2].trim()
    );
  });
}

async function replanOnce(input, weeks, skippedCount, easeIn, phases, counts) {
  const message = await client.messages.create(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM[input.language],
      messages: [{ role: "user", content: buildUserMessage(input, weeks, skippedCount, easeIn) }],
    },
    { timeout: CLAUDE_TIMEOUT_MS }
  );
  const out = extractJson(message.content[0]?.text ?? "");
  if (!out || !validateWeeks(out, phases, counts)) return null;
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + RATE_WINDOW_MS; }
  if (entry.count >= RATE_LIMIT) {
    return res.status(429).json({ error: "too_many_requests", message: "Prøv igen om lidt." });
  }
  entry.count++;
  rateLimitMap.set(ip, entry);

  const {
    sport: rawSport, fitness_level, target_km, language,
    goal_event, skipped_week_indices, remaining_weeks,
  } = req.body || {};

  const sport = SPORT_ALIASES[rawSport];
  if (!sport) return res.status(400).json({ error: "invalid_sport" });
  if (!VALID_FITNESS_LEVELS.includes(fitness_level)) return res.status(400).json({ error: "invalid_fitness_level" });

  const weeksProblem = badWeeks(remaining_weeks);
  if (weeksProblem) return res.status(400).json({ error: "invalid_remaining_weeks", message: weeksProblem });

  if (!Array.isArray(skipped_week_indices) || skipped_week_indices.some((n) => !Number.isInteger(n) || n < 0)) {
    return res.status(400).json({ error: "invalid_skipped_week_indices" });
  }
  const skippedCount = new Set(skipped_week_indices).size;
  if (skippedCount === 0) return res.status(400).json({ error: "nothing_skipped" });

  let targetKm = null;
  if (target_km !== undefined && target_km !== null && target_km !== "") {
    targetKm = Number(target_km);
    if (!Number.isFinite(targetKm) || targetKm <= 0) return res.status(400).json({ error: "invalid_target_km" });
  }

  // Each week keeps its own session count. Deriving one number and enforcing it
  // on every week rejected every plan with a shorter race week: the model
  // mirrored the 2-session week correctly, validateWeeks threw it away, twice,
  // for a 500 and two paid calls. Measured 2026-09-06 on a 6-week run plan.
  const counts = remaining_weeks.map((w) => w.items.length);

  // Same ceiling as /api/generate: past it Haiku loses count, and a replan is
  // the same shape of request as a fresh plan.
  const totalSessions = counts.reduce((a, b) => a + b, 0);
  if (totalSessions > MAX_TOTAL_SESSIONS) {
    return res.status(422).json({
      error: "plan_too_large",
      weeks: remaining_weeks.length,
      total_sessions: totalSessions,
      max_total_sessions: MAX_TOTAL_SESSIONS,
    });
  }

  const phases = remaining_weeks.map((w) => w.phase);
  const easeIn = skippedCount > EASE_IN_THRESHOLD;
  const input = {
    sport,
    fitness_level,
    target_km: targetKm,
    goal_event: typeof goal_event === "string" ? goal_event.slice(0, GOAL_EVENT_MAX_CHARS) : "",
    language: VALID_LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE,
  };

  try {
    let out = await replanOnce(input, remaining_weeks, skippedCount, easeIn, phases, counts);
    if (!out) out = await replanOnce(input, remaining_weeks, skippedCount, easeIn, phases, counts);
    if (!out) return res.status(500).json({ error: "replan_failed" });
    return res.status(200).json({ weeks: out.weeks, skipped_count: skippedCount, ease_in: easeIn });
  } catch (e) {
    console.error("replan error:", e);
    return res.status(500).json({ error: "replan_failed" });
  }
}

export { buildUserMessage, validateWeeks, badWeeks, EASE_IN_THRESHOLD };
