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

const matches = (received: string, expected: string): boolean =>
  received.length === expected.length &&
  timingSafeEqual(Buffer.from(received), Buffer.from(expected));

/**
 * Disparar a automação é uma ação de servidor para servidor (Cron da Vercel).
 * Em produção, AUTOMATION_SECRET é obrigatório; localmente, sem o segredo
 * configurado, o botão "Rodar agora" da tela funciona para demonstração.
 */
@Injectable()
export class AutomationSecretGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.AUTOMATION_SECRET;
    if (!expected) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (matches(request.header('x-automation-secret') ?? '', expected))
      return true;

    throw new UnauthorizedException({
      error: 'UNAUTHORIZED',
      message: 'Segredo da automação ausente ou inválido.',
    });
  }
}
