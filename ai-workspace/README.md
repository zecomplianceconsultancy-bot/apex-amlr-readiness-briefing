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
- **Drie werkwijzen in één invoerbalk:**
  - **Chat**: "Automatisch" kiest per vraag het model met de beste sterke punten, en toont waarom.
  - **Vergelijk**: dezelfde vraag aan 2–4 modellen tegelijk, plus een analyse van consensus,
    verschillen en mogelijke fouten, met een overeenstemmingsscore.
  - **Diep onderzoek**: onderzoek met bronnen (Perplexity) → uitwerking (ChatGPT) →
    onafhankelijke controle (Claude) → feitencheck (Gemini) → eindantwoord. Het oordeel van de
    controleur en de feitencheck is zichtbaar.
- Sterke punten per model sturen de standaardrolverdeling (één klik: "Op sterke punten verdelen")
- Promptbibliotheek (persoonlijk of gedeeld per project, met voorbeeldprompts), zoeken in alle
  gesprekken, export naar Markdown, kopieerknoppen
- Stabiel: dagelijkse automatische back-up (7 bewaard), automatisch herstarten, bescherming tegen
  dubbel starten, logbestanden in `data/logs`
- **Niets zonder toestemming:** browserbesturing staat standaard uit; aangezet vraagt de workspace
  vóór elke actie om toestemming (eenmalig of tot afsluiten), en alles wordt geaudit. Het
  startbestand vraagt één keer of het je browser automatisch mag openen.
- Browser-tools (optioneel, met toestemming): Perplexity, ChatGPT, Claude, Gemini via hun
  webinterface (live antwoord, bronnen, thread-link)
- Handmatige brug voor tools die geautomatiseerde browsers blokkeren: de workspace zet de vraag
  klaar, jij verstuurt hem in je eigen browser en plakt het antwoord terug (met bronnen en audit)
- Optioneel: Perplexity API (`PERPLEXITY_API_KEY`), naast de al ingebouwde Claude- en OpenAI-API
- API-providers: Anthropic (Claude), OpenAI (Responses API), plus een offline mock, allemaal via
  één AI Gateway
- Projectcontext met versiebeheer, hergebruikt in elk gesprek
- File upload (txt, md, csv, json, pdf) — versleuteld opgeslagen, tekst optioneel in context
- Provenance per antwoord: model + gerapporteerde versie, routing, exacte payload, context- en
  bestandsversies, tokens, latency, policybesluit
- Dataclassificatie per project vs. clearance per model (server-side afgedwongen)
- PII-masking (e-mail, IBAN, BSN, telefoon, kaartnummers) vóór verzending
- Append-only, hash-chained audit trail + verificatie

## Starten op je computer (geen GitHub, geen Docker nodig)

Alles draait **op je eigen computer**. Je gegevens (database, bestanden, ingelogde
AI-tools) staan in de map `data/` naast de app.

1. Installeer eenmalig **Node.js LTS** via https://nodejs.org.
   Op Windows installeert het startbestand dit ook zelf als het ontbreekt.
2. Pak de ZIP uit naar een vaste plek, bijvoorbeeld `Documenten\ai-workspace`.
3. Dubbelklik op het startbestand:
   - **Windows:** `start-windows.bat`
   - **Mac:** `start-mac.command`. Macs openen dit de eerste keer niet met een dubbelklik:
     klik met rechts → *Open* → *Open*.
4. De eerste keer installeert het de benodigde onderdelen en bereidt het de app voor
   (enkele minuten, internet nodig). Daarna start het in enkele seconden.
5. Het startbestand vraagt één keer of het je browser automatisch mag openen. Ga naar
   **http://127.0.0.1:3000** en maak je account aan.
6. Werk met de modellen "(handmatig)" (jij plakt) of met een API. Browserbesturing is optioneel
   en staat uit tot je hem zelf aanzet onder **Browser-tools**.

Laat het zwarte venster open terwijl je werkt; sluit het om te stoppen.
**Back-up:** kopieer de map `data/`. Die bevat ook de encryptiesleutel; zonder die sleutel
zijn opgeslagen bestanden niet te openen.

De app is alleen bereikbaar vanaf je eigen computer. Het netwerk wordt alleen gebruikt voor
de AI-tools zelf en voor de eenmalige installatie van onderdelen.

### Voor ontwikkelaars

```bash
npm install
npm run dev                  # http://localhost:3000, ingebouwde database in ./data
npm test                     # tests op de ingebouwde database
npm run test:postgres        # dezelfde tests tegen PostgreSQL (TEST_DATABASE_URL, wordt gewist!)
```

Team- of servergebruik: zet `DATABASE_URL` naar een PostgreSQL-server (zie
`docker-compose.yml`). Maak gebruikers dan aan met
`npm run user:create -- --email … --name … --admin`.

## Scripts

| Script | Doel |
|---|---|
| `npm run dev` / `build` / `start` | Next.js ontwikkelen / bouwen / draaien |
| `npm run typecheck` | TypeScript-controle |
| `npm test` | Unit- en integratietests (vereist testdatabase, zie hieronder) |
| `npm run db:generate` | Nieuwe migratie genereren na schemawijziging |
| `npm run db:migrate` | Migraties toepassen (gebeurt ook automatisch bij het starten) |
| `npm run start:desktop` | Het startprogramma zelf (wat de startbestanden aanroepen) |
| `npm run user:create` | Gebruiker aanmaken (geen publieke registratie) |
| `npm run audit:verify` | Hash-chain van de audit trail controleren |

## Een provider toevoegen

1. Implementeer `AIProvider` in `src/server/ai/providers/<naam>.ts`.
2. Registreer hem in `src/server/ai/providers/index.ts`.
3. Voeg modellen toe aan `src/server/ai/registry.ts`, met een bewuste `clearance`.
4. Voeg de API-key toe aan `src/server/config/env.ts` en `.env.example`.

UI, datapolicy, PII-masking, provenance en audit werken daarna automatisch.
