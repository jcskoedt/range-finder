/* Retention warning — GET /api/retention-warn
 *
 * Vercel Cron hits this once a day. It finds the accounts that have been quiet
 * for eleven months, sends each one the warning /privacy promises, and records
 * that it did.
 *
 * This endpoint is what makes the twelve-month deletion possible at all.
 * sweep_inactive() in Postgres deletes nobody who has no warning on record and
 * no thirty days since it, so if this stops working the outcome is that
 * nothing is deleted — not that someone is deleted unwarned. That is the safe
 * direction, but it is still a broken promise, so it has to be visible:
 * retention_status().overdue_unwarned counts exactly the accounts that are
 * past the deletion date and alive only because nobody warned them. It should
 * be 0. If it climbs, this endpoint is not running.
 *
 * Order matters and is not negotiable: send first, record second. Recording
 * first would let a failed send count as a warning, and thirty days later the
 * account goes without anyone ever having heard from us. A failed send simply
 * gets picked up again tomorrow.
 */

// A run has to finish inside the function's time limit, which is 10 seconds on
// Hobby and cannot be raised from vercel.json here: `maxDuration` lives under
// the `functions` key, and `functions` and `builds` are mutually exclusive —
// this project uses `builds`. So the run is bounded by a deadline it checks
// itself rather than by a count it hopes is small enough, and whatever it does
// not reach is picked up tomorrow. With no users yet the realistic number due
// on any given day is zero or one.
const WARN_LIMIT = 25;          // per run; a backlog drains over days
const DEADLINE_MS = 7500;       // leaves headroom under the 10s ceiling
const SEND_GAP_MS = 600;        // Resend's default ceiling is 2 requests/second
const APP_URL = "https://rangefinderapp.vercel.app";

// The synced document has no language field — verified in index.html: the
// wizard sends `language` to /api/generate but never stores it on the plan, and
// the UI language lives in localStorage, which never reaches the server. So
// there is nothing to localise from and the mail carries both languages rather
// than guessing. If a language ever lands in the document, narrow it here.
function warningEmail() {
  const subject = "Din Range Finder-konto slettes om 30 dage / Your Range Finder account will be deleted in 30 days";
  const text = [
    "Hej,",
    "",
    "Din Range Finder-konto har ikke været brugt i 11 måneder. Som beskrevet i",
    "privatlivspolitikken sletter vi konti efter 12 måneders inaktivitet, så om",
    "cirka 30 dage bliver din konto og dine planer slettet.",
    "",
    "Vil du beholde dem, skal du bare logge ind:",
    APP_URL,
    "",
    "Det er nok at åbne appen og logge ind. Du behøver ikke gøre andet.",
    "",
    "— Range Finder",
    "",
    "---",
    "",
    "Hi,",
    "",
    "Your Range Finder account has not been used for 11 months. As described in",
    "the privacy policy, we delete accounts after 12 months of inactivity, so in",
    "about 30 days your account and your plans will be deleted.",
    "",
    "To keep them, just sign in:",
    APP_URL,
    "",
    "Opening the app and signing in is enough. Nothing else is needed.",
    "",
    "— Range Finder",
    "",
    APP_URL + "/privacy",
  ].join("\n");
  return { subject, text };
}

async function sendWarning(apiKey, from, to) {
  const { subject, text } = warningEmail();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = JSON.stringify(await res.json()); } catch (e) {}
    throw new Error("resend_http_" + res.status + " " + detail);
  }
  const out = await res.json();
  return (out && out.id) || null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // An endpoint that sends mail must not be open. Vercel Cron sends
  // `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set in the
  // project. No secret configured means no way to tell cron from a stranger,
  // so it refuses rather than running.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[retention-warn] CRON_SECRET missing; refusing to run");
    return res.status(503).json({ error: "not_configured", missing: "CRON_SECRET" });
  }
  const auth = req.headers.authorization || "";
  if (auth !== "Bearer " + secret) {
    return res.status(401).json({ error: "unauthorized" });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("[retention-warn] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
    return res.status(503).json({ error: "not_configured", missing: "supabase" });
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: due, error: dueErr } = await admin.rpc("retention_warn_due", { p_limit: WARN_LIMIT });
  if (dueErr) {
    console.warn("[retention-warn] retention_warn_due failed: " + dueErr.message);
    return res.status(500).json({ error: "query_failed" });
  }
  const list = Array.isArray(due) ? due : [];

  // Resend is not set up yet. This returns 200 on purpose rather than failing:
  // the missing configuration is already recorded in HANDOFF.md and countable
  // in retention_status(), and a cron that fails every day for weeks teaches
  // you to ignore cron failures — which then hides the real one. The count
  // comes back in the response so a look at the logs still says what is
  // waiting.
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    console.warn("[retention-warn] Resend not configured; " + list.length + " account(s) waiting for a warning");
    return res.status(200).json({ ok: true, skipped: "resend_not_configured", due: list.length });
  }

  const startedAt = Date.now();
  let sent = 0;
  let stoppedEarly = false;
  const failed = [];
  for (const row of list) {
    if (!row || !row.email) continue;
    if (Date.now() - startedAt > DEADLINE_MS) {
      stoppedEarly = true;
      break;
    }
    try {
      const emailId = await sendWarning(apiKey, from, row.email);
      const { error: markErr } = await admin.rpc("retention_mark_warned", {
        p_user_id: row.user_id,
        p_email_id: emailId,
      });
      // Sent but not recorded is the one bad outcome left: tomorrow's run will
      // mail the same person again. Annoying, not destructive — and the
      // alternative, recording first, risks deleting someone who never heard
      // from us. Logged loudly so a recurring one gets noticed.
      if (markErr) {
        console.warn("[retention-warn] sent but not recorded for " + row.user_id + ": " + markErr.message);
        failed.push({ user_id: row.user_id, reason: "mark_failed" });
      } else {
        sent++;
      }
    } catch (e) {
      console.warn("[retention-warn] send failed for " + row.user_id + ": " + (e && e.message));
      failed.push({ user_id: row.user_id, reason: "send_failed" });
    }
    if (SEND_GAP_MS) await new Promise((r) => setTimeout(r, SEND_GAP_MS));
  }

  const { data: status } = await admin.rpc("retention_status");
  const s = Array.isArray(status) ? status[0] : status;
  if (s && Number(s.overdue_unwarned) > 0) {
    console.warn("[retention-warn] overdue_unwarned=" + s.overdue_unwarned +
      " — accounts past the deletion date that nobody has warned");
  }

  return res.status(200).json({
    ok: true,
    due: list.length,
    sent,
    failed: failed.length,
    stopped_early: stoppedEarly,
    status: s || null,
  });
}
