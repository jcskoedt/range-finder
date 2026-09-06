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

// Latest wins, and nothing is pruned here. Both of those are corrections.
//
// Earliest-wins looked symmetrical with the progress rule and was wrong: a
// tombstone's only job is to persist, so picking the older of two dates and
// then expiring it deleted the record while both sides still agreed the plan
// was gone. Measured: {a: yesterday} merged with {a: 2024} returned {}.
//
// Expiry moved to merge(), which is the only place that knows whether anyone
// still holds the plan. A tombstone must never expire while there is something
// left to resurrect.
export function mergeTombstones(a = {}, b = {}) {
  const out = {};
  for (const id of new Set([...keysOf(a), ...keysOf(b)])) {
    // ISO 8601 strings sort lexically in chronological order, so the latest
    // deletion wins without parsing either of them.
    const dates = [a && a[id], b && b[id]].filter(Boolean).sort();
    if (dates.length) out[id] = dates[dates.length - 1];
  }
  return out;
}

export function merge(server, client, now = Date.now()) {
  const all = mergeTombstones(server && server.tombstones, client && client.tombstones);
  const sp = (server && server.plans) || {};
  const cp = (client && client.plans) || {};

  const plans = {};
  for (const id of new Set([...keysOf(sp), ...keysOf(cp)])) {
    if (all[id]) continue;                      // deletion is final everywhere
    const s = sp[id], c = cp[id];
    if (!s) { plans[id] = c; continue; }
    if (!c) { plans[id] = s; continue; }
    const base = upd(c) > upd(s) ? c : s;
    plans[id] = { ...base, progress: mergeProgress(s.progress, c.progress) };
  }

  // Expiry happens last, and only for plans nobody is still carrying. A
  // tombstone that is still doing work — killing a copy on the other side —
  // outlives its TTL rather than letting the plan come back. An unreadable
  // date is kept for the same reason.
  const tombstones = {};
  for (const id of keysOf(all)) {
    const parsed = Date.parse(all[id]);
    const stillHeld = Boolean(sp[id] || cp[id]);
    const expired = Number.isFinite(parsed) && now - parsed >= TOMBSTONE_TTL_MS;
    if (stillHeld || !expired) tombstones[id] = all[id];
  }

  return { v: DOC_VERSION, plans, tombstones };
}

// ---------------------------------------------------------------------------
// The endpoint.
//
// Everything above this line is pure and testable by scripts/validate-sync.mjs.
// Everything below needs a database. Keep the split — it is what lets the gate
// run with no environment at all.

// Auth is checked before the client is built, so a request with no token costs
// nothing and can be tested without any Supabase project existing.
function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "DELETE") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "no_token" });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Named explicitly rather than failing as a 500 five lines later: the
    // Anthropic key being scoped to the wrong workspace cost this project an
    // afternoon of debugging a working endpoint.
    console.warn("[sync] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
    return res.status(503).json({ error: "not_configured" });
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData || !userData.user) return res.status(401).json({ error: "invalid_token" });
  const userId = userData.user.id;

  if (req.method === "DELETE") {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      console.warn("[sync] delete: " + error.message);
      return res.status(500).json({ error: "delete_failed" });
    }
    return res.status(204).end();     // libraries row goes with it, on delete cascade
  }

  const body = req.body || {};
  const clientDoc = body.doc;
  if (!clientDoc || typeof clientDoc !== "object" || typeof clientDoc.plans !== "object") {
    return res.status(400).json({ error: "invalid_doc" });
  }
  const baseVersion = Number.isInteger(body.baseVersion) ? body.baseVersion : 0;

  const first = await admin.rpc("sync_library", {
    p_user_id: userId, p_doc: clientDoc, p_base_version: baseVersion,
  });
  if (first.error) {
    console.warn("[sync] " + first.error.message);
    return res.status(500).json({ error: "sync_failed" });
  }

  let out = Array.isArray(first.data) ? first.data[0] : first.data;
  if (out && out.conflict) {
    // Someone else wrote since this client last synced. Merge against what the
    // server actually holds, then write at the version we just read.
    const merged = merge(out.doc, clientDoc);
    const retry = await admin.rpc("sync_library", {
      p_user_id: userId, p_doc: merged, p_base_version: out.version,
    });
    const retryRow = retry.error ? null : (Array.isArray(retry.data) ? retry.data[0] : retry.data);
    if (!retryRow || retryRow.conflict) {
      // A third device wrote in between. Nothing is lost — localStorage still
      // holds everything — so let the client retry on its own schedule.
      return res.status(409).json({ error: "retry" });
    }
    out = retryRow;
  }

  // conflict is internal between the SQL function and this handler.
  return res.status(200).json({ doc: out.doc, version: out.version });
}
