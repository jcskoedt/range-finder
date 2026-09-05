#!/usr/bin/env node
// Prompt validation gate for /api/generate.
//
// Why it exists: the original prompt embedded the phase table as prose and let
// the model count weeks itself — 4/15 samples passed. Moving phase allocation
// into deterministic code took it to 14/15. Since then the prompt gained a
// target distance and an English variant, neither of which has been measured.
//
// Talks to Anthropic directly with the same prompt-building code the endpoint
// uses, deliberately skipping the HTTP layer: the endpoint rate-limits to
// 5 req/IP/hour, and the rate limiter is not what we are validating.
//
// Usage: ANTHROPIC_API_KEY=... node scripts/validate-generate.mjs [--samples N]

import Anthropic from "@anthropic-ai/sdk";
import {
  MODEL, MAX_TOKENS, PEAK_FRACTION, FITNESS_SESSIONS,
  SYSTEM, allocatePhases, buildUserMessage, extractJson, validatePlan,
} from "../api/generate.js";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  ...(process.env.ANTHROPIC_WORKSPACE_ID
    ? { defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } }
    : {}),
});

const CONCURRENCY = 4;
const TIMEOUT_MS = 60000;

// Spread across sports, fitness levels, plan lengths and both languages,
// including the short plans that have no PEAK phase and the long ones that
// exercise allocatePhases()' extend-BASE branch.
const SAMPLES = [
  { sport: "løb",      fitness_level: "Motionist",     longest_session_km: 10, target_km: 42,  plan_weeks: 12, language: "da" },
  { sport: "løb",      fitness_level: "Begynder",      longest_session_km: 5,  target_km: 21,  plan_weeks: 8,  language: "da" },
  { sport: "løb",      fitness_level: "Konkurrerende", longest_session_km: 25, target_km: 42,  plan_weeks: 16, language: "en" },
  { sport: "løb",      fitness_level: "Erfaren",       longest_session_km: 15, target_km: 50,  plan_weeks: 4,  language: "en" },
  { sport: "cykling",  fitness_level: "Motionist",     longest_session_km: 40, target_km: 200, plan_weeks: 12, language: "da" },
  { sport: "cykling",  fitness_level: "Erfaren",       longest_session_km: 60, target_km: 300, plan_weeks: 20, language: "da" },
  { sport: "cykling",  fitness_level: "Begynder",      longest_session_km: 20, target_km: 100, plan_weeks: 10, language: "en" },
  { sport: "cykling",  fitness_level: "Konkurrerende", longest_session_km: 80, target_km: 250, plan_weeks: 24, language: "en" },
  { sport: "cykling",  fitness_level: "Motionist",     longest_session_km: 30, target_km: 150, plan_weeks: 3,  language: "da" },
  { sport: "svømning", fitness_level: "Begynder",      longest_session_km: 1,  target_km: 5,   plan_weeks: 8,  language: "da" },
  { sport: "svømning", fitness_level: "Motionist",     longest_session_km: 2,  target_km: 10,  plan_weeks: 12, language: "en" },
  { sport: "svømning", fitness_level: "Erfaren",       longest_session_km: 3,  target_km: 8,   plan_weeks: 6,  language: "da" },
  { sport: "løb",      fitness_level: "Motionist",     longest_session_km: 12, target_km: 42,  plan_weeks: 1,  language: "da" },
  { sport: "cykling",  fitness_level: "Erfaren",       longest_session_km: 50, target_km: 180, plan_weeks: 7,  language: "en" },
  // no target_km — the pre-2026-09-05 contract must still work
  { sport: "løb",      fitness_level: "Motionist",     longest_session_km: 10, plan_weeks: 12, language: "da" },
  // explicit sessions_per_week overriding the fitness-level default
  { sport: "cykling",  fitness_level: "Begynder",      longest_session_km: 25, target_km: 120, plan_weeks: 9, sessions_per_week: 6, language: "en" },
];

const DA_LETTERS = /[æøåÆØÅ]/;
const EN_HINTS = /\b(the|and|with|for|your|easy|ride|run|swim|session|week|pace|recovery|build)\b/i;

function checkLanguage(plan, want) {
  // The JSON "sport" field is canonical Danish in both languages by design, so
  // it is excluded here — only names and coach notes carry the plan's language.
  const text = plan.weeks.flatMap((w) => w.items.map((it) => it[0] + " " + it[2])).join(" ");
  if (want === "da") return DA_LETTERS.test(text);
  return !DA_LETTERS.test(text) && EN_HINTS.test(text);
}

async function once(sample, phases) {
  const input = {
    sport: sample.sport,
    fitness_level: sample.fitness_level,
    longest_session_km: sample.longest_session_km,
    target_km: sample.target_km ?? null,
    sessions_per_week: sample.sessions_per_week ?? null,
    goal_event: `${sample.target_km ?? ""} km`.trim(),
    language: sample.language,
  };
  const msg = await client.messages.create(
    { model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM[sample.language],
      messages: [{ role: "user", content: buildUserMessage(input, phases) }] },
    { timeout: TIMEOUT_MS }
  );
  const raw = msg.content[0]?.text ?? "";
  // stop_reason "max_tokens" means the JSON was cut off mid-plan — the known
  // truncation risk for long plans, worth telling apart from a bad plan.
  return { plan: extractJson(raw), stop: msg.stop_reason, rawLen: raw.length };
}

async function run(sample, i) {
  const weeks = Math.min(sample.plan_weeks, 24);
  const phases = allocatePhases(weeks);
  const label = `#${String(i + 1).padStart(2, "0")} ${sample.sport} ${weeks}u ${sample.language} ${sample.fitness_level}`;
  const res = { label, schema: false, firstTry: false, phases: false, sessions: false,
                target: null, race: null, lang: false, error: null };
  try {
    let out = await once(sample, phases);
    res.firstTry = !!out.plan && validatePlan(out.plan, sample.sport, phases);
    if (!res.firstTry) out = await once(sample, phases); // the endpoint retries once
    let plan = out.plan;
    if (!plan || !validatePlan(plan, sample.sport, phases)) {
      res.error = !plan
        ? `unparseable (stop=${out.stop}, ${out.rawLen} tegn)`
        : `plan invalid (stop=${out.stop}, ${plan.weeks?.length ?? "?"} uger, forventet ${phases.length})`;
      return res;
    }
    res.schema = true;
    res.phases = plan.weeks.every((w, k) => w.phase === phases[k]);
    const want = sample.sessions_per_week ?? FITNESS_SESSIONS[sample.fitness_level];
    res.sessions = plan.weeks.every((w) => w.items.length === want);
    res.lang = checkLanguage(plan, sample.language);
    if (sample.target_km) {
      // Exclude the final week: it holds the race itself at full target
      // distance, so counting it made every plan look like it overshot.
      const training = plan.weeks.slice(0, -1);
      const peakWanted = sample.target_km * PEAK_FRACTION;
      // A 1-week plan is nothing but race week, so there is no build-up to
      // measure — scored as not applicable rather than as a miss.
      if (training.length) {
        const longest = Math.max(...training.flatMap((w) => w.items.map((it) => it[1])));
        res.target = +(longest / peakWanted).toFixed(2);
      }
      const finalMax = Math.max(...plan.weeks[plan.weeks.length - 1].items.map((it) => it[1]));
      res.race = +(finalMax / sample.target_km).toFixed(2);
    }
  } catch (e) {
    res.error = String(e.message).slice(0, 120);
  }
  return res;
}

const n = Number(process.argv[process.argv.indexOf("--samples") + 1]) || SAMPLES.length;
const list = SAMPLES.slice(0, n);
console.log(`Kører ${list.length} samples mod ${MODEL}, ${CONCURRENCY} ad gangen…\n`);

const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < list.length) {
      const i = next++;
      const r = await run(list[i], i);
      results[i] = r;
      process.stdout.write(`${r.schema ? "✓" : "✗"} ${r.label}\n`);
    }
  })
);

const pct = (k) => `${results.filter(k).length}/${results.length}`;
console.log("\n── RESULTAT ──────────────────────────────");
console.log(`gyldig plan (schema + faser)   ${pct((r) => r.schema)}`);
console.log(`  heraf i første forsøg        ${pct((r) => r.firstTry)}`);
console.log(`faserækkefølge præcis          ${pct((r) => r.phases)}`);
console.log(`sessioner pr. uge korrekt      ${pct((r) => r.sessions)}`);
console.log(`sprog korrekt                  ${pct((r) => r.lang)}`);

const withTarget = results.filter((r) => r.target !== null);
if (withTarget.length) {
  const inBand = withTarget.filter((r) => r.target >= 0.55 && r.target <= 1.15);
  const raceOk = withTarget.filter((r) => r.race >= 0.9);
  console.log(`længste TRÆNING nær 80% af mål ${inBand.length}/${withTarget.length}  (ekskl. løbsdagen)`);
  console.log(`måldistance i sidste uge       ${raceOk.length}/${withTarget.length}`);
  console.log(`  ratio længste/forventet      ${withTarget.map((r) => r.target).join(", ")}`);
}
const failed = results.filter((r) => !r.schema || !r.lang || !r.sessions);
if (failed.length) {
  console.log("\n── FEJL ──────────────────────────────────");
  for (const r of failed)
    console.log(`  ${r.label}: ${r.error || [!r.schema && "schema", !r.sessions && "sessioner", !r.lang && "sprog"].filter(Boolean).join(", ")}`);
}
process.exit(results.every((r) => r.schema) ? 0 : 1);
