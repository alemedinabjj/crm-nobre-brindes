import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AutomationSecretGuard } from '../follow-ups/automation-secret.guard.js';
import { AssistantService } from './assistant.service.js';

const chatSchema = z.object({
  message: z.string().max(4000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(8000),
      }),
    )
    .max(20)
    .default([]),
  seller: z.string().trim().max(80).optional(),
});
type ChatInput = z.infer<typeof chatSchema>;

const searchSchema = z.object({
  query: z.string().trim().min(2).max(300),
  limit: z.number().int().min(1).max(10).default(4),
});
type SearchInput = z.infer<typeof searchSchema>;

const clientKey = (request: Request): string =>
  request.header('x-forwarded-for')?.split(',')[0]?.trim() ||
  request.ip ||
  'desconhecido';

@Controller('assistant')
export class AssistantController {
  constructor(
    @Inject(AssistantService) private readonly assistant: AssistantService,
  ) {}

  @Get('status')
  status() {
    return this.assistant.status();
  }

  @Post('chat')
  @HttpCode(200)
  chat(
    @Body(new ZodValidationPipe(chatSchema)) body: ChatInput,
    @Req() request: Request,
  ) {
    return this.assistant.chat(
      body.message,
      body.history,
      clientKey(request),
      body.seller,
    );
  }

  /** Busca direta na base (sem chat): usada pela tela de fontes e pelos evals. */
  @Post('search')
  @HttpCode(200)
  search(@Body(new ZodValidationPipe(searchSchema)) body: SearchInput) {
    return this.assistant.search(body.query, body.limit);
  }

  /** Reprocessa a base sob demanda (ex.: depois de editar um documento). */
  @Post('knowledge/sync')
  @HttpCode(200)
  @UseGuards(AutomationSecretGuard)
  sync() {
    return this.assistant.syncKnowledge();
  }
}
