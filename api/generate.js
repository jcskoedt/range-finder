import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 4096;
// Measured real latency (2026-09-04): 12 weeks/4 sessions ~14-16s, 24 weeks/6
// sessions ~35s. Vercel Functions default to a 300s limit with Fluid Compute
// (all plans, including Hobby) — NOT the old 10s Hobby limit. 40s per attempt
// leaves real margin over the worst measured case; see vercel.json's
// maxDuration for the matching function-level budget (covers this timeout
// twice over, for the one retry below).
const CLAUDE_TIMEOUT_MS = 40000;

// Best-effort in-memory rate limiting (resets per cold start), same pattern as api/scan.js
const rateLimitMap = new Map();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const VALID_SPORTS = ["cykling", "løb", "svømning"];
const VALID_FITNESS_LEVELS = ["Begynder", "Motionist", "Erfaren", "Konkurrerende"];
const VALID_PHASES = ["BASE", "BUILD", "PEAK", "TAPER", "RACE WEEK"];
const MAX_WEEKS = 24;
const DEFAULT_WEEKS = 12;
const GOAL_EVENT_MAX_CHARS = 200;

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

const SYSTEM = `Du er en erfaren cykeltræner og triatloncoach med 15 års erfaring. Du genererer strukturerede træningsplaner på dansk.

Du SKAL returnere valid JSON og intet andet. Ingen markdown-kodeblokke. Ingen forklaringstekst. Kun JSON.`;

function buildUserMessage({ sport, fitness_level, longest_session_km, goal_event }, phases) {
  const weeksList = phases.map((p, i) => `Uge ${i + 1}: fase ${p}`).join("\n");
  const sessionsPerWeek = { Begynder: 3, Motionist: 4, Erfaren: 5, Konkurrerende: 6 }[fitness_level];
  return `Generer en træningsplan med disse oplysninger:
- Sport: ${sport}
- Fitnessniveau: ${fitness_level} (Begynder/Motionist/Erfaren/Konkurrerende)
- Længste træning de seneste 4 uger: ${longest_session_km} km
- Mål: ${goal_event}

Faserne er allerede fastlagt for hver af de ${phases.length} uger — brug PRÆCIS denne rækkefølge, ændr den ikke:
${weeksList}

For hver uge, generer ${sessionsPerWeek} sessioner som ["Sessionsnavn", km_tal, "coach_note"].
Km pr. session: start fra ${longest_session_km} km og byg gradvist op gennem planen.
Coach-note: forklar HVORFOR (ikke hvad), max 15 ord.

Returnér PRÆCIS denne JSON-struktur og intet andet, med nøjagtig ${phases.length} uger i "weeks"-arrayet, i samme rækkefølge som listen ovenfor:
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
      system: SYSTEM,
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

  const { sport, fitness_level, longest_session_km, race_date, plan_weeks, goal_event } = req.body || {};

  if (!VALID_SPORTS.includes(sport)) {
    return res.status(400).json({ error: "invalid_sport" });
  }
  if (!VALID_FITNESS_LEVELS.includes(fitness_level)) {
    return res.status(400).json({ error: "invalid_fitness_level" });
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
