import { Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { InvalidInputException } from './http-errors.js';

@Injectable()
export class ZodValidationPipe<
  TSchema extends z.ZodType,
> implements PipeTransform<unknown, z.infer<TSchema>> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.infer<TSchema> {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;

    throw new InvalidInputException(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
}
