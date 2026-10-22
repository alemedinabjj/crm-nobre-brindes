import { z } from 'zod';

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

const optionalSecret = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  TZ_OPERACAO: z.string().default('America/Sao_Paulo'),
  /** Fixa "hoje" para reproduzir o cenário do case. Vazio = data real. */
  REFERENCE_DATE: z
    .string()
    .regex(isoDate, 'REFERENCE_DATE deve estar no formato AAAA-MM-DD')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Quando definida, toda requisição precisa do header x-api-key. */
  API_KEY: optionalSecret,
  /** Exigido no header x-automation-secret para disparar a automação. */
  AUTOMATION_SECRET: optionalSecret,
  /**
   * Agenda interna da automação de follow-up (cron de 5 campos, no fuso da
   * operação). Padrão: 7h40 em dias úteis. Vazio desliga o agendamento.
   */
  FOLLOW_UP_CRON: z
    .string()
    .default('40 7 * * 1-5')
    .transform((value) => value.trim() || undefined),
});

export type AppConfig = z.infer<typeof envSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuração inválida:\n${issues}`);
  }
  return parsed.data;
};
