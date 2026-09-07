# Range Finder — Handoff
Sidst opdateret: 2026-09-07

## Hvad det er

En træningsplan-app til cykling, løb og svømning. Brugeren angiver sport, måldistance, niveau og enten et antal uger eller en løbsdato; Claude Haiku genererer en plan med faser, sessioner og coach-noter. Planen bor i browserens localStorage. Login er valgfrit: uden konto forlader planerne aldrig browseren, med konto spejles hele biblioteket til Supabase.

**Single-file SPA** — hele frontenden er `index.html` (3567 linjer, inkl. CSS og JS). Fire Vercel-funktioner i `api/`.

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
| Cloud sync (valgfrit login) | virker, **verificeret mod produktionsdatabasen** 2026-09-06 |
| Privatlivspolitik | live på `/privacy`, med rigtige selskabsoplysninger |
| Slet min konto | virker, verificeret: 204 og rækken væk via cascade |
| Skrifttyper | selvhostet, ingen Google i anmodningskæden |
| Opbevaringsregel (12 mdr.) | databasen er færdig og verificeret 7/7 — **afsenderen mangler tre env-variabler og et deploy**, se nedenfor |

**C er bygget og verificeret** — bortset fra opbevaringsreglen. Task 1-9 og 11 af `docs/superpowers/plans/2026-09-06-c-cloud-sync.md` er i produktion. Designet ligger i `docs/superpowers/specs/2026-09-06-c-cloud-sync-design.md`; læs den før du rører fletningen.

> **Politikken holder når afsenderen tændes, og ikke før.** `/privacy` siger at inaktive konti slettes efter 12 måneder med en advarsel efter 11.
>
> **Databasen er færdig** — anvendt og verificeret 2026-09-07: `pg_cron`, tabellen `retention_warnings`, viewet `retention_accounts` (én definition af "inaktiv", tre forbrugere), `sweep_inactive()`, `retention_warn_due()`, `retention_mark_warned()` og `retention_status()`. `supabase/verify-retention.sql` dækker syv konti, fire tællere og ét sweep: 7/7 og 4/4. Skemafilens fire funktionskroppe er `md5`-diffet mod `pg_proc.prosrc` og er byte-identiske med databasen.
>
> **Sletningen er spærret bag advarslen.** `sweep_inactive()` rører ikke en konto uden en advarsel på sig og 30 dage siden. Fejler afsenderen, bliver konsekvensen derfor at *ingenting* slettes — ikke at nogen slettes uden at have hørt fra os. Det er den rigtige retning at fejle i, men det er stadig et løfte der ikke holdes, så det er gjort tælleligt: **`retention_status().overdue_unwarned` skal være 0.** Stiger den, kører afsenderen ikke.
>
> **Afsenderen mangler tre env-variabler og et deploy.** `api/retention-warn.js` er skrevet og `vercel.json` har et dagligt cron-job kl. 04:00 UTC, men uden `RESEND_API_KEY`, `RESEND_FROM` og `CRON_SECRET` svarer endpointet `200` med `skipped` og et antal. Hverken endpointet eller cron-nøglen er verificeret mod produktion — der er ikke deployet. Se `TODOS.md`, *Kræver dig*, punkt 2.
>
> Rækkefølgen i endpointet er ikke til forhandling: **send først, registrér bagefter.** Omvendt ville en fejlet afsendelse tælle som en advarsel, og 30 dage senere ryger kontoen uden at nogen har hørt fra os.

**Og magic link virker kun for organisationens egne medlemmer.** Supabases indbyggede mailserver afviser alle andre adresser med `Email address not authorized` og har et loft på 2 mails i timen. Appen viser ingen fejl — brugeren får bare aldrig noget. Custom SMTP via Resend er derfor ikke valgfrit, og det er den eneste ting der spærrer for at nogen ud over Jacob kan logge ind. Se `TODOS.md` under C.

Resten af det åbne arbejde står i `TODOS.md`.

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

### Verificeret mod produktionsdatabasen 2026-09-06

Ikke med stub, men med to rigtige klienter mod den rigtige database:

| Trin | Resultat |
|---|---|
| Enhed A krydser `0_0` af og synkroniserer | version 3 |
| Enhed B sender `0_1` med **forældet** version 2 | serveren tvinges ned i fletningen |
| Fletning | `["0_0","0_1"]` — begge kryds overlevede, version 5 |
| Ugerne | 24 bevaret, ikke overskrevet af enhed B's tomme `weeks: []` |
| Enhed A genindlæser | henter enhed B's kryds, `0_0=8 km`, `0_1=15 km` |
| `DELETE /api/sync` | 204, og både bruger og bibliotek væk via cascade |

Den fjerde linje er lige så vigtig som den tredje: enhed B sendte et ældre `updatedAt`, og serveren beholdt sit indhold. Det er `updatedAt`-reglen der arbejder — feltet fandtes slet ikke i klienten indtil gennemgangen fandt det, så serveren vandt ved et tilfælde.

Den femte fandt en fejl: klienten **skubbede kun**. `syncNow` kørte ved nyt login og derefter kun når noget ændrede sig lokalt, så en anden enheds ændring var usynlig indtil denne skrev noget. Ved genindlæsning er `state.session` allerede sat, så `onAuthStateChange` læser det som "var logget ind i forvejen" og springer over. `init()` synkroniserer nu også når der allerede er en session.

### Opbevaringsreglen har én definition af "inaktiv", ikke tre

Viewet `retention_accounts` findes for at der kun er ét sted hvor det står hvad inaktiv betyder. Tre ting læser det: sweepet, statusopgørelsen og endpointet der sender advarslen. To definitioner ville drive fra hinanden, og drift her betyder enten at maile nogen der er aktiv eller at slette nogen der aldrig blev advaret.

To regler i det er værd at kende, fordi de ikke er åbenlyse:

**`warned_at >= inactive_since`.** Kommer en advaret bruger tilbage, hopper `inactive_since` frem forbi advarslen, og den gamle advarsel holder op med at tælle. En ny stilhed kræver en ny advarsel. Det er også derfor `retention_warnings` aldrig ryddes ved sync: det er ikke nødvendigt, og en `delete` inde i `sync_library()` ville være endnu en skrivning på den varme sti der kunne fejle i stilhed.

**`retention_warn_due()` stopper ikke ved 12 måneder.** Har afsenderen været nede, drifter konti forbi slettedatoen uadvarede, og et vindue der lukkede ved 12 måneder ville aldrig nå dem — de ville leve for evigt, og politikken ville i tavshed aldrig gælde dem. Den advarer alt der har været stille i 11 måneder eller mere uden en gyldig advarsel, og lader de 30 dage løbe derfra.

### RLS er slået til uden politikker

Fundet 2026-09-07 af Supabases advisor, bekræftet i `pg_policies`: `libraries` har `relrowsecurity` sat og **nul** politikker. De tre "own row"-politikker i `supabase/schema.sql` er aldrig blevet anvendt, og filen påstod det modsatte.

Det er ikke et hul. RLS uden politikker nægter anon og authenticated alt, og `/api/sync` går ind med service-rollen der springer RLS over — appen er upåvirket, og databasen er strammere end filen beskrev, ikke løsere. Politikkerne står kommenteret ud i filen nu, med hvorfor og hvornår de skal køres.

**Går en klient-side forespørgsel mod `libraries` en dag i stykker med en tilladelsesfejl, er det her det står.** Rettelsen er at køre de tre politikker. Den er ikke at slå RLS fra.

Det er samme fejlform som gate-lektionen nedenfor: et dokument der beskriver en form ingen har. Det er nu den anden gang i dette projekt, og begge gange var det ikke koden der var forkert, men troen på at filen og virkeligheden var i takt.

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

### Supabases SQL-editor ødelægger funktionskroppe — brug MCP i stedet
Editoren har en hjælper der automatisk tilføjer RLS på nyoprettede tabeller. Den holder ikke styr på `$`-citering, så den læser `end;` inde i en plpgsql-krop som slutningen på sætningen og klistrer sin egen linje ind **før** det afsluttende `$`:

```
end;
-- Added by Supabase: enable Row Level Security on newly created tables
ALTER TABLE cur_doc ENABLE ROW LEVEL SECURITY;
```

Den troede at `cur_doc` — en lokal variabel — var en tabel. Kroppen blev aldrig lukket, og `sync_library` blev aldrig oprettet, mens `create table` i samme kørsel gik fint fordi den ikke indeholder `$`.

Det kostede to fejldiagnoser. Først lød fejlen `function ... does not exist` selv om `pg_proc` viste en række, og bagefter rapporterede PostgREST den som *"not found in schema cache"* fordi rettighederne også manglede. **Får du den besked på en funktion du kan se i databasen, er det rettigheder, ikke cachen.**

Kør migrationer gennem Supabase-MCP'en (`.mcp.json` ligger i repoet, godkend med `/mcp`), ikke gennem dashboardets editor.

### `revoke ... from public` lukker også døren for service-rollen
`revoke all on function ... from public, anon, authenticated` er rigtigt: uden den kan enhver med anon-nøglen kalde en `security definer`-funktion med et fremmed `p_user_id`, og RLS stopper dem ikke. Men Postgres giver `EXECUTE` til `PUBLIC` som standard, og `service_role` arver den frem for at være superuser — så revoke'en tager rettigheden fra endpointet i samme greb. Der skal et eksplicit `grant execute ... to service_role` bagefter.

### Login slettede biblioteket
At registrere `onAuthStateChange` er det der får `detectSessionInUrl` til at hente tokenet ud af URL-fragmentet, og den fyrer med det samme. Lytteren stod tre linjer over `state.planIndex = await loadIndex()`, så login-synkroniseringen kørte mod et tomt indeks: der blev sendt et dokument uden planer, og svaret blev skrevet tilbage over `plans-index`. Planerne overlevede under deres egne nøgler, forældreløse og usynlige.

Nu læses biblioteket før auth wires, **og** et `libraryReady`-flag får `syncNow` til at udskyde — rækkefølgen alene er for skrøbelig, fordi lytteren kan fyre når som helst. `applyDoc` fjerner desuden aldrig en plan bare fordi svaret undlader den; det kræver en tombstone.

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
| `api/sync.js` | Fletningen som rene funktioner **plus** endpointet. Fletningen eksporteres, så gaten kører den rigtige kode |
| `scripts/validate-sync.mjs` | Gate for fletningen, 19 tilfælde, exit 0/1. Kør den før du rører fletningen |
| `supabase/schema.sql` | Tabel, RLS, `sync_library()` og opbevaringsreglen. Anvendes i hånden — der er intet migreringsværktøj, så filen og databasen holdes i takt manuelt |
| `supabase/verify-retention.sql` | Gate for opbevaringsreglen, syv konti og fire tællere i én transaktion. Rejser en fejl og ruller tilbage hvis et af dem svigter, og rydder op efter sig selv på vejen ud |
| `api/retention-warn.js` | Advarselsmailen. Dagligt Vercel-cron-job. Send først, registrér bagefter. No-op uden Resend-nøglen |
| `privacy.html` | Privatlivspolitik. Ruten `/privacy` skal ligge **før** filsystem-fasen |
| `fonts/` | Selvhostede woff2. Google Fonts sender besøgendes IP til Google |
| `.mcp.json` | Supabase-MCP. Godkend med `/mcp`. Brug den frem for dashboardets SQL-editor |
| `docs/superpowers/specs/` | Design-specs. C ligger i `2026-09-06-c-cloud-sync-design.md` |
| `vercel.json` | Routing. Bruger det gamle `builds`-format — `functions` og `builds` udelukker hinanden. catch-all'en skal blive stående som `/(?!_vercel/)(.*)`, ellers sluger den `/_vercel/*` |
| `.vercelignore` | Vercel læser ikke `.gitignore` |
| `TODOS.md` | Opgaveliste med begrundelser og fravalg |
| `CLAUDE.md` | Instruktioner til AI-assistenter i dette repo |
