# Range Finder — TODO
Sidst opdateret: 2026-09-04

---

## 🔴 Gør nu

- [ ] **BLOKERENDE: Ret ANTHROPIC_API_KEY i Vercel** — nøglen er ikke scoped til et workspace, alle `/api/generate` og `/api/scan`-kald fejler i produktion. Se "⚠️ BLOKERENDE" øverst i HANDOFF.md for begge fix-muligheder.
- [x] **Kør prompt-validering** — DONE 2026-09-04. Original prompt (fase-tabel som prosa, Claude beregner selv): **4/15 (27%)** — Haiku følger ikke pålideligt en indlejret opslagstabel. Omskrev til deterministisk fase-allokering i kode + Claude fylder kun sessioner ind: **14/15 (93%)** på første forsøg, den sidste fejl (JSON-syntaksfejl) lykkedes på almindeligt retry. CEO-planens prompt-spec er opdateret med den nye tilgang — se "Prompt spec — REWRITTEN" i planen.

---

## 🟠 Byg nu — B1 (AI-plangenering)

### Nye filer
- [ ] `api/generate.js` — Vercel function: modtager wizard-inputs, kalder Claude Haiku, returnerer JSON-plan

### Ændringer i index.html
- [ ] Wizard: 3 nye felter — fitnessniveau (dropdown), længste session de seneste 4 uger (km), løbsdato (dato, valgfrit)
- [ ] Plan-rendering: 3-element arrays `[navn, km, coach_note]` — render coach_note som kursiv under session
- [ ] I DAG-tab: Progress Ring (SVG-cirkel, km logget / km planlagt for ugen)
- [ ] I DAG-tab: km-loginput ("Km logget i dag") skriver til localStorage
- [x] Loading state under generering: knap disables + spinner + "Din AI-coach tænker..." — DONE 2026-09-04, 45 sek med roterende undertekst, se HANDOFF.md
- [ ] Fallback-besked: "AI-coach midlertidigt utilgængelig — her er din plan baseret på vores algoritme."
- [ ] Email-felt (valgfrit, sidst i wizard): "Bruges kun til at gemme din plan, når du logger ind."

### Fejl der SKAL fixes inden kode skrives
- [x] **Double-submit** — DONE 2026-09-04, knappen fjernes fra DOM'en under de 45 sek loading-skærm, umuligt at trykke igen
- [ ] **Model refusal** — Hvis Haiku afviser: treat som `generation_failed`, fald tilbage til algoritme
- [ ] **Default uger** — Hardcode 12 uger server-side hvis ingen løbsdato angives
- [ ] **Progress Ring >100%** — Cap ring ved 100%; tillad km-log over planlagt

---

## 🟡 Byg efter B1 er valideret — B2

- [ ] `api/replan.js` — Modtager skippede uger + resterende plan → Claude justerer faser og km
- [ ] UI: "Vil du justere din plan?" prompt når en uge er passeret uden loggede sessioner

---

## 🟡 Byg efter B2 — C (Cloud sync + konti)

*Ingen betalinger. Målet er at planer synker på tværs af enheder og ikke forsvinder.*

- [ ] Supabase-projekt: opret auth + Postgres
- [ ] Magic link auth (email, ingen adgangskode)
- [ ] Cloud sync: plans + sessions gemmes i Supabase i stedet for localStorage
- [ ] `/api/migrate-plan` — migrer localStorage-planer ved første sign-in

---

## 🔵 Backlog (defer til brugerfeedback)

- [ ] **Del plan som URL** — base64-encode planstate → querystring → delbar link
- [ ] **iCal-eksport** — .ics-fil download fra PLAN-tabben
- [ ] **Ugentlig coaching-email** — Resend + Supabase Edge Function cron
- [ ] **Strava-integration** — kræver OAuth-review-proces, uger ventetid
- [ ] **Haiku → Sonnet upgrade** — Kun hvis plan-kvalitet viser sig utilstrækkelig

---

## 🔧 Kendte tekniske bekymringer

- [ ] Haiku max_tokens 4096 kan truncere 24-ugers planer. Overvej cap på 20 uger til det er testet.
- [ ] Prompt injection via `goal_event`-felt. Mitigér: max 200 chars server-side.
- [ ] localStorage QuotaExceededError ikke håndteret. Tilføj try/catch ved plan-gemning.
- [ ] **(eng-review 2026-09-04)** Opgrader rate limiting til Vercel Firewall når/hvis in-memory Map bliver utilstrækkelig (reelt misbrug, eller når appen har betalende brugere). B1 bruger bevidst in-memory Map (matcher scan.js) — dette er kun en fremtidig genbesøg, ikke en aktuel mangel.
- [ ] **(eng-review 2026-09-04)** Skriv `scripts/validate-generate.mjs` — genkørbart script der sender de 10-20 sample-inputs mod `/api/generate` og tjekker JSON-schema-validitet, i stedet for den nuværende manuelle valideringsgate. Deferred — B1 kører uden for nu.
- [ ] **(prompt-validering 2026-09-04)** Fase-tabellens regel for uge 17+ ("tilføj 1 BASE uge, maks 8 BASE uger totalt") er tvetydig for uger 21-24 — tabellen siger intet om hvad der sker når BASE-loftet er nået men planen stadig skal være længere. Nuværende implementering (`allocatePhases()` i CEO-planen) fortsætter bare med at forlænge BASE forbi loftet i stedet for at gætte på noget andet. Bør genbesøges med rigtig coaching-faglig input før B1 skibes.
- [ ] **(design-review 2026-09-04, FINDING-002)** Appen har kun ét reelt `<h1>` og ingen `<h2>`-`<h6>` nogen steder — sektionstitler ("My plans", "150 km cycling", fasenavne, "How it works") er alle styled `<div>`/`<p>`, ikke semantiske headings. Skader skærmlæser-navigation (ingen heading-outline at hoppe igennem). Ikke en CSS-only fix — kræver ændringer i hver `render*`-funktion. Fortjener en dedikeret gennemgang, ikke bundlet ind i en design-polish-omgang.

---

## ✅ Klaret

- [x] Deployed til Vercel: https://traeningsplan-app.vercel.app
- [x] /office-hours: design doc godkendt
- [x] /plan-ceo-review: CEO-plan skrevet
- [x] Projektmappe samlet i `/Users/jacobcompenskodt/06RANGE_FINDER`
