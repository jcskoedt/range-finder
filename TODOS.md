# Range Finder — TODO
Sidst opdateret: 2026-09-04

---

## 🔴 Gør nu

- [x] **BLOKERENDE: Ret ANTHROPIC_API_KEY** — LØST 2026-09-05. `ANTHROPIC_WORKSPACE_ID` sat i Vercel (Production), `api/scan.js` fik samme header. Verificeret med tre ægte kald i produktion mod dansk, engelsk og alle tre sportsgrene — se HANDOFF.md.
- [x] **Prompt-validering kørt igen** — 2026-09-05, efter måldistance + engelsk variant. **15/16 gyldige (94%)**, 14/16 i første forsøg. Ingen regression fra de 93% før ændringerne. Kør igen med `node scripts/validate-generate.mjs`.
- [x] **`scripts/validate-generate.mjs` skrevet** — den udskudte opgave fra eng-review. Kalder Anthropic direkte med endpointets egne funktioner (importeret, ikke kopieret), så rate limiten ikke er i vejen. 16 samples på tværs af sportsgrene, niveauer, planlængder og begge sprog. Exit-kode 0/1, så den kan bruges som gate.
- [ ] **Lange planer taber en uge.** Begge kørsler fejlede på den længste/tætteste plan — 20u×5 og 24u×6 sessioner. Fejlen er ikke trunkering (`stop_reason: end_turn`), modellen returnerer bare 23 uger i stedet for 24. Retry hjælper ikke. Appen falder tilbage til algoritmen, så brugeren får en plan, men ikke en AI-plan. **Overvej at cappe AI-planer ved ~16-20 uger** og lade algoritmen tage de længste. Bekræfter den gamle bekymring om lange planer, men årsagen er optælling, ikke max_tokens.
- [ ] **Måldistance-heuristikken rammer 12/13** (ekskl. 1-ugers planer, hvor der ikke er nogen opbygning at måle). Ratio længste træning / forventet 80%: mest 1,0, med enkelte på 0,63-0,75 og én på 1,25. God nok, men ikke præcis.
- [ ] **Automatisér aliaset** — `rangefinderapp.vercel.app` skal sættes manuelt efter hvert deploy og har nu tre gange peget på gammel kode. Overvej at gøre `rangefinderapp` til produktionsdomænet i projektindstillingerne i stedet for et manuelt alias.
- [ ] **`icon.svg` mangler en route i `vercel.json`** — `index.html` refererer til den, men catch-all-routen sender den til `index.html`.

- [x] **Kør prompt-validering** — DONE 2026-09-04. Original prompt (fase-tabel som prosa, Claude beregner selv): **4/15 (27%)** — Haiku følger ikke pålideligt en indlejret opslagstabel. Omskrev til deterministisk fase-allokering i kode + Claude fylder kun sessioner ind: **14/15 (93%)** på første forsøg, den sidste fejl (JSON-syntaksfejl) lykkedes på almindeligt retry. CEO-planens prompt-spec er opdateret med den nye tilgang — se "Prompt spec — REWRITTEN" i planen.

---

## 🟠 Byg nu — B1 (AI-plangenering)

### Nye filer
- [x] `api/generate.js` — Vercel function: modtager wizard-inputs, kalder Claude Haiku, returnerer JSON-plan. DONE (commit `df07c5b`), kontrakt lukket 2026-09-05.

### Kontrakt frontend ↔ API — DONE 2026-09-05 (trin 1)
Tre brud fandtes ved kodelæsning; alle ville have fejlet støjende i det øjeblik wizarden blev koblet på.
- [x] **Sport-nøgler matchede ikke.** Frontenden (og `api/scan.js`) bruger `cykling`/`lob`/`svomning`; `generate.js` krævede `cykling`/`løb`/`svømning` → garanteret 400 for løb og svømning. Løst med `SPORT_ALIASES` der normaliserer i handleren; begge stavemåder accepteres nu, og ét kanonisk navn går videre til prompt og `validatePlan()`.
- [x] **Måldistance fandtes slet ikke i kontrakten** — hverken i koden eller i CEO-spec'en. Km-opbygningen var kun forankret i `longest_session_km`, så en bruger med mål 200 km og længste tur 40 km kunne få en plan der aldrig nærmede sig målet. Tilføjet som valgfrit `target_km` (valideret 0 < x ≤ 5000). Planens længste session sigter mod 80% af målet — samme `PEAK_FRACTION`-heuristik som den lokale `generatePlan()`, så AI-plan og fallback-plan bygger mod samme sted.
- [x] **`sessions_per_week` blev ignoreret** — API'et udledte det af fitnessniveau, så wizardens felt havde ingen effekt. Nu eksplicit input (1-7), med fitnessniveau som fallback.
- [x] `apiPlanToLocalPlan()` i index.html — mapper `{label, sport, weeks}` til appens planobjekt: sport tilbage til ASCII-nøgle, faser Title Case'et så de grupperer sammen med fallback-planens faser, `weeksAvailable` taget fra det faktiske antal returnerede uger (ikke wizardens ønske — API'et capper ved 24). **Funktionen er endnu ikke kaldt** — det er trin 2.
- [x] `api/scan.js` fik samme workspace-header som `generate.js` (påkrævet af Mulighed B for nøglefixet).

**Verificeret lokalt:** 18 valideringsveje (sport-aliaser, target_km, sessions_per_week, samt de eksisterende fitness-/løbsdato-veje) + rate limiting. Selve Claude-kaldet er ikke verificeret — kræver at nøglen virker.

### Ændringer i index.html
- [x] Wizard: **fitnessniveau** (dropdown) tilføjet 2026-09-05 — påkrævet af API'et, så trin 2 kunne ikke virke uden det. Værdierne er de danske strings API'et validerer; labels er engelske som resten af wizarden.
- [x] **Længste session** fandtes allerede som "Current longest session (km, optional)" (`wLongest`) — nu mappet til `longest_session_km`.
- [ ] **Løbsdato** (valgfri dato) — mangler stadig. "Time available"-dropdownen dækker funktionelt det samme via `plan_weeks`, så det er nu et UX-valg (dato vs. antal uger), ikke en blokering.
- [ ] Plan-rendering: 3-element arrays `[navn, km, coach_note]` — render coach_note som kursiv under session
- [ ] I DAG-tab: Progress Ring (SVG-cirkel, km logget / km planlagt for ugen)
- [ ] I DAG-tab: km-loginput ("Km logget i dag") skriver til localStorage
- [x] Loading state under generering: knap disables + spinner + "Din AI-coach tænker..." — DONE 2026-09-04, 45 sek med roterende undertekst, se HANDOFF.md
- [x] **Fallback-besked** — DONE 2026-09-05. Gult banner øverst på PLAN-viewet. Tre varianter: generel fallback, rate limit (429), og capped plan. Banneret gemmes bevidst ikke på planobjektet — det beskriver hvad der lige skete, ikke hvad planen er.
- [ ] Email-felt (valgfrit, sidst i wizard): "Bruges kun til at gemme din plan, når du logger ind."

### Fejl der SKAL fixes inden kode skrives
- [x] **Double-submit** — DONE 2026-09-04, knappen fjernes fra DOM'en under de 45 sek loading-skærm, umuligt at trykke igen
- [x] **Model refusal** — DONE 2026-09-05. Alt der ikke er en gyldig plan (afvisning, parse-fejl, 4xx/5xx, netværksfejl, timeout) falder tilbage til `generatePlan()`.
- [x] **Default uger** — DONE. `DEFAULT_WEEKS = 12` server-side, og frontenden sender nu altid `plan_weeks` fra wizardens "Time available".
- [ ] **Progress Ring >100%** — Cap ring ved 100%; tillad km-log over planlagt

---

### Trin 2 — wizarden kalder /api/generate — DONE 2026-09-05
- [x] `generateBtn`-handleren kalder `/api/generate` og mapper svaret gennem `apiPlanToLocalPlan()`. Algoritmen er fallback.
- [x] Loading-skærmen venter på det ægte svar i stedet for `setTimeout(8000)`. Klient-timeout 95 sek (serveren bruger 40 sek pr. forsøg × 2 forsøg).
- [x] Double-submit forbliver umulig — hele viewet erstattes, så knappen findes ikke i DOM'en mens kaldet løber.

**Verificeret i browser mod en lokal stub-server:**
| Vej | Resultat |
|---|---|
| 200 OK | AI-plan, 12 uger, faser Title Case'et så de matcher fallback-planens |
| Request-body | `{"sport":"cykling","fitness_level":"Motionist","longest_session_km":60,"target_km":200,"sessions_per_week":4,"plan_weeks":12,"goal_event":"200 km cykelløb"}` |
| 500 | Fallback til algoritme + banner |
| 429 | Fallback + egen rate limit-besked |
| Netværksfejl | Fallback + banner |
| Hængende server | Afbrudt efter 95 sek, fallback + banner |
| 52 uger ønsket | AI-plan capped til 24 + banner der siger det |

Ingen console-fejl på nogen vej. Selve Anthropic-kaldet er stadig uverificeret — det kræver at nøglen er deployet.

### Sprogskifter DA/EN — DONE 2026-09-05
Knappen sidder fast i bundhøjre hjørne (`position:fixed`) og følger scrollen. `#app` har `padding-bottom:72px`, så den ikke dækker det sidste element i en visning.
Appen var halvt engelsk (landingsside, wizard) og halvt dansk (planvisning, coach-noter). Alle ~190 brugervendte strenge ligger nu i ét `I18N`-objekt med `t()`-opslag, og knappen i baren øverst skifter hele siden.

- [x] `I18N` med 192 nøgler pr. sprog — verificeret symmetrisk, alle `t()`-kald har en nøgle, ingen ubrugte
- [x] Valget gemmes i `localStorage` (`rf-lang`) og sætter `<html lang>`. Første besøg følger browserens sprog.
- [x] `SPORTS` (labels, tempo, ernæring, intervalskemaer) slår op i ordbogen — skifter live på en åben plan
- [x] `generatePlan()` skriver sessionsnavne, noter og faser på det valgte sprog
- [x] `/api/generate` tager `language` og har en engelsk prompt-variant, så AI-planens indhold følger sproget
- [x] Faser samlet om fælles nøgler, så en dansk AI-plan og en dansk algoritme-plan begge siger "Løbsuge" — ikke "Race Week" og "Løbsuge" side om side
- [x] "Recreational" → **"Intermediate"** i niveau-dropdownen (dansk: "Motionist")

**Kendt og bevidst:** planer beholder det sprog de blev lavet på. Sessionsnavne og coach-noter er data, ikke UI — AI-tekst kan ikke oversættes ved rendering. Al chrome (faner, statistik, faseforklaring, datoer, tempo/ernæring) skifter derimod live, også på gamle planer.

**To fejl fundet ved browsertest, ikke af syntakstjek:**
1. `generatePlan()` havde tre lokale variabler ved navn `t` (taper-løkker + ramp-beregning) som skyggede `t()` → "t is not a function" på hver eneste plangenerering. Alle seks `t`-variabler i filen er omdøbt.
2. En tidligere redigering havde overskrevet `reset_progress`/`delete_plan` plus otte nøgler, så Tal-fanen viste rå nøglenavne. Fanget af en nøgle-krydskontrol, ikke af øjet.

### Km-afrunding + sidste sprog-leftovers — DONE 2026-09-05
- [x] **Flydende-komma-støj i km-summer.** Fase-fremdriften viste `0/628.5999999999999 km`. Den lokale algoritme runder alt via `roundStep()`, men AI-planer returnerer frit valgte decimaler, så summerne samlede støj op. Ny `fmtKm()` runder til én decimal **kun ved visning** — planens data, `data-km`-attributter og km-inputfelter beholder de præcise tal. Anvendt alle 14 steder km vises.
- [x] **Hardcodet dansk fundet ved samme lejlighed:** "UGE"/"Uge"/"uger"/"sess." i ugekort, fase-meta og plan-oversigt. Min tidligere sweep missede dem, fordi teksten stod klods op ad `${}`-interpolationer og ikke matchede tekstnode-regexet. Nu i ordbogen (198 nøgler pr. sprog).
- [x] **`sportLabel` viste den rå ASCII-nøgle** med stort begyndelsesbogstav i plan-oversigten — løb blev til "Lob" og svømning til "Svomning", i begge sprog. Bruger nu `SPORTS[plan.sport].label`.

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
- [ ] **(trin 1, 2026-09-05) Prompt-valideringen skal køres igen.** De målte 93% (14/15) gælder den gamle prompt. `target_km` tilføjede to nye ting Haiku skal ramme: at planens længste session lander omkring 80% af målet, og at måldistancen gennemføres i sidste uge. Ingen af delene er målt. Tallet i prompten er beregnet i JS, ikke overladt til modellen — netop den lektie valideringen gav — men adfærden er stadig uverificeret.
- [ ] **(prompt-validering 2026-09-04)** Fase-tabellens regel for uge 17+ ("tilføj 1 BASE uge, maks 8 BASE uger totalt") er tvetydig for uger 21-24 — tabellen siger intet om hvad der sker når BASE-loftet er nået men planen stadig skal være længere. Nuværende implementering (`allocatePhases()` i CEO-planen) fortsætter bare med at forlænge BASE forbi loftet i stedet for at gætte på noget andet. Bør genbesøges med rigtig coaching-faglig input før B1 skibes.
- [ ] **(design-review 2026-09-04, FINDING-002)** Appen har kun ét reelt `<h1>` og ingen `<h2>`-`<h6>` nogen steder — sektionstitler ("My plans", "150 km cycling", fasenavne, "How it works") er alle styled `<div>`/`<p>`, ikke semantiske headings. Skader skærmlæser-navigation (ingen heading-outline at hoppe igennem). Ikke en CSS-only fix — kræver ændringer i hver `render*`-funktion. Fortjener en dedikeret gennemgang, ikke bundlet ind i en design-polish-omgang.

---

## ✅ Klaret

- [x] Deployed til Vercel: https://traeningsplan-app.vercel.app
- [x] /office-hours: design doc godkendt
- [x] /plan-ceo-review: CEO-plan skrevet
- [x] Projektmappe samlet i `/Users/jacobcompenskodt/06RANGE_FINDER`
