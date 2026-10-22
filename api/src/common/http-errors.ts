import { HttpException, HttpStatus } from '@nestjs/common';
import type { RuleViolation } from '../domain/stage-transition.js';

/**
 * Formato único de erro da API. `violations` lista todas as regras quebradas
 * de uma vez, para a tela mostrar o que falta sem tentativa e erro.
 */
export type ApiErrorBody = {
  error: string;
  message: string;
  violations?: RuleViolation[];
  fields?: { path: string; message: string }[];
};

export class BusinessRuleException extends HttpException {
  constructor(violations: RuleViolation[]) {
    const body: ApiErrorBody = {
      error: 'BUSINESS_RULE_VIOLATION',
      message: violations.map((violation) => violation.message).join(' '),
      violations,
    };
    super(body, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class InvalidInputException extends HttpException {
  constructor(fields: { path: string; message: string }[]) {
    const body: ApiErrorBody = {
      error: 'INVALID_INPUT',
      message: 'Dados inválidos na requisição.',
      fields,
    };
    super(body, HttpStatus.BAD_REQUEST);
  }
}

export class OpportunityNotFoundException extends HttpException {
  constructor(id: string) {
    const body: ApiErrorBody = {
      error: 'NOT_FOUND',
      message: `Oportunidade ${id} não encontrada.`,
    };
    super(body, HttpStatus.NOT_FOUND);
  }
}
