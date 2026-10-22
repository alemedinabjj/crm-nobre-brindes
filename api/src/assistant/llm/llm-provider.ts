/**
 * Contrato mínimo com o provedor de IA. O agente, os guardrails e os evals
 * dependem só disto; trocar Gemini por outro provedor é escrever outra
 * implementação, sem tocar no resto.
 */

export type ChatRole = 'user' | 'assistant';

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type ToolResult = {
  callId: string;
  name: string;
  output: unknown;
};

/** Um turno da conversa interna do agente. */
export type AgentMessage =
  | { role: 'user'; text: string }
  | {
      role: 'assistant';
      text: string;
      toolCalls: ToolCall[];
      /**
       * Resposta crua do provedor, devolvida como veio nos turnos seguintes.
       * O Gemini exige isso para manter as "thought signatures" entre
       * chamadas de ferramenta; outros provedores podem ignorar.
       */
      providerContent?: unknown;
    }
  | { role: 'tool'; results: ToolResult[] };

export type ToolDeclaration = {
  name: string;
  description: string;
  /** JSON Schema dos argumentos. */
  parameters: Record<string, unknown>;
};

export type GenerateRequest = {
  system: string;
  messages: AgentMessage[];
  tools: ToolDeclaration[];
  temperature?: number;
};

export type TokenUsage = { inputTokens: number; outputTokens: number };

export type GenerateResponse = {
  text: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  providerContent?: unknown;
  /** Modelo que gerou a resposta, quando o provedor faz fallback. */
  model?: string;
};

export type EmbeddingPurpose = 'document' | 'query';

export interface LlmProvider {
  readonly name: string;
  readonly chatModel: string;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
  embed(texts: string[], purpose: EmbeddingPurpose): Promise<number[][]>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/**
 * O provedor não conseguiu responder (sobrecarga, timeout, cota) mesmo após
 * as novas tentativas. É falha temporária do lado de fora, não bug nosso:
 * vira 503 com mensagem clara em vez de 500 genérico.
 */
export class LlmUnavailableError extends Error {
  constructor(message = 'O provedor de IA não respondeu.', cause?: unknown) {
    super(message, { cause });
    this.name = 'LlmUnavailableError';
  }
}
