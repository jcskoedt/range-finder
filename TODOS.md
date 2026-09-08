# Range Finder — TODO
Sidst opdateret: 2026-09-08 (2)

B1 (AI-plangenerering) og B2 (replan) er færdige og i produktion. Se `HANDOFF.md` for hvordan projektet hænger sammen.

---

## Kræver dig — trin for trin

Fire ting spærrer for resten, og ingen af dem er kode. De står i den rækkefølge de bør tages: nummer 1 er et ja, nummer 2 har DNS-ventetid indbygget, og 3 og 4 hænger på nummer 2.

### ~~1. Godkend databaseændringen~~ — kørt 2026-09-07

`pg_cron` installeret, `sweep_inactive()` oprettet, cron-jobbet `sweep-inactive` aktivt på `0 3 1 * *` i UTC, og `verify-retention.sql` bestod 4/4. Funktionen kan kun kaldes af `postgres`. Basen står som den blev fundet: 0 brugere, 0 forældreløse biblioteker.

Tilbage af opbevaringsreglen er advarselsmailen — se den sidste note i dette afsnit.

### 2. Resend-konto og verificeret afsenderdomæne

Den vigtigste, fordi DNS tager tid og fordi to andre punkter venter på den. Se det udførlige punkt under *C* nedenfor for hvorfor.

1. Opret konto på resend.com og tilføj domænet.
2. Læg de DNS-records Resend viser (SPF og DKIM) hos den udbyder der har domænet. Vent på at de er verificeret — minutter til timer.
3. Supabase-dashboardet → dit projekt → Authentication → Emails → SMTP-indstillingerne → slå custom SMTP til med Resends værdier.
4. Samme sted, Rate Limits: loftet starter på 30 mails i timen efter custom SMTP. Skru op hvis det bliver for lidt.
5. Test på en adresse der **ikke** er din egen og ikke er medlem af Supabase-organisationen. Det er hele pointen — på din egen virker det også uden Resend.

Samme Resend-konto driver advarselsmailen i opbevaringsreglen, så når den er oprettet, mangler der tre env-variabler i Vercel (Production) før `api/retention-warn.js` gør andet end at tælle:

6. `RESEND_API_KEY` — nøglen fra Resend.
7. `RESEND_FROM` — afsenderadressen på det verificerede domæne, fx `Range Finder <ingen-svar@dit-domæne.dk>`.
8. `CRON_SECRET` — en tilfældig streng, fx `openssl rand -hex 32`. Vercel sender den selv som `Authorization: Bearer …` til cron-jobbet. **Uden den nægter endpointet at køre** — en åben endpoint der sender mails er ikke noget man lader stå.

Sig til når de tre er sat, så deployer vi og verificerer med et rigtigt kald i stedet for at læse konfigurationen.

### 3. Accepter Supabases databehandleraftale

`supabase.com/legal/dpa`, eller dashboardet → organisationen → Settings → de juridiske dokumenter. Den skal **accepteres**, ikke bare læses: i det øjeblik der ligger en emailadresse i basen, er du dataansvarlig og Supabase din databehandler.

Basen er tom lige nu — slette-konto-testen 6/9 tog den ene konto med sig — så det er ikke akut i dag. Det skal være på plads før nummer 2 er færdig, for derefter kommer der brugere.

### 4. Del linket med fem rigtige folk

CEO-planens Gate 0. Stadig ikke gjort, og det er det eneste der kan besvare om AI-planer er bedre end algoritme-planer. Kan først gøres når nummer 2 er på plads — indtil da kan de ikke logge ind, og appen viser dem ikke nogen fejl.

### Og to ting mere du skal vide

**Advarselsmailen er deployet, men sender ingenting endnu.** `api/retention-warn.js` og det daglige cron-job kl. 04:00 UTC gik i produktion 2026-09-08 og er verificeret med kald: `503` uden `CRON_SECRET`, `405` på POST, og resten af siden upåvirket. Uden `RESEND_API_KEY` og `RESEND_FROM` vil den svare `200` med `skipped: "resend_not_configured"` og antallet der venter — med vilje, frem for at fejle: et cron-job der fejler hver dag i ugevis lærer dig at ignorere cron-fejl, og så er den rigtige fejl også usynlig.

**Men lige nu er `CRON_SECRET` ikke sat, så den svarer 503 og cron-kørslen står som fejlet hver dag.** Det er den ene af de tre variabler der ikke afhænger af Resend. Sæt den, og kørslen virker fra i morgen: den finder 0 forfaldne og no-op'er pænt.

Sletningen er nu spærret bag advarslen: `sweep_inactive()` rører ikke en konto der ikke har en advarsel på sig og 30 dage siden. Så indtil afsenderen kører, sletter systemet **ingenting** — det er den rigtige retning at fejle i, men det er stadig et løfte der ikke holdes, så det er tælleligt frem for tavst: `retention_status().overdue_unwarned` er antallet af konti der er forbi slettedatoen og kun lever fordi ingen har advaret dem. Den skal være 0.

`vercel.json` klarede det: build Ready på 11s, og forsiden, analytics-stien, `/privacy` og `/api/generate` svarer som før. Cron-*registreringen* er det eneste der ikke er verificeret — `vercel inspect` rapporterer ikke crons, så den skal ses i dashboardet under Cron Jobs, og det første rigtige bevis er en kørsel kl. 04:00 UTC.

**`libraries` har RLS slået til og nul politikker.** De tre "own row"-politikker i `supabase/schema.sql` blev aldrig anvendt; fundet 2026-09-07 af Supabases egen advisor og bekræftet i `pg_policies`. Det er ikke et hul: RLS uden politikker nægter anon og authenticated alt, og `/api/sync` bruger service-rollen der springer RLS over, så appen er upåvirket. Filen er nu rettet til at sige det — politikkerne står kommenteret ud med hvorfor.

Beslutningen er din: lad dem være til noget faktisk har brug for dem (profilsiden er den første kandidat), eller kør dem nu for at have dem. Jeg anbefaler det første — en politik uden forbruger giver adgang til ingens fordel, og fail-closed er strammere. Men det skal være et valg, ikke en glemsel.



`/privacy` lover en advarsel efter 11 måneder. Slettedelen er der efter nummer 1; **advarselsmailen findes ikke**, og den kan ikke bygges før Resend. Der er ingen risiko lige nu — sweepet kan først nå en konto 12 måneder efter sidste login, og der er nul konti — men advarslen skal være ude før den første konto bliver så gammel. Det er Task 10, Step 2, og den bygger jeg når nummer 2 er på plads.

---

## Lige nu: få tal på bordet

Målingen kører i produktion. Tilbage er at få rigtige folk igennem den:

- [x] ~~**Deploy af analytics-koden.**~~ Landet 2026-09-06, `ee79b8d`.
- [x] ~~**Push routing-rettelsen.**~~ `49202aa`. Uden den slugte SPA-catch-all'en `/_vercel/insights/script.js` og serverede `index.html` byte for byte, så analytics-scriptet aldrig indlæstes.
- [x] ~~**Web Analytics slået til**~~ i Vercel-dashboardet. Bekræftet indirekte: edge injicerer kun insights-scriptet når toggle'en er sat, og stien svarer med det rigtige script.
- [x] ~~**Verificér i produktion.**~~ Målt 2026-09-06: `200 application/javascript`, 3106 bytes.
  ```bash
  curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
    https://rangefinderapp.vercel.app/_vercel/insights/script.js
  ```
  Giver den `text/html`, sluger en rute stien igen — så er catch-all'en eller `handle: filesystem` blevet rørt.
- [x] ~~**`@vercel/analytics` fjernet igen.**~~ Lå ucommittet efter et `npm i` uden at nogen kode importerede den. Appen bruger `window.va`-shimmen og et `<script src>`-tag i `index.html`.
- [ ] **Del linket med fem rigtige folk.** CEO-planens Gate 0, stadig ikke gjort. C er bygget nu, så det blokerer ikke længere *arbejdet* — det blokerer svaret på om AI-planerne er værd at have. Kræver Resend først. Se *Kræver dig* øverst, punkt 4.
- [ ] `replan_used` er det eneste event der ikke er testet — det kræver API'et og sprungne uger.

---

## Næste større stykke: C — konti og cloud sync

**Designet er skrevet:** `docs/superpowers/specs/2026-09-06-c-cloud-sync-design.md`. Ti beslutninger, datamodel, fletteregler, synkroniseringsflow og testtilfælde. Læs den før du rører C.

**Afgør dette først:** CEO-planen spørger om AI-planer beviseligt er bedre end algoritme-planer, og svarer ikke. Der er endnu ikke én rigtig bruger der har gennemført en plan. C er det dyreste stykke arbejde i planen og svært at rulle tilbage når der først ligger brugerdata i en database — så spørgsmålet bør besvares før, ikke efter.

Målingen kører nu og kan besvare det. Den mangler kun rigtige brugere og tid.

C bringer også ting ind som ikke er tekniske. I dag gemmer appen nul persondata — alt ligger i brugerens egen localStorage — så der er ingen GDPR-forpligtelser overhovedet. Udløseren er emailadressen, ikke Supabase: i det øjeblik du indfører magic link, bliver du **dataansvarlig** og Supabase din **databehandler**. Og implicit auth flow (token i URL-hash) blev accepteret som trade-off for B og skal genbesøges.

### Start med denne — den har ventetid indbygget

- [ ] **Resend-konto og verificeret afsenderdomæne.** Trinene står i *Kræver dig* øverst, punkt 2. Ikke en detalje til sidst: det er en forudsætning for at magic link virker for andre end dig selv.

  Supabases indbyggede mailserver **sender kun til medlemmer af din egen Supabase-organisation**. Alle andre adresser fejler med `Email address not authorized`, og loftet er 2 mails i timen. Magic link vil altså virke perfekt når du tester på dig selv, og fejle for hver eneste testbruger. Kilde: supabase.com/docs/guides/auth/auth-smtp.

  Rettelsen er custom SMTP. Resend står på Supabases egen liste og ligger i forvejen i backloggen til den ugentlige coaching-email, så én udbyder dækker begge. Verifikationen kræver DNS-records (SPF og DKIM), og DNS tager tid — derfor står punktet først.

  Efter custom SMTP er slået til, sætter Supabase et startloft på 30 mails i timen, som kan skrues op på Rate Limits-siden.

### Resten

- [x] ~~**Supabase-projekt: auth + Postgres.**~~ Oprettet via Vercels Marketplace-integration, ref `pxbrkdymegmizyvaqude`. Skemaet er kørt: tabellen `libraries`, RLS-politikkerne, indekset og `sync_library()`. Kilden ligger i `supabase/schema.sql` — der er intet migreringsværktøj, så de to skal holdes i takt manuelt.
- [x] ~~**Bekraeft regionen er EU.**~~ eu-west-1, Irland. Laest fra projektet via Supabase-MCP, ikke gaettet ud fra en IP-blok. Staar i privatlivspolitikken.
- [ ] **Accepter Supabases databehandleraftale.** Se *Kræver dig* øverst, punkt 3. (Basen er tom igen — 0 brugere, målt 2026-09-07 — så det er ikke akut i dag, men det skal være på plads før der er brugere.)
- [x] ~~**Privatlivspolitik og en slette-mig-funktion.**~~ Politikken ligger paa /privacy med rigtige selskabsoplysninger, og slet-konto-knappen er verificeret mod produktionsdatabasen: 204, og baade bruger og bibliotek vaek via cascade.
- [x] ~~Magic link auth (email, ingen adgangskode)~~ `fef2401`. Verificeret ende til ende 2026-09-06: link sendt, modtaget, klikket, session hydreret.
- [x] ~~Cloud sync: planer og sessioner i skyen~~ `5fb6931`. Ikke *i stedet for* localStorage — localStorage forblev det primære lager, og skyen er et spejl. Det var beslutning 3.
- [x] ~~`/api/migrate-plan`~~ **udgår.** Første login er bare den første synkronisering mod et tomt dokument, og fletningen klarer resten. Det fjerner også hele uuid-problemet CEO-planen brugte et afsnit på: `plan.id` forlader aldrig dokumentet.
- [ ] **Opbevaringsreglen (Task 10).** Databasesiden er færdig og verificeret 2026-09-07: `retention_warnings`, viewet `retention_accounts`, `sweep_inactive()` spærret bag advarslen, `retention_warn_due()`, `retention_mark_warned()` og `retention_status()`. `verify-retention.sql` dækker syv konti og fire tællere, 7/7 og 4/4, og skemafilens fire funktionskroppe er diffet mod databasen og er identiske.

  Tilbage: **de tre env-variabler og et deploy.** Se *Kræver dig* øverst, punkt 2, trin 6-8.

  Planens egen version af `sweep_inactive()` er **ikke** den der blev skrevet. Den koblede `auth.users` til `libraries` med et join, og en bruger der logger ind uden nogensinde at lave en plan har ingen `libraries`-række — de konti ville stå for evigt med en emailadresse i, altså præcis det politikken lover at fjerne. Den skrevne version falder tilbage på kontoens egne datoer og kræver at **både** `last_seen_at` og `last_sign_in_at` er gamle, før den sletter.

- [ ] **Email-felt i wizarden** — flyttet hertil fra B1. Teksten lover "gemmes når du logger ind", og der er intet login før C. En email i localStorage gør heller ikke migreringen lettere, for sign-in-flowet spørger alligevel. Bygges sammen med magic link auth.

---

## Fra compliance-gennemgangen 2026-09-06

Kørt mod den live side med målinger, ikke skøn. Lukket: farvekontrast (`--subtle` var 4,48 mod hvid, grænsen er 4,5 — nu `#767676` = 4,54), selvhostede skrifttyper, samtykketekst ved email-feltet, privatlivspolitik, og slet-min-konto.

**Cookiebanner og cookiepolitik kan springes over.** Der sættes nul cookies — `document.cookie` er tom. Supabase gemmer sessionen i localStorage, og Vercel Web Analytics er cookiefri. Det holder kun så længe det passer: en chat-widget, en YouTube-embed eller Google Analytics ændrer det med det samme.

- [ ] **Kontaktoplysninger på selve siden.** Politikkens footer har CVR og adresse, men forsiden har ingenting. Det er e-handelslovens krav, ikke GDPR's.
- [ ] **Vilkår og betingelser.** Ikke strengt påkrævet for en gratis app, men god skik når der er konti.
- [ ] **Engelsk privatlivspolitik.** Appen er tosproget; politikken er kun dansk. Skal på plads før appen vises til nogen der ikke læser dansk.
- [ ] **Copyright på `hero-video.mp4` og `logo.png`.** Egne optagelser eller stock med licens? Kan kun besvares af Jacob.

---

## Næste bundt — designet, venter på et ja

Fire ting besluttet 2026-09-08. Mockup: `profile-preview.html`, åbnes direkte fra disk. Intet af det er bygget endnu.

### Profilsiden

Ruter på om der er planer, **uden** en femte værdi i `state.view` — noten nedenfor antog at den var nødvendig, men når forsiden forsvinder ved planer, er valget afledt frem for gemt. `renderLibrary()` splittes i `renderLanding()` og `renderProfile()`. Sletter du din sidste plan, falder du tilbage til salgsforsiden af sig selv.

**Første paint er den svære del.** `init()` kalder `renderLibrary(true)` *før* `state.planIndex=await loadIndex()`, og indekset går gennem `window.storage.get()` og kan ikke læses synkront. Ruter man på `planIndex.length`, tegner første paint salgsforsiden med `<video autoplay>` og swapper bagefter — så hentes de 27 MB alligevel, og feature'en ville se ud som om den virkede. Fixet er en `hasPlans`-nøgle i localStorage, skrevet af `saveIndex()` og læst synkront i `init()`.

Layout: planerne er siden, kontoen en stille fod. Email + sync-badge + log ud synligt, `Slet min konto` bag en `<details>`. Wordmark-linje øverst, fordi hero'en er det eneste sted der er branding i dag. `#langToggle` kræver intet — den ligger uden for `#app` og er allerede `position:fixed`.

**Ikke med:** fremdrift på plan-kortene. `state.planIndex` bærer ikke fremdrift, så hvert kort ville kræve at hele plandokumentet blev læst ved hver render. Egen opgave. Og RLS-politikkerne er stadig ikke nødvendige: profilen læser localStorage, ikke Supabase.

- [ ] Byg profilsiden

### Adgangskode ved siden af magic link

Besluttet: **begge.** Email + adgangskode øverst, "send mig et link i stedet" under.

Grunden er større end bekvemmelighed: **adgangskode virker uden Resend.** Slås email-bekræftelse fra i Supabase, oprettes en konto uden at der sendes en mail, og så venter Gate 0 ikke længere på DNS. Prisen er at adresserne ikke er verificerede — en tastefejl låser folk ude uden nulstilling, og advarselsmailen i opbevaringsreglen har ingen adresse den kan stole på. Det bliver rigtigt igen når Resend er på plads; adgangskoden udskyder afhængigheden, den fjerner den ikke.

- [ ] Byg adgangskode-login i `index.html`
- [ ] **Kræver dig:** Supabase → Authentication → Providers → Email → slå *Confirm email* fra. Uden det sender adgangskode-oprettelse stadig en bekræftelsesmail, og så er vi tilbage i mail-afhængigheden.

### "Gem din plan" flytter til Kalender-fanen

`authBoxHtml()` ligger på linje 3276 inde i `renderTabPlan`; kalender-fanen er `today` (`tab_today` = "Kalender"), altså `renderTabToday`. Den bliver mere synlig, ikke mindre — `planTab` starter på `"today"`. `wireAuthBox()` skal kaldes i samme funktion som rendrer den, jf. kommentaren over funktionen.

- [ ] Flyt den

### Kopiér træningsbeskrivelse til Strava

Samme tekst som iCal-beskrivelsen: coach-note, `Tempo:`, `Ernæring:`, `Før træning:` hvis den findes, fasen. Bygges i dag inde i `planToIcs` (1786-1793) og flytter ud i en delt `sessionDescription()` som både eksporten og knappen kalder — ikke en kopi.

**Må ikke `await` noget før `navigator.clipboard.writeText`.** Det var præcis det der gjorde at kopiér-knappen til delelinks aldrig virkede: `await` på gzip brugte klikkets clipboard-tilladelse op. Teksten bygges synkront og skal blive det.

- [ ] Byg knappen

### Afsendernavn i mails

Afsendernavnet er `smtp_sender_name` og hører til custom SMTP, så From-adressen er Supabases indtil Resend er på plads. Men emne og brødtekst er separate felter og kan ændres nu.

- [ ] **Kræver dig:** Supabase → Authentication → Emails → Magic Link. Emne: `Dit login-link til Range Finder`. Behold `{{ .ConfirmationURL }}` i brødteksten, ellers virker linket ikke.

---

## Profilside — planerne skal have deres eget sted

- [ ] **Byg en profilside.** I dag tegner `renderLibrary()` marketing-forsiden og de gemte planer i samme view: hero-video, ticker, wordmark og tagline, og så planerne nedenunder. Der findes ikke et sted der er dit.

  Tre ting det koster i dag:

  **En tilbagevendende bruger henter 27 MB hero-video for at nå sin egen plan.** `hero-video.mp4` indlæses hver gang forsiden vises, også når du kun skal krydse søndagens lange tur af.

  **Forsiden sælger produktet til nogen der allerede bruger det.** Tagline og ticker giver mening for en førstegangsbesøgende og er støj for alle andre.

  **Auth-tingene har ingen naturlig plads.** Login-boksen, log ud og slet-konto ligger i bunden af en enkelt plans PLAN-fane, fordi der ikke var andre steder at gøre af dem. De hører til på en profil, ikke inde i en træningsplan.

  Formen kunne være: forsiden bliver ved med at være salgssiden for folk uden planer, og har man planer, lander man på profilen i stedet. Profilen samler biblioteket, kontoen, synkroniseringsstatus og sletning ét sted.

  Bemærk at det rører `state.view`, som i dag kun kender `library`, `wizard` og `plan`.

---

## Kræver et menneske, ikke kode

- [ ] **Fase-tabellens hul for uge 21-24.** Reglen siger "tilføj 1 BASE-uge, maks 8 BASE-uger totalt", men ikke hvad der sker når loftet er nået og planen skal være længere endnu. `allocatePhases()` forlænger bare BASE videre.

  Kandidatregel: forlæng BUILD i stedet når BASE rammer 8. Det er et gæt, ikke fagligt funderet — og præcis den slags hvor et forkert gæt ser rigtigt ud. **Spørg en rigtig coach før det implementeres.**

---

## Små forbedringer

- [x] ~~**Nøgletallene på TAL-fanen kunne blive en `<dl>`.**~~ Lavet 2026-09-06, `fbaea72`. `dt` står før `dd` i DOM'en, og `flex-direction:column-reverse` viser tallet først uden at bytte om på markup'en.
- [ ] **Måldistance-heuristikken rammer 12-13 af 14.** Ratio længste træning / forventet 80%: mest 1,0, med enkelte på 0,63-0,75 og én på 1,25. Fungerer, men er ikke præcis.
- [x] ~~**Længdegrænsen for delelinks er ikke testet ordentligt.**~~ Målt 2026-09-06 på en rigtig AI-plan fra produktion. Den gzippede sti topper på **3249 tegn, 41% af loftet**, på den største plan appen kan lave. Ingen risiko.

  Men målingen fandt noget andet: **fallback-stien uden gzip krydser loftet mellem 80 og 90 sessioner** og lander på 9469 tegn (118%) ved max. På en browser uden `CompressionStream` kan store planer altså ikke deles. Fejlen er pæn — brugeren får "denne plan er for lang til at deles som link" — men kodekommentaren påstod det modsatte og er rettet.

- [ ] **Beslut om raw-fallbacken skal gøre mere end at fejle pænt.** `CompressionStream` mangler kun i Safari under 16.4 og Firefox under 113, så gruppen er lille og krympende. Mulighederne er at lade den være, eller at droppe fallbacken helt og sige det direkte. Ingen af delene haster.
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
- **`vercel.json` skulle rettes:** legacy `routes` springer filsystemet over, så SPA-catch-all'en slugte `/_vercel/insights/script.js` og serverede `index.html` (målt: 200, `text/html`, 144661 bytes). Browseren ville have parset SPA'en som JavaScript og målingen aldrig virket, uden en fejl nogen steder. `handle: filesystem` var det første forsøg og var **ikke** nok; rettelsen er en negativ lookahead i catch-all'en selv (`49202aa`). Se `HANDOFF.md`
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
