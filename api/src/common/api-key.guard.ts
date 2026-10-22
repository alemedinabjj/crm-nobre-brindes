import { timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

/**
 * Proteção mínima para o ambiente do case: se API_KEY estiver configurada,
 * exige o header x-api-key. Em produção o plano é outro (ver README):
 * SSO corporativo com JWT, papéis por vendedor/gestor e rate limiting.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.API_KEY;
    if (!expected) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (request.path === '/health') return true;

    const received = request.header('x-api-key') ?? '';
    const isValid =
      received.length === expected.length &&
      timingSafeEqual(Buffer.from(received), Buffer.from(expected));
    if (!isValid)
      throw new UnauthorizedException({
        error: 'UNAUTHORIZED',
        message: 'API key ausente ou inválida.',
      });
    return true;
  }
}
