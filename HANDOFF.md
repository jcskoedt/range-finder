# Range Finder — Handoff
Sidst opdateret: 2026-09-06

## Hvad det er

En træningsplan-app til cykling, løb og svømning. Brugeren angiver sport, måldistance, niveau og enten et antal uger eller en løbsdato; Claude Haiku genererer en plan med faser, sessioner og coach-noter. Planen bor i browserens localStorage. Ingen konti, ingen server-database.

**Single-file SPA** — hele frontenden er `index.html` (3114 linjer, inkl. CSS og JS). Tre Vercel-funktioner i `api/`.

---

## Status: B1 og B2 er færdige og i produktion

**Live:** https://rangefinderapp.vercel.app

| | |
|---|---|
| AI-plangenerering | virker, dansk og engelsk |
| Replan efter sprungne uger | virker — **rettet 2026-09-06, havde aldrig virket i produktion** |
| Screenshot-import (Strava m.fl.) | virker |
| Del plan som link | virker |
| Kalender-eksport (.ics) | virker |
| Sprogskifter DA/EN | hele appen, inkl. AI-output |
| Valideringsgate | 16/16 |
| Måling (Vercel Web Analytics) | virker, verificeret i produktion 2026-09-06 |
| Cloud sync (valgfrit login) | virker, deployet 2026-09-06 — fletning ubekræftet med to rigtige browsere |

Tilbage: **C** (konti + cloud sync) og en håndfuld mindre punkter — se `TODOS.md`.

C er designet færdigt: `docs/superpowers/specs/2026-09-06-c-cloud-sync-design.md`. Ti beslutninger, datamodel, fletteregler og testtilfælde. Læs den før du rører C.

Målingen kører. Verificeret i produktion 2026-09-06: `/_vercel/insights/script.js` svarer `200 application/javascript`, 3106 bytes — det rigtige script, ikke SPA'en. Det bekræfter både routing-rettelsen og at toggle'en er sat, for edge injicerer kun scriptet når Web Analytics er slået til.

---

## Kom i gang

### Deploy
```bash
git push origin main      # udløser automatisk et deploy
```
Det er alt. `rangefinderapp.vercel.app` er sat til *Connect to an environment → Production* i Vercels projektindstillinger og følger nyeste produktions-deploy af sig selv.

> **Kør aldrig `vercel alias set` på det domæne.** Det pinner domænet til én bestemt deployment, og så serverer det gammel kode uden at nogen opdager det. Det skete tre gange den 5. september 2026, og hver gang gik der tid med at lede efter en fejl der ikke fandtes.

`traeningsplan-app.vercel.app` svarer stadig (gammelt projektnavn) men skal ikke bruges.

### Test at det virker
```bash
curl -s -m 90 -X POST https://rangefinderapp.vercel.app/api/generate \
  -H "Content-Type: application/json" \
  -d '{"sport":"lob","fitness_level":"Motionist","longest_session_km":10,"target_km":42,"plan_weeks":4,"goal_event":"maraton","language":"da"}'
```
Skal give en JSON-plan med fire uger. Tager 7-15 sek.

### Prompt-validering — kør før du ændrer i prompten
```bash
ANTHROPIC_API_KEY=... node scripts/validate-generate.mjs
```
16 samples på tværs af sportsgrene, niveauer, planlængder og begge sprog. Exit 0/1, så den kan bruges som gate. Senest **16/16**.

```bash
node scripts/sweep-plan-length.mjs        # find hvor lange planer knækker
```

### Lokal udvikling
Der er ingen build. Åbn `index.html` direkte, eller server mappen. API-kald virker kun mod produktion, da nøglerne kun findes i Vercels **Production**-miljø — vil du teste lokalt, så tilføj dem til `development` og kør `vercel env pull`.

---

## Arkitektur

```
index.html            hele UI'et: state, render-funktioner, i18n, plan-algoritme
  ├── I18N            126 nøgler pr. sprog, da + en
  ├── generatePlan()  lokal algoritme — fallback når AI fejler
  └── fetch → api/

api/generate.js       plan fra bunden        (419 linjer)
api/replan.js         justér efter pause     (220) — importerer fra generate.js
api/scan.js           screenshot → sessioner  (99)
```

### Sådan hænger en plangenerering sammen

1. Wizarden sender `{sport, fitness_level, longest_session_km, target_km, sessions_per_week, plan_weeks|race_date, goal_event, language}`
2. Serveren regner **faserne ud i kode** (`allocatePhases()`) og fortæller modellen præcis hvilken fase hver uge har
3. Claude udfylder kun sessionsindhold — navne, km, coach-noter
4. `validatePlan()` afviser alt der ikke matcher: forkert ugetal, ændret fase, forkert tuple-form
5. Fejler det, prøves én gang til; fejler det igen, falder frontenden tilbage til `generatePlan()` og fortæller brugeren hvorfor

### Nøglekonstanter (`api/generate.js`)
```
MODEL                claude-haiku-4-5-20251001
MAX_TOKENS           16000     (modellens reelle loft er 64000)
MAX_WEEKS            24
MAX_TOTAL_SESSIONS   100       uger × sessioner/uge — derover afvises AI-vejen
CLAUDE_TIMEOUT_MS    40000     pr. forsøg, to forsøg
RATE_LIMIT           5         pr. IP pr. time, in-memory
PEAK_FRACTION        0.8       længste træning ≈ 80% af måldistancen
```

---

## Måling

Vercel Web Analytics, cookieless. Shim og script-tag ligger øverst i `<body>`; alle events går gennem `track()` i `index.html`, som er pakket ind i try/catch — en adblocker eller et koldt deploy må aldrig kaste midt i at gemme en plan.

| Event | Data | Hvad det svarer på |
|---|---|---|
| `plan_generated` | `source` (ai/algorithm), `sport`, `weeks`, `sessions_per_week`, `lang` | Bliver der overhovedet lavet planer? |
| `plan_fallback` | `reason` | Hvor tit betales der for AI-output som ingen ser |
| `session_logged` | `week_idx`, `source` | Gate 0, og AI vs. algoritme over tid |
| `replan_used` | `weeks_rewritten` | Bruges B2 |
| `plan_shared` | — | Spredes planer |
| `plan_exported` | `events` | Virker .ics-eksporten |

`reason` holdes til et lille fast sæt: `timeout`, `http_429`, `plan_too_large`, `http_error`, `network`, `malformed`. Rå statuskoder ville sprøjte engangsværdier ud i dashboardet og svare på ingenting.

Ingen fritekst, ingen km-værdier, ingen datoer, intet id. Der er ikke persondata i det.

To ting der er nemme at få galt og allerede er håndteret: at fjerne et kryds logger ingenting, og log-knappen renderes kun for sessioner der ikke er færdige, så en session kan ikke tælles to gange.

## Cloud sync

Valgfrit login. localStorage er stadig det primære lager og skrives altid først; skyen er et spejl der kun tilføjer en sikkerhedskopi. Appen virker uændret uden konto.

| Fil | Rolle |
|---|---|
| `api/sync.js` | Fletningen som rene funktioner, plus `POST /api/sync`. Fletningen eksporteres, så gaten kører den rigtige kode |
| `scripts/validate-sync.mjs` | 19 konfliktsituationer, exit 0/1. **Kør den før du rører fletningen** |
| `supabase/schema.sql` | Tabellen, RLS og `sync_library()`. Anvendes i hånden — intet migreringsværktøj |

**Hele biblioteket er ét jsonb-dokument pr. bruger.** Ingen relationer, fordi der aldrig forespørges på tværs af planer eller brugere.

**Fletteregler:** fremdrift pr. session, seneste `at` vinder. Post uden `at` tæller som ældst. Tombstone på én af siderne fjerner planen — sletning er endelig. Ellers vinder den plan med seneste `updatedAt` indholdet, og fremdrift flettes på tværs uanset hvilken side det var.

**Migrering er ingen kode.** Første login er den første synkronisering mod et tomt dokument.

### Det der kan tabe data, og hvordan det er hegnet

Fletningen er den ene del af C der fejler i stilhed — en bruger opdager ikke at en session forsvandt, de tror de huskede forkert. Derfor er den rene funktioner testet uden browser og uden database.

**Kapløbet mellem debounce og svar** er det skarpeste. Klienten må ikke bare erstatte sit bibliotek med svaret: skriver brugeren mens kaldet er undervejs, ville svaret slette det før det var sendt. Hver lokal skrivning hæver `localRev`, værdien fanges ved afsendelse, og svaret anvendes kun hvis den ikke har flyttet sig. Ellers kasseres svaret, `syncBaseVersion` bliver stående så næste runde stadig fletter, og der planlægges en ny.

**`applyDoc` er hegnet med `applyingRemote`,** fordi den skriver gennem `savePlan` og ellers ville tælle sine egne skrivninger mod den tæller den sammenlignes med.

**Fire fejl fundet ved en adversarisk gennemgang 2026-09-06**, alle lukket: `updatedAt` fandtes slet ikke i klienten så serveren altid vandt planindholdet; screenshot-importen var et syvende ustemplet skrivested; tombstone-reglen valgte den ældste dato og lod udløbet fjerne den, så en sletning begge sider var enige om forsvandt; og nulstil-fremdrift kunne ikke repræsenteres i en foreningsmængde.

Den vigtigste lektie er ikke fejlene, men at **gaten skjulte den første.** Alle plan-tests gav et eksplicit `updatedAt` med, så den beviste noget om en dokumentform ingen havde. En gate der tester data der ikke findes, er værre end ingen gate, fordi den bliver troet.

### Mailen er den skjulte forudsætning

Supabases indbyggede mailserver sender **kun til medlemmer af projektets egen organisation**, med et loft på 2 i timen. Magic link virker derfor perfekt når du tester på dig selv og fejler for hver rigtig bruger, med `Email address not authorized` og ingen synlig fejl i appen. Custom SMTP via Resend er ikke valgfrit. Kilde: supabase.com/docs/guides/auth/auth-smtp.

## Det der kostede tid — læs dette før du ændrer noget

### Faser skal beregnes i kode, ikke af modellen
Den oprindelige prompt havde fasetabellen som prosa og lod Claude selv tælle uger: **4 af 15 samples bestod**. Flyttet til `allocatePhases()` i kode, hvor modellen får fasen for hver uge udleveret: **14 af 15**. Samme lektie gælder `api/replan.js`, hvor faserne er låst og valideres uændrede tilbage.

**Enhver ny AI-funktion i dette projekt skal følge samme mønster:** struktur i kode, indhold fra modellen.

### Lange planer taber uger
Over ~100 sessioner (uger × sessioner/uge) returnerer Haiku det forkerte antal uger — `stop_reason: end_turn`, ikke trunkering, og et retry redder det ikke. Derfor `MAX_TOTAL_SESSIONS`. Grænsen går på **sessioner, ikke uger**: 24 uger × 3 virker fint, 17 × 6 gør ikke.

### Legacy `routes` springer filsystemet over — catch-all'en slugte analytics-scriptet
`vercel.json` bruger `builds` og dermed legacy `routes`, og de tjekker ikke filsystemet af sig selv. Derfor de eksplicitte ruter til `logo.png`, `icon.svg` og resten — og derfor slugte SPA-catch-all'en `/_vercel/insights/script.js` og serverede `index.html` i stedet. Målt før rettelsen: 200, `text/html`, 144661 bytes, præcis som en ukendt sti.

Browseren ville have parset hele SPA'en som JavaScript, og målingen ville aldrig have virket — uden en fejl nogen steder. Samme familie som "alle `/api/*` gav 404 siden første commit".

`{ "handle": "filesystem" }` før catch-all'en var det første forsøg, og **det var ikke nok:** filsystem-fasen matcher kun rigtige filer i build-outputtet, og insights-scriptet injiceres af edge, så den matchede aldrig. Rettelsen er at udelukke præfikset i catch-all'en selv — `"src": "/(?!_vercel/)(.*)"` — for det afhænger ikke af den forskel.

Tjek en platform-sti sådan her, ikke ved at kigge på konfigurationen:
```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
  https://rangefinderapp.vercel.app/_vercel/insights/script.js
```
HTML betyder at en rute sluger den. De seks eksplicitte statiske ruter er overflødige nu, men står der stadig.

### Replan havde aldrig virket — to fejl der skjulte hinanden
Fundet 2026-09-06 ved at teste `replan_used`-eventet ende til ende. Endpointet havde ligget i produktion i et døgn uden nogensinde at svare 200.

**Fasen er en visningstekst, ikke en nøgle.** `runReplan` sendte `plan.weeks[i].phase` direkte videre, men den streng er lokaliseret, blok-nummereret og nogle gange suffikset: "Base 1", "Build 2 · restitution", "Løbsuge". Serveren validerer mod `BASE / BUILD / PEAK / TAPER / RACE WEEK`, så hver eneste replan blev afvist med 400 før den nåede modellen. `toUpperCase()` ville ikke have hjulpet — den danske løbsuge hedder "Løbsuge". Ugerne bærer nu `phaseKey` ved siden af `phase`.

**Sessionsantal er pr. uge, ikke pr. plan.** Serveren udledte ét tal og krævede at hver returneret uge havde præcis så mange sessioner. Men en løbsuge har legitimt færre end en build-uge. Målt mod produktion før rettelsen: sender man `[3,3,2]` ind, kommer `[3,3,3]` retur med status 200 — løbsugen får lydløst en session den ikke skulle have. Sender man `[4,3,2]`, afvises svaret to gange og ender som 500 efter to betalte kald. Hvilken af de to man rammer er ikke deterministisk, for det afhænger af om modellen adlyder instruktionen eller spejler sit input.

Lektien er fasetabellens, en etage dybere: **struktur i kode, og strukturen skal have den rigtige granularitet.** Ét sessionstal for hele planen var forkert på præcis samme måde som én prosatabel for alle uger var det.

### Vercel læser ikke `.gitignore`
Uden `.vercelignore` uploades hele mappen. En 130MB fil i en urelateret mappe væltede et deploy med *"File size limit exceeded (100 MB)"*.

### `vercel --prod` kan sige "Not authorized" og alligevel deploye
Skete 5. september: CLI'en fejlede med exit 1, men deploymentet lå `Ready` i produktion. **Tjek `vercel ls rangefinderapp` før du fejlsøger en "fejlet" deploy.**

### Tidszoner og sommertid
`Math.ceil((dato - i_dag) / uge_i_ms)` gav 11 uger for 70 dage, fordi Danmark skifter CEST→CET undervejs — 70 dage er 70 dage *plus en time*. Tæl hele dage først: `Math.round(diff / 86400000)`. Både `weeksUntil()` i index.html og serveren gør det nu.

### Clipboard mister tilladelsen når du venter
`navigator.clipboard.writeText()` kræver at klikket stadig tæller som brugerhandling. Ventede vi på gzip-komprimeringen først, var tilladelsen brugt op og kopieringen fejlede altid. Delelinket forudberegnes nu ved render, så klikket kopierer synkront.

### Flyt aldrig markup uden dens wiring
Screenshot-importen blev engang efterladt uden `wireUploadArea()`, og `api/scan.js` var uopnåelig fra UI'et uden at nogen opdagede det. Da boksen blev flyttet fra PLAN- til Kalender-fanen, fulgte kaldet med.

---

## Uløste beslutninger

1. **Er AI-planer bedre end algoritme-planer?** CEO-planen stiller spørgsmålet og besvarer det ikke. Der er endnu ikke én rigtig bruger der har gennemført en plan. **Det bør afgøres før C** — C er det dyreste stykke arbejde i planen og svært at rulle tilbage, når der først ligger brugerdata i en database.

   Målingen kører nu i produktion. Når der er data, er `session_logged` delt på `source` det tætteste svar uden at spørge folk: krydser AI-brugere flere sessioner af over flere uger end algoritme-brugere, betyder planen noget. CEO-planens Gate 0 — fem rigtige brugere der laver en plan og logger en session — aflæses på `plan_generated` og `session_logged`.
2. **Fase-tabellens hul for uge 21-24.** Reglen siger "tilføj 1 BASE-uge, maks 8 BASE-uger totalt", men ikke hvad der sker når loftet er nået og planen skal være længere. Koden forlænger bare BASE videre. Kræver en rigtig coach — en kandidatregel er at forlænge BUILD i stedet, men det er et gæt.
3. ~~**Sikkerhed ved C.**~~ Genbesøgt og afgjort 2026-09-06: implicit flow beholdes, PKCE fravalgt bevidst. Det forpligter til `Cache-Control: no-store` på `index.html`, ellers kan en cachet side med et token i hashet nå den forkerte browser. Se specen.

---

## Reviews

| Review | Status | Rapport |
|---|---|---|
| CEO | issues_open (scope besluttet) | `~/.gstack/projects/traeningsplan-app/ceo-plans/2026-09-03-ai-plan-generation.md` |
| Eng | CLEARED, 9/9 løst | samme fil, nederst |
| QA-only | 97/100 | `.gstack/qa-reports/qa-report-range-finder-2026-09-04.md` |
| Design | B+ / AI Slop: A | `~/.gstack/projects/jcskoedt-range-finder/designs/design-audit-20260904/` |

Design-reviewets FINDING-002 (manglende overskriftssemantik) er lukket 2026-09-05.

---

## Arbejdsgang

**Alt laves og committes lokalt. Der pushes og deployes kun når Jacob eksplicit siger til.**

**Koster noget mere end $0,24 i API-credits, så spørg først** — antal kald, model, beløb. Under grænsen: kør bare, og nævn prisen bagefter. Tællingen er kumulativ inden for en opgave.

| | Pris | Kræver ja? |
|---|---|---|
| `scripts/validate-generate.mjs` | $0,25 | **ja** |
| `scripts/sweep-plan-length.mjs` | $0,45 | **ja** |
| Én plan mod `/api/generate` | $0,01 | nej |

Kald der afvises før modellen (400, 422, 429) og alt mod den lokale stub-server koster ingenting. Begge regler står uddybet i `CLAUDE.md`.

---

## Nøglefiler

| Fil | Formål |
|---|---|
| `index.html` | Hele frontenden — UI, i18n, lokal plan-algoritme |
| `api/generate.js` | Plangenerering. Deler konstanter og helpers med replan |
| `api/replan.js` | Justering efter sprungne uger |
| `api/scan.js` | Screenshot → aktiviteter |
| `scripts/validate-generate.mjs` | Prompt-gate, 16 samples, exit 0/1 |
| `scripts/sweep-plan-length.mjs` | Finder hvor lange planer knækker |
| `docs/superpowers/specs/` | Design-specs. C ligger i `2026-09-06-c-cloud-sync-design.md` |
| `vercel.json` | Routing. Bruger det gamle `builds`-format — `functions` og `builds` udelukker hinanden. catch-all'en skal blive stående som `/(?!_vercel/)(.*)`, ellers sluger den `/_vercel/*` |
| `.vercelignore` | Vercel læser ikke `.gitignore` |
| `TODOS.md` | Opgaveliste med begrundelser og fravalg |
| `CLAUDE.md` | Instruktioner til AI-assistenter i dette repo |
