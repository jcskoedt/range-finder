# Range Finder — Handoff
Sidst opdateret: 2026-09-06

## Hvad det er

En træningsplan-app til cykling, løb og svømning. Brugeren angiver sport, måldistance, niveau og enten et antal uger eller en løbsdato; Claude Haiku genererer en plan med faser, sessioner og coach-noter. Planen bor i browserens localStorage. Ingen konti, ingen server-database.

**Single-file SPA** — hele frontenden er `index.html` (3034 linjer, inkl. CSS og JS). Tre Vercel-funktioner i `api/`.

---

## Status: B1 og B2 er færdige og i produktion

**Live:** https://rangefinderapp.vercel.app

| | |
|---|---|
| AI-plangenerering | virker, dansk og engelsk |
| Replan efter sprungne uger | virker |
| Screenshot-import (Strava m.fl.) | virker |
| Del plan som link | virker |
| Kalender-eksport (.ics) | virker |
| Sprogskifter DA/EN | hele appen, inkl. AI-output |
| Valideringsgate | 16/16 |

Tilbage: **C** (konti + cloud sync) og en håndfuld mindre punkter — se `TODOS.md`.

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

## Det der kostede tid — læs dette før du ændrer noget

### Faser skal beregnes i kode, ikke af modellen
Den oprindelige prompt havde fasetabellen som prosa og lod Claude selv tælle uger: **4 af 15 samples bestod**. Flyttet til `allocatePhases()` i kode, hvor modellen får fasen for hver uge udleveret: **14 af 15**. Samme lektie gælder `api/replan.js`, hvor faserne er låst og valideres uændrede tilbage.

**Enhver ny AI-funktion i dette projekt skal følge samme mønster:** struktur i kode, indhold fra modellen.

### Lange planer taber uger
Over ~100 sessioner (uger × sessioner/uge) returnerer Haiku det forkerte antal uger — `stop_reason: end_turn`, ikke trunkering, og et retry redder det ikke. Derfor `MAX_TOTAL_SESSIONS`. Grænsen går på **sessioner, ikke uger**: 24 uger × 3 virker fint, 17 × 6 gør ikke.

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
2. **Fase-tabellens hul for uge 21-24.** Reglen siger "tilføj 1 BASE-uge, maks 8 BASE-uger totalt", men ikke hvad der sker når loftet er nået og planen skal være længere. Koden forlænger bare BASE videre. Kræver en rigtig coach — en kandidatregel er at forlænge BUILD i stedet, men det er et gæt.
3. **Sikkerhed ved C.** Implicit auth flow (token i URL-hash) blev accepteret som trade-off for B. Skal genbesøges.

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

**Alt laves og committes lokalt. Der pushes og deployes kun når Jacob eksplicit siger til.** Se `CLAUDE.md`.

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
| `vercel.json` | Routing. Bruger det gamle `builds`-format — `functions` og `builds` udelukker hinanden |
| `.vercelignore` | Vercel læser ikke `.gitignore` |
| `TODOS.md` | Opgaveliste med begrundelser og fravalg |
| `CLAUDE.md` | Instruktioner til AI-assistenter i dette repo |
