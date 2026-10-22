/**
 * Política de novas tentativas para chamadas ao provedor de IA.
 *
 * O Gemini devolve 503 ("high demand") e 504 (deadline) em picos de uso, e
 * 429 quando a cota do minuto estoura. São falhas passageiras: vale tentar de
 * novo com espera crescente e, se o modelo principal seguir indisponível,
 * cair para um modelo reserva. Erros 4xx de requisição (400, 401, 403, 404)
 * não melhoram com nova tentativa e sobem na hora. A exceção é o 404 de
 * modelo: o Google aposenta modelos, então um reserva que sumiu é pulado.
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

/** Modelo inexistente ou aposentado: não adianta repetir, mas há outros na fila. */
export const isModelMissing = (error: unknown): boolean =>
  errorStatus(error) === 404;

/**
 * Timeout já custou o prazo inteiro: repetir no mesmo modelo dobra a espera
 * do usuário. Melhor ir direto para o próximo da fila.
 */
export const isTimeout = (error: unknown): boolean => {
  if (errorStatus(error) === 504 || errorStatus(error) === 408) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|aborted|DEADLINE_EXCEEDED/i.test(message);
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
 * Disjuntor simples: modelo que acabou de falhar vai para o fim da fila por um
 * tempo, e as próximas perguntas não pagam de novo o timeout dele.
 */
export class ModelCooldown {
  private readonly until = new Map<string, number>();

  constructor(
    private readonly cooldownMs = 120_000,
    private readonly now: () => number = Date.now,
  ) {}

  trip(model: string): void {
    this.until.set(model, this.now() + this.cooldownMs);
  }

  isCooling(model: string): boolean {
    return (this.until.get(model) ?? 0) > this.now();
  }

  /** Mantém a ordem, mas manda os modelos em resfriamento para o fim. */
  order(models: readonly string[]): string[] {
    return [
      ...models.filter((model) => !this.isCooling(model)),
      ...models.filter((model) => this.isCooling(model)),
    ];
  }
}

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
    /** Avisado quando um modelo esgota as tentativas (para o disjuntor). */
    onModelFailed?: (model: string) => void;
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
        const missing = isModelMissing(error);
        if (!missing && !isRetryable(error)) throw error;
        const attempt = { model, error };
        attempts.push(attempt);
        options.onRetry?.(attempt);
        if (missing || isTimeout(error)) break;
      }
    }
    options.onModelFailed?.(model);
  }
  throw options.exhausted(attempts);
};
