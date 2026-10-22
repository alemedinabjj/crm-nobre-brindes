/**
 * Política de novas tentativas para chamadas ao provedor de IA.
 *
 * O Gemini devolve 503 ("high demand") e 504 (deadline) em picos de uso, e
 * 429 quando a cota do minuto estoura. São falhas passageiras: vale tentar de
 * novo com espera crescente e, se o modelo principal seguir indisponível,
 * cair para um modelo reserva. Erros 4xx de requisição (400, 401, 403, 404)
 * não melhoram com nova tentativa e sobem na hora.
 */

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_MESSAGE =
  /timeout|timed out|aborted|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up|UNAVAILABLE|DEADLINE_EXCEEDED|RESOURCE_EXHAUSTED/i;

export const errorStatus = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
};

export const isRetryable = (error: unknown): boolean => {
  const status = errorStatus(error);
  if (status !== undefined) return RETRYABLE_STATUS.has(status);
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_MESSAGE.test(message);
};

export type RetryPolicy = {
  /** Tentativas por modelo (a primeira inclusa). */
  attemptsPerModel: number;
  /** Espera antes da 2ª tentativa; dobra a cada nova tentativa. */
  baseDelayMs: number;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  attemptsPerModel: 2,
  baseDelayMs: 800,
};

export type Attempt = { model: string; error: unknown };

/**
 * Executa `call` em cada modelo da lista, em ordem, com novas tentativas.
 * Devolve o primeiro sucesso; erro não recuperável sobe imediatamente; se tudo
 * falhar por motivo passageiro, lança `exhausted(tentativas)`.
 */
export const withModelFallback = async <T>(
  models: readonly string[],
  call: (model: string) => Promise<T>,
  options: {
    policy?: RetryPolicy;
    sleep?: (ms: number) => Promise<void>;
    exhausted: (attempts: Attempt[]) => Error;
    onRetry?: (attempt: Attempt) => void;
  },
): Promise<T> => {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts: Attempt[] = [];

  for (const model of models) {
    for (let index = 0; index < policy.attemptsPerModel; index += 1) {
      if (index > 0) await sleep(policy.baseDelayMs * 2 ** (index - 1));
      try {
        return await call(model);
      } catch (error) {
        if (!isRetryable(error)) throw error;
        const attempt = { model, error };
        attempts.push(attempt);
        options.onRetry?.(attempt);
      }
    }
  }
  throw options.exhausted(attempts);
};
