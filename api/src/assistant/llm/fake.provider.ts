import { createHash } from 'node:crypto';
import { normalize } from './gemini.provider.js';
import type {
  EmbeddingPurpose,
  GenerateRequest,
  GenerateResponse,
  LlmProvider,
} from './llm-provider.js';

export type ScriptedTurn = (
  request: GenerateRequest,
) => Omit<GenerateResponse, 'usage'>;

const STOPWORDS = new Set(
  'a o as os de da do das dos e é em um uma uns umas para por com sem no na nos nas ao à que se qual quais como quando onde mais menos muito'.split(
    ' ',
  ),
);

/** Minúsculas, sem acento e sem pontuação: "Prazo de produção?" → ["prazo", "producao"]. */
export const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));

/**
 * Embedding determinístico por hashing de palavras (bag of words): textos que
 * compartilham palavras ficam próximos. Não entende sinônimos, mas permite
 * testar ingestão, índice HNSW e busca de ponta a ponta sem rede e sem custo.
 */
export const hashingEmbedding = (
  text: string,
  dimensions: number,
): number[] => {
  const vector = Array.from({ length: dimensions }, () => 0);
  for (const token of tokenize(text)) {
    const digest = createHash('md5').update(token).digest();
    const index = digest.readUInt32BE(0) % dimensions;
    vector[index] = (vector[index] ?? 0) + (digest[4]! % 2 === 0 ? 1 : -1);
  }
  return normalize(vector);
};

/** Provedor de mentira para testes: respostas roteirizadas e embedding por hashing. */
export class FakeLlmProvider implements LlmProvider {
  readonly name = 'fake';
  readonly chatModel = 'fake-chat';
  readonly embeddingModel = 'fake-hashing-embedding';
  readonly requests: GenerateRequest[] = [];
  private turn = 0;

  constructor(
    private readonly script: ScriptedTurn[] = [],
    readonly embeddingDimensions = 768,
  ) {}

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    this.requests.push(structuredClone(request));
    const step = this.script[Math.min(this.turn, this.script.length - 1)];
    this.turn += 1;
    const response = step?.(request) ?? { text: 'Sem roteiro.', toolCalls: [] };
    return { ...response, usage: { inputTokens: 100, outputTokens: 20 } };
  }

  async embed(
    texts: string[],
    _purpose: EmbeddingPurpose,
  ): Promise<number[][]> {
    return texts.map((text) =>
      hashingEmbedding(text, this.embeddingDimensions),
    );
  }
}
