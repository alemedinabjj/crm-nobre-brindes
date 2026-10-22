import { describe, expect, it, vi } from 'vitest';
import {
  FOREIGN_THOUGHT_SIGNATURE,
  GeminiProvider,
  toContents,
} from './gemini.provider.js';
import { LlmUnavailableError } from './llm-provider.js';
import { isRetryable, withModelFallback } from './resilience.js';

const apiError = (status: number) =>
  Object.assign(new Error(`erro ${status}`), { status });

const run = <T>(models: string[], call: (model: string) => Promise<T>) =>
  withModelFallback(models, call, {
    sleep: () => Promise.resolve(),
    exhausted: (attempts) =>
      new LlmUnavailableError(`${attempts.length} tentativas`),
  });

describe('isRetryable', () => {
  it('trata sobrecarga, deadline e cota como passageiros', () => {
    for (const status of [429, 500, 503, 504])
      expect(isRetryable(apiError(status))).toBe(true);
    expect(isRetryable(new Error('fetch failed'))).toBe(true);
  });

  it('não insiste em erro de requisição ou de chave', () => {
    for (const status of [400, 401, 403, 404])
      expect(isRetryable(apiError(status))).toBe(false);
  });
});

describe('withModelFallback', () => {
  it('tenta de novo no mesmo modelo e devolve o primeiro sucesso', async () => {
    const call = vi
      .fn<(model: string) => Promise<string>>()
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValueOnce('ok');
    await expect(run(['principal', 'reserva'], call)).resolves.toBe('ok');
    expect(call.mock.calls.map(([model]) => model)).toEqual([
      'principal',
      'principal',
    ]);
  });

  it('cai para o modelo reserva quando o principal segue sobrecarregado', async () => {
    const call = vi.fn((model: string) =>
      model === 'principal'
        ? Promise.reject(apiError(503))
        : Promise.resolve(model),
    );
    await expect(run(['principal', 'reserva'], call)).resolves.toBe('reserva');
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('esgotadas as tentativas, lança erro de indisponibilidade', async () => {
    const call = vi.fn(() => Promise.reject(apiError(504)));
    await expect(run(['a', 'b'], call)).rejects.toThrow('4 tentativas');
  });

  it('pula modelo reserva aposentado (404) e segue para o próximo', async () => {
    const call = vi.fn((model: string) => {
      if (model === 'principal') return Promise.reject(apiError(503));
      if (model === 'aposentado') return Promise.reject(apiError(404));
      return Promise.resolve(model);
    });
    await expect(
      run(['principal', 'aposentado', 'vigente'], call),
    ).resolves.toBe('vigente');
    expect(call.mock.calls.map(([model]) => model)).toEqual([
      'principal',
      'principal',
      'aposentado',
      'vigente',
    ]);
  });

  it('erro não recuperável sobe na hora, sem fallback', async () => {
    const call = vi.fn(() => Promise.reject(apiError(400)));
    await expect(run(['a', 'b'], call)).rejects.toThrow('erro 400');
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe('toContents', () => {
  const raw = {
    role: 'model',
    parts: [
      {
        functionCall: { id: 'c1', name: 'resumo_funil', args: {} },
        thoughtSignature: 'assinatura',
      },
    ],
  };
  const history = [
    { role: 'user' as const, text: 'oi' },
    {
      role: 'assistant' as const,
      text: '',
      toolCalls: [{ id: 'c1', name: 'resumo_funil', args: {} }],
      providerContent: { model: 'principal', content: raw },
    },
  ];

  it('reenvia a resposta crua (com assinatura) ao mesmo modelo', () => {
    expect(toContents(history, 'principal')[1]).toBe(raw);
  });

  it('reconstrói sem assinatura quando o próximo turno vai para outro modelo', () => {
    const rebuilt = toContents(history, 'reserva')[1];
    expect(rebuilt).toEqual({
      role: 'model',
      parts: [
        {
          functionCall: { id: 'c1', name: 'resumo_funil', args: {} },
          thoughtSignature: FOREIGN_THOUGHT_SIGNATURE,
        },
      ],
    });
  });

  it('mantém a conversa no modelo que já respondeu o turno anterior', () => {
    const provider = new GeminiProvider({
      apiKey: 'teste',
      chatModel: 'principal',
      fallbackChatModels: ['reserva', 'outro'],
      embeddingModel: 'emb',
      embeddingDimensions: 768,
      timeoutMs: 1000,
    });
    const fromReserve = [
      history[0]!,
      { ...history[1]!, providerContent: { model: 'reserva', content: raw } },
    ];
    expect(provider.modelOrderFor(fromReserve)).toEqual([
      'reserva',
      'principal',
      'outro',
    ]);
    expect(provider.modelOrderFor([history[0]!])).toEqual([
      'principal',
      'reserva',
      'outro',
    ]);
  });
});
