# AI Workspace — Architectuur

> Doel: één gecontroleerde interface waarin projecten worden beheerd en waarachter AI-modellen
> als verwisselbare engines draaien — geschikt om door te groeien naar KYC/AML/compliance-workflows.

Dit document beschrijft (1) de architectuur, (2) de tech stack, (3) het datamodel, (4) de
provider-abstractie, (5) de mappenstructuur, (6) security-by-design en (7) de roadmap.
Alles wat hier als "gebouwd" staat, zit in deze codebase en is getest.

---

## 1. Technische architectuur

```
┌──────────────────────────── Browser ─────────────────────────────┐
│  Next.js UI: projecten · chat + modelkeuze · context · bestanden  │
│  instellingen · provenance-paneel · audit trail                   │
└───────────────┬──────────────────────────────────────────────────┘
                │ HTTPS · httpOnly sessiecookie · same-origin only
┌───────────────▼──────────────────────────────────────────────────┐
│  API-laag  /api/v1/*   (auth, origin-check, validatie met zod)    │
├──────────────────────────────────────────────────────────────────┤
│  Domeinservices: projects · conversations · files · audit         │
│  Autorisatie: projectlidmaatschap + rol (owner/editor/viewer)     │
├──────────────────────────────────────────────────────────────────┤
│  AI-laag                                                          │
│   Orchestrator ─ bouwt de taak (nu: chatbeurt; later: pipelines)  │
│   Context builder ─ projectcontext (versie) + documenten + historie│
│   Router ─ kiest model (nu: handmatig/standaard; later: automatisch)│
│   AI Gateway ─ ENIGE toegang tot providers:                       │
│      egress-policy → PII-masking → request vastleggen → stream →  │
│      resultaat, modelversie, tokens, latency → audit event        │
│   Provider adapters:                                              │
│     browser (fase 1): Perplexity · ChatGPT · Claude · Gemini web  │
│     api: Anthropic · OpenAI · (Gemini, …)   ·   mock (offline)    │
├──────────────────────────────────────────────────────────────────┤
│  PostgreSQL: ingebouwd (desktop) of server (data, provenance, audit)│
│  Blob storage (AES-256-GCM versleuteld; lokaal → later S3/Azure)  │
└──────────────────────────────────────────────────────────────────┘
```

**Kernprincipes**

1. **Model-agnostisch.** De applicatie kent alleen genormaliseerde types (`ChatRequest`,
   `ChatResult`, `ProviderEvent`). SDK-types van Anthropic/OpenAI verlaten hun adapter nooit.
2. **Eén choke point.** Alle modelaanroepen gaan door `AI Gateway`. Daar zitten policy,
   masking, logging en audit — dus het kan niet per feature "vergeten" worden.
3. **Project = segregatie-eenheid.** Alle data hangt aan een project; toegang alleen via
   lidmaatschap. Ook platformadmins zien geen projectinhoud (need-to-know).
4. **Alles is herleidbaar.** Elk AI-antwoord verwijst naar een `model_invocation` met de exacte
   payload, gebruikte contextversie, bestanden (+sha256), routingbesluit, policybesluit,
   gerapporteerde modelversie, tokens en latency.
5. **Modulaire monoliet.** Eén deploybare app met strikt gescheiden lagen (`src/server/*`).
   Geen microservices tot er een echte reden is; de AI-laag kan later zonder herontwerp naar
   een eigen service (de gateway heeft al een service-achtige interface).

**Request flow van één chatbericht**

1. `POST /api/v1/projects/:p/conversations/:c/messages` → sessie + origin-check.
2. Orchestrator: rolcheck (≥ editor), gesprek hoort bij project, gebruikersbericht opslaan.
3. Router: expliciete keuze → projectstandaard → systeemstandaard (besluit + reden wordt bewaard).
4. Context builder: basisinstructies + laatste projectcontextversie + documenten ("in context")
   + gespreksgeschiedenis, binnen een tekenbudget. Wat niet past wordt **gemeld**, nooit stil
   afgekapt.
5. Gateway: classificatie-check → PII-masking → invocation-record (`running`) met payload-hash
   → streamen → record bijwerken → audit event (in dezelfde transactie).
6. SSE naar de browser: `meta` (model, routing, #gemaskeerd, waarschuwingen) → `delta`s → `done`.
7. Afbreken door gebruiker → provider-request wordt geannuleerd, status `cancelled`, gedeeltelijk
   antwoord bewaard.

---

## 2. Tech stack

| Laag | Keuze | Waarom |
|---|---|---|
| Taal | **TypeScript** (strict) end-to-end | Eén taal voor UI en backend, sterke types over de provider-grens. |
| Web/API | **Next.js 16** (App Router, route handlers) | UI + API in één deploy; server components lezen direct uit de servicelaag. |
| UI | React 19 + **Tailwind CSS 4** | Snel, geen zware componentbibliotheek nodig in de MVP. |
| Database | **PostgreSQL 16**, lokaal ingebouwd via **PGlite** | Op de desktop draait PostgreSQL ín de app (PGlite, map `data/db`): niets te installeren. Voor team- of servergebruik is het dezelfde code met `DATABASE_URL` naar een PostgreSQL-server. Transacties, JSONB, triggers (append-only audit) en straks row-level security. |
| ORM/migraties | **Drizzle ORM** + drizzle-kit | SQL-dichtbij, typed, migraties als leesbare SQL-bestanden (auditbaar). |
| Validatie | **zod 4** | Alle input en de environment worden gevalideerd. |
| Auth | Eigen sessies + **Argon2id** | Volledige controle en auditbaarheid; SSO (OIDC/Entra ID) komt in fase 2. |
| AI SDK's | `@anthropic-ai/sdk`, `openai` (Responses API) | Officiële SDK's, alleen binnen de adapters. |
| PDF-tekst | `unpdf` | Pure JS, geen native dependencies. |
| Tests | **Vitest** tegen echte Postgres | Integratietests dekken gateway, policy, masking, rollen, audit. |

**Bewust (nog) niet:** LangChain/LlamaIndex (te veel abstractie over precies de laag die we
zelf willen controleren), microservices, een vector-database (komt met research/RAG in fase 3),
Redis/queues (komt met achtergrondtaken en multi-instance).

**Later toe te voegen:** een Python-worker (document-OCR, entity extraction, scraping) achter een
job-queue (bijv. pg-boss of BullMQ), en pgvector voor semantisch zoeken.

---

## 3. Database-ontwerp

Schema: `src/server/db/schema.ts` · migraties: `drizzle/`.

| Tabel | Doel | Belangrijke keuzes |
|---|---|---|
| `users` | Accounts | Geen publieke registratie; rol `admin`/`member`. |
| `sessions` | Serversessies | Alleen **SHA-256 van het token** opgeslagen; vervaldatum. |
| `projects` | Werkruimte = segregatie-eenheid | `classification` (public → restricted), `pii_redaction`, `default_model_id`. |
| `project_members` | Toegang | Rol per project: `owner` / `editor` / `viewer`. |
| `project_context_versions` | Herbruikbare projectcontext | **Append-only versies**; invocaties verwijzen naar de gebruikte versie. |
| `conversations` | Gesprekken | Altijd gescoped op project. |
| `messages` | Berichten | Assistant-berichten verwijzen naar hun `model_invocation`. |
| `files` | Uploads | sha256 van origineel, versleutelde blob, geëxtraheerde tekst, `include_in_context`. Soft-delete van record + fysiek wissen van blob. |
| `model_invocations` | **Provenance** per AI-aanroep | purpose, provider, model (registry/aangevraagd/**gerapporteerd**), routing, params, exacte payload, request-hash, contextRefs, policy/redactie, status, tokens, latency, fout. |
| `audit_events` | **Audit trail** | Append-only (DB-triggers blokkeren UPDATE/DELETE/TRUNCATE) én **hash-chained** (`prev_hash` → `hash`); verifieerbaar met `npm run audit:verify`. Geen FK's, zodat de trail blijft bestaan. |

**Geplande uitbreidingen (niet gebouwd):**

- `workflows`, `workflow_runs`, `workflow_steps` — multi-model pipelines; elke stap = één
  `model_invocation` met `purpose` + `workflow_step_id`.
- `approvals` — human-in-the-loop: wie keurde welke output/versie goed, met motivatie.
- `sources`, `citations` — researchlaag: opgehaalde bronnen (URL, tijdstip, content-hash,
  snapshot) en welke claim naar welke bron verwijst.
- `model_disagreements` — vastgelegde verschillen tussen modeluitkomsten.
- `organizations` + `organization_id` op projecten — multi-tenant (bijv. per klant/entiteit).
- `provider_credentials` — per-organisatie API-keys, versleuteld (KMS).
- `prompt_blobs` — content-addressed opslag van grote payloads (deduplicatie).

---

## 4. Provider abstraction design

```ts
interface AIProvider {
  id: string;
  displayName: string;
  isConfigured(): boolean;
  streamChat(req: ChatRequest): AsyncGenerator<ProviderEvent>;   // text-delta's + done(ChatResult)
}
```

- **`ChatResult`** bevat altijd: tekst, `modelReported` (de versie volgens de provider),
  genormaliseerde `finishReason` (`stop | length | refusal | content_filter | other`) plus de
  ruwe reden, token-usage, provider request-id en `citations[]` (voor researchproviders).
- **`ProviderError`** normaliseert fouten (`auth`, `rate_limit`, `timeout`, `unavailable`,
  `bad_request`, `cancelled`) met `retryable`.
- **Model registry** (`src/server/ai/registry.ts`): per model provider, providernaam, limieten,
  **clearance** (hoogste dataclassificatie die het mag ontvangen) en **tags** (input voor de
  toekomstige automatische router).
- **Router** is een interface (`ModelRouter`). MVP: `DefaultRouter`. Een expliciete
  gebruikerskeuze wordt gehonoreerd of geweigerd — nooit stil vervangen door een ander model.
- **Gateway** is de enige plek die `provider.streamChat` aanroept.

**Twee transports achter dezelfde interface.** Een engine is bereikbaar via `api` (officiële
SDK) of via `browser`. De browservariant bedient de webinterface van de tool op de desktop via
Playwright. Zie [BROWSER-TOOLS.md](BROWSER-TOOLS.md). Beide leveren dezelfde `ProviderEvent`s,
dus de overstap van browser naar API is een andere keuze in de modelkiezer en verder niets.
De browser-engine is generiek. Wat per site verschilt, staat als selectors in
`browser/sites.ts` en is zonder codewijziging te overschrijven. Browser-tools hebben clearance
*Intern*: klantdata gaat er nooit doorheen.

**Een provider toevoegen (bijv. Gemini):**

1. `src/server/ai/providers/gemini.ts` — implementeer `AIProvider` (map de SDK-stream naar
   `ProviderEvent`, map fouten naar `ProviderError`).
2. Registreer in `providers/index.ts`.
3. Voeg modellen toe aan `registry.ts` met een bewuste `clearance`.
4. Env-variabele voor de key in `config/env.ts`. Klaar — UI, policy, audit en provenance werken
   automatisch.

**Research zonder harde Perplexity-dependency:** research wordt een orchestrator-*stap*, niet
een provider-eigenschap. Twee implementaties achter één `ResearchProvider`-interface
(`search → fetch → extract → analyse → QA → antwoord met citations`):
(a) eigen pijplijn (zoek-API naar keuze + fetch/extract + LLM via de gateway),
(b) Perplexity (of Claude/OpenAI web-search tools) als *optionele* adapter.
Bronnen worden met content-hash en tijdstip opgeslagen, zodat een conclusie later
reproduceerbaar is.

**Multi-model pipelines & disagreement (fase 3):** de orchestrator voert stappen uit
(research → analyse → uitwerking → QA door een *ander* model → consolidatie). De QA-stap levert
gestructureerde output (akkoord / afwijking + onderbouwing). Afwijkingen worden als
`disagreement` opgeslagen en in de UI naast elkaar getoond in plaats van weggemiddeld.

**Bewuste keuze:** server-side "refusal fallbacks" (provider schakelt zelf naar een ander
model) staan uit. Model-routing is een besluit van *onze* router, zodat het in de audit trail
staat. Het daadwerkelijk gebruikte model wordt altijd uit de response vastgelegd.

---

## 5. Folder/project structure

```
ai-workspace/
├── docs/ARCHITECTURE.md          ← dit document
├── drizzle/                      ← SQL-migraties (incl. append-only audit triggers)
├── scripts/                      ← migrate, create-user, verify-audit
├── tests/                        ← unit + integratie (echte Postgres, mock provider)
└── src/
    ├── app/                      ← Next.js: pagina's + /api/v1 route handlers (dun!)
    │   ├── (app)/projects/[projectId]/{c/[conversationId],context,files,settings,audit}
    │   ├── (app)/admin/audit
    │   ├── login/
    │   └── api/v1/…
    ├── components/               ← UI (chat, provenance-paneel, sidebar, audit-tabel)
    ├── lib/                      ← client-veilige helpers (fetch/SSE, formatting)
    └── server/                   ← alles server-only, framework-onafhankelijk
        ├── ai/                   ← types · registry · catalog · router · gateway ·
        │   └── providers/            context-builder · orchestrator · adapters
        ├── audit/                ← hash-chain, recordAudit, queries
        ├── auth/                 ← wachtwoorden, sessies, rate limit, page guards
        ├── authz/                ← projectrollen
        ├── config/               ← gevalideerde environment
        ├── conversations/ files/ projects/   ← domeinservices
        ├── db/                   ← schema + client
        ├── http/                 ← API-wrapper, fouten, request-schema's
        ├── security/             ← crypto, data-policy, PII-redactie
        └── storage/              ← versleutelde blob storage
```

Route handlers bevatten geen businesslogica; ze valideren input en roepen services aan. Zo kan
de backend later zonder Next.js draaien (bijv. als losse API-service).

---

## 6. Security-by-design

**Gebouwd in de MVP**

| Onderwerp | Maatregel |
|---|---|
| Authenticatie | Argon2id (OWASP-parameters), timing-gelijke login, rate limiting, serversessies (token-hash in DB), `__Host-` cookie, httpOnly, SameSite=Lax, Secure in productie. |
| CSRF | Origin-check op alle muterende API-calls (naast SameSite). |
| Autorisatie | Projectlidmaatschap + rol op **elke** call; niet-leden krijgen 404 (geen bestaan-lek); IDs altijd gescoped op project. Admin ≠ inzage in projectdata. |
| Data egress | Projectclassificatie vs. modelclearance, server-side afgedwongen in de gateway; geweigerde calls worden vastgelegd (payload niet bewaard) en geaudit. |
| Dataminimalisatie | PII-masking (e-mail, IBAN met mod-97, BSN met elfproef, telefoon, kaartnummers met Luhn) vóór verzending; alleen tellingen gelogd. OpenAI: `store: false`. |
| Encryptie | Bestanden AES-256-GCM at rest, blob gebonden aan storage key (AAD), sha256-integriteitscheck bij download. TLS/HSTS in productie. |
| Audit | Append-only (DB-triggers) + hash-chain + verificatiescript; audit in dezelfde transactie als de wijziging. |
| Provenance | Exacte payload, request-hash, context- en bestandsversies, routing- en policybesluit, gerapporteerde modelversie per antwoord. |
| Prompt injection | Documenten in `<document>`-tags gemarkeerd als onbetrouwbare data; instructie om daarin geen opdrachten te volgen. |
| Input | zod-validatie, bestandstype-allowlist + magic-byte-check, groottelimiet, veilige bestandsnamen. |
| Browser | Strikte CSP (`connect-src 'self'`), X-Frame-Options DENY, nosniff, Referrer-Policy; API-keys uitsluitend server-side. |

**Voor productie / volgende fases**

- SSO via OIDC (Entra ID/Google) + MFA; sessie-intrekking en idle-timeout.
- Secrets en encryptiesleutels in een KMS/Key Vault (envelope encryption, key rotation — het
  blob-formaat heeft daar ruimte voor).
- Postgres: encryptie at rest, TLS, aparte least-privilege rollen (app ≠ migraties), backups,
  eventueel row-level security per project.
- Audit export naar WORM-opslag / SIEM; periodieke chain-verificatie.
- Retentiebeleid per project/classificatie (AVG), recht op verwijdering, DPIA.
- Contractuele toets per provider (DPA, zero-data-retention, EU-regio) → clearance per model.
- Rate limiting en kostenbudgetten per gebruiker/project (Redis).
- Human-in-the-loop approvals en vier-ogen-principe voor compliance-output.
- Betere PII-detectie (NER/DLP-service, namen/adressen) en omkeerbare pseudonimisering.

---

## 7. MVP-roadmap

**Fase 1 — MVP (deze versie)** ✅
Login · projecten · rollen · centrale chat met streaming · **browser-tools (Perplexity, ChatGPT,
Claude, Gemini via hun webinterface, zonder API)** · API-adapters Claude + OpenAI (klaar voor
later) · provider abstraction · modelkiezer · projectcontext met versies · file upload
(txt/md/csv/json/pdf) · provenance per antwoord incl. bronnen · hash-chained audit trail ·
egress-policy · PII-masking.

**Fase 1b — Stabiliseren op browser-tools**
Selectors per tool valideren en bijhouden · multi-tool vergelijking (zelfde vraag naar meerdere
tools) · eerste pipeline: research (Perplexity) → uitwerking (ChatGPT/Claude) → QA door een
andere tool → consolidatie · daarna formeel naar API-koppelingen.

**Fase 2 — Hardening & gemak**
SSO/MFA · Gemini-adapter · admin-UI voor gebruikers en model-clearance · kostenoverzicht
(tokens × prijs) · zoeken in gesprekken · export (Markdown/PDF) · DOCX-upload · achtergrondjobs.

**Fase 3 — Research & multi-model**
Eigen researchlaag (search → fetch → extract → analyse → QA → citations) met bronnenopslag ·
optionele Perplexity/web-search adapters · "vergelijk modellen" (zelfde prompt, meerdere
modellen naast elkaar) · pipelines met QA door tweede model · disagreement-weergave ·
consolidatiestap · regelgebaseerde automatische routing.

**Fase 4 — Workflows & compliance**
Workflow-builder (stappen, modellen, approvals) · human-in-the-loop · KYC-dossiermodule
(ingestion → extractie → CDD → research → UBO → risico → QA → goedkeuring → rapport) ·
multi-tenancy · retentie & DPIA-ondersteuning.

**Fase 5 — Media & e-learning**
Media-provider-interface (video/beeld, bijv. Higgsfield) achter dezelfde gateway-principes
(policy, audit, provenance), e-learning/gamification-module.

---

## Bekende beperkingen van deze versie

- Rate limiter is in-memory (één instantie).
- Browser-tools: selectors zijn getest tegen een nagebootste chatpagina. Tegen de echte sites
  moeten ze op de desktop gevalideerd worden (knop *Controleer*); webinterfaces veranderen
  zonder aankondiging. Geen modelversie of tokens beschikbaar via de webinterface.
- Bestanden alleen als tekst in de context (geen afbeeldingen/visuele PDF-analyse); geen OCR.
- Contextbudget in tekens, niet in tokens.
- Invocaties bewaren de volledige payload per aanroep (bewust, voor traceerbaarheid); bij groei
  deduplicatie via content-addressed opslag.
- De modellimieten in de registry voor OpenAI moeten tegen de actuele providerdocumentatie
  worden geverifieerd.
