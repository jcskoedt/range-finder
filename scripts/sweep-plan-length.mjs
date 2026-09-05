#!/usr/bin/env node
// Finds where long plans start failing.
//
// The 2026-09-05 gate run failed on the longest, densest plan in both runs
// (20w x 5 sessions, then 24w x 6), with stop_reason end_turn rather than
// max_tokens — the model losing count, not running out of room. This sweeps
// plan length at a fixed density to locate the breaking point, and adds two
// controls at 24 weeks with fewer sessions to separate "too many weeks" from
// "too many sessions".
//
// Single attempt per run, no retry: we want the raw per-attempt failure rate,
// not what the endpoint's retry rescues.
//
// Usage: ANTHROPIC_API_KEY=... node scripts/sweep-plan-length.mjs [--reps N]

import Anthropic from "@anthropic-ai/sdk";
import {
  MODEL, MAX_TOKENS, FITNESS_SESSIONS, SYSTEM,
  allocatePhases, buildUserMessage, extractJson, validatePlan,
} from "../api/generate.js";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  ...(process.env.ANTHROPIC_WORKSPACE_ID
    ? { defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } }
    : {}),
});

const REPS = Number(process.argv[process.argv.indexOf("--reps") + 1]) || 3;
const CONCURRENCY = 4;

const CELLS = [
  ...[8, 12, 16, 18, 20, 22, 24].map((weeks) => ({ weeks, fitness: "Konkurrerende" })),
  { weeks: 24, fitness: "Motionist", note: "kontrol" },
  { weeks: 24, fitness: "Begynder", note: "kontrol" },
];

async function attempt(cell) {
  const phases = allocatePhases(cell.weeks);
  const input = {
    sport: "cykling", fitness_level: cell.fitness, longest_session_km: 60,
    target_km: 200, sessions_per_week: null, goal_event: "200 km", language: "da",
  };
  const t0 = Date.now();
  try {
    const msg = await client.messages.create(
      { model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM.da,
        messages: [{ role: "user", content: buildUserMessage(input, phases) }] },
      { timeout: 90000 }
    );
    const ms = Date.now() - t0;
    const raw = msg.content[0]?.text ?? "";
    const plan = extractJson(raw);
    if (!plan) return { ok: false, ms, why: `uparsbar (stop=${msg.stop_reason})` };
    if (!validatePlan(plan, "cykling", phases)) {
      const got = plan.weeks?.length ?? "?";
      if (got !== phases.length) return { ok: false, ms, why: `${got} uger i stedet for ${phases.length} (stop=${msg.stop_reason})` };
      return { ok: false, ms, why: `ugyldige sessioner (stop=${msg.stop_reason})` };
    }
    return { ok: true, ms, out: msg.usage.output_tokens };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, why: String(e.message).slice(0, 60) };
  }
}

const jobs = [];
for (const cell of CELLS) for (let r = 0; r < REPS; r++) jobs.push(cell);
console.log(`${CELLS.length} punkter x ${REPS} forsøg = ${jobs.length} kald mod ${MODEL}\n`);

const results = new Map(CELLS.map((c) => [c, []]));
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const cell = jobs[next++];
      const r = await attempt(cell);
      results.get(cell).push(r);
      process.stdout.write(r.ok ? "." : "x");
    }
  })
);

console.log("\n\n uger  sess/uge  i alt   bestået      tid    tokens   fejl");
console.log("──────────────────────────────────────────────────────────────────────────");
for (const cell of CELLS) {
  const rs = results.get(cell);
  const spw = FITNESS_SESSIONS[cell.fitness];
  const ok = rs.filter((r) => r.ok).length;
  const bar = "█".repeat(ok) + "·".repeat(rs.length - ok);
  const why = [...new Set(rs.filter((r) => !r.ok).map((r) => r.why))].join("; ");
  const times = rs.filter((r) => r.ms).map((r) => r.ms);
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length / 1000) : 0;
  const outs = rs.filter((r) => r.out).map((r) => r.out);
  const avgOut = outs.length ? Math.round(outs.reduce((a, b) => a + b, 0) / outs.length) : 0;
  console.log(
    `  ${String(cell.weeks).padStart(2)}      ${spw}      ${String(cell.weeks * spw).padStart(3)}   ${bar} ${ok}/${rs.length}` +
    `  ${String(avg).padStart(3)}s  ${String(avgOut || "-").padStart(6)}   ${cell.note ? "(" + cell.note + ") " : ""}${why}`
  );
}
