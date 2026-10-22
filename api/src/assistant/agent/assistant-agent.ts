import type { GuardrailFlag } from '../guardrails/input-guard.js';
import { inspectInput } from '../guardrails/input-guard.js';
import { inspectOutput } from '../guardrails/output-guard.js';
import type { SearchHit } from '../knowledge/knowledge.repository.js';
import type {
  AgentMessage,
  LlmProvider,
  ToolCall,
  ToolResult,
} from '../llm/llm-provider.js';
import {
  ASSISTANT_TOOLS,
  toolDeclarations,
  type ProposedAction,
  type ToolContext,
} from '../tools/assistant-tools.js';
import { buildSystemPrompt } from './system-prompt.js';

/** Limites do laço: protegem custo, latência e loops do modelo. */
export const AGENT_LIMITS = {
  maxModelCalls: 5,
  maxToolCalls: 8,
  historyTurns: 6,
  maxToolOutputChars: 12_000,
};

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export type ToolTrace = {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  durationMs: number;
  error?: string;
};

export type Citation = {
  number: number;
  chunkId: string;
  documentTitle: string;
  section: string;
  excerpt: string;
  cited: boolean;
};

export type AssistantOutcome = 'answered' | 'blocked' | 'limit_reached';

export type AssistantReply = {
  answer: string;
  outcome: AssistantOutcome;
  citations: Citation[];
  toolCalls: ToolTrace[];
  proposedActions: ProposedAction[];
  guardrailFlags: GuardrailFlag[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  latencyMs: number;
  /** Pergunta como foi enviada ao modelo (dados sensíveis mascarados). */
  sanitizedQuestion: string;
};

export type AgentDependencies = Omit<ToolContext, 'registerSources'> & {
  provider: LlmProvider;
  today: string;
  sellerName?: string;
  now?: () => number;
};

const FALLBACK_ANSWER =
  'Não consegui concluir a resposta dentro do limite de consultas. Tente perguntar de forma mais específica.';

const truncateOutput = (output: unknown): unknown => {
  const serialized = JSON.stringify(output);
  return serialized.length <= AGENT_LIMITS.maxToolOutputChars
    ? output
    : {
        aviso: 'Resultado truncado por tamanho.',
        parcial: serialized.slice(0, AGENT_LIMITS.maxToolOutputChars),
      };
};

/**
 * Laço do agente: modelo decide → ferramentas executam → modelo responde.
 * Guardrails de entrada antes, de saída depois, e limites duros no meio.
 */
export const runAssistant = async (
  question: string,
  history: ChatTurn[],
  dependencies: AgentDependencies,
): Promise<AssistantReply> => {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const { provider } = dependencies;
  const flags = new Set<GuardrailFlag>();
  const usage = { inputTokens: 0, outputTokens: 0 };

  const reply = (
    partial: Partial<AssistantReply> &
      Pick<AssistantReply, 'answer' | 'outcome'>,
  ): AssistantReply => ({
    citations: [],
    toolCalls: [],
    proposedActions: [],
    usage,
    model: provider.chatModel,
    sanitizedQuestion: question,
    ...partial,
    guardrailFlags: [...flags],
    latencyMs: now() - startedAt,
  });

  const input = inspectInput(question);
  input.flags.forEach((flag) => flags.add(flag));
  if (!input.allowed) {
    return reply({
      answer: input.message,
      outcome: 'blocked',
      sanitizedQuestion: '[bloqueada]',
    });
  }

  // Fontes numeradas em sequência durante toda a resposta: [1], [2], ...
  const sources: { number: number; hit: SearchHit }[] = [];
  const registerSources = (hits: SearchHit[]) =>
    hits.map((hit) => {
      const existing = sources.find((source) => source.hit.id === hit.id);
      if (existing) return existing;
      const entry = { number: sources.length + 1, hit };
      sources.push(entry);
      return entry;
    });
  const toolContext: ToolContext = { ...dependencies, registerSources };

  const knownCodes = new Set<string>(
    input.text.toUpperCase().match(/\bOPP-\d{3,6}\b/g) ?? [],
  );
  const traces: ToolTrace[] = [];
  const actions: ProposedAction[] = [];
  const toolsByName = new Map(ASSISTANT_TOOLS.map((tool) => [tool.name, tool]));
  const declarations = toolDeclarations();
  const system = buildSystemPrompt({
    today: dependencies.today,
    sellerName: dependencies.sellerName,
  });

  const messages: AgentMessage[] = [
    ...history
      .slice(-AGENT_LIMITS.historyTurns)
      .map((turn): AgentMessage =>
        turn.role === 'user'
          ? {
              role: 'user',
              text: inspectInput(turn.content).allowed
                ? turn.content
                : '[mensagem removida]',
            }
          : { role: 'assistant', text: turn.content, toolCalls: [] },
      ),
    { role: 'user', text: input.text },
  ];

  const executeCall = async (call: ToolCall): Promise<ToolResult> => {
    const started = now();
    const tool = toolsByName.get(call.name);
    if (!tool) {
      flags.add('TOOL_ARGS_INVALID');
      traces.push({
        name: call.name,
        args: call.args,
        ok: false,
        durationMs: 0,
        error: 'ferramenta desconhecida',
      });
      return {
        callId: call.id,
        name: call.name,
        output: { erro: `Ferramenta ${call.name} não existe.` },
      };
    }

    const result = await tool
      .run(call.args, toolContext)
      .catch((error: unknown) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : 'falha inesperada',
      }));

    if (!result.ok) {
      flags.add('TOOL_ARGS_INVALID');
      traces.push({
        name: call.name,
        args: call.args,
        ok: false,
        durationMs: now() - started,
        error: result.error,
      });
      return {
        callId: call.id,
        name: call.name,
        output: { erro: result.error },
      };
    }

    const { outcome } = result;
    outcome.opportunityCodes?.forEach((code) => knownCodes.add(code));
    if (outcome.proposedAction) actions.push(outcome.proposedAction);
    if (outcome.suspiciousContentDropped)
      flags.add('RETRIEVED_CONTENT_SUSPICIOUS');
    traces.push({
      name: call.name,
      args: call.args,
      ok: true,
      durationMs: now() - started,
    });
    return {
      callId: call.id,
      name: call.name,
      output: truncateOutput(outcome.output),
    };
  };

  let answer = '';
  let outcome: AssistantOutcome = 'limit_reached';

  for (let step = 0; step < AGENT_LIMITS.maxModelCalls; step += 1) {
    const toolsAllowed = traces.length < AGENT_LIMITS.maxToolCalls;
    const response = await provider.generate({
      system,
      messages,
      tools: toolsAllowed ? declarations : [],
    });
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;

    if (response.toolCalls.length === 0) {
      answer = response.text;
      outcome = 'answered';
      break;
    }

    messages.push({
      role: 'assistant',
      text: response.text,
      toolCalls: response.toolCalls,
      providerContent: response.providerContent,
    });

    const budget = AGENT_LIMITS.maxToolCalls - traces.length;
    const calls = response.toolCalls.slice(0, Math.max(budget, 0));
    if (calls.length < response.toolCalls.length)
      flags.add('TOOL_LIMIT_REACHED');

    const results = await Promise.all(calls.map(executeCall));
    for (const skipped of response.toolCalls.slice(calls.length)) {
      results.push({
        callId: skipped.id,
        name: skipped.name,
        output: { erro: 'Limite de consultas atingido nesta pergunta.' },
      });
    }
    messages.push({ role: 'tool', results });
  }

  if (outcome === 'limit_reached') flags.add('TOOL_LIMIT_REACHED');

  const checked = inspectOutput(answer || FALLBACK_ANSWER, {
    citableSources: new Set(sources.map((source) => source.number)),
    knownOpportunityCodes: knownCodes,
  });
  checked.flags.forEach((flag) => flags.add(flag));

  return reply({
    answer: checked.text,
    outcome,
    citations: sources.map(({ number, hit }) => ({
      number,
      chunkId: hit.id,
      documentTitle: hit.documentTitle,
      section: hit.section,
      excerpt:
        hit.content.length > 320
          ? `${hit.content.slice(0, 317)}...`
          : hit.content,
      cited: checked.citedSources.includes(number),
    })),
    toolCalls: traces,
    proposedActions: actions,
    sanitizedQuestion: input.text,
  });
};
