/**
 * Limite por janela deslizante, em memória. Suficiente para uma instância;
 * com várias réplicas, o mesmo contrato iria para o Redis.
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  tryAcquire(key: string): boolean {
    const current = this.now();
    const recent = (this.hits.get(key) ?? []).filter(
      (time) => current - time < this.windowMs,
    );
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(current);
    this.hits.set(key, recent);
    return true;
  }
}
