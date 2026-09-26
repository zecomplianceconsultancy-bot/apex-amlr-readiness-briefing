# AI Workspace — MVP

Eigen AI Master Workspace / Orchestrator: één webapp waarin je projecten beheert en waarachter
meerdere AI-modellen (Claude, OpenAI, later Gemini/research-providers) als verwisselbare engines
draaien — met provenance, audit trail en datapolicy vanaf dag één.

Architectuur, datamodel, security en roadmap: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Wat zit erin

- Login (Argon2id, serversessies), projecten met rollen (eigenaar / bewerker / lezer)
- Centrale chat met live streaming, modelkiezer en "automatisch" (router)
- Providers: Anthropic (Claude), OpenAI (Responses API), offline mock — via één AI Gateway
- Projectcontext met versiebeheer, hergebruikt in elk gesprek
- File upload (txt, md, csv, json, pdf) — versleuteld opgeslagen, tekst optioneel in context
- Provenance per antwoord: model + gerapporteerde versie, routing, exacte payload, context- en
  bestandsversies, tokens, latency, policybesluit
- Dataclassificatie per project vs. clearance per model (server-side afgedwongen)
- PII-masking (e-mail, IBAN, BSN, telefoon, kaartnummers) vóór verzending
- Append-only, hash-chained audit trail + verificatie

## Snel starten

Vereist: Node.js ≥ 20.9 en PostgreSQL 16 (lokaal of via Docker).

```bash
cd ai-workspace
npm install
docker compose up -d                      # of gebruik een eigen Postgres
cp .env.example .env
# Vul ENCRYPTION_KEY in:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Optioneel: ANTHROPIC_API_KEY en/of OPENAI_API_KEY. Zonder keys werkt de offline mock.

npm run db:migrate
npm run user:create -- --email jij@example.com --name "Jouw naam" --admin
npm run dev                               # http://localhost:3000
```

## Scripts

| Script | Doel |
|---|---|
| `npm run dev` / `build` / `start` | Next.js ontwikkelen / bouwen / draaien |
| `npm run typecheck` | TypeScript-controle |
| `npm test` | Unit- en integratietests (vereist testdatabase, zie hieronder) |
| `npm run db:generate` | Nieuwe migratie genereren na schemawijziging |
| `npm run db:migrate` | Migraties toepassen |
| `npm run user:create` | Gebruiker aanmaken (geen publieke registratie) |
| `npm run audit:verify` | Hash-chain van de audit trail controleren |

Tests draaien tegen een aparte database (standaard
`postgres://workspace:workspace@localhost:5432/ai_workspace_test`, of `TEST_DATABASE_URL`).
De test-suite **wist en herbouwt** die database bij elke run.

```bash
createdb -U workspace ai_workspace_test   # eenmalig
npm test
```

## Een provider toevoegen

1. Implementeer `AIProvider` in `src/server/ai/providers/<naam>.ts`.
2. Registreer hem in `src/server/ai/providers/index.ts`.
3. Voeg modellen toe aan `src/server/ai/registry.ts`, met een bewuste `clearance`.
4. Voeg de API-key toe aan `src/server/config/env.ts` en `.env.example`.

UI, datapolicy, PII-masking, provenance en audit werken daarna automatisch.
