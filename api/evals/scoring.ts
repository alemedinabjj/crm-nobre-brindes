/**
 * Pontuação dos evals, sem I/O: compara a resposta da API com o esperado.
 * Separado do runner para ser reaproveitado (CLI, CI ou outro transporte).
 */
import type { SearchHit } from '../src/assistant/knowledge/knowledge.repository.js';
import { AGENT_CASES, type AgentCase, type RetrievalCase } from './dataset.js';

export const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

export const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
    ] ?? 0
  );
};

export type RetrievalResult = RetrievalCase & {
  rank: number | null;
  sectionRank: number | null;
  top: string[];
};

export type RetrievalSummary = {
  mode: string;
  cases: number;
  hitAt1: number;
  hitAtK: number;
  sectionHitAtK: number;
  mrr: number;
  paraphraseHitAtK: number;
  results: RetrievalResult[];
};

export const scoreRetrieval = (
  mode: string,
  results: RetrievalResult[],
): RetrievalSummary => {
  const ranked = (items: RetrievalResult[]) =>
    items.filter((item) => item.rank !== null);
  const paraphrases = results.filter((item) => item.paraphrase);
  const withSection = results.filter((item) => item.expectedSection);
  return {
    mode,
    cases: results.length,
    hitAt1: results.filter((item) => item.rank === 1).length / results.length,
    hitAtK: ranked(results).length / results.length,
    sectionHitAtK:
      withSection.filter((item) => item.sectionRank !== null).length /
      Math.max(withSection.length, 1),
    mrr:
      results.reduce((sum, item) => sum + (item.rank ? 1 / item.rank : 0), 0) /
      results.length,
    paraphraseHitAtK:
      ranked(paraphrases).length / Math.max(paraphrases.length, 1),
    results,
  };
};

export const evaluateHits = (
  testCase: RetrievalCase,
  hits: Pick<SearchHit, 'documentSlug' | 'section'>[],
): RetrievalResult => {
  const rankOf = (
    predicate: (hit: Pick<SearchHit, 'documentSlug' | 'section'>) => boolean,
  ) => {
    const index = hits.findIndex(predicate);
    return index >= 0 ? index + 1 : null;
  };
  return {
    ...testCase,
    rank: rankOf((hit) => hit.documentSlug === testCase.expectedDocument),
    sectionRank: testCase.expectedSection
      ? rankOf(
          (hit) =>
            hit.documentSlug === testCase.expectedDocument &&
            hit.section === testCase.expectedSection,
        )
      : null,
    top: hits.map((hit) => `${hit.documentSlug} › ${hit.section}`),
  };
};

export type ChatReply = {
  answer: string;
  outcome: string;
  citations: {
    number: number;
    cited: boolean;
    excerpt: string;
    documentTitle: string;
    section: string;
  }[];
  toolCalls: { name: string; ok: boolean }[];
  proposedActions: {
    type: string;
    opportunityCode: string;
    toStage?: string;
    reason?: string | null;
  }[];
  guardrailFlags: string[];
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
};

export type Check = { name: string; pass: boolean; detail?: string };

export type AgentResult = {
  id: string;
  category: string;
  question: string;
  pass: boolean;
  checks: Check[];
  answer: string;
  tools: string[];
  latencyMs: number;
  tokens: number;
  groundedness?: number;
  error?: string;
};

export const checkCase = (testCase: AgentCase, reply: ChatReply): Check[] => {
  const checks: Check[] = [];
  const answer = normalize(reply.answer);
  const tools = reply.toolCalls
    .filter((call) => call.ok)
    .map((call) => call.name);

  checks.push({
    name: 'outcome',
    pass: reply.outcome === (testCase.expectOutcome ?? 'answered'),
    detail: reply.outcome,
  });
  if (testCase.expectAnyTool) {
    checks.push({
      name: 'ferramenta',
      pass: testCase.expectAnyTool.some((tool) => tools.includes(tool)),
      detail: tools.join(', ') || 'nenhuma',
    });
  }
  if (testCase.forbidTools) {
    checks.push({
      name: 'ferramenta proibida',
      pass: !testCase.forbidTools.some((tool) => tools.includes(tool)),
    });
  }
  for (const text of testCase.mustInclude ?? []) {
    checks.push({
      name: `contém "${text}"`,
      pass: answer.includes(normalize(text)),
    });
  }
  if (testCase.mustIncludeAny) {
    checks.push({
      name: `contém um de [${testCase.mustIncludeAny.join(' | ')}]`,
      pass: testCase.mustIncludeAny.some((text) =>
        answer.includes(normalize(text)),
      ),
    });
  }
  for (const pattern of testCase.mustNotMatch ?? []) {
    checks.push({
      name: `não contém ${pattern}`,
      pass: !pattern.test(reply.answer),
    });
  }
  if (testCase.expectCitation) {
    checks.push({
      name: 'cita fonte',
      pass: reply.citations.some((citation) => citation.cited),
    });
  }
  if (testCase.expectAction !== undefined) {
    const expected = testCase.expectAction;
    const actions = reply.proposedActions;
    if (expected === null) {
      checks.push({
        name: 'nenhuma ação proposta',
        pass: actions.length === 0,
      });
    } else {
      const match = actions.find(
        (action) =>
          action.type === expected.type &&
          action.opportunityCode === expected.code &&
          (!expected.to || action.toStage === expected.to) &&
          (!expected.reasonIncludes ||
            normalize(action.reason ?? '').includes(
              normalize(expected.reasonIncludes),
            )),
      );
      checks.push({
        name: `propõe ${expected.type} ${expected.code}${expected.to ? ` → ${expected.to}` : ''}`,
        pass: match !== undefined,
        detail: JSON.stringify(actions),
      });
    }
  }
  return checks;
};

export const summarizeAgent = (results: AgentResult[]) => {
  const byCategory = (category: string) =>
    results.filter((result) => result.category === category);
  const toolCases = AGENT_CASES.filter((testCase) => testCase.expectAnyTool);
  const citationCases = AGENT_CASES.filter(
    (testCase) => testCase.expectCitation,
  );
  const resultOf = (id: string) => results.find((result) => result.id === id);
  const checkPassed = (id: string, name: string) =>
    resultOf(id)?.checks.find((check) => check.name === name)?.pass ?? false;
  const graded = results.filter((result) => result.groundedness !== undefined);
  const latencies = results
    .filter((result) => result.latencyMs > 0)
    .map((result) => result.latencyMs);

  return {
    passRate: results.filter((result) => result.pass).length / results.length,
    byCategory: Object.fromEntries(
      [...new Set(results.map((result) => result.category))].map((category) => {
        const items = byCategory(category);
        return [
          category,
          items.filter((item) => item.pass).length / items.length,
        ];
      }),
    ),
    security:
      byCategory('security').filter((item) => item.pass).length /
      Math.max(byCategory('security').length, 1),
    toolSelection:
      toolCases.filter((testCase) => checkPassed(testCase.id, 'ferramenta'))
        .length / toolCases.length,
    citationRate:
      citationCases.filter((testCase) => checkPassed(testCase.id, 'cita fonte'))
        .length / citationCases.length,
    groundedness: graded.length
      ? graded.reduce((sum, result) => sum + (result.groundedness ?? 0), 0) /
        graded.length
      : null,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    avgTokens: Math.round(
      results.reduce((sum, result) => sum + result.tokens, 0) /
        Math.max(results.length, 1),
    ),
  };
};
