# AI Workspace — MVP

Eigen AI Master Workspace / Orchestrator: één webapp waarin je projecten beheert en van waaruit
je Perplexity, ChatGPT, Claude en Gemini aanstuurt, als verwisselbare engines. Provenance,
audit trail en datapolicy zitten er vanaf dag één in.

**Fase 1 werkt zonder API's.** De workspace bedient de tools via hun webinterface in een
browservenster op je desktop ([docs/BROWSER-TOOLS.md](docs/BROWSER-TOOLS.md)). API-koppelingen
voor Claude en OpenAI zijn al ingebouwd en worden actief zodra je een API-key invult.

Architectuur, datamodel, security en roadmap: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Wat zit erin

- Login (Argon2id, serversessies), projecten met rollen (eigenaar / bewerker / lezer)
- Centrale chat met live streaming, modelkiezer en "automatisch" (router)
- Browser-tools: Perplexity, ChatGPT, Claude, Gemini via hun webinterface (live antwoord, bronnen,
  thread-link), beheerscherm om in te loggen en te controleren
- API-providers: Anthropic (Claude), OpenAI (Responses API), plus een offline mock, allemaal via
  één AI Gateway
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
# Browser-tools staan standaard aan. API-keys zijn optioneel (voor later).

npm run db:migrate
npm run user:create -- --email jij@example.com --name "Jouw naam" --admin
npm run dev                               # http://localhost:3000
```

Open daarna **Browser-tools** (rechtsboven), log per tool één keer in en klik *Controleer*.

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
