# Range Finder — TODO
Sidst opdateret: 2026-09-06

B1 (AI-plangenerering) og B2 (replan) er færdige og i produktion. Se `HANDOFF.md` for hvordan projektet hænger sammen.

---

## Lige nu: få tal på bordet

Målingen er bygget og committet lokalt (se Færdigt). Den mangler to ting for at give noget:

- [ ] **Slå Web Analytics til** i Vercel-dashboardet. Toggle'en viser samtidig event-loftet på planen.
- [ ] **Deploy.** Målingen kan først verificeres i produktion.
- [ ] **Verificér efter deploy:** `curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://rangefinderapp.vercel.app/_vercel/insights/script.js` skal give JavaScript, ikke HTML. Generér så en plan live og se eventet lande.
- [ ] **Del linket med fem rigtige folk.** Det er CEO-planens Gate 0, og det er stadig ikke gjort.
- [ ] `replan_used` er det eneste event der ikke er testet — det kræver API'et og sprungne uger.

---

## Næste større stykke: C — konti og cloud sync

**Afgør dette først:** CEO-planen spørger om AI-planer beviseligt er bedre end algoritme-planer, og svarer ikke. Der er endnu ikke én rigtig bruger der har gennemført en plan. C er det dyreste stykke arbejde i planen og svært at rulle tilbage når der først ligger brugerdata i en database — så spørgsmålet bør besvares før, ikke efter.

Målingen er nu på plads til at besvare det. Den skal bare deployes og køre længe nok.

C bringer også ting ind som ikke er tekniske: persondata gør dig til databehandler (GDPR, sletning, privatlivspolitik), og implicit auth flow (token i URL-hash) blev accepteret som trade-off for B og skal genbesøges.

- [ ] Supabase-projekt: auth + Postgres
- [ ] Magic link auth (email, ingen adgangskode)
- [ ] Cloud sync: planer og sessioner i Supabase i stedet for localStorage
- [ ] `/api/migrate-plan` — flyt localStorage-planer over ved første login
- [ ] **Email-felt i wizarden** — flyttet hertil fra B1. Teksten lover "gemmes når du logger ind", og der er intet login før C. En email i localStorage gør heller ikke migreringen lettere, for sign-in-flowet spørger alligevel. Bygges sammen med magic link auth.

---

## Kræver et menneske, ikke kode

- [ ] **Fase-tabellens hul for uge 21-24.** Reglen siger "tilføj 1 BASE-uge, maks 8 BASE-uger totalt", men ikke hvad der sker når loftet er nået og planen skal være længere endnu. `allocatePhases()` forlænger bare BASE videre.

  Kandidatregel: forlæng BUILD i stedet når BASE rammer 8. Det er et gæt, ikke fagligt funderet — og præcis den slags hvor et forkert gæt ser rigtigt ud. **Spørg en rigtig coach før det implementeres.**

---

## Små forbedringer

- [ ] **Nøgletallene på TAL-fanen kunne blive en `<dl>`.** De fire tal er `<div>`-par. De læses forståeligt op som "0 Km kørt", så det er en forbedring, ikke en fejl.
- [ ] **Måldistance-heuristikken rammer 12-13 af 14.** Ratio længste træning / forventet 80%: mest 1,0, med enkelte på 0,63-0,75 og én på 1,25. Fungerer, men er ikke præcis.
- [ ] **Længdegrænsen for delelinks er ikke testet ordentligt.** Grænsen på 8000 tegn er kun ramt af syntetiske planer, som gzip komprimerer urealistisk godt (en 24-ugers testplan gav 940 tegn). En rigtig 24-ugers plan bør måles.
- [ ] **Rate limiting** er en in-memory `Map`, 5 pr. IP pr. time, som nulstilles ved cold start. Opgrader til Vercel Firewall hvis der kommer reelt misbrug. Bevidst valg, ikke en mangel.

---

## Backlog — vent på brugerfeedback

- [ ] **Ugentlig coaching-email** — Resend + Supabase Edge Function cron. Kræver C.
- [ ] **Strava-integration** — kræver OAuth-review hos Strava, uger ventetid.
- [ ] **Haiku → Sonnet** — kun hvis plankvaliteten viser sig utilstrækkelig. Gaten står på 16/16, så der er ingen anledning nu.

---

## Færdigt

### Måling (2026-09-06)
- Seks Vercel Web Analytics-events: `plan_generated`, `plan_fallback`, `session_logged`, `replan_used`, `plan_shared`, `plan_exported`. Cookieless, anonyme, ingen persondata. Se `HANDOFF.md` for tabellen
- **`vercel.json` skulle rettes først:** legacy `routes` springer filsystemet over, så SPA-catch-all'en slugte `/_vercel/insights/script.js` og serverede `index.html` (målt: 200, `text/html`, 144661 bytes). Uden `handle: filesystem` ville browseren have parset SPA'en som JavaScript og målingen aldrig virket, uden en fejl nogen steder
- `plan_fallback.reason` har også en pengevinkel: når `validatePlan()` afviser et svar, er der allerede betalt for de output-tokens, prøvet igen, og serveret algoritme-planen. Det var usynligt før
- Verificeret lokalt gennem wizarden: alle events fyrer med de rigtige payloads, et fjernet kryds logger ingenting, og log-knappen renderes kun for sessioner der ikke er færdige

### B1 — AI-plangenerering (2026-09-04 → 05)
- `api/generate.js`: fase-allokering i kode, sport-aliaser, `target_km`, `sessions_per_week`, sprogvariant, sessions-cap, rate limit
- Wizarden kalder API'et med algoritmen som fallback ved enhver fejl; loading-skærmen venter på det ægte svar
- Nye felter: fitnessniveau, løbsdato (valgfri, overskriver "Tid til rådighed")
- Coach-noter under hver session; konkret ernæring pr. distance med før-træning-fueling; ordliste for RPE, zone 2, sweet spot, tærskel, gel, carb-load
- Progress ring for ugen, cappet ved 100% mens tallet viser det rigtige
- Km afrundes ved visning; rådata og inputfelter beholder præcise tal

### B2 — replan (2026-09-05)
- `api/replan.js` deler konstanter med `generate.js` via import, ikke kopi
- Detekterer uger hvis sidste sessionsdato er passeret uden noget krydset af, og tilbyder at skrive resten om
- **To bevidste afvigelser fra CEO-specen:** faserne er låst (specen tillod modellen at omdøbe dem — samme fejl som gav 27%), og planen beholder sin længde (specen tillod at tilføje en uge, men en fast løbsdato flytter sig ikke; første resterende uge markeres som tilbagevenden i stedet)

### Sprog (2026-09-05)
- Appen var halvt engelsk, halvt dansk. Alle brugervendte strenge ligger nu i ét `I18N`-objekt, 126 nøgler pr. sprog, med DA/EN-knap i bundhøjre
- `/api/generate` og `/api/replan` tager `language` og har engelske prompt-varianter
- Planer beholder det sprog de blev lavet på; al chrome skifter live

### Deling og eksport (2026-09-05)
- **Del som link:** planen gzippes og base64-kodes ind i URL'en. 4113 tegn JSON → 5484 rå base64 → **2125 gzip'et**. Fremdrift følger ikke med. Ingen server, ingen konto, ingen persondata.
- **iCal-eksport:** heldagsbegivenheder med coach-note, tempo, ernæring og fase i beskrivelsen. Verificeret mod RFC 5545 på 49 events

### Tilgængelighed (2026-09-05)
- Design-reviewets FINDING-002 lukket: rigtig overskriftsdisposition i hver visning uden spring i niveauer, sessionslisten er en `<ul>`, fanerne har `role="tablist"`/`tab`/`tabpanel`

### Infrastruktur
- `scripts/validate-generate.mjs` — prompt-gate, 16 samples, exit 0/1. Senest 16/16
- `scripts/sweep-plan-length.mjs` — finder hvor lange planer knækker
- `MAX_TOKENS` 4096 → 16000 (modellens reelle loft er 64000, bekræftet via Models API)
- Sessions-cap på 100: over grænsen afvises AI-vejen på ~200 ms i stedet for at fejle efter 35 sek
- `.vercelignore` — Vercel læser ikke `.gitignore`
- Domænet følger produktionen automatisk; `vercel alias set` må aldrig køres på det igen
- `savePlan()` fortæller nu brugeren når lageret er fuldt i stedet for at tabe planen i stilhed
- `icon.svg` har fået en route

### Rettelser undervejs
| Fejl | Årsag |
|---|---|
| Alle `/api/*` gav 404 siden første commit | `vercel.json` omskrev uden `.js`-endelse |
| Alle AI-kald fejlede | Org-nøgle uden workspace-scope; `ANTHROPIC_WORKSPACE_ID` mangler |
| `generatePlan()` kastede ved hver plangenerering | Tre lokale variabler ved navn `t` skyggede den nye `t()` |
| Tal-fanen viste rå nøglenavne | 10 i18n-nøgler overskrevet af en tidligere redigering |
| 70 dage blev til 11 uger | Sommertid — 70 dage er 70 dage plus en time i millisekunder |
| Kopiér-knappen kopierede aldrig | `await` på gzip brugte klikkets clipboard-tilladelse op |
| `0/628.5999999999999 km` | Flydende-komma-støj i summer af AI-genererede decimaler |
| `tempoFn` ramte altid default | Matchede danske ord mens generatoren skrev engelske |
| `sportLabel` viste "Lob" og "Svomning" | Rå ASCII-nøgle med stort begyndelsesbogstav |
