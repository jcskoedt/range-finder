# C — cloud sync, implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Et valgfrit login der løbende sikkerhedskopierer hele biblioteket til Supabase, så en plan aldrig går tabt fordi en browser blev ryddet.

**Architecture:** localStorage forbliver det primære lager og skrives altid først. Er man logget ind, sendes hele biblioteket som ét jsonb-dokument til `/api/sync`, som fletter serverside og svarer med det flettede resultat. Fremdrift flettes pr. session på et tidsstempel; sletning er endelig via tombstones.

**Tech Stack:** Vanilla JS i én HTML-fil (intet build), Vercel Node-funktioner, Supabase (Auth + Postgres), Resend til SMTP.

**Spec:** `docs/superpowers/specs/2026-09-06-c-cloud-sync-design.md`

## Global Constraints

- **Intet build-trin.** `index.html` serveres råt. Alle biblioteker hentes fra CDN med `<script src>`; bare specifiers (`import x from "pkg"`) virker ikke i browseren.
- **Ét sprog ad gangen.** Alle brugervendte strenge skal ind i `I18N`-objektet med både `da`- og `en`-variant. Ingen hardkodede strenge i markup.
- **Struktur i kode, indhold fra modellen.** Projektets bærende regel. Her betyder den: fletningen er deterministisk kode, aldrig en heuristik.
- **Testbar uden browser.** Fletningen skal kunne importeres af et `.mjs`-script uden env-variabler. Supabase-klienten oprettes derfor **inde i handleren**, aldrig på modulniveau. Verificér med `env -i node --input-type=module -e "import('.../api/sync.js')"` — en gate som en urelateret afhængighedsopgradering kan knække, er ikke en gate. (`api/generate.js` har sin klient på modulniveau og importerer alligevel uden nøgle, fordi Anthropic-SDK'en først kaster ved kald. Det er held, ikke design, og det bør ikke kopieres.)
- **Alt lokalt først.** Der pushes og deployes kun når Jacob eksplicit siger til. Commits lokalt er fint.
- **`vercel.json` er skrøbelig.** Den har fejlet to gange på ét døgn. Verificér altid med `curl -I` mod produktion, aldrig ved at læse konfigurationen.
- **Sport-nøgler er ASCII:** `cykling` / `lob` / `svomning`.

## Afvigelse fra ren TDD — læs dette først

Projektet har ingen unit-test-opsætning. Testdisciplinen er to gates (`scripts/validate-generate.mjs`, `scripts/sweep-plan-length.mjs`) plus verifikation i en rigtig browser via `/browse`.

Planen følger det:

- **Fletningen (Task 3)** er ren TDD. Den er rene funktioner uden I/O, testes af `scripts/validate-sync.mjs`, og gaten skrives **før** implementeringen.
- **`index.html`-ændringer** verificeres i browseren med konkrete kommandoer og forventet output. Det er projektets etablerede metode, og det er den eneste der fanger fejl som `t`-skygningen der kostede en aften.
- **Endpointet (Task 5)** verificeres med `curl` mod en lokal `vercel dev` eller mod produktion efter deploy.

Skriv ikke en Jest-opsætning ind i projektet som en del af den her plan. Det er en selvstændig beslutning.

## Filstruktur

| Fil | Ansvar | Nyt? |
|---|---|---|
| `api/sync.js` | Fletningen (eksporteret) + `POST`-handleren. Samme mønster som `api/generate.js`, der både har handler og eksporterer sine helpers til gaten | Ny |
| `scripts/validate-sync.mjs` | Gate for fletningen. 10 konfliktsituationer, exit 0/1 | Ny |
| `supabase/schema.sql` | Tabel, RLS, cron. Anvendes manuelt i Supabases SQL-editor og ligger i repoet som kilde | Ny |
| `index.html` | Tidsstempler, tombstones, auth, synkroniseringsløkke, statusvisning, login-prompt | Ændres |
| `vercel.json` | `Cache-Control: no-store` på catch-all'en | Ændres |
| `HANDOFF.md`, `TODOS.md` | Opdateres til sidst | Ændres |

`index.html` er 3114 linjer og vokser videre. Projektet er bevidst single-file, så planen splitter den ikke — det ville være en selvstændig beslutning.

**Vigtigt om `api/`:** `vercel.json` bygger `api/*.js` som funktioner, så **enhver** `.js` i `api/` bliver et offentligt endpoint. Læg derfor ikke et hjælpemodul i `api/` uden en handler. Fletningen bor i `api/sync.js` sammen med handleren, præcis som `api/replan.js` importerer fra `api/generate.js`.

---

## ✅ Task 1: Tidsstempel på fremdrift

Bagudkompatibel og kan sendes ud alene. Jo før den er ude, jo mere fremdrift er tidsstemplet den dag skyen tændes.

**Files:**
- Modify: `index.html` — **seks** skrivesteder, ikke tre. PLAN-fanen: checkbox (`data-cb`), km-input (`data-inp`), log-knap (`data-logbtn`). IDAG-fanen i `renderTabToday`: `#todayLogBtn`, `#todayUndoBtn`, `#todayActKm`.

  IDAG-fanen blev overset i første udkast af planen. `#todayUndoBtn` sætter `done=false`, og uden tidsstempel dér ville en fortrydelse altid tabe en fletning mod et gammelt kryds — netop testcase 2 i gaten.

**Interfaces:**
- Produces: fremdrifts-poster på formen `{done, actualKm, at}` hvor `at` er `new Date().toISOString()`. Task 3 fletter på `at`.

- [ ] **Step 1: Find de tre skrivesteder**

```bash
grep -n "plan.progress\[ikey\]=cur\|cur.actualKm=e.target.value" index.html
```

Forventet: seks steder. Tre i `renderTabPlan` omkring linje 2930-2955, og tre i `renderTabToday` omkring linje 2645-2649. Rammer du kun tre, kigger du kun i PLAN-fanen.

- [ ] **Step 2: Tilføj en hjælper ved siden af `track()`**

```js
/* ---------------- FREMDRIFT ---------------- */
// Fletning i C afgøres på hvornår en post blev skrevet. Uden det kan to
// browsere ikke skilles ad: "krydset af på telefonen søndag" ser ud præcis
// som "fjernet på laptoppen torsdag". Poster uden at tæller som ældst.
function stampProgress(entry){return Object.assign({},entry,{at:new Date().toISOString()});}
```

- [ ] **Step 3: Brug den alle tre steder**

Checkbox-handleren:
```js
cur.done=!cur.done;if(cur.done&&(cur.actualKm==null||cur.actualKm===''))cur.actualKm=km;
if(cur.done)track("session_logged",{week_idx:wIdx,source:plan.generatedBy||"unknown"});
plan.progress[ikey]=stampProgress(cur);await savePlan(plan);renderTabPlan(plan,c);
```

Log-knappen:
```js
const wasDone=cur.done;
cur.done=true;if(!cur.actualKm||cur.actualKm==='')cur.actualKm=km;
if(!wasDone)track("session_logged",{week_idx:wIdx,source:plan.generatedBy||"unknown"});
plan.progress[ikey]=stampProgress(cur);await savePlan(plan);openItemKey=null;renderTabPlan(plan,c);
```

Km-inputtet i PLAN-fanen:
```js
cur.actualKm=e.target.value;plan.progress[ikey]=stampProgress(cur);await savePlan(plan);
```

IDAG-fanens tre, som alle er enkeltlinjer i `renderTabToday`:
```js
// #todayLogBtn
if(lb)lb.onclick=async()=>{const cur=plan.progress[ikey]||{done:false,actualKm:null};cur.done=true;if(!cur.actualKm)cur.actualKm=km;plan.progress[ikey]=stampProgress(cur);await savePlan(plan);renderTabToday(plan,c);};
// #todayUndoBtn — fortrydelse skal stemples, ellers taber den altid en fletning
if(ub)ub.onclick=async()=>{const cur=plan.progress[ikey]||{done:false,actualKm:null};cur.done=false;plan.progress[ikey]=stampProgress(cur);await savePlan(plan);renderTabToday(plan,c);};
// #todayActKm
if(kmI){kmI.onclick=(e)=>e.stopPropagation();kmI.onchange=async(e)=>{const cur=plan.progress[ikey]||{done:true};cur.actualKm=e.target.value;plan.progress[ikey]=stampProgress(cur);await savePlan(plan);};}
```

- [ ] **Step 4: Verificér i browseren**

```bash
B="$HOME/.claude/skills/gstack/browse/dist/browse"
$B goto "file:///Users/jacobcompenskodt/06RANGE_FINDER/index.html"
# lav en plan, åbn en uge, kryds en session af, så:
$B js "JSON.stringify(Object.values(state.activePlan.progress)[0])"
```

Forventet: et objekt med `at` som en ISO-streng, fx `{"done":true,"actualKm":8,"at":"2026-09-06T18:02:11.900Z"}`.

- [ ] **Step 5: Verificér at gamle planer ikke knækker**

```bash
$B js "(function(){const p=state.activePlan;p.progress['9_9']={done:true,actualKm:5};return JSON.stringify(p.progress['9_9'])})()"
```

Forventet: posten uden `at` accepteres uden fejl. Appen må ikke kaste på fremdrift uden tidsstempel.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(progress): stamp each entry with when it was written"
```

---

## ✅ Task 2: Lokale tombstones ved sletning

Uden et lokalt spor kan klienten ikke fortælle serveren at en plan er slettet, og serverens kopi ville blive flettet tilbage.

**Files:**
- Modify: `index.html` — sletteknappen i `renderTabTal`, og `loadIndex`/`saveIndex`-området

**Interfaces:**
- Produces: `localStorage["tombstones"]` som `{[planId]: isoDato}`. Task 7 sender det med i `doc`.

- [ ] **Step 1: Tilføj læsning og skrivning ved siden af `loadIndex`/`saveIndex`**

```js
const TOMBSTONE_KEY="tombstones";
async function loadTombstones(){try{const r=await withTimeout(window.storage.get(TOMBSTONE_KEY,false),STORAGE_TIMEOUT_MS,null);return r&&r.value?JSON.parse(r.value):{}}catch(e){return{};}}
async function addTombstone(id){
  const t=await loadTombstones();
  t[id]=new Date().toISOString();
  await withTimeout(window.storage.set(TOMBSTONE_KEY,JSON.stringify(t)),STORAGE_TIMEOUT_MS,null);
}
```

- [ ] **Step 2: Kald den fra sletteknappen**

Find sletningen (`grep -n "deleteBtn" index.html`) og indsæt før planen fjernes fra indekset:

```js
const id=plan.id;
await addTombstone(id);
state.planIndex=state.planIndex.filter(p=>p.id!==id);
```

- [ ] **Step 3: Verificér i browseren**

```bash
$B js "JSON.stringify(await loadTombstones())"   # før: {}
# slet en plan i UI'et, så:
$B js "JSON.stringify(await loadTombstones())"
```

Forventet: `{"p1757148000000":"2026-09-06T..."}` med det slettede id.

- [ ] **Step 4: Verificér at planen ikke kommer igen ved reload**

```bash
$B reload
$B js "state.planIndex.length"
```

Forventet: samme antal som efter sletningen.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(delete): leave a tombstone so a deleted plan cannot come back"
```

---

## ✅ Task 3: Fletningen og dens gate

Ren TDD. Ingen netværk, ingen database, ingen env-variabler.

**Files:**
- Create: `api/sync.js` (kun eksporterne i denne task — handleren kommer i Task 5)
- Create: `scripts/validate-sync.mjs`

**Interfaces:**
- Produces: `merge(server, client, now) -> doc`, `mergeProgress(a, b) -> progress`, `mergeTombstones(a, b, now) -> tombstones`, konstanterne `DOC_VERSION` og `TOMBSTONE_TTL_MS`. Task 5 bruger `merge`.

- [ ] **Step 1: Skriv gaten først — den skal fejle**

Opret `scripts/validate-sync.mjs`:

```js
#!/usr/bin/env node
// Gate for fletningen i /api/sync.
//
// Fletningen er den ene ting i C der kan tabe data i stilhed: en bruger
// opdager ikke at en session forsvandt, de tror bare de huskede forkert.
// Derfor ligger den i rene funktioner og testes her, uden browser og uden
// database.
//
// Usage: node scripts/validate-sync.mjs

import { merge, mergeProgress, mergeTombstones, TOMBSTONE_TTL_MS } from "../api/sync.js";

let pass = 0, fail = 0;
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FEJL  ${label}\n        fik      ${a}\n        ventede  ${e}`); }
};

const p = (at, extra = {}) => ({ done: true, actualKm: 8, at, ...extra });
const plan = (id, updatedAt, progress = {}) => ({ id, updatedAt, weeks: [], progress });
const NOW = Date.parse("2026-09-06T12:00:00.000Z");

console.log("fremdrift");
eq("1. seneste at vinder",
  mergeProgress({ "0_0": p("2026-09-01T00:00:00.000Z") }, { "0_0": p("2026-09-05T00:00:00.000Z", { actualKm: 12 }) }),
  { "0_0": p("2026-09-05T00:00:00.000Z", { actualKm: 12 }) });

eq("2. fortrydelse vinder hvis den er nyest",
  mergeProgress({ "0_0": p("2026-09-01T00:00:00.000Z") }, { "0_0": { done: false, actualKm: null, at: "2026-09-05T00:00:00.000Z" } }),
  { "0_0": { done: false, actualKm: null, at: "2026-09-05T00:00:00.000Z" } });

eq("3. post uden at taber",
  mergeProgress({ "0_0": { done: true, actualKm: 5 } }, { "0_0": p("2026-09-01T00:00:00.000Z") }),
  { "0_0": p("2026-09-01T00:00:00.000Z") });

eq("4. poster kun på én side bevares",
  mergeProgress({ "0_0": p("2026-09-01T00:00:00.000Z") }, { "1_0": p("2026-09-02T00:00:00.000Z") }),
  { "0_0": p("2026-09-01T00:00:00.000Z"), "1_0": p("2026-09-02T00:00:00.000Z") });

console.log("tombstones");
eq("5. tidligste sletning vinder",
  mergeTombstones({ a: "2026-09-05T00:00:00.000Z" }, { a: "2026-09-06T00:00:00.000Z" }, NOW),
  { a: "2026-09-05T00:00:00.000Z" });

eq("6. tombstone ældre end 12 mdr ryddes",
  mergeTombstones({ a: new Date(NOW - TOMBSTONE_TTL_MS - 1000).toISOString() }, {}, NOW),
  {});

console.log("planer");
eq("7. sletning slår nyere redigering",
  merge({ plans: { a: plan("a", "2026-09-06T00:00:00.000Z") }, tombstones: {} },
        { plans: {}, tombstones: { a: "2026-09-01T00:00:00.000Z" } }, NOW).plans,
  {});

eq("8. plan kun på én side bevares",
  Object.keys(merge({ plans: { a: plan("a", "2026-09-01T00:00:00.000Z") }, tombstones: {} },
                    { plans: { b: plan("b", "2026-09-01T00:00:00.000Z") }, tombstones: {} }, NOW).plans).sort(),
  ["a", "b"]);

eq("9. nyere plan vinder indhold, fremdrift flettes alligevel",
  merge(
    { plans: { a: plan("a", "2026-09-01T00:00:00.000Z", { "0_0": p("2026-09-04T00:00:00.000Z") }) }, tombstones: {} },
    { plans: { a: plan("a", "2026-09-05T00:00:00.000Z", { "1_0": p("2026-09-02T00:00:00.000Z") }) }, tombstones: {} },
    NOW
  ).plans.a.progress,
  { "0_0": p("2026-09-04T00:00:00.000Z"), "1_0": p("2026-09-02T00:00:00.000Z") });

eq("10. tomt serverdokument mod fyldt klient",
  Object.keys(merge({ plans: {}, tombstones: {} },
                    { plans: { a: plan("a", "2026-09-01T00:00:00.000Z") }, tombstones: {} }, NOW).plans),
  ["a"]);

console.log(`\n${pass} ok, ${fail} fejl`);
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: Kør den og se den fejle**

```bash
node scripts/validate-sync.mjs
```

Forventet: `ERR_MODULE_NOT_FOUND` for `../api/sync.js`.

- [ ] **Step 3: Skriv fletningen**

Opret `api/sync.js`:

```js
// Cloud sync for the plan library. See
// docs/superpowers/specs/2026-09-06-c-cloud-sync-design.md
//
// The merge functions are exported so scripts/validate-sync.mjs can exercise
// this exact code rather than a copy that drifts. They are pure: no I/O, no
// env vars, no client. The Supabase client is created inside the handler for
// that reason — api/generate.js builds its client at module scope, which is
// why validate-generate.mjs has to pass a dummy key.

export const DOC_VERSION = 1;
export const TOMBSTONE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

// A progress entry written before the `at` field existed counts as oldest, so
// any stamped entry beats it. An unparseable date is treated the same way.
const ts = (e) => (e && e.at ? Date.parse(e.at) || 0 : 0);

export function mergeProgress(a = {}, b = {}) {
  const out = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[key], y = b[key];
    if (!x) { out[key] = y; continue; }
    if (!y) { out[key] = x; continue; }
    out[key] = ts(y) > ts(x) ? y : x;
  }
  return out;
}

export function mergeTombstones(a = {}, b = {}, now = Date.now()) {
  const out = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    // ISO strings sort lexically, so the earliest deletion wins.
    const at = [a[id], b[id]].filter(Boolean).sort()[0];
    if (now - Date.parse(at) < TOMBSTONE_TTL_MS) out[id] = at;
  }
  return out;
}

export function merge(server, client, now = Date.now()) {
  const tombstones = mergeTombstones(server?.tombstones, client?.tombstones, now);
  const sp = server?.plans || {}, cp = client?.plans || {};
  const plans = {};
  for (const id of new Set([...Object.keys(sp), ...Object.keys(cp)])) {
    if (tombstones[id]) continue;           // deletion is final everywhere
    const s = sp[id], c = cp[id];
    if (!s) { plans[id] = c; continue; }
    if (!c) { plans[id] = s; continue; }
    const base = Date.parse(c.updatedAt || 0) > Date.parse(s.updatedAt || 0) ? c : s;
    plans[id] = { ...base, progress: mergeProgress(s.progress, c.progress) };
  }
  return { v: DOC_VERSION, plans, tombstones };
}
```

- [ ] **Step 4: Kør gaten igen**

```bash
node scripts/validate-sync.mjs
```

Forventet: `10 ok, 0 fejl`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add api/sync.js scripts/validate-sync.mjs
git commit -m "feat(sync): the merge, and a gate that proves it never drops a session"
```

---

## SPÆRRER FOR TASK 5 — fund fra gennemgangen af Task 3

Adversarisk gennemgang af fletningen, 2026-09-06. Alle fire er verificeret i den kørende kode, ikke påstået. **Fletningen må ikke sættes i drift før de er lukket**, for de taber data i stilhed og opdages ikke af brugeren.

**A. `updatedAt` findes ikke i klienten — nul forekomster i `index.html`.** Specen beskriver feltet; ingen task tilføjede det. `upd(c) > upd(s)` er derfor altid `0 > 0`, så **serverens kopi vinder altid planindholdet**. En replan lavet på én enhed rulles tilbage af en anden enheds ældre uger. Samme gælder `dateOverrides`.

Værst: **gaten skjuler det.** Alle tre plan-tests giver et eksplicit `updatedAt` med. Der findes ingen test for den form produktionen faktisk har. Ret koden *og* tilføj en test hvor ingen side har `updatedAt`.

**B. Der er et syvende skrivested til fremdrift.** `index.html:3095`, screenshot-importen, skriver `{done:true, actualKm, source}` uden `at`. Kommentaren ved `stampProgress` påstår seks. En importeret Strava-tur taber derfor til et hvilket som helst stemplet fjernet kryds, uanset alder.

**C. Tombstone-reglen ødelægger tombstones.** Verificeret: `mergeTombstones({a:"2026-09-05"},{a:"2024-09-06"},nu)` giver `{}`. Tidligste-vinder vælger den ældste dato, hvorefter udløbet fjerner den — begge sider er enige om at planen er slettet, og resultatet indeholder ingen sletning. **Specen er også forkert her.** For en oplysning hvis eneste opgave er at overleve, er nyeste-vinder den rigtige regel.

**D. Nulstil fremdrift kan ikke repræsenteres.** `index.html:3043` sætter `plan.progress={}`, men en foreningsmængde har ingen sletning, så hver server-post kommer tilbage. Nulstillingen holder i to sekunder. Rettelsen er at skrive stemplede `{done:false, actualKm:null, at}` for hver eksisterende nøgle i stedet for at rydde objektet.

**E. Debounce-kapløb (hører til Task 7, ikke Task 3).** Klienten erstatter sit lokale bibliotek med svaret. Krydser brugeren felt to af mens kaldet med felt ét er undervejs, overskriver svaret felt to før det er sendt. Vinduet er én rundtur, og at krydse flere felter af i træk er præcis hvordan en uges træning logges. Task 7 skal enten flette svaret ind i det aktuelle lokale dokument frem for at erstatte det, eller kassere svaret hvis der er skrevet lokalt siden kaldet blev sendt.

---

## ✅ Task 4: Supabase-projekt og skema

**Files:**
- Create: `supabase/schema.sql`

**Interfaces:**
- Produces: tabellen `libraries` med kolonnerne `user_id, doc, version, updated_at, last_seen_at`. Task 5 skriver til den.

- [ ] **Step 1: Opret projektet**

I Supabases dashboard: nyt projekt, **EU-region** (kan ikke ændres bagefter uden migrering). Accepter databehandleraftalen på `supabase.com/legal/dpa`.

Noter `SUPABASE_URL`, `SUPABASE_ANON_KEY` og `SUPABASE_SERVICE_ROLE_KEY`.

- [ ] **Step 2: Skriv skemaet**

Opret `supabase/schema.sql`:

```sql
-- Cloud sync for Range Finder. Applied by hand in the Supabase SQL editor;
-- this file is the source of truth for what was applied.

create table if not exists libraries (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  doc          jsonb       not null default '{"v":1,"plans":{},"tombstones":{}}'::jsonb,
  version      bigint      not null default 1,
  updated_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table libraries enable row level security;

-- The endpoint uses the service role and bypasses RLS. These policies exist so
-- that a mistake elsewhere cannot expose one user's library to another.
create policy "own row read"  on libraries for select using (auth.uid() = user_id);
create policy "own row write" on libraries for update using (auth.uid() = user_id);

create index if not exists libraries_last_seen_idx on libraries (last_seen_at);
```

- [ ] **Step 3: Anvend det**

Kopiér ind i Supabases SQL-editor og kør. Verificér:

```sql
select column_name, data_type from information_schema.columns where table_name = 'libraries';
```

Forventet: fem kolonner med de typer der står ovenfor.

- [ ] **Step 4: Læg nøglerne i Vercel**

```bash
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
```

`SUPABASE_ANON_KEY` er offentlig og hardkodes i `index.html` — det er den nøgle browseren skal bruge, og RLS er det der beskytter data, ikke nøglens hemmelighed.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(db): the libraries table, one row per user"
```

---

## ✅ Task 5: `/api/sync`

**Files:**
- Modify: `api/sync.js` — tilføj default-eksporteret handler under de eksisterende eksporter

**Interfaces:**
- Consumes: `merge` fra Task 3, tabellen fra Task 4
- Produces: `POST /api/sync` med body `{doc, baseVersion}` → `{doc, version}`. Task 7 kalder den.

- [ ] **Step 1: Skriv handleren**

Tilføj øverst i `api/sync.js`:

```js
import { createClient } from "@supabase/supabase-js";
```

Og nederst:

```js
// Read, merge and write must be one transaction. Without the row lock two
// devices syncing at the same moment can each merge against the pre-write
// state and the second write silently discards the first one's merge.
const SQL = `
  with locked as (
    select doc, version from libraries where user_id = $1 for update
  )
  select * from locked
`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const token = (req.headers.authorization || "").replace(/^Bearer /, "");
  if (!token) return res.status(401).json({ error: "no_token" });

  // Created here, not at module scope, so the merge functions above stay
  // importable by scripts/validate-sync.mjs with no environment at all.
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return res.status(401).json({ error: "invalid_token" });
  const userId = userData.user.id;

  const { doc: clientDoc, baseVersion } = req.body || {};
  if (!clientDoc || typeof clientDoc !== "object" || !clientDoc.plans) {
    return res.status(400).json({ error: "invalid_doc" });
  }

  const { data, error } = await admin.rpc("sync_library", {
    p_user_id: userId,
    p_doc: clientDoc,
    p_base_version: Number.isInteger(baseVersion) ? baseVersion : 0,
  });
  if (error) {
    console.warn("[sync] " + error.message);
    return res.status(500).json({ error: "sync_failed" });
  }
  return res.status(200).json({ doc: data.doc, version: data.version });
}
```

- [ ] **Step 2: Læg fletningen i databasen som en funktion**

Fletningen skal køre inde i transaktionen. Tilføj til `supabase/schema.sql` og kør i SQL-editoren:

```sql
create or replace function sync_library(p_user_id uuid, p_doc jsonb, p_base_version bigint)
returns table(doc jsonb, version bigint, conflict boolean)
language plpgsql
as $$
declare
  cur_doc jsonb;
  cur_ver bigint;
begin
  select l.doc, l.version into cur_doc, cur_ver
    from libraries l where l.user_id = p_user_id for update;

  if not found then
    insert into libraries (user_id, doc, version) values (p_user_id, p_doc, 1);
    return query select p_doc, 1::bigint, false;
    return;
  end if;

  -- Equal versions mean the client had already seen everything on the server,
  -- so its document is authoritative and no merge is needed.
  if cur_ver = p_base_version then
    update libraries set doc = p_doc, version = cur_ver + 1,
                         updated_at = now(), last_seen_at = now()
      where user_id = p_user_id;
    return query select p_doc, cur_ver + 1, false;
  else
    -- Someone else wrote since this client last synced. Hand the server copy
    -- back untouched; the endpoint merges and calls again.
    return query select cur_doc, cur_ver, true;
  end if;
end;
$$;
```

**Hvorfor `conflict` er en selvstændig kolonne:** uden den kan handleren ikke skelne de to udfald. Begge svarer med en version der er forskellig fra `baseVersion` — den ene fordi den blev hævet ved skrivning, den anden fordi serveren var foran. En boolean gør det utvetydigt frem for at udlede det af tal.

Tilføj i handleren efter `rpc`-kaldet:

```js
  let out = data;
  if (out.conflict) {
    // Merge against what the server actually holds, then write at its version.
    const merged = merge(out.doc, clientDoc);
    const retry = await admin.rpc("sync_library", {
      p_user_id: userId, p_doc: merged, p_base_version: out.version,
    });
    if (retry.error || retry.data?.conflict) {
      // A second conflict means a third device wrote in between. The client
      // retries on its own schedule; nothing is lost, localStorage still holds it.
      return res.status(409).json({ error: "retry" });
    }
    out = retry.data;
  }
  return res.status(200).json({ doc: out.doc, version: out.version });
```

Handleren i Step 1 svarer `{doc, version}` uden `conflict` — feltet er intern mellem SQL og handler og skal ikke ud til klienten.

- [ ] **Step 3: Test mod lokal dev**

```bash
vercel env pull .env.development.local
vercel dev
```

I en anden terminal, med et gyldigt access token fra en test-bruger:

```bash
curl -s -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"doc":{"v":1,"plans":{"a":{"id":"a","updatedAt":"2026-09-06T00:00:00.000Z","weeks":[],"progress":{}}},"tombstones":{}},"baseVersion":0}'
```

Forventet: `{"doc":{...},"version":1}`.

- [ ] **Step 4: Test at anden skrivning fletter**

Kør samme curl igen med `"baseVersion":0` men en anden plan i `plans`. Forventet: svaret indeholder **begge** planer og `version` 2.

- [ ] **Step 5: Test uden token**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/sync -d '{}'
```

Forventet: `401`.

- [ ] **Step 6: Commit**

```bash
git add api/sync.js supabase/schema.sql
git commit -m "feat(sync): the endpoint, merging inside a locked transaction"
```

---

## ✅ Task 6: Auth — magic link og no-store

**Files:**
- Modify: `index.html` — Supabase-klient fra CDN, login-felt, sessionshåndtering, I18N-nøgler
- Modify: `vercel.json` — `Cache-Control: no-store`

**Interfaces:**
- Produces: `state.session` (Supabase-session eller `null`), `signIn(email)`, `signOut()`. Task 7 læser `state.session` for at vide om der skal synkroniseres.

- [ ] **Step 1: Læg `no-store` på catch-all'en**

I `vercel.json`, på den sidste rute:

```json
{ "src": "/(?!_vercel/)(.*)", "dest": "/index.html",
  "headers": { "Cache-Control": "no-store" } }
```

Grunden: tokenet lander i URL-hashet, og en cachet side med et hash-token kan nå den forkerte browser.

- [ ] **Step 2: Hent Supabase fra CDN**

Over app-scriptet i `index.html`:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
```

- [ ] **Step 3: Opret klienten og hydrér sessionen**

```js
/* ---------------- AUTH ---------------- */
const SUPABASE_URL="https://<projekt>.supabase.co";
const SUPABASE_ANON_KEY="<anon key>";   // offentlig; RLS beskytter data, ikke nøglen
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{
  auth:{detectSessionInUrl:true,persistSession:true}
});

async function signIn(email){
  const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin}});
  return !error;
}
async function signOut(){
  await sb.auth.signOut();
  state.session=null;
  render();  // biblioteket bliver liggende — beslutning 10
}
```

- [ ] **Step 4: Lyt på sessionsændringer**

I opstartsblokken nederst:

```js
sb.auth.onAuthStateChange((_e,session)=>{
  state.session=session||null;
  if(session)syncNow("login");
  render();
});
```

- [ ] **Step 5: Tilføj I18N-nøgler**

Både `da` og `en`:

```js
auth_save_title:"Gem din plan",
auth_save_body:"Planen ligger kun i denne browser. Log ind, så gemmes den også i skyen.",
auth_email_ph:"din@email.dk",
auth_send:"Send login-link",
auth_sent:"Tjek din indbakke.",
auth_signout:"Log ud",
sync_saved:"Gemt i skyen", sync_saving:"Gemmer", sync_pending:"Ikke gemt endnu",
```

- [ ] **Step 6: Verificér no-store i produktion efter deploy**

```bash
curl -sI https://rangefinderapp.vercel.app/ | grep -i cache-control
```

Forventet: `cache-control: no-store`. Læs ikke konfigurationen — den fil har fejlet to gange.

- [ ] **Step 7: Verificér magic link i en kold fane på en anden maskine**

Log ind, klik linket i mailen, og bekræft at sessionen hydreres. Det skal testes på en anden enhed end den der bad om linket, før C går live.

- [ ] **Step 8: Commit**

```bash
git add index.html vercel.json
git commit -m "feat(auth): optional magic-link sign-in, and no-store for the hash token"
```

---

## ✅ Task 7: Synkroniseringsløkken

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `state.session` (Task 6), `/api/sync` (Task 5), `loadTombstones` (Task 2)
- Produces: `syncNow(reason)`, `scheduleSync()`, `state.syncState` som `"saved" | "saving" | "pending"`

- [ ] **Step 1: Byg dokumentet af det lokale bibliotek**

```js
/* ---------------- CLOUD SYNC ---------------- */
let syncTimer=null, syncBaseVersion=0;

async function buildDoc(){
  const plans={};
  for(const meta of state.planIndex){
    const full=state.planCache[meta.id]||await loadPlan(meta.id);
    if(full)plans[meta.id]=full;
  }
  return {v:1,plans,tombstones:await loadTombstones()};
}
```

- [ ] **Step 2: Skriv `syncNow`**

```js
// localStorage is already written before this runs, so a failure here never
// loses anything — it only delays the backup.
async function syncNow(reason){
  if(!state.session)return;
  state.syncState="saving";renderSyncBadge();
  try{
    const res=await fetch("/api/sync",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+state.session.access_token},
      body:JSON.stringify({doc:await buildDoc(),baseVersion:syncBaseVersion})
    });
    if(res.status===401){state.session=null;state.syncState="pending";renderSyncBadge();return;}
    if(!res.ok)throw new Error("HTTP "+res.status);
    const out=await res.json();
    syncBaseVersion=out.version;
    await applyDoc(out.doc);
    state.syncState="saved";
  }catch(e){
    console.warn("[sync] "+reason+": "+e);
    state.syncState="pending";
    scheduleRetry();
  }
  renderSyncBadge();
}
```

- [ ] **Step 3: Skriv `applyDoc` — svaret er sandheden**

```js
// The server always answers with the merged document. Replacing the local
// library with it is what keeps the two stores from drifting apart.
async function applyDoc(doc){
  const ids=Object.keys(doc.plans||{});
  for(const id of ids){state.planCache[id]=doc.plans[id];await savePlan(doc.plans[id]);}
  state.planIndex=ids.map(id=>{
    const p=doc.plans[id];
    return {id,sport:p.sport,label:p.label,weeksAvailable:p.weeksAvailable,
            sessionsPerWeek:p.sessionsPerWeek,createdAt:p.createdAt};
  });
  await saveIndex(state.planIndex);
  if(state.activePlan&&doc.plans[state.activePlan.id])state.activePlan=doc.plans[state.activePlan.id];
  render();
}
```

- [ ] **Step 4: Udløserne**

```js
function scheduleSync(){clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncNow("change"),2000);}
let retryDelay=2000;
function scheduleRetry(){setTimeout(()=>syncNow("retry"),retryDelay);retryDelay=Math.min(retryDelay*4,60000);}

document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")syncNow("hidden");});
window.addEventListener("pagehide",()=>syncNow("pagehide"));
window.addEventListener("online",()=>syncNow("online"));
```

Kald `scheduleSync()` fra `savePlan()` og `saveIndex()`, så enhver ændring udløser den.

- [ ] **Step 5: Læg badgen i markup først**

`renderSyncBadge()` skriver til `#syncBadge`. Det element findes ikke endnu, og en wiring uden markup fejler tavst — samme familie som screenshot-importen der stod uden `wireUploadArea()` og var uopnåelig uden at nogen opdagede det.

Ved siden af sprogskifteren i `<body>`:

```html
<div class="sync-badge" id="syncBadge" aria-live="polite"></div>
```

Og i CSS'en, ved siden af `.lang-toggle`:

```css
.sync-badge{
  position:fixed;bottom:16px;left:16px;z-index:20;
  font-size:10px;font-weight:200;letter-spacing:0.1em;text-transform:uppercase;
  color:var(--subtle);pointer-events:none;
}
```

- [ ] **Step 6: Statusvisning**

```js
function renderSyncBadge(){
  const el=document.getElementById("syncBadge");
  if(!el)return;
  if(!state.session){el.textContent="";return;}
  el.textContent=t(state.syncState==="saved"?"sync_saved":state.syncState==="saving"?"sync_saving":"sync_pending");
}
```

Bekræft at elementet faktisk findes, ikke kun at funktionen er skrevet:

```bash
$B js "!!document.getElementById('syncBadge')"
```

Forventet: `true`.

- [ ] **Step 7: Verificér fletning mellem to browsere**

```bash
$B goto "https://<preview>.vercel.app/"      # log ind, lav en plan, kryds session 0_0 af
# i en anden browserprofil: log ind som samme bruger, kryds 1_0 af
# tilbage i den første:
$B js "Object.keys(state.activePlan.progress).sort().join(',')"
```

Forventet: `0_0,1_0`. Begge afkrydsninger overlever.

- [ ] **Step 8: Verificér at offline ikke taber noget**

```bash
$B js "window.dispatchEvent(new Event('offline'))"
# kryds to sessioner af
$B js "state.syncState"           # forventet: "pending"
$B js "window.dispatchEvent(new Event('online'))"
$B js "state.syncState"           # forventet: "saved" efter et øjeblik
```

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "feat(sync): back the library up continuously when signed in"
```

---

## ✅ Task 8: Login foreslås efter første plan

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Vis feltet under planen, ikke som modal**

I `renderTabPlan`, efter delelinket, når `!state.session && !localStorage.getItem("authDismissed")`:

```js
`<div class="auth-nudge">
   <div class="auth-title">${t("auth_save_title")}</div>
   <div class="auth-body">${t("auth_save_body")}</div>
   <input type="email" id="authEmail" placeholder="${t("auth_email_ph")}">
   <button class="btn btn-outline" id="authSend">${t("auth_send")}</button>
   <button class="btn-quiet" id="authDismiss">×</button>
 </div>`
```

- [ ] **Step 2: Wire knapperne**

```js
const sendBtn=document.getElementById("authSend");
if(sendBtn)sendBtn.onclick=async()=>{
  const email=document.getElementById("authEmail").value.trim();
  if(!email)return;
  const ok=await signIn(email);
  alertInline("authSend",ok?t("auth_sent"):t("replan_failed"));
};
const dismiss=document.getElementById("authDismiss");
if(dismiss)dismiss.onclick=()=>{localStorage.setItem("authDismissed","1");render();};
```

**Husk `wireUploadArea`-lektien:** markup uden wiring er sket i det her projekt før, og ingen opdagede det. Verificér at knappen svarer i browseren, ikke kun at den er der.

- [ ] **Step 3: Verificér**

```bash
$B js "!!document.getElementById('authSend')"        # true efter første plan
$B js "document.getElementById('authDismiss').click(); localStorage.getItem('authDismissed')"
```

Forventet: `"1"`, og feltet vises ikke igen efter `render()`.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(auth): offer sign-in once there is a plan worth keeping"
```

---

## ✅ Task 9: Sletning af konto og privatlivspolitik

**Files:**
- Modify: `index.html` — sletteknap i indstillinger
- Create: `privacy.html`
- Modify: `vercel.json` — rute til `privacy.html`

- [ ] **Step 1: Slet-min-konto**

```js
async function deleteAccount(){
  const res=await fetch("/api/sync",{method:"DELETE",
    headers:{"Authorization":"Bearer "+state.session.access_token}});
  if(res.ok){await sb.auth.signOut();state.session=null;render();}
}
```

Tilføj `DELETE`-grenen i `api/sync.js`:

```js
  if (req.method === "DELETE") {
    const { error } = await admin.auth.admin.deleteUser(userId);   // cascade fjerner rækken
    if (error) return res.status(500).json({ error: "delete_failed" });
    return res.status(204).end();
  }
```

- [ ] **Step 2: Skriv `privacy.html`**

Skal nævne: hvilke data der gemmes (email, planer, fremdrift), hvem databehandleren er (Supabase, EU-region), opbevaringsperioden (12 måneders inaktivitet), og hvordan man sletter sig selv. Genbrug appens CSS-tokens.

- [ ] **Step 3: Rute den**

I `vercel.json`, i `builds` og i `routes` **før** catch-all'en:

```json
{ "src": "privacy.html", "use": "@vercel/static" }
{ "src": "/privacy", "dest": "/privacy.html" }
```

- [ ] **Step 4: Verificér**

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://rangefinderapp.vercel.app/privacy
```

Forventet: `200 text/html`.

- [ ] **Step 5: Commit**

```bash
git add index.html privacy.html vercel.json api/sync.js
git commit -m "feat(gdpr): delete your account, and say what is stored"
```

---

## Task 10: Opbevaring — advarsel og sletning

**Files:**
- Modify: `supabase/schema.sql`

- [ ] **Step 1: Advarsels- og slettefunktion**

```sql
-- 11 months of silence gets a warning, 12 gets deleted. auth.users cascade
-- takes the library row with it.
create or replace function sweep_inactive()
returns void language plpgsql as $$
begin
  delete from auth.users u
   using libraries l
   where l.user_id = u.id
     and l.last_seen_at < now() - interval '12 months';
end;
$$;

select cron.schedule('sweep-inactive', '0 3 1 * *', 'select sweep_inactive()');
```

- [ ] **Step 2: Advarsels-mailen**

En Supabase Edge Function der kører dagen før og sender via Resend til brugere med `last_seen_at` mellem 11 og 12 måneder. Kræver Resend-nøglen som secret.

- [ ] **Step 3: Verificér uden at vente et år**

```sql
update libraries set last_seen_at = now() - interval '13 months' where user_id = '<testbruger>';
select sweep_inactive();
select count(*) from libraries where user_id = '<testbruger>';
```

Forventet: `0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(retention): warn at eleven months, delete at twelve"
```

---

## Task 11: Dokumentation

- [ ] **Step 1: `HANDOFF.md`** — nyt afsnit om cloud sync ved siden af *Måling*: dokumentets form, fletteregler i én sætning, og at `validate-sync.mjs` skal køres før fletningen røres. Tilføj `api/sync.js`, `scripts/validate-sync.mjs` og `supabase/schema.sql` til nøglefil-tabellen.

- [ ] **Step 2: `CLAUDE.md`** — udvid regel 2. Der står i dag "kør gaten før du rører en prompt". Tilføj: kør `validate-sync.mjs` før du rører fletningen.

- [ ] **Step 3: `TODOS.md`** — flyt C til Færdigt, og flyt de udskudte punkter fra specens *Senere, ikke nu* op i backloggen med deres afhængigheder.

- [ ] **Step 4: Commit**

```bash
git add HANDOFF.md CLAUDE.md TODOS.md
git commit -m "docs: record cloud sync and its gate"
```

---

## Selvtjek mod specen

| Spec-krav | Task |
|---|---|
| `at` pr. fremdrifts-post | 1 |
| Lokale tombstones | 2 |
| Fletteregler, alle 10 testtilfælde | 3 |
| Én tabel, jsonb, version, last_seen_at | 4 |
| `/api/sync`, transaktion med row lock | 5 |
| Implicit flow, `no-store` | 6 |
| Fire udløsere, debounce, dirty, statusvisning | 7 |
| Login efter første plan | 8 |
| Sletning på anmodning, privatlivspolitik | 9 |
| 11 måneders advarsel, 12 måneders sletning | 10 |
| EU-region, DPA | 4, Step 1 |
| Resend som forudsætning | Forudsætning før Task 6 |
| Migrering = første sync | 7 (ingen selvstændig task — det er formålet) |

**Ikke dækket, med vilje:** de fem punkter under *Senere, ikke nu* i specen.
