import Anthropic from "@anthropic-ai/sdk";

// If ANTHROPIC_API_KEY is an organization-level key (not scoped to a single
// workspace), Anthropic requires an anthropic-workspace-id header on every
// request. Set ANTHROPIC_WORKSPACE_ID in Vercel's env vars if you hit:
// "This API key is not scoped to a workspace..." (seen in production logs
// 2026-09-04 — this env var was not set, and the key in use needs it).
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  ...(process.env.ANTHROPIC_WORKSPACE_ID
    ? { defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } }
    : {}),
});

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 4096;
// Measured real latency (2026-09-04): 12 weeks/4 sessions ~14-16s, 24 weeks/6
// sessions ~35s. Vercel Functions default to a 300s limit with Fluid Compute
// (all plans, including Hobby) — NOT the old 10s Hobby limit. 40s per attempt
// leaves real margin over the worst measured case, comfortably within the
// platform default even with the one retry below.
// NOTE: vercel.json cannot set an explicit maxDuration here — its legacy
// `builds`-based config (needed for the static file routing) is mutually
// exclusive with the `functions` property Vercel uses for that. This relies
// on the platform default (300s) rather than a pinned per-function value;
// revisit if this project ever migrates off the `builds` config.
const CLAUDE_TIMEOUT_MS = 40000;

// Best-effort in-memory rate limiting (resets per cold start), same pattern as api/scan.js
const rateLimitMap = new Map();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// The app stores sport as ASCII keys (cykling/lob/svomning) — they double as
// object keys and DOM data attributes, and api/scan.js already speaks them.
// The prompt and the returned plan use the real Danish words. Normalize at the
// boundary so both spellings are accepted and one canonical form goes onward.
const SPORT_ALIASES = {
  cykling: "cykling",
  lob: "løb",
  løb: "løb",
  svomning: "svømning",
  svømning: "svømning",
};
const VALID_FITNESS_LEVELS = ["Begynder", "Motionist", "Erfaren", "Konkurrerende"];
const VALID_PHASES = ["BASE", "BUILD", "PEAK", "TAPER", "RACE WEEK"];
const MAX_WEEKS = 24;
const DEFAULT_WEEKS = 12;
const GOAL_EVENT_MAX_CHARS = 200;
const MAX_TARGET_KM = 5000;
const MIN_SESSIONS_PER_WEEK = 1;
const MAX_SESSIONS_PER_WEEK = 7;
const FITNESS_SESSIONS = { Begynder: 3, Motionist: 4, Erfaren: 5, Konkurrerende: 6 };
// The longest session peaks at ~80% of the target distance — the same heuristic
// the local generatePlan() fallback uses, so an AI plan and a fallback plan for
// the same input build toward the same place.
const PEAK_FRACTION = 0.8;
// The app has a DA/EN toggle, so the plan text has to follow it. Absent =
// Danish, which is what every caller before this sent.
const VALID_LANGUAGES = ["da", "en"];
const DEFAULT_LANGUAGE = "da";
// The JSON "sport" field stays the canonical Danish key in both languages — it
// is an identifier the model echoes back and validatePlan checks, not display
// text. Only the wording in the brief changes.
const SPORT_WORDS = {
  da: { cykling: "cykling", "løb": "løb", "svømning": "svømning" },
  en: { cykling: "cycling", "løb": "running", "svømning": "swimming" },
};

// Deterministic phase allocation — validated by prompt-validation gate (2026-09-04).
// The original approach (embedding this table as prose and asking Claude to compute
// week counts itself) passed only 4/15 samples. Computing it in code and telling
// Claude which phase each week already is passed 14/15 on the first try.
const BASE_TABLE = {
  1: ["TAPER"],
  2: ["BUILD", "TAPER"],
  3: ["BUILD", "BUILD", "TAPER"],
  4: ["BASE", "BUILD", "BUILD", "TAPER"],
  5: ["BASE", "BUILD", "BUILD", "BUILD", "TAPER"],
  6: ["BASE", "BASE", "BUILD", "BUILD", "BUILD", "TAPER"],
  7: ["BASE", "BASE", "BUILD", "BUILD", "BUILD", "PEAK", "TAPER"],
  8: ["BASE", "BASE", "BUILD", "BUILD", "BUILD", "PEAK", "PEAK", "TAPER"],
  9: ["BASE", "BASE", "BASE", "BUILD", "BUILD", "BUILD", "PEAK", "PEAK", "TAPER"],
  10: ["BASE", "BASE", "BASE", "BUILD", "BUILD", "BUILD", "BUILD", "PEAK", "PEAK", "TAPER"],
  11: ["BASE", "BASE", "BASE", "BUILD", "BUILD", "BUILD", "BUILD", "PEAK", "PEAK", "TAPER", "RACE WEEK"],
  12: ["BASE", "BASE", "BASE", "BASE", "BUILD", "BUILD", "BUILD", "BUILD", "PEAK", "PEAK", "PEAK", "TAPER"],
  13: ["BASE", "BASE", "BASE", "BASE", "BUILD", "BUILD", "BUILD", "BUILD", "BUILD", "PEAK", "PEAK", "TAPER", "RACE WEEK"],
  14: ["BASE", "BASE", "BASE", "BASE", "BUILD", "BUILD", "BUILD", "BUILD", "BUILD", "PEAK", "PEAK", "PEAK", "TAPER", "RACE WEEK"],
  15: ["BASE", "BASE", "BASE", "BASE", "BASE", "BUILD", "BUILD", "BUILD", "BUILD", "BUILD", "PEAK", "PEAK", "PEAK", "TAPER", "RACE WEEK"],
  16: ["BASE", "BASE", "BASE", "BASE", "BUILD", "BUILD", "BUILD", "BUILD", "BUILD", "PEAK", "PEAK", "PEAK", "TAPER", "RACE WEEK", "RACE WEEK", "RACE WEEK"],
};

function allocatePhases(weeksToRace) {
  const w = Math.max(1, Math.min(MAX_WEEKS, weeksToRace));
  if (w <= 16) return BASE_TABLE[w];
  // 17+: extend BASE by 1 per extra week beyond 16. The source spec caps BASE at
  // 8 total but is silent on what happens past that cap (weeks 21-24) — see
  // TODOS.md ("prompt-validering 2026-09-04"). This keeps extending BASE rather
  // than silently dropping weeks; revisit with real coaching input before relying
  // on plans this long.
  const extra = w - 16;
  const base16 = BASE_TABLE[16];
  const baseCount = base16.filter((p) => p === "BASE").length; // 4
  const rest = base16.filter((p) => p !== "BASE");
  return [...Array(baseCount + extra).fill("BASE"), ...rest];
}

const SYSTEM = {
  da: `Du er en erfaren cykeltræner og triatloncoach med 15 års erfaring. Du genererer strukturerede træningsplaner på dansk.

Du SKAL returnere valid JSON og intet andet. Ingen markdown-kodeblokke. Ingen forklaringstekst. Kun JSON.`,
  en: `You are an experienced cycling and triathlon coach with 15 years of experience. You generate structured training plans in English.

You MUST return valid JSON and nothing else. No markdown code blocks. No explanatory text. Only JSON.`,
};

function buildUserMessage(
  { sport, fitness_level, longest_session_km, target_km, sessions_per_week, goal_event, language },
  phases
) {
  const lang = language === "en" ? "en" : "da";
  const sessionsPerWeek = sessions_per_week ?? FITNESS_SESSIONS[fitness_level];
  const sportWord = SPORT_WORDS[lang][sport];
  // Every number the model needs is computed here rather than described to it.
  // The prompt-validation gate (2026-09-04) showed Haiku is unreliable at
  // arithmetic embedded in prose — the same reason phases are precomputed.
  const peakKm = target_km ? Math.round(target_km * PEAK_FRACTION) : null;

  if (lang === "en") {
    const weeksList = phases.map((p, i) => `Week ${i + 1}: phase ${p}`).join("\n");
    const targetLine = target_km ? `\n- Target distance: ${target_km} km` : "";
    // Plans shorter than 7 weeks have no PEAK phase at all (see BASE_TABLE), so
    // this anchors on "the plan's longest session" rather than a named phase.
    const kmInstruction = target_km
      ? `Km per session: start from ${longest_session_km} km as the longest session in week 1 and build up gradually. The plan's longest session should be around ${peakKm} km, and the target distance of ${target_km} km is completed in the final week.`
      : `Km per session: start from ${longest_session_km} km and build up gradually through the plan.`;
    return `Generate a training plan with these details:
- Sport: ${sportWord}
- Fitness level: ${fitness_level} (Begynder=beginner/Motionist=intermediate/Erfaren=experienced/Konkurrerende=competitive)
- Longest session in the last 4 weeks: ${longest_session_km} km${targetLine}
- Goal: ${goal_event}

The phases are already fixed for each of the ${phases.length} weeks — use EXACTLY this order, do not change it:
${weeksList}

For each week, generate ${sessionsPerWeek} sessions as ["Session name", km_number, "coach_note"].
${kmInstruction}
Coach note: explain WHY (not what), max 15 words.

Return EXACTLY this JSON structure and nothing else, with exactly ${phases.length} weeks in the "weeks" array, in the same order as the list above. Keep the "sport" value exactly as written here:
{
  "label": "Short plan title in English",
  "sport": "${sport}",
  "weeks": [
    { "phase": "<the phase for week 1 from the list above>", "items": [["Session name", km_number, "coach_note"]] }
  ]
}`;
  }

  const weeksList = phases.map((p, i) => `Uge ${i + 1}: fase ${p}`).join("\n");
  const targetLine = target_km ? `\n- Måldistance: ${target_km} km` : "";
  const kmInstruction = target_km
    ? `Km pr. session: start fra ${longest_session_km} km som længste session i uge 1 og byg gradvist op. Planens længste session skal ligge omkring ${peakKm} km, og selve måldistancen på ${target_km} km gennemføres i den sidste uge.`
    : `Km pr. session: start fra ${longest_session_km} km og byg gradvist op gennem planen.`;
  return `Generer en træningsplan med disse oplysninger:
- Sport: ${sportWord}
- Fitnessniveau: ${fitness_level} (Begynder/Motionist/Erfaren/Konkurrerende)
- Længste træning de seneste 4 uger: ${longest_session_km} km${targetLine}
- Mål: ${goal_event}

Faserne er allerede fastlagt for hver af de ${phases.length} uger — brug PRÆCIS denne rækkefølge, ændr den ikke:
${weeksList}

For hver uge, generer ${sessionsPerWeek} sessioner som ["Sessionsnavn", km_tal, "coach_note"].
${kmInstruction}
Coach-note: forklar HVORFOR (ikke hvad), max 15 ord.

Returnér PRÆCIS denne JSON-struktur og intet andet, med nøjagtig ${phases.length} uger i "weeks"-arrayet, i samme rækkefølge som listen ovenfor. Behold "sport"-værdien præcis som skrevet her:
{
  "label": "Kort plantitel på dansk",
  "sport": "${sport}",
  "weeks": [
    { "phase": "<fasen for uge 1 fra listen ovenfor>", "items": [["Sessionsnavn", km_tal, "coach_note"]] }
  ]
}`;
}

function extractJson(raw) {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function validatePlan(plan, sport, phases) {
  if (typeof plan?.label !== "string" || !plan.label.trim()) return false;
  if (plan.sport !== sport) return false;
  if (!Array.isArray(plan.weeks) || plan.weeks.length !== phases.length) return false;
  return plan.weeks.every((w, i) => {
    if (w.phase !== phases[i] || !VALID_PHASES.includes(w.phase)) return false;
    if (!Array.isArray(w.items) || w.items.length === 0) return false;
    return w.items.every(
      (item) =>
        Array.isArray(item) &&
        item.length === 3 &&
        typeof item[0] === "string" &&
        item[0].trim() &&
        typeof item[1] === "number" &&
        item[1] >= 0 &&
        typeof item[2] === "string" &&
        item[2].trim()
    );
  });
}

async function generateOnce(input, phases) {
  const message = await client.messages.create(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM[input.language],
      messages: [{ role: "user", content: buildUserMessage(input, phases) }],
    },
    { timeout: CLAUDE_TIMEOUT_MS }
  );
  const raw = message.content[0]?.text ?? "";
  const plan = extractJson(raw);
  if (!plan || !validatePlan(plan, input.sport, phases)) return null;
  return plan;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Rate limit by IP
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
    sport: rawSport,
    fitness_level,
    longest_session_km,
    target_km,
    sessions_per_week,
    language,
    race_date,
    plan_weeks,
    goal_event,
  } = req.body || {};

  const sport = SPORT_ALIASES[rawSport];
  if (!sport) {
    return res.status(400).json({ error: "invalid_sport" });
  }
  if (!VALID_FITNESS_LEVELS.includes(fitness_level)) {
    return res.status(400).json({ error: "invalid_fitness_level" });
  }

  // Both optional: callers that predate this contract still work, and the prompt
  // falls back to its original wording when they are absent.
  let targetKm = null;
  if (target_km !== undefined && target_km !== null && target_km !== "") {
    targetKm = Number(target_km);
    if (!Number.isFinite(targetKm) || targetKm <= 0 || targetKm > MAX_TARGET_KM) {
      return res.status(400).json({ error: "invalid_target_km" });
    }
  }

  const planLanguage = VALID_LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE;

  let sessionsPerWeek = null;
  if (sessions_per_week !== undefined && sessions_per_week !== null && sessions_per_week !== "") {
    sessionsPerWeek = Number(sessions_per_week);
    if (
      !Number.isInteger(sessionsPerWeek) ||
      sessionsPerWeek < MIN_SESSIONS_PER_WEEK ||
      sessionsPerWeek > MAX_SESSIONS_PER_WEEK
    ) {
      return res.status(400).json({ error: "invalid_sessions_per_week" });
    }
  }

  let weeksToRace;
  if (race_date) {
    const raceDate = new Date(race_date);
    if (isNaN(raceDate.getTime())) {
      return res.status(400).json({ error: "invalid_race_date", message: "Ugyldig løbsdato." });
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (raceDate < today) {
      return res.status(400).json({ error: "invalid_race_date", message: "Løbsdatoen er i fortiden." });
    }
    weeksToRace = Math.ceil((raceDate - today) / (7 * 24 * 60 * 60 * 1000));
    if (weeksToRace < 1) {
      return res.status(400).json({ error: "invalid_race_date" });
    }
  } else {
    weeksToRace = parseInt(plan_weeks, 10) || DEFAULT_WEEKS;
    if (weeksToRace < 1) {
      return res.status(400).json({ error: "invalid_race_date" });
    }
  }

  const capped = weeksToRace > MAX_WEEKS;
  if (capped) weeksToRace = MAX_WEEKS;

  const input = {
    sport,
    fitness_level,
    longest_session_km: Number(longest_session_km) >= 0 ? Number(longest_session_km) : 0,
    target_km: targetKm,
    sessions_per_week: sessionsPerWeek,
    language: planLanguage,
    goal_event: typeof goal_event === "string" ? goal_event.slice(0, GOAL_EVENT_MAX_CHARS) : "",
  };
  const phases = allocatePhases(weeksToRace);

  try {
    let plan = await generateOnce(input, phases);
    if (!plan) plan = await generateOnce(input, phases); // one retry, per validated strategy
    if (!plan) return res.status(500).json({ error: "generation_failed" });

    if (capped) plan.capped = true;
    return res.status(200).json(plan);
  } catch (e) {
    console.error("generate error:", e);
    return res.status(500).json({ error: "generation_failed" });
  }
}
