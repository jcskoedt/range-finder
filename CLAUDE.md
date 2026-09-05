# RANGE FINDER — Project Instructions

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
