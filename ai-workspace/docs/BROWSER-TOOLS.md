# Browser-tools: AI-tools bedienen zonder API

Fase 1 van de workspace werkt **zonder API-koppelingen**. De workspace bedient Perplexity,
ChatGPT, Claude en Gemini via hun gewone webinterface, in een browservenster op je eigen
computer, met je eigen abonnementen. Pas als de workflows stabiel zijn, stap je over op API's.
Daarvoor hoef je alleen in de modelkiezer een ander model te kiezen: gateway, policy,
provenance en audit blijven hetzelfde.

## Hoe het werkt

```
Workspace (chat) → Orchestrator → AI Gateway (policy, PII-masking, logging)
   → BrowserProvider → Playwright → browservenster op je desktop
       → perplexity.ai / chatgpt.com / claude.ai / gemini.google.com
   ← antwoord live uitgelezen + bronlinks + URL van de thread
```

- Eén apart browserprofiel (`BROWSER_PROFILE_DIR`) met één tabblad per tool. Je logt per tool
  **één keer zelf** in, inclusief 2FA of captcha. De workspace ziet of bewaart geen wachtwoorden.
- Per vraag start de workspace een **nieuw gesprek** in de tool. De prompt bevat de
  projectinstructies, de documenten en de gespreksgeschiedenis uit de workspace. De workspace
  is dus de bron van waarheid, niet de chatgeschiedenis in de tool.
- Het antwoord wordt live uitgelezen. Het is klaar als de tool niet meer "genereert" en de
  tekst een paar seconden gelijk blijft.
- Bronlinks (vooral Perplexity) en de URL van de originele thread worden bij het antwoord
  opgeslagen. Je vindt ze onder "Bronnen" en "Provenance".
- Per tool wordt één vraag tegelijk verwerkt; andere vragen wachten in de rij.

## Eerste keer instellen

1. Start de workspace met het startbestand (`start-windows.bat` of `start-mac.command`). Het
   browservenster opent op de computer waar de workspace draait. Het startbestand gebruikt
   Chrome of Edge als die er is, en downloadt anders eenmalig een ingebouwde Chromium.
2. Na het aanmaken van je account kom je vanzelf op **Browser-tools**.
3. Per tool: klik **Openen**, log in het venster in, en zet in de instellingen van de tool
   "gebruik voor training / model verbeteren" uit. Klik daarna **Controleer**.
4. Kies in een project met classificatie *Publiek* of *Intern* bijvoorbeeld
   "Perplexity (browser)" in de modelkiezer.

Laat het browservenster open terwijl je werkt. Je kunt meekijken wat de workspace typt.

## "Verifieer dat u een mens bent" blijft terugkomen

Sommige sites (zoals Perplexity, via Cloudflare) herkennen dat het browservenster door software
wordt bestuurd ("Chrome wordt beheerd door geautomatiseerde testsoftware") en laten het dan niet
door, hoe vaak je ook klikt. Dat is precies waar die beveiliging voor is; de workspace probeert
dat bewust niet te omzeilen. De tool krijgt dan de status *Menselijke controle nodig* (dat blijft
bewaard na een herstart) en wordt niet meer automatisch gekozen. Gebruik in plaats daarvan:

### De handmatige brug (geen API, geen kosten)

Kies in de modelkiezer bijvoorbeeld **"Perplexity (handmatig)"**. Dit werkt ook als stap in
Vergelijk en Diep onderzoek. Is de automatische browserroute geblokkeerd, dan kiest de workspace
de handmatige route vanzelf.

1. De workspace zet de vraag klaar (met projectcontext, persoonsgegevens gemaskeerd).
2. Klik **Open Perplexity**. Perplexity opent in je **gewone** browser, met de vraag ingevuld
   (bij lange vragen staat de vraag op je klembord: plak met Ctrl+V).
3. Verstuur de vraag daar, kopieer het volledige antwoord inclusief de bronnen, plak het in de
   workspace en klik **Verwerken**.

De workspace legt de vraag, het antwoord en de bronnen (URL's worden uit de geplakte tekst
gehaald) vast met provenance en audit trail, net als bij de automatische routes.

### De Perplexity API (later)

Zet `PERPLEXITY_API_KEY=...` in `.env` en herstart. Dan verschijnen "Perplexity Sonar Pro (API)"
en "Perplexity Sonar (API)": volledig automatisch en stabiel, met bronnen, tegen een klein bedrag
per vraag. Bij gelijke sterke punten krijgt de API voorrang op de handmatige route.

## Als een tool niet meer werkt

Webinterfaces veranderen zonder aankondiging. De workspace vindt het invoerveld, de
verzendknop en het antwoord via CSS-selectors in `src/server/ai/browser/sites.ts`.

- **"Inloggen nodig" / invoerveld niet gevonden:** log opnieuw in via Openen. Werkt het daarna
  nog niet, dan is de pagina gewijzigd.
- **Selectors bijwerken zonder codewijziging:** maak een bestand `browser-sites.json` en zet
  `BROWSER_SITES_FILE=./browser-sites.json` in `.env`:

  ```json
  {
    "perplexity": {
      "input": "#ask-input",
      "response": "div.prose",
      "generating": "button[aria-label='Stop']",
      "stableMs": 3000
    }
  }
  ```

  Velden: `newChatUrl`, `input`, `submit`, `response`, `generating`, `citations`,
  `citationsScope`, `maxPromptChars`, `stableMs`. Selectors vind je met rechtsklik →
  *Inspecteren* in het browservenster.
- **Te lange prompt:** webinterfaces accepteren minder tekst dan API's. De workspace stemt de
  hoeveelheid context af op de gekozen tool en meldt het als documenten zijn ingekort. Zet
  zo nodig minder bestanden "in context".

## Belangrijke kanttekeningen

- **Voorwaarden van de aanbieders.** De gebruiksvoorwaarden van consumentenproducten
  (ChatGPT, Claude.ai, Perplexity, Gemini) verbieden of beperken meestal geautomatiseerd
  gebruik buiten de API. Gebruik dit daarom persoonlijk, met laag volume en om te testen. Er
  is risico op blokkering van je account. De workspace gebruikt bewust geen trucs om
  botdetectie te omzeilen. Weigert een site automatisering, dan hoort die tool via de API te
  lopen.
- **Geen klantdata.** Browser-tools hebben clearance *Intern*. Projecten met classificatie
  *Vertrouwelijk* of *Strikt vertrouwelijk* (KYC-dossiers, klantgegevens) worden server-side
  geblokkeerd. Voor die projecten zijn API's met verwerkersovereenkomst en
  dataretentie-afspraken nodig.
- **Minder precieze provenance.** De exacte modelversie en het tokengebruik zijn via de
  webinterface niet betrouwbaar uit te lezen. Vastgelegd worden de tool (`perplexity-web`),
  de exacte prompt, het antwoord, de bronnen en de thread-URL.
- **Het browserprofiel bevat je ingelogde sessies.** Behandel die map als een wachtwoord. Hij
  staat in `.gitignore`.
