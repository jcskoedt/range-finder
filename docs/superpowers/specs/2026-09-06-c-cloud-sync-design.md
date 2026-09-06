# C — konti og cloud sync

Design, 2026-09-06. Afløser C-afsnittet i CEO-planen (`~/.gstack/projects/traeningsplan-app/ceo-plans/2026-09-03-ai-plan-generation.md`), som blev skrevet omkring et abonnement der siden er skåret væk.

---

## Hvorfor

**Planen må ikke gå tabt.** I dag bor hele biblioteket i browserens localStorage. Rydder nogen deres browserdata, bruger et privat vindue, eller skifter maskine, er tyve ugers træning væk uden varsel.

Det er den eneste begrundelse for **denne** udgave af C. Ikke flere enheder, ikke email-kontakt, ikke betaling — ikke fordi de er fravalgt, men fordi de ikke er det der skal bære designet. Flere enheder bliver muligt som en sidegevinst. Resten står under *Senere, ikke nu*.

CEO-planens C var bygget op om $9/md og en free tier-gate. Begge dele er ude af denne udgave, og gaten gav kun mening sammen med abonnementet. Det er værd at vide når man læser den plan.

## Beslutninger

Ti beslutninger truffet i designsamtalen 2026-09-06. De er bindende for det her dokument; ændrer én sig, skal designet genbesøges.

| # | Spørgsmål | Valg |
|---|---|---|
| 1 | Hvorfor konti | Planen må ikke gå tabt |
| 2 | Hvad skal overleve | Hele biblioteket — planer, fremdrift, historik |
| 3 | Login påkrævet | Nej, valgfrit. Appen virker uændret uden |
| 4 | Konflikter | Flet pr. session |
| 5 | Sletning | Endelig, overalt |
| 6 | Arkitektur | Ét dokument pr. bruger, flettet serverside |
| 7 | Auth-flow | Implicit flow, token i URL-hash |
| 8 | Hvornår spørges der om login | Efter første plan er lavet |
| 9 | Opbevaring | Slet efter 12 måneders inaktivitet |
| 10 | Log ud | Lokalt bibliotek bliver liggende |

Beslutning 7 gik imod anbefalingen i samtalen. PKCE blev fravalgt til fordel for det simplere flow. Følgen står under *Auth*.

## Senere, ikke nu

Det følgende er **udskudt, ikke fravalgt**. Det hører til produktet, men ikke til første udgave af C. Skelnen er vigtig: der er ingen af punkterne her man skal argumentere for at få lov til at bygge senere — de skal bare ikke bygges nu, og designet ovenfor må ikke spærre for dem.

| Senere | Afhænger af | Bemærk |
|---|---|---|
| Betaling og abonnement | C | CEO-planen havde $9/md og en free tier-gate. Begge dele er taget ud af *denne* udgave, og gaten skal genopfindes hvis betaling kommer tilbage — den eksisterede kun for at understøtte abonnementet |
| Ugentlig coaching-email | C og Resend | Resend er allerede en forudsætning for magic link, så infrastrukturen findes når C er færdig |
| Deling af planer mellem konti | C | Delelinket i dag er kontoløst og bærer ikke fremdrift. En kontobaseret deling er en anden funktion, ikke en udvidelse af den |
| Flere enheder som markedsført formål | C | Virker som sidegevinst fra dag ét. Det der mangler er ikke kode, men at turde love det — og det kræver at synkroniseringen har kørt hos rigtige brugere først |
| Strava-integration | Ingenting | Uafhængig af C og kan startes når som helst. Uger af OAuth-review hos Strava, så ventetiden er det dyre, ikke koden |

Designet ovenfor er valgt så ingen af dem bliver sværere senere. Ét dokument pr. bruger betyder at en betalings- eller delingsfunktion tilføjer felter frem for tabeller, og at et abonnements-flag er én kolonne.

---

## Forudsætninger, før der skrives kode

Rækkefølgen er ikke tilfældig. Den første har ventetid indbygget.

1. **Resend-konto og verificeret afsenderdomæne.** Supabases indbyggede mailserver sender kun til medlemmer af projektets egen organisation; alle andre adresser fejler med `Email address not authorized`, og loftet er 2 mails i timen ([kilde](https://supabase.com/docs/guides/auth/auth-smtp)). Magic link vil altså virke når du tester på dig selv og fejle for hver rigtig bruger. Custom SMTP er ikke valgfrit. Verifikation kræver SPF- og DKIM-records, og DNS tager tid. Efter custom SMTP sætter Supabase et startloft på 30 mails i timen, som kan hæves.
2. **Supabase-projekt i EU-region.** Regionen kan ikke ændres bagefter uden migrering.
3. **Databehandleraftalen accepteret** (`supabase.com/legal/dpa`).
4. **`at`-tidsstempler i produktion** — se *Forberedende ændring* nedenfor. Jo før den er ude, jo mere fremdrift er tidsstemplet den dag skyen tændes.

---

## Forberedende ændring (sendes ud før resten)

Fremdrift gemmes i dag som `progress[key] = {done, actualKm}` uden at vide hvornår posten blev skrevet. Uden det kan to browsere ikke afgøres: der er ingen måde at skelne *krydset af på telefonen søndag* fra *fjernet på laptoppen torsdag*.

Reglen "afkrydset vinder altid" duer ikke, fordi et kryds skal kunne fortrydes.

Derfor får hver post et `at`:

```js
progress[key] = { done, actualKm, at: new Date().toISOString() }
```

Sættes hvert sted fremdrift skrives: checkbox-handleren, log-knappen, og km-inputtets `onchange`. Poster uden `at` behandles som `at: 0` i fletningen, så en tidsstemplet post altid slår dem.

Dette er en selvstændig, bagudkompatibel ændring. Den kan sendes ud alene.

---

## Datamodel

Én tabel. Ingen relationer, fordi der aldrig forespørges på tværs af planer eller brugere.

```sql
create table libraries (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  doc          jsonb       not null,
  version      bigint      not null default 1,
  updated_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
```

`version` bruges til at opdage samtidige skrivninger. `last_seen_at` driver opbevaringsreglen og opdateres ved hver synkronisering.

### Dokumentets form

```jsonc
{
  "v": 1,
  "plans": {
    "p1757148000000": {
      "id": "p1757148000000",
      "sport": "lob",
      "label": "42 km løb",
      "target": 42,
      "weeksAvailable": 12,
      "sessionsPerWeek": 4,
      "startDate": "2026-09-06",
      "raceDate": null,
      "createdAt": "2026-09-06",
      "updatedAt": "2026-09-06T09:41:12.004Z",
      "fitnessLevel": "Erfaren",
      "generatedBy": "ai",
      "weeks": [ /* uændret form */ ],
      "progress": {
        "0_0": { "done": true, "actualKm": 8, "at": "2026-09-06T18:02:11.900Z" }
      }
    }
  },
  "tombstones": {
    "p1757100000000": "2026-09-05T20:14:03.000Z"
  }
}
```

`updatedAt` er nyt på planen og sættes ved oprettelse og ved replan. Det afgør hvilken side der vinder for selve planindholdet.

Størrelse: en 100-sessioners plan er 6.917 bytes JSON (målt 2026-09-06). Ti planer ligger omkring 70 KB. En jsonb-kolonne mærker det ikke, og der er derfor ingen grund til at normalisere.

---

## Fletning

Fletningen er den ene ting i C der kan tabe data i stilhed. Den ligger derfor serverside, i ét modul, testbart uden browser.

```
merge(server, client):
  tombstones = union(server.tombstones, client.tombstones)   // tidligste dato vinder
  plans = {}
  for id in union(server.plans, client.plans):
    if id in tombstones: continue                            // sletning er endelig
    s = server.plans[id]; c = client.plans[id]
    if not s: plans[id] = c; continue
    if not c: plans[id] = s; continue
    base = (c.updatedAt > s.updatedAt) ? c : s               // planindhold
    plans[id] = { ...base, progress: mergeProgress(s.progress, c.progress) }
  return { v: 1, plans, tombstones }

mergeProgress(a, b):
  for key in union(a, b):
    if key only in one side: take it
    else: take the entry with the later ts(); ved lige stand vinder serverens
```

`at` er en ISO 8601-streng. Sammenlign altid gennem en hjælper, aldrig som streng mod tal:

```js
const ts = (e) => (e && e.at ? Date.parse(e.at) || 0 : 0);
```

En post uden `at`, eller med en uparselig værdi, giver 0 og taber dermed altid til en tidsstemplet post. Det er den ønskede adfærd for fremdrift skrevet før feltet fandtes.

**Sletning slår alt.** Er et id i `tombstones` på blot én af siderne, findes planen ikke i resultatet — også hvis den anden side har nyere fremdrift. Det følger direkte af beslutning 5, og det er prisen for at planer ikke genopstår som spøgelser.

**Tombstones ryddes efter 12 måneder.** De er få dusin bytes hver, men skal ikke vokse uendeligt. Efter 12 måneder kan ingen enhed rimeligvis stadig ligge med en usynkroniseret kopi, og inaktive konti er alligevel slettet på det tidspunkt.

**Klienten skal begynde at føre tombstones lokalt.** I dag fjerner sletning blot planen fra `plans-index` og sletter `plan-<id>`; der efterlades intet spor. Uden et lokalt spor kan klienten ikke fortælle serveren at planen er slettet, og serverens kopi ville blive flettet tilbage ved næste synkronisering — netop den spøgelsesadfærd beslutning 5 findes for at undgå. Sletning skal derfor skrive `{id: slettetTidspunkt}` i en lokal `tombstones`-nøgle, som følger med i `doc` ved synkronisering. Det gælder også for brugere der aldrig logger ind; de bærer bare en nøgle ingen læser.

---

## Synkroniseringsflowet

**localStorage skrives altid først.** UI'et venter aldrig på nettet, hverken logget ind eller ej.

### Endpoint

`POST /api/sync` med `{ doc, baseVersion }`. Svarer altid `{ doc, version }` — det flettede dokument. Klienten erstatter sit lokale bibliotek med svaret, så der er én sandhed efter hver synkronisering i stedet for to der driver fra hinanden.

Serveren skal læse, flette og skrive **i én transaktion med `select ... for update`**. Uden det kan to enheder der synkroniserer samtidig overskrive hinandens fletning.

```
begin
  select doc, version from libraries where user_id = $1 for update
  if not found: insert client doc, version 1
  else if version = baseVersion: doc = client doc
  else: doc = merge(server doc, client doc)
  update libraries set doc = $doc, version = version + 1,
                       updated_at = now(), last_seen_at = now()
commit
```

### Hvornår der synkroniseres

| Hændelse | Adfærd |
|---|---|
| Login, og hver sideindlæsning når logget ind | Hent, flet, tegn |
| Ændring i planer eller fremdrift | Debounce 2 sekunder — ellers ét kald pr. afkrydsning |
| `visibilitychange` → skjult, og `pagehide` | Skyl straks. Telefonen-i-lommen-tilfældet |
| `online` | Skyl det der venter |

### Når det fejler

Intet går tabt: localStorage er allerede skrevet, før nettet røres.

Et `dirty`-flag markerer at der mangler at blive sendt. Der prøves igen med voksende pause (2s, 8s, 30s, derefter hvert minut). Ved fejl vises en tilstand, ikke en fejlbesked: *gemt i skyen* / *gemmer* / *ikke gemt endnu*. Brugeren kan alligevel ikke gøre noget ved en 500'er, og appen virker uændret imens.

Ved `401` (session udløbet) stoppes synkroniseringen stille, og login foreslås igen næste gang appen åbnes.

### Hvad der ikke synkroniseres

Sprogvalg og hvilken fane man stod på. Kun biblioteket.

---

## Auth

Supabase magic link, implicit flow, `detectSessionInUrl: true`. Supabase-klienten hentes fra CDN, da projektet ikke har et build-trin.

**`Cache-Control: no-store` på `index.html` er påkrævet.** Tokenet lander i URL-hashet, og uden `no-store` kan en cachet side med et hash-token nå den forkerte browser. I `vercel.json` betyder det en `headers`-nøgle på catch-all-ruten — samme rute som lookahead-rettelsen fra `49202aa`. Prisen er at de ~148 KB SPA hentes forfra ved hver indlæsning i stedet for at ligge i cachen.

Det skal testes i en kold fane på en anden maskine før C går live.

**Login foreslås efter første plan er lavet.** Et diskret felt, ikke en modal. Afviser man, spørges der ikke igen automatisk.

**Log ud** stopper synkroniseringen og lader det lokale bibliotek ligge. Appen virker videre præcis som før login. På en delt computer betyder det at planerne bliver liggende — det er en bevidst afvejning til fordel for ikke at miste træning.

**Migrering er ikke et selvstændigt endpoint.** Første login er blot den første synkronisering mod et tomt dokument, og fletningen gør resten. `/api/migrate-plan` fra CEO-planen udgår, og dermed også hele id-problemet den beskrev: `plan.id` bliver aldrig en uuid, det forbliver `"p"+Date.now()` inde i dokumentet.

---

## Opbevaring og sletning

`last_seen_at` opdateres ved hver synkronisering.

En månedlig kørsel (pg_cron) sender en advarsel via Resend efter **11 måneders** stilhed og sletter rækken efter **12**. `on delete cascade` fra `auth.users` gør at sletning af kontoen tager biblioteket med.

Sletning på brugerens anmodning er én række plus Supabase-brugeren. Der skal være en knap til det i appen, ikke kun en email-adresse.

En privatlivspolitik skal skrives. Den findes ikke i dag, fordi appen indtil nu ikke har gemt persondata overhovedet.

---

## Test

`scripts/validate-sync.mjs`, exit 0/1, samme mønster som `scripts/validate-generate.mjs`. Kører mod fletningsmodulet direkte, uden browser og uden database.

Tilfælde der skal dækkes:

1. Samme session krydset af på begge sider med forskellig `at` — den seneste vinder
2. Krydset af på den ene side, fortrudt på den anden — den seneste `at` vinder, ikke "afkrydset vinder"
3. Poster uden `at` mod poster med — den tidsstemplede vinder
4. Plan slettet på den ene side, redigeret på den anden — sletningen vinder
5. Plan findes kun på den ene side — bevares
6. Replan på den ene side, fremdrift på den anden — nye uger og bevaret fremdrift i samme resultat
7. To browsere ude af sync i en uge, begge med ændringer — intet krydset tabes
8. Tomt serverdokument mod fyldt klient — førstegangsmigrering
9. Tombstone ældre end 12 måneder — ryddes
10. Samtidige skrivninger mod samme bruger — versionen hæves én gang pr. skrivning, ingen tabt opdatering

---

## Risici

**`Cache-Control: no-store` rammer indlæsningstiden.** 148 KB hentes forfra hver gang. Måles efter C, og genbesøges hvis det er mærkbart.

**Implicit flow er den svagere af de to muligheder.** Valgt bevidst (beslutning 7). Genbesøges hvis appen nogensinde håndterer mere følsomme data end træningskilometer.

**`vercel.json` har bidt to gange på én dag** — først `builds`-formatet der gjorde `functions` umuligt, så catch-all'en der slugte analytics-scriptet. `no-store`-headeren skal ind i samme fil. Verificér med `curl -I` mod produktion, ikke ved at læse konfigurationen.

**Fletningen kan ikke testes af brugerne.** Den fejler stille, per definition. Derfor er `validate-sync.mjs` ikke valgfri, og derfor ligger fletningen serverside frem for i `index.html`.

---

## Åbent, bevidst udskudt

- **Fase-tabellens hul for uge 21-24.** Kræver en rigtig træner, ikke kode. Uafhængigt af C.
- **Raw-fallbacken for delelinks.** Krydser 8000-tegnsloftet mellem 80 og 90 sessioner på browsere uden `CompressionStream`. Fejler pænt. Beslutning udskudt.
- **Måldistance-heuristikken** rammer 12-13 af 14. Fungerer, er upræcis.
