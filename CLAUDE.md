# RANGE FINDER — Project Instructions

## Start her

Læs `HANDOFF.md` først. Den forklarer hvad appen er, hvordan delene hænger sammen, hvordan man deployer og verificerer, og — vigtigst — hvilke fejl der allerede har kostet tid. `TODOS.md` har det åbne arbejde øverst og en changelog nedenunder.

## Grænse for API-credits: $0,24

Koster noget **mere end $0,24**, så sig hvad det koster — antal kald, model, beløb — og vent på ja. Under grænsen: bare kør, og nævn prisen i opsummeringen.

Grænsen ligger med vilje under prisen på begge valideringsscripts, så de **altid** kræver et ja. Tællingen er kumulativ: kører du noget billigt mange gange, så læg sammen.

| Hvad | Kald | Pris | Kræver ja? |
|---|---|---|---|
| `scripts/validate-generate.mjs` | 16 | $0,25 | **ja** |
| `scripts/sweep-plan-length.mjs` | 27 | $0,45 | **ja** |
| Én plan mod `/api/generate` | 1 | $0,01 | nej |
| Én justering mod `/api/replan` | 1 | $0,02 | nej |

Haiku 4.5: $1 pr. million input-tokens, $5 pr. million output. Output er det dyre — en 24-ugers plan er målt til 4.693 output-tokens.

**Koster ingenting:** kald der afvises før modellen (400, 422, 429), `client.models.retrieve()`, og alt arbejde mod den lokale stub-server. Test mod stubben når du kan — gratis og hurtigere.

## To regler der ikke må brydes

**1. Struktur i kode, indhold fra modellen.** Faser, ugetal og andet der skal være præcist beregnes i JavaScript og udleveres til Claude. Den oprindelige prompt lod modellen selv tælle: 4 af 15 samples bestod. Med faserne udleveret: 14 af 15. Enhver ny AI-funktion skal følge samme mønster.

**2. Kør gaten før du rører en prompt — eller fletningen.**
```bash
ANTHROPIC_API_KEY=... node scripts/validate-generate.mjs   # prompten, 16 samples
node scripts/validate-sync.mjs                             # fletningen, 19 tilfælde
```
Begge exit 0/1. Senest 16/16 og 19/19.

Fletnings-gaten kræver hverken nøgle eller netværk. Den findes fordi fletningen er den ene del af cloud sync der kan tabe data i stilhed — en bruger opdager ikke at en session forsvandt, de tror de huskede forkert.

**Og opbevaringsreglen har sin egen.** Rører du `sweep_inactive()`, viewet `retention_accounts` eller `api/retention-warn.js`, så kør `supabase/verify-retention.sql` gennem Supabase-MCP'en — syv konti, fire tællere, ét sweep, én transaktion. Den hører til her af samme grund som fletningen: den sletter konti, og en fejl i den opdager ingen bruger. Senest 7/7 og 4/4.

**Og husk hvad en gate ikke kan se.** Da fletningen blev skrevet, gav alle plan-tests et eksplicit `updatedAt` med, mens ingen plan i produktionen havde feltet. Gaten var grøn og beviste noget om en dokumentform ingen havde. Fire af dagens fem synkroniseringsfejl lå i *hvornår* fletningen blev kaldt, ikke i fletningen.


## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec

## Git og deploy — vigtigt

**Alt laves lokalt først. Der pushes og deployes KUN når Jacob eksplicit siger til.**

- Commit lokalt er fint uden at spørge — det er reversibelt og holder arbejdet samlet.
- `git push` kræver at Jacob siger det. Ikke "skal jeg pushe?" efterfulgt af antaget ja — han skal sige det.
- `vercel --prod` og `vercel alias set` kræver det samme. De er udadvendte og ændrer hvad brugere ser.
- Rapportér altid hvad der ligger ucommittet/upushet, så han kan beslutte.

## Domæne

`rangefinderapp.vercel.app` er det eneste domæne der skal bruges. Det er sat til at følge Production automatisk (Vercel → Settings → Domains), så et produktions-deploy er nok.

**Kør aldrig `vercel alias set` på det.** Det ville pinne domænet til én deployment, og så begynder det at servere gammel kode uden at nogen opdager det. Det skete tre gange den 5. september 2026.
