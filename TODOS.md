# Range Finder — TODO
Sidst opdateret: 2026-09-04

---

## 🔴 Gør nu

- [x] **BLOKERENDE: Ret ANTHROPIC_API_KEY** — LØST 2026-09-05. `ANTHROPIC_WORKSPACE_ID` sat i Vercel (Production), `api/scan.js` fik samme header. Verificeret med tre ægte kald i produktion mod dansk, engelsk og alle tre sportsgrene — se HANDOFF.md.
- [x] **Prompt-validering kørt igen** — 2026-09-05, efter måldistance + engelsk variant. **15/16 gyldige (94%)**, 14/16 i første forsøg. Ingen regression fra de 93% før ændringerne. Kør igen med `node scripts/validate-generate.mjs`.
- [x] **`scripts/validate-generate.mjs` skrevet** — den udskudte opgave fra eng-review. Kalder Anthropic direkte med endpointets egne funktioner (importeret, ikke kopieret), så rate limiten ikke er i vejen. 16 samples på tværs af sportsgrene, niveauer, planlængder og begge sprog. Exit-kode 0/1, så den kan bruges som gate.
- [x] **`max_tokens` var sat 16x for lavt** — RETTET 2026-09-05. Koden brugte 4096; Haiku 4.5's reelle loft er **64000** (bekræftet med `client.models.retrieve`, ikke antaget — det lukker det åbne spørgsmål i HANDOFF). Lange planer bruger op til 4693 output-tokens, så de blev trunkeret. Hævet til 16000 (SDK'ets anbefaling for ikke-streamende kald). Efter ændringen optræder `stop_reason: max_tokens` ikke længere i nogen kørsel. Det koster intet ekstra — man betaler pr. genereret token, ikke pr. loft.
- [x] **Cap på antal sessioner** — DONE 2026-09-05. `MAX_TOTAL_SESSIONS = 100` i `api/generate.js`. Over grænsen springes Claude-kaldet helt over og der returneres `422 plan_too_large` med tallene; frontenden falder tilbage til algoritmen og siger hvorfor. Fejler på ~200 ms i stedet for ~35 sek.

  Grænsen går på **sessioner, ikke uger** — `24u × 4 = 96` slipper igennem, mens `17u × 6 = 102` afvises. En ugebaseret cap ville have afvist den første, som målte 3/3.

  **Jeg flyttede den kortvarigt til 90 og rullede det tilbage.** Gate-sample #06 (20u × 5 = 100) havde fejlet 3 af 4 kørsler, hvilket lignede et argument. Men `24u × 4` er også 96 sessioner og målte 3/3, så 90 ville udelukke en form der beviseligt virker — på styrken af én konfiguration. Ved n=3 kan 2/3 og 3/3 ikke skelnes. Efterfølgende kørsel gav **16/16**, inklusive #06. Fejlene var støj.

  Data understøtter: 120+ fejler ofte (2 af 9), 108 og derunder holder mest (11 af 12). 100 ligger bevidst inde i det usikre bånd — fallbacken er hurtig og pæn, så det koster mindre at være rundhåndet end at afvise planer modellen klarer fint.

- [ ] **Måldistance-heuristikken rammer 12/13** (ekskl. 1-ugers planer, hvor der ikke er nogen opbygning at måle). Ratio længste træning / forventet 80%: mest 1,0, med enkelte på 0,63-0,75 og én på 1,25. God nok, men ikke præcis.
- [x] **Aliaset er automatiseret** — DONE 2026-09-05. `rangefinderapp.vercel.app` er sat til *Connect to an environment → Production* i projektindstillingerne og følger nu nyeste produktions-deploy af sig selv. Verificeret: domænet serverer ring, løbsdato, ernæring, ordliste og DST-rettelsen, og API'et svarer 200. **Kør aldrig `vercel alias set` på det domæne igen** — det ville pinne det forfra.
- [x] **`icon.svg` route** — DONE 2026-09-05. Tilføjet til både `builds` og `routes` i `vercel.json`, før catch-all-routen. Verificeres først når det er deployet.

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
- [x] **Løbsdato** — DONE 2026-09-05. `race_date` var allerede fuldt implementeret server-side (validering, dato-i-fortiden, ugeudregning, capping ved 24) men blev aldrig sendt fra frontenden — nul forekomster i index.html. Nu et valgfrit datofelt i wizarden: sættes det, viser hintet "≈ N uger til løbsdagen" live, "Tid til rådighed" dæmpes og deaktiveres, og `race_date` sendes i stedet for `plan_weeks`. Ryddes datoen, træder dropdownen til igen. Datoen gemmes som `plan.raceDate`, og algoritme-fallbacken bruger samme ugetal, så en fejlet AI-plan ikke pludselig får en anden længde.

  **DST-fejl fundet undervejs:** `Math.ceil((dato - i_dag)/uge_i_ms)` gav 11 uger for 70 dage, fordi Danmark skifter fra CEST til CET undervejs — 70 dage er 70 dage plus én time i millisekunder. Rettet begge steder til at tælle hele dage først (`Math.round(diff/86400000)`), så klient og server er enige. 7 og 14 dage var korrekte i forvejen, fordi de ikke krydser skiftet.
- [x] Plan-rendering: coach_note vises nu kursivt under sessionsnavnet i PLAN-fanen — DONE 2026-09-05. Den lå kun i den udfoldede detalje, så hele pointen med AI-planer krævede et klik pr. session. Fjernet fra detaljen så den ikke står to steder. Dæmpes til 50% når sessionen er krydset af. Algoritme-planers tekniske noter ("intervaller: 3x10 min sweet spot") vises samme sted; sessioner uden note får ingen linje.
- [x] **Ernæring pr. session** — DONE 2026-09-05. Den gamle `nutritionFn` var abstrakt ("60-90 g kulhydrat i timen") og lå gemt i den udfoldede detalje. Erstattet af `fuelFor()` med konkrete bånd pr. sport: "1 flaske + en banan", "2 flasker + 2-3 barer", "planlæg et madstop". Hvert bånd har tre dele — `short` til plan-listen, `during` til detaljen, og `before` (kun på lange træninger) med hvad man skal spise **inden**. Deterministisk kode, ikke AI, så den virker også på algoritme-planer og koster hverken tokens eller ventetid.
- [x] **Ordliste i "Faser og begreber"** — DONE 2026-09-05. Panelet forklarede kun faserne, men planen er fuld af fagsprog ingen havde defineret. Tilføjet RPE, Zone 2, sweet spot, tærskel, gel og carb-load. Titlen er ændret fra "Hvad betyder faserne?" da panelet nu dækker begge dele.
- [x] **I DAG-tab: Progress Ring** — DONE 2026-09-05. SVG-ring over ugenavigationen, så den summerer præcis den uge stripen viser. `weekProgress()` læser `plan.progress` og `plan.extras` — ingen ny localStorage-struktur (eng-review-fundet). Skjules når ugen hverken har planlagte eller loggede km.
- [x] ~~I DAG-tab: km-loginput~~ — STRØGET 2026-09-05, begge tilfælde er allerede dækket. **Planlagt træning:** `todayActKm` i dagens kort (og samme felt i PLAN-fanens detalje) skriver til `plan.progress[key].actualKm`. **Uplanlagt træning:** `plan.extras` via "+ Tilføj ekstra træning", som ligger permanent nederst på I DAG med navn, km og valgfrit screenshot. Der er ikke et hul at fylde — byg ikke et tredje input.
- [x] Loading state under generering: knap disables + spinner + "Din AI-coach tænker..." — DONE 2026-09-04, 45 sek med roterende undertekst, se HANDOFF.md
- [x] **Fallback-besked** — DONE 2026-09-05. Gult banner øverst på PLAN-viewet. Tre varianter: generel fallback, rate limit (429), og capped plan. Banneret gemmes bevidst ikke på planobjektet — det beskriver hvad der lige skete, ikke hvad planen er.
- [→] **Email-felt flyttet til C** (2026-09-05). Teksten lover "gemmes når du logger ind", men der er intet login før C. Dybere: en email i localStorage gør ikke migreringen lettere, for sign-in-flowet spørger alligevel om den. Feltet ville være indsamling uden modtager. Bygges sammen med magic link auth.

### Fejl der SKAL fixes inden kode skrives
- [x] **Double-submit** — DONE 2026-09-04, knappen fjernes fra DOM'en under de 45 sek loading-skærm, umuligt at trykke igen
- [x] **Model refusal** — DONE 2026-09-05. Alt der ikke er en gyldig plan (afvisning, parse-fejl, 4xx/5xx, netværksfejl, timeout) falder tilbage til `generatePlan()`.
- [x] **Default uger** — DONE. `DEFAULT_WEEKS = 12` server-side, og frontenden sender nu altid `plan_weeks` fra wizardens "Time available".
- [x] **Progress Ring >100%** — DONE 2026-09-05. Buen cappes ved fuld cirkel, men tallet viser det rigtige: 300 km logget mod 60 planlagt står som 500%. Gennemførte ekstra-træninger tæller med i logget, hvilket er hele grunden til at cappen skal være der.

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

- [x] ~~Haiku max_tokens 4096 kan truncere~~ — RETTET 2026-09-05. Bekymringen var korrekt, men årsagsforklaringen var kun halvt rigtig: 4096 trunkerede fra ~22 uger x 6 sessioner, og loftet er hævet til 16000 (Haikus reelle grænse er 64000). Cappen bør sættes på **antal sessioner, ikke uger** — se punktet under "Gør nu".
- [x] ~~Prompt injection via `goal_event`~~ — allerede implementeret. `GOAL_EVENT_MAX_CHARS = 200` afkorter server-side i `api/generate.js`. Feltet fyldes desuden af wizardens egne tal, ikke af fri brugertekst.
- [x] **localStorage QuotaExceededError** — DONE 2026-09-05. Der *var* et try/catch i `savePlan()`, men det slugte fejlen, så brugeren mistede sin plan uden at få det at vide. Værre: shimmen kaldte `Promise.resolve(localStorage.setItem(...))`, og `setItem` kaster **synkront** når kvoten er fuld — så fejlen slap ud før der overhovedet fandtes en promise. Shimmen returnerer nu en afvist promise, `savePlan()`/`saveIndex()` returnerer true/false, og en fejl viser en rød advarsel. Advarslen ligger uden for render-cyklussen (savePlan kaldes ~10 steder, og et re-render ville tørre et in-app-banner væk), vises kun én gang ad gangen, og kan lukkes.
- [ ] **(eng-review 2026-09-04)** Opgrader rate limiting til Vercel Firewall når/hvis in-memory Map bliver utilstrækkelig (reelt misbrug, eller når appen har betalende brugere). B1 bruger bevidst in-memory Map (matcher scan.js) — dette er kun en fremtidig genbesøg, ikke en aktuel mangel.
- [x] ~~Skriv `scripts/validate-generate.mjs`~~ — DONE 2026-09-05. Kalder Anthropic direkte med endpointets egne funktioner, uden om rate limiten. Exit 0/1 så den kan bruges som gate. Kør: `node scripts/validate-generate.mjs`.
- [x] ~~Prompt-valideringen skal køres igen~~ — KØRT 2026-09-05 efter både måldistance og engelsk variant. **15/16 (94%)**, ingen regression fra de 93%. Sprog korrekt på alle gyldige planer, måldistance-heuristikken 12/13.
- [ ] **(prompt-validering 2026-09-04)** Fase-tabellens regel for uge 17+ ("tilføj 1 BASE uge, maks 8 BASE uger totalt") er tvetydig for uger 21-24 — tabellen siger intet om hvad der sker når BASE-loftet er nået men planen stadig skal være længere. Nuværende implementering (`allocatePhases()` i CEO-planen) fortsætter bare med at forlænge BASE forbi loftet i stedet for at gætte på noget andet. Bør genbesøges med rigtig coaching-faglig input før B1 skibes.

  **Kan ikke løses uden en træner.** Kandidatregel: forlæng BUILD i stedet for BASE når BASE rammer loftet på 8. Det er et gæt, ikke fagligt funderet — og præcis den slags hvor et forkert gæt ser rigtigt ud. Spørg en rigtig coach før det implementeres.
- [ ] **(design-review 2026-09-04, FINDING-002)** Appen har kun ét reelt `<h1>` og ingen `<h2>`-`<h6>` nogen steder — sektionstitler ("My plans", "150 km cycling", fasenavne, "How it works") er alle styled `<div>`/`<p>`, ikke semantiske headings. Skader skærmlæser-navigation (ingen heading-outline at hoppe igennem). Ikke en CSS-only fix — kræver ændringer i hver `render*`-funktion. Fortjener en dedikeret gennemgang, ikke bundlet ind i en design-polish-omgang.

  **Løsning:** en fokuseret omgang gennem hver `render*`-funktion der giver sektionstitler rigtige `<h2>`-`<h4>`. Skal ikke smugles ind i en anden opgave — det rører hele UI-laget.

---

## ✅ Klaret

- [x] Deployed til Vercel: https://traeningsplan-app.vercel.app
- [x] /office-hours: design doc godkendt
- [x] /plan-ceo-review: CEO-plan skrevet
- [x] Projektmappe samlet i `/Users/jacobcompenskodt/06RANGE_FINDER`
