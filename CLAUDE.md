# RANGE FINDER — Project Instructions

## Start her

Læs `HANDOFF.md` først. Den forklarer hvad appen er, hvordan delene hænger sammen, hvordan man deployer og verificerer, og — vigtigst — hvilke fejl der allerede har kostet tid. `TODOS.md` har det åbne arbejde øverst og en changelog nedenunder.

## Spørg før du bruger credits

**Alt der rammer Anthropic-API'et koster Jacobs penge. Sig hvad det koster, og vent på ja, før du kører det.** Ikke kør først og rapportér bagefter.

| Hvad | Kald | Ca. pris |
|---|---|---|
| `scripts/validate-generate.mjs` | 16 | **$0,25** |
| `scripts/sweep-plan-length.mjs` | 27 | **$0,45** |
| Én plan mod `/api/generate` | 1 | $0,01 |
| Én justering mod `/api/replan` | 1 | $0,02 |

Haiku 4.5: $1 pr. million input-tokens, $5 pr. million output. Output er det dyre — en 24-ugers plan er målt til 4.693 output-tokens.

**Koster ingenting:** kald der afvises før modellen (400, 422, 429), `client.models.retrieve()`, og alt arbejde i browseren mod stub-serveren. Test mod stubben når du kan — den er gratis og hurtigere.

Kører du samme script igen, spørg igen. Fem kørsler af gaten er $1,25, ikke $0,25.

## To regler der ikke må brydes

**1. Struktur i kode, indhold fra modellen.** Faser, ugetal og andet der skal være præcist beregnes i JavaScript og udleveres til Claude. Den oprindelige prompt lod modellen selv tælle: 4 af 15 samples bestod. Med faserne udleveret: 14 af 15. Enhver ny AI-funktion skal følge samme mønster.

**2. Kør gaten før du rører en prompt.**
```bash
ANTHROPIC_API_KEY=... node scripts/validate-generate.mjs
```
16 samples, exit 0/1. Senest 16/16.


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
