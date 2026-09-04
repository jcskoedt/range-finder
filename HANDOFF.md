# Range Finder — Handoff
Sidst opdateret: 2026-09-05 (sprogskifter)

## ⚠️ BLOKERENDE — ét trin tilbage
`ANTHROPIC_API_KEY` er en org-nøgle uden workspace-scope, så Anthropic afviser alle kald fra `api/generate.js` og `api/scan.js` med:
> "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header..."

**Status 2026-09-05:** Mulighed B er valgt og halvvejs udført.
- ✅ `ANTHROPIC_WORKSPACE_ID` er sat i Vercel (Production) — bekræftet med `vercel env ls`
- ✅ `api/scan.js` sender nu samme workspace-header som `generate.js` (den manglede — screenshot-import ville ellers være blevet ved med at fejle)
- ⬜ **Mangler: redeploy.** Env-ændringer slår ikke igennem på eksisterende deployments. Kør:
  ```bash
  cd /Users/jacobcompenskodt/06RANGE_FINDER
  vercel --prod
  vercel ls rangefinderapp                       # find nyeste "Ready" deployment
  vercel alias set <nyeste-url> rangefinderapp.vercel.app
  ```
- ⬜ **Mangler: verifikation.** Skal give en JSON-plan (HTTP 200), ikke `generation_failed`:
  ```bash
  curl -s -m 90 -X POST https://rangefinderapp.vercel.app/api/generate \
    -H "Content-Type: application/json" \
    -d '{"sport":"lob","fitness_level":"Motionist","longest_session_km":10,"target_km":42,"plan_weeks":4,"goal_event":"maraton"}'
  ```

Bemærk: env-vars findes kun i **Production**. Preview og `vercel dev` har ingen nøgle, så AI-funktioner kan ikke testes lokalt eller i preview før de også tilføjes der. Se TODOS.md for kommandoerne.

## Status i én sætning
Alle plan-reviews er clearet, `api/generate.js` er bygget, routing-buggen er rettet, og kontrakten mellem frontend og API er lukket (2026-09-05) — men nøglefixet mangler et redeploy før noget AI-relateret kan verificeres, Wizarden kalder nu `/api/generate` med algoritmen som fallback (browser-verificeret mod en stub), men det ægte Anthropic-kald er aldrig lykkedes endnu.

---

## Live app
**URL:** `https://rangefinderapp.vercel.app`
**Repo:** `jcskoedt/range-finder` (branch: `main`, alt arbejde pushes direkte, ingen feature branches brugt)
**Vercel-projekt:** `rangefinderapp` (team: `range-finder`)

**Navnehistorik (vigtig hvis noget ser forkert ud):** Projektet hed oprindeligt `traeningsplan-app`. Omdøbt 2026-09-04 → `range-finder` (taget af en anden bruger) → endte på `rangefinderapp`. Den gamle URL `traeningsplan-app.vercel.app` virker muligvis stadig midlertidigt som alias, men skal ikke bruges fremadrettet. `rangefinderapp.vercel.app` er en **manuel alias** (`vercel alias set`) — den følger IKKE automatisk nye deploys. Efter hver git push, tjek at aliaset peger på den nyeste deployment:
```bash
vercel ls rangefinderapp          # find nyeste "Ready" deployment
vercel alias set <nyeste-url> rangefinderapp.vercel.app
```
Dette bør fikses permanent (se "Kendte tekniske gæld" nedenfor) i stedet for at gøre det manuelt hver gang.

---

## Kritisk fund: alle API-routes har været døde siden start

**Symptom:** `/api/scan` og `/api/generate` gav 404 i produktion — på ALLE deployments, inklusive 2 dage gamle, altså siden projektets første commit. Ingen opdagede det fordi ingen nogensinde lavede et ægte live-kald mod et `/api/*`-endpoint før i aften.

**Root cause:** `vercel.json`'s route `{ "src": "/api/(.*)", "dest": "/api/$1" }` omskriver til en sti UDEN filendelse (`/api/generate`), men dette projekts build-pipeline (`@vercel/vc-build`) registrerer den deployede functions faktiske sti MED endelse (`api/generate.js`). Stierne matchede aldrig, så Vercel svarede med sin egen generiske 404 i stedet for at nå frem til koden.

**Fix (pushet + live-verificeret, commit `b6d5146`):** Routen er nu `{ "src": "/api/(.*)", "dest": "/api/$1.js" }`. Bekræftet live: `curl -X OPTIONS https://rangefinderapp.vercel.app/api/generate` giver nu 200 (var 404 før fixet, på ALLE deployments inkl. 2 dage gamle). Routing er løst — men se den blokerende API-nøgle-fejl øverst i denne fil, som er det NÆSTE lag der stopper et ægte kald.

---

## Hvad er faktisk bygget

### `api/generate.js` — FÆRDIG, testet lokalt, ikke koblet til frontend
- Model: `claude-haiku-4-5-20251001`, `max_tokens: 4096`, 40 sek. timeout pr. forsøg (1 retry ved parse-fejl)
- Fase-allokering er **deterministisk kode** (`allocatePhases()`), ikke noget Claude selv regner ud — se "Prompt-validering" nedenfor for hvorfor
- Rate limiting: in-memory Map, 5 req/IP/time (samme mønster som `api/scan.js`)
- Server-side validering: ugyldig sport/fitnessniveau → 400, løbsdato i fortiden → 400, uger > 24 → capped med `"capped": true` i response
- `goal_event` trunkeres til 200 tegn server-side (prompt-injection-mitigering)
- Testet med 8 lokale cases (happy path × 2, alle 400-veje, cap-logik, rate limit) — alle bestod. Se commit `df07c5b` for detaljer.
- **Live-testet efter routing-fixet:** routing virker (200 på OPTIONS), men selve Anthropic-kaldet fejler pga. API-nøgle-problemet øverst i denne fil. Koden er klar — kun nøglen mangler at blive rettet i Vercel.

### Video-hero + fallback — LIVE
- Fuldbredde baggrundsvideo på forsiden, 16:9 letterboxed på desktop (≥1025px), cover-fill på mindre skærme
- Pause/play-knap nederst til højre i videoen
- **Fallback-billede** (`hero-fallback.jpg`, udtrukket fra brugerens eget billede): hvis videoen ikke er startet at spille inden for 10 sek. (eller fejler), skiftes der automatisk til stillbilledet. Testet ved at fjerne videofilen midlertidigt og bekræfte skiftet sker.
- Alle primære knapper (`.btn`) har gul tekst i stedet for hvid, for visuel sammenhæng

### PLAN-fane fase-accordion — LIVE, gennemgået (eng-review + QA + design-review)
- Uger grupperes nu korrekt i ~7 hovedfaser (ikke 14, se QA-rapport)
- Screenshot-upload-boksen er genindført (var faldet ud i en tidligere refaktorering)
- To separate produktionsbugs fundet og rettet undervejs — se "Reviews" nedenfor

### Wizard → /api/generate — KOBLET 2026-09-05 (ikke deployet endnu)
- "Generate plan" kalder nu `/api/generate` med wizardens felter og venter på det ægte svar. Ingen kunstig timer.
- Enhver fejl (afvisning, 4xx/5xx, netværksfejl, 95 sek timeout, ugyldig plan) falder tilbage til `generatePlan()` og viser et gult banner der siger hvorfor.
- Nyt felt i wizarden: **Fitness level** — `/api/generate` svarer 400 uden det.
- Alle veje browser-verificeret mod en lokal stub-server. Selve Anthropic-kaldet er uverificeret indtil nøglen er deployet.

---

## Prompt-validering (kør 2026-09-04) — vigtigt at forstå før man rører prompten

**Oprindelig CEO-plan-spec** (fase-tabel indlejret som prosa, Claude skal selv tælle/slå op): **4/15 sample-inputs bestod (27%)**. Haiku 4.5 følger ikke pålideligt en tekst-tabel til præcis optælling — fejlene spændte fra let forskudte uge-antal til fuldstændig usammenhængende faserækkefølger.

**Fix:** Flyttede faseberegningen til almindelig deterministisk kode (`allocatePhases()`, findes både i `api/generate.js` og i CEO-planen). Claude får nu at vide PRÆCIS hvilken fase hver uge har, og skal kun generere sessionsindhold. **Resultat: 14/15 (93%)** i første forsøg, den sidste fejl var en engangs-JSON-syntaksfejl der løste sig ved almindeligt retry.

**Kendt uløst hul i selve fase-tabellen:** Reglen for uge 17-24 ("tilføj 1 BASE-uge, maks 8 BASE-uger totalt") siger intet om hvad der sker når loftet er nået men planen skal være længere endnu. Nuværende implementering fortsætter bare med at forlænge BASE forbi loftet. Bør genbesøges med en rigtig coachs input — se TODOS.md.

**Målt reel latency (vigtigt — modsiger CEO-planens antagelse om "2-5 sek"):**
| Plan | Tid |
|---|---|
| 12 uger × 4 sessioner/uge | 14-16 sek |
| 24 uger × 6 sessioner/uge | ~35 sek |

Dette er langt over de "2-5 sek" CEO-planen oprindeligt antog. Vercel Functions har heldigvis 300 sek. som platform-default med Fluid Compute (se nedenfor), så det er ikke et hårdt problem — men det betyder wizardens loading-skærm skal designes til reel ventetid på 15-35+ sek, ikke de 8 sek. den har lige nu.

---

## Vercel-platform-viden (jeg havde forældet info om dette — ret det hvis du støder på det samme)
**Antagelsen "Vercel Hobby = 10 sek. function timeout" er FORÆLDET.** Med Fluid Compute (default for alle nye projekter/planer) er grænsen 300 sek. på alle planer inklusive Hobby. Dette ændrer den oprindelige eng-review-anbefaling om et 8 sek. Anthropic-timeout — det er nu sat til 40 sek. i `api/generate.js`.

**`functions` og `builds` i `vercel.json` er gensidigt udelukkende.** Dette projekt bruger det ældre `builds`-format (nødvendigt for den custom static-fil-routing). Det betyder `maxDuration` IKKE kan sættes eksplicit pr. function lige nu — den falder tilbage til platform-default (300 sek). Hvis I nogensinde migrerer væk fra `builds`-formatet, kan I sætte det eksplicit.

---

## Reviews — status

| Review | Status | Rapport |
|---|---|---|
| CEO Review | issues_open (scope besluttet) | `~/.gstack/projects/traeningsplan-app/ceo-plans/2026-09-03-ai-plan-generation.md` |
| Eng Review | **CLEARED**, 9/9 fund løst | Samme fil, `## GSTACK REVIEW REPORT` nederst |
| QA-only | **97/100**, 1 fund fikset, 1 åbent | `.gstack/qa-reports/qa-report-range-finder-2026-09-04.md` |
| Design Review | **B+ / AI Slop: A**, 1 fund fikset, 1 deferred | `~/.gstack/projects/jcskoedt-range-finder/designs/design-audit-20260904/design-audit-range-finder.md` |

To rigtige produktionsbugs blev fundet og rettet undervejs i eng-review (begge allerede live, ikke relateret til B1):
1. Screenshot-upload-boksen var faldet ud af PLAN-fanen under en refaktorering
2. `handleScreenshot()` kaldte tre ikke-eksisterende funktioner (`renderRoute`, `renderStats`, `renderWeeksList`) efter et vellykket import — var live siden den oprindelige commit

---

## Uløste beslutninger
1. **Strategisk:** Validerer AI-planer > algoritme-planer, før C (betaling/konti) bygges? Ikke afgjort — B1 bygges som AI uanset, men paywall-spørgsmålet for C er åbent.
2. **Sikkerhed:** Implicit auth flow (access token i URL hash) accepteret som trade-off for B, genbesøg ved C.
3. **Feasibility:** `claude-haiku-4-5-20251001`'s reelle max_tokens-loft er ikke verificeret mod Anthropics dokumentation — antaget at 4096 er sikkert, ikke bekræftet mod et højere loft.
4. **Fase-tabel-hul:** Uge 21-24 BASE-loft-adfærd (se "Prompt-validering" ovenfor) — kræver coaching-fagligt input.

---

## Næste skridt (i rækkefølge)

1. **Redeploy + verificér nøglen** — se "BLOKERENDE" øverst. Intet AI-relateret kan verificeres før dette.
2. ~~**Luk kontrakten frontend ↔ API**~~ — DONE 2026-09-05. Sport-aliaser, `target_km`, `sessions_per_week` og `apiPlanToLocalPlan()`. Se TODOS.md → "Kontrakt frontend ↔ API" for hvad der var i stykker og hvorfor.
3. ~~**Kobl `/api/generate` til wizarden**~~ — DONE 2026-09-05. Kalder API'et, mapper via `apiPlanToLocalPlan()`, falder tilbage til `generatePlan()` på enhver fejl, og viser et banner der siger hvorfor. Alle syv veje er browser-verificeret mod en stub-server (se TODOS.md).
4. ~~**Ret loading-skærmens tidsstyring**~~ — DONE 2026-09-05. Venter på det ægte svar; klient-timeout 95 sek.
5. **Resterende wizard-felt:** løbsdato (valgfri dato). Fitnessniveau er bygget (det var påkrævet af API'et), og længste session fandtes allerede. Løbsdato dækkes funktionelt af "Time available" via `plan_weeks` — det er nu et UX-valg, ikke en blokering.
6. **Coach-note-rendering:** `items[2]` vises i dag kun i den udfoldede detalje (`.item-note`). Skal frem som kursiv linje under sessionsnavnet.
7. **Progress Ring** på I DAG-fanen — genbrug `plan.progress`/`computeStats()`, IKKE en ny localStorage-struktur (se eng-review-fund).
8. **Email-felt** i wizarden (valgfrit, sidste felt) — kun til localStorage i B, ingen ekstern kald.

### Sprog — løst 2026-09-05
Sprogmikset er væk. Alle brugervendte strenge ligger i `I18N` i index.html, `t()` slår op, og DA/EN-knappen i baren øverst skifter hele siden inkl. datoer, tempo/ernæring og faseforklaring. Valget ligger i `localStorage` under `rf-lang`; første besøg følger browseren. `/api/generate` tager `language` og har en engelsk prompt-variant, så AI-planens indhold følger sproget.

Planer beholder det sprog de blev lavet på — sessionsnavne og coach-noter er data, ikke UI. Chrome skifter live, også på gamle planer.

`tempoFn`'s døde substring-matching er også rettet undervejs: den matchede på danske ord mens `generatePlan()` skrev engelske noter, så den ramte altid default-grenen. Items bærer nu en stabil `kind` på index 3 (`intervals`/`veryeasy`/`long`/`b2b`), og `tempoFn` skifter på den. AI-items har ingen `kind` og får default, hvilket er rigtigt for en coach-note i prosa.

## Nøglefiler

| Fil | Formål |
|---|---|
| `/Users/jacobcompenskodt/06RANGE_FINDER/index.html` | Single-file SPA |
| `/Users/jacobcompenskodt/06RANGE_FINDER/api/generate.js` | AI-plangenerering — FÆRDIG, ikke koblet til frontend endnu |
| `/Users/jacobcompenskodt/06RANGE_FINDER/api/scan.js` | Screenshot-import (eksisterende, virker) |
| `/Users/jacobcompenskodt/06RANGE_FINDER/api/replan.js` | SKAL BYGGES — B2 (gated bag ≥1 bruger der beder om justering) |
| `/Users/jacobcompenskodt/06RANGE_FINDER/vercel.json` | Routing — se "Kritisk fund" ovenfor før du ændrer i denne |
| `/Users/jacobcompenskodt/06RANGE_FINDER/hero-fallback.jpg` | Video-fallback-billede |
| `/Users/jacobcompenskodt/06RANGE_FINDER/TODOS.md` | Løbende opgaveliste, tjek "Kendte tekniske bekymringer" |
| `~/.gstack/projects/traeningsplan-app/ceo-plans/2026-09-03-ai-plan-generation.md` | CEO-plan — kilde til sandhed for B1-spec, inkl. opdateret prompt-tilgang |
