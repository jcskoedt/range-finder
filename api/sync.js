// Cloud sync for the plan library.
// Design: docs/superpowers/specs/2026-09-06-c-cloud-sync-design.md
//
// The merge functions below are exported so scripts/validate-sync.mjs can
// exercise this exact code rather than a copy that drifts — the same reason
// api/replan.js imports from api/generate.js instead of duplicating it.
//
// They are deliberately pure: no I/O, no env vars, no client. The Supabase
// client is built inside the handler so importing this file can never depend
// on the environment, or on how a third-party SDK behaves when constructed
// without credentials. Verified: this module imports cleanly under `env -i`.
// A gate that an unrelated dependency upgrade can break is not a gate.
//
// Merge rules, in one place:
//   - progress merges per session key; the entry with the later `at` wins
//   - an entry with no `at`, or an unparseable one, counts as oldest
//   - a tombstone on either side removes the plan entirely — deletion is final
//   - otherwise the plan with the later `updatedAt` supplies the content, and
//     progress is merged across both regardless of which side that was

export const DOC_VERSION = 1;
export const TOMBSTONE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export const EMPTY_DOC = { v: DOC_VERSION, plans: {}, tombstones: {} };

// A progress entry written before the `at` field existed counts as oldest, so
// any stamped entry beats it. Date.parse returns NaN for junk, and NaN || 0
// gives 0, so a corrupt timestamp degrades the same safe way.
const ts = (e) => (e && e.at ? Date.parse(e.at) || 0 : 0);

// Ties go to the server copy. Not arbitrary: the server's version is the one
// every other device has already seen, so preferring it keeps a tie from
// flip-flopping as devices sync in different orders.
const upd = (p) => (p && p.updatedAt ? Date.parse(p.updatedAt) || 0 : 0);

const keysOf = (o) => Object.keys(o || {});

export function mergeProgress(a = {}, b = {}) {
  const out = {};
  for (const key of new Set([...keysOf(a), ...keysOf(b)])) {
    const x = a[key], y = b[key];
    if (!x) { out[key] = y; continue; }
    if (!y) { out[key] = x; continue; }
    out[key] = ts(y) > ts(x) ? y : x;
  }
  return out;
}

export function mergeTombstones(a = {}, b = {}, now = Date.now()) {
  const out = {};
  for (const id of new Set([...keysOf(a), ...keysOf(b)])) {
    // ISO 8601 strings sort lexically in chronological order, so the earliest
    // deletion wins without parsing either of them.
    const at = [a && a[id], b && b[id]].filter(Boolean).sort()[0];
    if (!at) continue;
    const parsed = Date.parse(at);
    // A tombstone with an unreadable date is kept rather than dropped: losing
    // it would let the plan come back, which is the worse of the two failures.
    if (!Number.isFinite(parsed) || now - parsed < TOMBSTONE_TTL_MS) out[id] = at;
  }
  return out;
}

export function merge(server, client, now = Date.now()) {
  const tombstones = mergeTombstones(server && server.tombstones, client && client.tombstones, now);
  const sp = (server && server.plans) || {};
  const cp = (client && client.plans) || {};
  const plans = {};
  for (const id of new Set([...keysOf(sp), ...keysOf(cp)])) {
    if (tombstones[id]) continue;               // deletion is final everywhere
    const s = sp[id], c = cp[id];
    if (!s) { plans[id] = c; continue; }
    if (!c) { plans[id] = s; continue; }
    const base = upd(c) > upd(s) ? c : s;
    plans[id] = { ...base, progress: mergeProgress(s.progress, c.progress) };
  }
  return { v: DOC_VERSION, plans, tombstones };
}

// The endpoint itself lands in Task 5 of
// docs/superpowers/plans/2026-09-06-c-cloud-sync.md. Until then this answers
// honestly instead of crashing: vercel.json builds every api/*.js as a
// function, so this path is reachable the moment the file ships.
export default async function handler(_req, res) {
  return res.status(501).json({ error: "not_implemented" });
}
