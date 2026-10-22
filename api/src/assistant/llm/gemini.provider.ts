import { randomUUID } from 'node:crypto';
import {
  GoogleGenAI,
  type Content,
  type GenerateContentResponse,
  type Part,
} from '@google/genai';
import type {
  AgentMessage,
  EmbeddingPurpose,
  GenerateRequest,
  GenerateResponse,
  LlmProvider,
  ToolCall,
} from './llm-provider.js';

export type GeminiOptions = {
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  timeoutMs: number;
};

const EMBED_BATCH_SIZE = 50;

const isContent = (value: unknown): value is Content =>
  typeof value === 'object' && value !== null && 'parts' in value;

/** Converte o histórico neutro do agente para o formato do Gemini. */
const toContents = (messages: AgentMessage[]): Content[] =>
  messages.map((message): Content => {
    if (message.role === 'user') {
      return { role: 'user', parts: [{ text: message.text }] };
    }
    if (message.role === 'assistant') {
      // Reenvia a resposta original: preserva thought signatures das chamadas.
      if (isContent(message.providerContent)) return message.providerContent;
      const parts: Part[] = [];
      if (message.text) parts.push({ text: message.text });
      for (const call of message.toolCalls) {
        parts.push({
          functionCall: { id: call.id, name: call.name, args: call.args },
        });
      }
      return { role: 'model', parts };
    }
    return {
      role: 'user',
      parts: message.results.map((result) => ({
        functionResponse: {
          id: result.callId,
          name: result.name,
          response: { output: result.output },
        },
      })),
    };
  });

const readToolCalls = (response: GenerateContentResponse): ToolCall[] =>
  (response.functionCalls ?? []).map((call) => ({
    id: call.id ?? randomUUID(),
    name: call.name ?? '',
    args: (call.args as Record<string, unknown> | undefined) ?? {},
  }));

const readText = (response: GenerateContentResponse): string => {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => typeof part.text === 'string' && !part.thought)
    .map((part) => part.text)
    .join('')
    .trim();
};

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  private readonly client: GoogleGenAI;

  constructor(private readonly options: GeminiOptions) {
    this.client = new GoogleGenAI({
      apiKey: options.apiKey,
      httpOptions: { timeout: options.timeoutMs },
    });
  }

  get chatModel(): string {
    return this.options.chatModel;
  }

  get embeddingModel(): string {
    return this.options.embeddingModel;
  }

  get embeddingDimensions(): number {
    return this.options.embeddingDimensions;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const response = await this.client.models.generateContent({
      model: this.options.chatModel,
      contents: toContents(request.messages),
      config: {
        systemInstruction: request.system,
        temperature: request.temperature ?? 0.2,
        tools:
          request.tools.length > 0
            ? [
                {
                  functionDeclarations: request.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parametersJsonSchema: tool.parameters,
                  })),
                },
              ]
            : undefined,
      },
    });

    return {
      text: readText(response),
      toolCalls: readToolCalls(response),
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
      providerContent: response.candidates?.[0]?.content,
    };
  }

  async embed(texts: string[], purpose: EmbeddingPurpose): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
      const batch = texts.slice(start, start + EMBED_BATCH_SIZE);
      const response = await this.client.models.embedContent({
        model: this.options.embeddingModel,
        contents: batch,
        config: {
          taskType:
            purpose === 'document' ? 'RETRIEVAL_DOCUMENT' : 'RETRIEVAL_QUERY',
          outputDimensionality: this.options.embeddingDimensions,
        },
      });
      const embeddings = response.embeddings ?? [];
      if (embeddings.length !== batch.length) {
        throw new Error(
          `Embedding retornou ${embeddings.length} vetores para ${batch.length} textos.`,
        );
      }
      for (const embedding of embeddings)
        vectors.push(normalize(embedding.values ?? []));
    }
    return vectors;
  }
}

/**
 * Vetores com dimensão reduzida (768) não vêm normalizados; normalizar deixa
 * a distância de cosseno estável e comparável entre consultas.
 */
export const normalize = (vector: number[]): number[] => {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? vector : vector.map((value) => value / norm);
};
