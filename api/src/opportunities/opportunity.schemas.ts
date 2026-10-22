import { z } from 'zod';
import { STAGES } from '../domain/stage.js';

/** AAAA-MM-DD de um dia que existe no calendário (rejeita 2026-02-30). */
const calendarDate = z.iso.date({
  message: 'Use uma data válida no formato AAAA-MM-DD',
});

const trimmed = (max: number) =>
  z.string().trim().min(1, 'Campo obrigatório').max(max);

const itemSchema = z.object({
  productName: trimmed(160),
  quantity: z
    .number()
    .int('Quantidade deve ser inteira')
    .positive('Quantidade deve ser maior que zero'),
});

const money = z
  .number()
  .positive('Valor deve ser maior que zero')
  .max(9_999_999_999.99)
  .multipleOf(0.01, 'Use no máximo 2 casas decimais');

export const createOpportunitySchema = z.object({
  companyName: trimmed(160),
  sellerName: trimmed(80),
  estimatedValue: money.nullable().default(null),
  lastContactAt: calendarDate.nullable().default(null),
  proposalValidUntil: calendarDate.nullable().default(null),
  clientEventDate: calendarDate.nullable().default(null),
  items: z.array(itemSchema).max(50).default([]),
});
export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;

/** Edição parcial. Etapa não muda aqui: só pela rota de transição. */
export const updateOpportunitySchema = z
  .object({
    companyName: trimmed(160),
    sellerName: trimmed(80),
    estimatedValue: money.nullable(),
    lastContactAt: calendarDate.nullable(),
    proposalValidUntil: calendarDate.nullable(),
    clientEventDate: calendarDate.nullable(),
    /** Quando enviado, substitui a lista inteira de itens. */
    items: z.array(itemSchema).max(50),
  })
  .partial()
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'Envie ao menos um campo para atualizar',
  );
export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;

export const changeStageSchema = z.object({
  to: z.enum(STAGES, {
    message: `Etapa inválida. Use uma de: ${STAGES.join(', ')}`,
  }),
  reason: z.string().trim().max(500).nullish(),
  changedBy: z.string().trim().max(80).nullish(),
});
export type ChangeStageInput = z.infer<typeof changeStageSchema>;

export const registerContactSchema = z.object({
  /** Padrão: hoje. Permite registrar um contato feito em dia anterior. */
  contactedOn: calendarDate.optional(),
});
export type RegisterContactInput = z.infer<typeof registerContactSchema>;

/** `?stage=FOLLOW_UP,FORECAST` */
const stageList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.enum(STAGES, { message: 'Etapa inválida no filtro' })));

export const listOpportunitiesQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  stage: stageList.optional(),
  seller: z.string().trim().max(80).optional(),
  attention: z.enum(['critical', 'warning', 'any']).optional(),
});
export type ListOpportunitiesQuery = z.infer<
  typeof listOpportunitiesQuerySchema
>;
