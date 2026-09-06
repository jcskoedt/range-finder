#!/usr/bin/env node
// Gate for fletningen i /api/sync.
//
// Hvorfor den findes: fletningen er den ene ting i cloud sync der kan tabe
// data i stilhed. En bruger opdager ikke at en session forsvandt — de tror
// bare de huskede forkert. Derfor ligger fletningen i rene funktioner, og
// derfor testes de her: uden browser, uden database, uden env-variabler.
//
// Kør den før du rører fletningen. Se
// docs/superpowers/specs/2026-09-06-c-cloud-sync-design.md
//
// Usage: node scripts/validate-sync.mjs

import { merge, mergeProgress, mergeTombstones, TOMBSTONE_TTL_MS } from "../api/sync.js";

let pass = 0, fail = 0;
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FEJL  ${label}\n        fik      ${a}\n        ventede  ${e}`); }
};

// done/actualKm/at i den rækkefølge, så JSON.stringify kan sammenlignes direkte
const p = (at, extra = {}) => ({ done: true, actualKm: 8, at, ...extra });
const plan = (id, updatedAt, progress = {}) => ({ id, updatedAt, weeks: [], progress });
const NOW = Date.parse("2026-09-06T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

console.log("\nfremdrift — flettes pr. session på at");

eq("1. seneste at vinder",
  mergeProgress(
    { "0_0": p("2026-09-01T00:00:00.000Z") },
    { "0_0": p("2026-09-05T00:00:00.000Z", { actualKm: 12 }) }),
  { "0_0": p("2026-09-05T00:00:00.000Z", { actualKm: 12 }) });

// Den her er grunden til at "afkrydset vinder altid" ikke duer: et kryds skal
// kunne fortrydes, og fortrydelsen skal slå igennem hvis den er nyest.
eq("2. fortrydelse vinder hvis den er nyest",
  mergeProgress(
    { "0_0": p("2026-09-01T00:00:00.000Z") },
    { "0_0": { done: false, actualKm: null, at: "2026-09-05T00:00:00.000Z" } }),
  { "0_0": { done: false, actualKm: null, at: "2026-09-05T00:00:00.000Z" } });

eq("3. post uden at taber mod en stemplet",
  mergeProgress(
    { "0_0": { done: true, actualKm: 5 } },
    { "0_0": p("2026-09-01T00:00:00.000Z") }),
  { "0_0": p("2026-09-01T00:00:00.000Z") });

eq("4. poster kun på én side bevares",
  mergeProgress(
    { "0_0": p("2026-09-01T00:00:00.000Z") },
    { "1_0": p("2026-09-02T00:00:00.000Z") }),
  { "0_0": p("2026-09-01T00:00:00.000Z"), "1_0": p("2026-09-02T00:00:00.000Z") });

console.log("\ntombstones — sletning er endelig");

eq("5. tidligste sletning vinder",
  mergeTombstones({ a: "2026-09-05T00:00:00.000Z" }, { a: "2026-09-06T00:00:00.000Z" }, NOW),
  { a: "2026-09-05T00:00:00.000Z" });

eq("6. tombstone ældre end 12 mdr ryddes",
  mergeTombstones({ a: iso(NOW - TOMBSTONE_TTL_MS - 1000) }, {}, NOW),
  {});

eq("6b. tombstone lige under 12 mdr bevares",
  mergeTombstones({ a: iso(NOW - TOMBSTONE_TTL_MS + 60000) }, {}, NOW),
  { a: iso(NOW - TOMBSTONE_TTL_MS + 60000) });

console.log("\nplaner");

eq("7. sletning slår nyere redigering",
  merge(
    { plans: { a: plan("a", "2026-09-06T00:00:00.000Z") }, tombstones: {} },
    { plans: {}, tombstones: { a: "2026-09-01T00:00:00.000Z" } }, NOW).plans,
  {});

eq("8. plan kun på én side bevares",
  Object.keys(merge(
    { plans: { a: plan("a", "2026-09-01T00:00:00.000Z") }, tombstones: {} },
    { plans: { b: plan("b", "2026-09-01T00:00:00.000Z") }, tombstones: {} }, NOW).plans).sort(),
  ["a", "b"]);

// Replan på den ene side, afkrydsning på den anden: de nye uger og den
// bevarede fremdrift skal begge være med i samme resultat.
eq("9. nyere plan vinder indhold, fremdrift flettes alligevel",
  merge(
    { plans: { a: plan("a", "2026-09-01T00:00:00.000Z", { "0_0": p("2026-09-04T00:00:00.000Z") }) }, tombstones: {} },
    { plans: { a: plan("a", "2026-09-05T00:00:00.000Z", { "1_0": p("2026-09-02T00:00:00.000Z") }) }, tombstones: {} },
    NOW).plans.a.progress,
  { "0_0": p("2026-09-04T00:00:00.000Z"), "1_0": p("2026-09-02T00:00:00.000Z") });

eq("9b. den nyere plans egne felter vinder",
  merge(
    { plans: { a: { ...plan("a", "2026-09-01T00:00:00.000Z"), label: "gammel" } }, tombstones: {} },
    { plans: { a: { ...plan("a", "2026-09-05T00:00:00.000Z"), label: "ny" } }, tombstones: {} },
    NOW).plans.a.label,
  "ny");

eq("10. tomt serverdokument mod fyldt klient — førstegangsmigrering",
  Object.keys(merge(
    { plans: {}, tombstones: {} },
    { plans: { a: plan("a", "2026-09-01T00:00:00.000Z") }, tombstones: {} }, NOW).plans),
  ["a"]);

// To browsere ude af sync i en uge, begge med ændringer i samme plan.
// Intet krydset må tabes.
eq("11. en uge ude af sync, begge sider har ændringer",
  Object.keys(merge(
    { plans: { a: plan("a", "2026-09-01T00:00:00.000Z", {
        "0_0": p("2026-08-30T00:00:00.000Z"), "0_1": p("2026-08-31T00:00:00.000Z") }) }, tombstones: {} },
    { plans: { a: plan("a", "2026-09-02T00:00:00.000Z", {
        "0_2": p("2026-09-03T00:00:00.000Z"), "1_0": p("2026-09-04T00:00:00.000Z") }) }, tombstones: {} },
    NOW).plans.a.progress).sort(),
  ["0_0", "0_1", "0_2", "1_0"]);

console.log("\nrobusthed");

eq("12. tomme og manglende dokumenter kaster ikke",
  merge(undefined, undefined, NOW),
  { v: 1, plans: {}, tombstones: {} });

eq("13. uparselig at tæller som ældst",
  mergeProgress(
    { "0_0": { done: true, actualKm: 5, at: "ikke en dato" } },
    { "0_0": p("2026-09-01T00:00:00.000Z") }),
  { "0_0": p("2026-09-01T00:00:00.000Z") });

console.log(`\n${pass} ok, ${fail} fejl`);
process.exit(fail === 0 ? 0 : 1);
