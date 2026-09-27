/**
 * Step prompts for multi-model workflows. Pure functions (no I/O) so they are easy to test
 * and tune. Every prompt asks for the language of the question.
 */

/** Longest earlier-step output quoted into a later step (browser tools have input limits). */
export const MAX_QUOTED_CHARS = 12_000;

export function quote(text: string, max = MAX_QUOTED_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[… ingekort: ${text.length - max} tekens weggelaten]`;
}

const LANGUAGE = "Antwoord in de taal waarin de vraag is gesteld.";

export function researchPrompt(question: string): string {
  return `Onderzoek de onderstaande vraag grondig.
- Zoek actuele, betrouwbare bronnen (bij voorkeur primaire bronnen, toezichthouders en wet- en regelgeving waar relevant).
- Geef de belangrijkste feiten, cijfers en data, elk met bronvermelding (URL).
- Benoem onzekerheden en punten waarover bronnen elkaar tegenspreken.
${LANGUAGE}

Vraag:
${question}`;
}

export function draftPrompt(question: string, research: string): string {
  return `Werk een volledig en goed gestructureerd antwoord uit op de vraag hieronder.
- Gebruik het onderzoek als basis en neem de bronvermeldingen over.
- Scheid feiten van je eigen analyse en benoem aannames.
${LANGUAGE}

<vraag>
${question}
</vraag>

<onderzoek>
${quote(research)}
</onderzoek>`;
}

export function reviewPrompt(question: string, research: string, draft: string): string {
  return `Je bent een onafhankelijke, kritische reviewer (tweede lijn). Beoordeel het conceptantwoord op:
1. feitelijke juistheid, en of de claims door het onderzoek en de bronnen worden gedragen;
2. ontbrekende of onvolledige punten;
3. tegenstrijdigheden en te stellige of misleidende formuleringen;
4. risico's als iemand op dit antwoord zou vertrouwen.
Geef concrete verbeterpunten als genummerde lijst. Wees kort over wat wel klopt.
${LANGUAGE}
Sluit af met precies één regel in dit formaat:
OORDEEL: AKKOORD of OORDEEL: AANPASSEN of OORDEEL: ONBETROUWBAAR

<vraag>
${question}
</vraag>

<onderzoek>
${quote(research)}
</onderzoek>

<concept>
${quote(draft)}
</concept>`;
}

export function factcheckPrompt(question: string, draft: string): string {
  return `Je bent een onafhankelijke feitencontroleur. Controleer de feitelijke claims in het conceptantwoord hieronder (data, cijfers, namen, wetsartikelen, termijnen, citaten) aan de hand van actuele, betrouwbare bronnen. Zoek zelf.
Geef een tabel of lijst met per claim: de claim, "klopt" / "klopt niet" / "niet te verifiëren", de juiste informatie en de bron (URL).
Beoordeel alleen feiten, niet stijl.
${LANGUAGE}
Sluit af met precies één regel: FEITEN: CORRECT of FEITEN: FOUTEN of FEITEN: ONZEKER

<vraag>
${question}
</vraag>

<concept>
${quote(draft)}
</concept>`;
}

export function finalPrompt(question: string, draft: string, review: string, factcheck?: string | null): string {
  return `Maak het definitieve antwoord op de vraag.
- Verwerk alle terechte punten uit de review${factcheck ? " en corrigeer alle feiten die volgens de feitencheck niet kloppen" : ""} in het concept.
- Behoud de bronvermeldingen.
- Waar de review en het concept het oneens blijven of iets onzeker is: benoem dat expliciet onder de kop "Openstaande punten".
Geef alleen het definitieve antwoord, zonder uitleg over je werkwijze.
${LANGUAGE}

<vraag>
${question}
</vraag>

<concept>
${quote(draft)}
</concept>

<review>
${quote(review)}
</review>${factcheck ? `

<feitencheck>
${quote(factcheck)}
</feitencheck>` : ""}`;
}

export function judgePrompt(question: string, answers: { label: string; text: string }[]): string {
  const per = Math.floor(40_000 / Math.max(1, answers.length));
  return `Hieronder staan antwoorden van verschillende AI-modellen op dezelfde vraag. Vergelijk ze kritisch en gebruik precies deze koppen:
## Consensus
Waar zijn de modellen het over eens?
## Verschillen
Waar spreken ze elkaar tegen? Noem per punt welk model wat zegt.
## Mogelijke fouten of onbewezen claims
## Beste antwoord
Een samengevoegd antwoord dat zo juist en volledig mogelijk is.
${LANGUAGE}
Sluit af met precies één regel: OVEREENSTEMMING: HOOG of OVEREENSTEMMING: MIDDEL of OVEREENSTEMMING: LAAG

<vraag>
${question}
</vraag>

${answers.map((a) => `<antwoord model="${a.label.replace(/"/g, "'")}">\n${quote(a.text, per)}\n</antwoord>`).join("\n\n")}`;
}

export { AGREEMENT_LEVELS, FACT_VERDICTS, parseVerdict, REVIEW_VERDICTS, type VerdictKey } from "@/lib/verdict";
