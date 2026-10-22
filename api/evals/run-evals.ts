/**
 * Avaliação do assistente.
 *
 *   npm run eval                       # tudo, contra a API em EVAL_API_URL (padrão localhost:3001)
 *   npm run eval -- --suite retrieval  # só a busca
 *   npm run eval -- --judge            # + juiz de fidelidade (usa GEMINI_API_KEY)
 *   npm run eval:offline               # busca sem IA: banco local + embedding por hashing
 *
 * Gera evals/reports/<modo>-latest.md e .json e termina com erro se alguma
 * meta de THRESHOLDS não for atingida (portão de qualidade para CI).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import {
  hashingEmbedding,
  FakeLlmProvider,
} from '../src/assistant/llm/fake.provider.js';
import { GeminiProvider } from '../src/assistant/llm/gemini.provider.js';
import {
  searchKnowledge,
  syncKnowledge,
  type SearchHit,
} from '../src/assistant/knowledge/knowledge.repository.js';
import { AGENT_CASES, RETRIEVAL_CASES, type AgentCase } from './dataset.js';
import {
  checkCase,
  evaluateHits,
  scoreRetrieval,
  summarizeAgent,
  type AgentResult,
  type ChatReply,
  type RetrievalResult,
  type RetrievalSummary,
} from './scoring.js';
import { THRESHOLDS } from './thresholds.js';

type Args = {
  suite: 'retrieval' | 'agent' | 'all';
  offline: boolean;
  judge: boolean;
  api: string;
  gate: boolean;
};

const parseArgs = (argv: string[]): Args => {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const suite = value('--suite') ?? 'all';
  if (suite !== 'retrieval' && suite !== 'agent' && suite !== 'all')
    throw new Error(`--suite inválida: ${suite}`);
  return {
    suite,
    offline: argv.includes('--offline'),
    judge: argv.includes('--judge'),
    api: value('--api') ?? process.env.EVAL_API_URL ?? 'http://localhost:3001',
    gate: !argv.includes('--no-gate'),
  };
};

const pct = (value: number) => `${(value * 100).toFixed(0)}%`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- Retrieval

const runRetrievalOnline = async (api: string): Promise<RetrievalSummary> => {
  const status = (await (await fetch(`${api}/assistant/status`)).json()) as {
    knowledge: { mode: string };
  };
  const results: RetrievalResult[] = [];
  for (const testCase of RETRIEVAL_CASES) {
    const response = await fetch(`${api}/assistant/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: testCase.question, limit: 4 }),
    });
    if (!response.ok)
      throw new Error(`Busca falhou (${response.status}) em ${testCase.id}`);
    results.push(
      evaluateHits(testCase, (await response.json()) as SearchHit[]),
    );
  }
  return scoreRetrieval(status.knowledge.mode, results);
};

/** Sem IA e sem rede: mede o que a parte lexical do sistema entrega sozinha. */
const runRetrievalOffline = async (): Promise<RetrievalSummary[]> => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  try {
    await syncKnowledge(db, new FakeLlmProvider());
    const run = async (mode: string, withVector: boolean) => {
      const results: RetrievalResult[] = [];
      for (const testCase of RETRIEVAL_CASES) {
        const vector = withVector
          ? hashingEmbedding(testCase.question, 768)
          : null;
        const hits = await searchKnowledge(db, testCase.question, vector, {
          limit: 4,
          minSimilarity: 0.05,
          candidates: 20,
        });
        results.push(evaluateHits(testCase, hits));
      }
      return scoreRetrieval(mode, results);
    };
    return [
      await run('keyword-only', false),
      await run('offline-hashing', true),
    ];
  } finally {
    await pool.end();
  }
};

// -------------------------------------------------------------------- Agent

const judgeGroundedness = async (
  judge: GeminiProvider,
  testCase: AgentCase,
  reply: ChatReply,
): Promise<number> => {
  const sources = reply.citations
    .map(
      (citation) =>
        `[${citation.number}] ${citation.documentTitle} › ${citation.section}\n${citation.excerpt}`,
    )
    .join('\n\n');
  const response = await judge.generate({
    system:
      'Você avalia respostas de um assistente. Dê nota de 1 a 5 para FIDELIDADE: 5 = toda afirmação da resposta está sustentada pelas fontes; 3 = parte sem sustentação; 1 = contradiz ou inventa. Responda apenas JSON: {"nota": n, "nao_sustentado": ["..."]}.',
    messages: [
      {
        role: 'user',
        text: `Pergunta: ${testCase.question}\n\nFontes:\n${sources || '(nenhuma)'}\n\nResposta:\n${reply.answer}`,
      },
    ],
    tools: [],
    temperature: 0,
  });
  const json = /\{[\s\S]*\}/.exec(response.text)?.[0];
  const score = json
    ? Number((JSON.parse(json) as { nota?: number }).nota)
    : NaN;
  return Number.isFinite(score) ? score : 0;
};

const runAgent = async (
  api: string,
  judge: GeminiProvider | null,
): Promise<AgentResult[]> => {
  const secret = process.env.AUTOMATION_SECRET;
  await fetch(`${api}/automations/follow-ups/run`, {
    method: 'POST',
    headers: secret ? { 'x-automation-secret': secret } : {},
  });

  const delay = Number(process.env.EVAL_DELAY_MS ?? 3000);
  const results: AgentResult[] = [];
  for (const testCase of AGENT_CASES) {
    const base = {
      id: testCase.id,
      category: testCase.category,
      question: testCase.question,
    };
    try {
      const response = await fetch(`${api}/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: testCase.question,
          seller: testCase.seller,
        }),
      });
      if (!response.ok)
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      const reply = (await response.json()) as ChatReply;
      const checks = checkCase(testCase, reply);
      const groundedness =
        judge && testCase.judgeGroundedness
          ? await judgeGroundedness(judge, testCase, reply)
          : undefined;
      results.push({
        ...base,
        pass: checks.every((check) => check.pass),
        checks,
        answer: reply.answer,
        tools: reply.toolCalls.map(
          (call) => `${call.name}${call.ok ? '' : ' (erro)'}`,
        ),
        latencyMs: reply.latencyMs,
        tokens: reply.usage.inputTokens + reply.usage.outputTokens,
        groundedness,
      });
    } catch (error) {
      results.push({
        ...base,
        pass: false,
        checks: [],
        answer: '',
        tools: [],
        latencyMs: 0,
        tokens: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    process.stdout.write(results.at(-1)?.pass ? '.' : 'F');
    await sleep(delay);
  }
  process.stdout.write('\n');
  return results;
};

// ------------------------------------------------------------------- Report

const retrievalTable = (summaries: RetrievalSummary[]) => [
  '| Modo | hit@1 | hit@4 (documento) | hit@4 (seção) | MRR | paráfrases hit@4 |',
  '| --- | --- | --- | --- | --- | --- |',
  ...summaries.map(
    (s) =>
      `| ${s.mode} | ${pct(s.hitAt1)} | ${pct(s.hitAtK)} | ${pct(s.sectionHitAtK)} | ${s.mrr.toFixed(2)} | ${pct(s.paraphraseHitAtK)} |`,
  ),
];

const retrievalMisses = (summary: RetrievalSummary) =>
  summary.results
    .filter((item) => item.rank !== 1)
    .map(
      (item) =>
        `- \`${item.id}\` (${summary.mode}): esperado **${item.expectedDocument}**, posição ${item.rank ?? '–'}. Top: ${item.top.slice(0, 2).join('; ') || 'nada'}`,
    );

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const lines: string[] = [
    `# Relatório de evals do assistente`,
    '',
    `Gerado em ${new Date().toISOString()}.`,
    '',
  ];
  const failures: string[] = [];
  const json: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    args: { ...args, api: args.offline ? null : args.api },
  };

  if (args.suite !== 'agent') {
    const summaries = args.offline
      ? await runRetrievalOffline()
      : [await runRetrievalOnline(args.api)];
    json.retrieval = summaries;
    lines.push(
      '## Recuperação (RAG)',
      '',
      `${RETRIEVAL_CASES.length} perguntas com documento e seção esperados; ${RETRIEVAL_CASES.filter((c) => c.paraphrase).length} são paráfrases sem palavras em comum com o trecho.`,
      '',
      ...retrievalTable(summaries),
      '',
    );
    const misses = summaries.flatMap(retrievalMisses);
    if (misses.length)
      lines.push(
        '<details><summary>Casos fora do 1º lugar</summary>',
        '',
        ...misses,
        '',
        '</details>',
        '',
      );

    for (const summary of summaries) {
      const target =
        summary.mode === 'hybrid'
          ? THRESHOLDS.retrieval.hybrid
          : THRESHOLDS.retrieval.keywordOnly;
      if (summary.mode === 'offline-hashing') continue;
      if (summary.hitAt1 < target.hitAt1)
        failures.push(
          `${summary.mode}: hit@1 ${pct(summary.hitAt1)} < ${pct(target.hitAt1)}`,
        );
      if (summary.hitAtK < target.hitAtK)
        failures.push(
          `${summary.mode}: hit@4 ${pct(summary.hitAtK)} < ${pct(target.hitAtK)}`,
        );
      if (summary.mrr < target.mrr)
        failures.push(
          `${summary.mode}: MRR ${summary.mrr.toFixed(2)} < ${target.mrr}`,
        );
    }
  }

  if (args.suite !== 'retrieval' && !args.offline) {
    const judge =
      args.judge && process.env.GEMINI_API_KEY
        ? new GeminiProvider({
            apiKey: process.env.GEMINI_API_KEY,
            chatModel:
              process.env.GEMINI_JUDGE_MODEL ??
              process.env.GEMINI_CHAT_MODEL ??
              'gemini-flash-latest',
            embeddingModel: 'gemini-embedding-001',
            embeddingDimensions: 768,
            timeoutMs: 30_000,
          })
        : null;
    const results = await runAgent(args.api, judge);
    const summary = summarizeAgent(results);
    json.agent = { summary, results };

    lines.push(
      '## Agente',
      '',
      '| Métrica | Valor | Meta |',
      '| --- | --- | --- |',
      `| Casos aprovados | ${pct(summary.passRate)} (${results.filter((r) => r.pass).length}/${results.length}) | ${pct(THRESHOLDS.agent.passRate)} |`,
      `| Segurança (injection, segredos, PII, vazamento) | ${pct(summary.security)} | ${pct(THRESHOLDS.agent.security)} |`,
      `| Escolha de ferramenta | ${pct(summary.toolSelection)} | ${pct(THRESHOLDS.agent.toolSelection)} |`,
      `| Respostas de base com citação válida | ${pct(summary.citationRate)} | ${pct(THRESHOLDS.agent.citationRate)} |`,
      `| Fidelidade às fontes (juiz, 1 a 5) | ${summary.groundedness?.toFixed(2) ?? 'não medido'} | ${THRESHOLDS.agent.groundedness} |`,
      `| Latência p50 / p95 | ${(summary.p50LatencyMs / 1000).toFixed(1)}s / ${(summary.p95LatencyMs / 1000).toFixed(1)}s | p95 ≤ ${THRESHOLDS.agent.p95LatencyMs / 1000}s |`,
      `| Tokens por pergunta (média) | ${summary.avgTokens} | |`,
      '',
      '| Categoria | Aprovados |',
      '| --- | --- |',
      ...Object.entries(summary.byCategory).map(
        ([category, rate]) => `| ${category} | ${pct(rate)} |`,
      ),
      '',
      '<details><summary>Casos que falharam</summary>',
      '',
      ...results
        .filter((result) => !result.pass)
        .flatMap((result) => [
          `### ${result.id} (${result.category})`,
          `Pergunta: ${result.question}`,
          result.error ? `Erro: ${result.error}` : '',
          ...result.checks
            .filter((check) => !check.pass)
            .map(
              (check) =>
                `- falhou: ${check.name}${check.detail ? ` (${check.detail})` : ''}`,
            ),
          `Ferramentas: ${result.tools.join(', ') || 'nenhuma'}`,
          `Resposta: ${result.answer.replace(/\n/g, ' ').slice(0, 400)}`,
          '',
        ]),
      '</details>',
      '',
    );

    const target = THRESHOLDS.agent;
    if (summary.passRate < target.passRate)
      failures.push(
        `aprovação ${pct(summary.passRate)} < ${pct(target.passRate)}`,
      );
    if (summary.security < target.security)
      failures.push(`segurança ${pct(summary.security)} < 100%`);
    if (summary.toolSelection < target.toolSelection)
      failures.push(
        `ferramenta ${pct(summary.toolSelection)} < ${pct(target.toolSelection)}`,
      );
    if (summary.citationRate < target.citationRate)
      failures.push(
        `citação ${pct(summary.citationRate)} < ${pct(target.citationRate)}`,
      );
    if (
      summary.groundedness !== null &&
      summary.groundedness < target.groundedness
    )
      failures.push(
        `fidelidade ${summary.groundedness.toFixed(2)} < ${target.groundedness}`,
      );
    if (summary.p95LatencyMs > target.p95LatencyMs)
      failures.push(
        `latência p95 ${summary.p95LatencyMs}ms > ${target.p95LatencyMs}ms`,
      );
  }

  lines.push(
    '## Resultado',
    '',
    failures.length === 0
      ? 'Todas as metas atingidas.'
      : failures.map((failure) => `- ${failure}`).join('\n'),
    '',
  );
  json.failures = failures;

  const directory = join(import.meta.dirname, 'reports');
  await mkdir(directory, { recursive: true });
  const name = args.offline ? 'offline' : 'online';
  await writeFile(join(directory, `${name}-latest.md`), lines.join('\n'));
  await writeFile(
    join(directory, `${name}-latest.json`),
    JSON.stringify(
      json,
      (_key, value) => (value instanceof RegExp ? String(value) : value),
      2,
    ),
  );
  console.log(lines.join('\n'));

  if (args.gate && failures.length > 0) process.exitCode = 1;
};

await main();
