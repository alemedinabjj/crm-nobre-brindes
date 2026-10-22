import { z } from 'zod';
import { allowedTargets } from '../../domain/stage-transition.js';
import { STAGE_LABELS, STAGES, type Stage } from '../../domain/stage.js';
import type { FollowUpsService } from '../../follow-ups/follow-ups.service.js';
import type { OpportunityView } from '../../opportunities/opportunity.presenter.js';
import type { OpportunitiesService } from '../../opportunities/opportunities.service.js';
import { looksLikeInjection } from '../guardrails/input-guard.js';
import type { SearchHit } from '../knowledge/knowledge.repository.js';
import type { ToolDeclaration } from '../llm/llm-provider.js';

/**
 * Ferramentas que o modelo pode chamar. Regras de projeto:
 *
 * 1. Lista fechada: o modelo só enxerga o que está aqui.
 * 2. Argumentos validados por Zod antes de executar; o mesmo schema gera a
 *    declaração JSON Schema enviada ao Gemini.
 * 3. Leitura reaproveita os serviços da API (mesmas regras e mesmos cálculos
 *    de atenção que a tela usa).
 * 4. Ações nunca executam: devolvem uma proposta que o vendedor confirma com
 *    um clique, e aí a API normal valida tudo de novo (humano no circuito).
 */

export type ProposedAction =
  | {
      type: 'CHANGE_STAGE';
      opportunityId: string;
      opportunityCode: string;
      companyName: string;
      fromStage: Stage;
      toStage: Stage;
      reason: string | null;
      requiresReason: boolean;
      summary: string;
    }
  | {
      type: 'REGISTER_CONTACT';
      opportunityId: string;
      opportunityCode: string;
      companyName: string;
      summary: string;
    };

export type ToolContext = {
  opportunities: OpportunitiesService;
  followUps: FollowUpsService;
  searchKnowledge: (query: string) => Promise<SearchHit[]>;
  /** Numera as fontes de forma contínua ao longo da resposta. */
  registerSources: (hits: SearchHit[]) => { number: number; hit: SearchHit }[];
};

export type ToolOutcome = {
  output: unknown;
  /** Códigos OPP que apareceram no resultado (alimenta o guardrail de saída). */
  opportunityCodes?: string[];
  proposedAction?: ProposedAction;
  suspiciousContentDropped?: boolean;
};

type ToolDefinition<TSchema extends z.ZodType> = {
  name: string;
  description: string;
  kind: 'read' | 'action';
  schema: TSchema;
  execute: (
    args: z.infer<TSchema>,
    context: ToolContext,
  ) => Promise<ToolOutcome>;
};

export type ToolRunResult =
  { ok: true; outcome: ToolOutcome } | { ok: false; error: string };

export type AssistantTool = {
  name: string;
  description: string;
  kind: 'read' | 'action';
  schema: z.ZodType;
  /** Valida os argumentos vindos do modelo e só então executa. */
  run: (rawArgs: unknown, context: ToolContext) => Promise<ToolRunResult>;
};

const defineTool = <TSchema extends z.ZodType>(
  definition: ToolDefinition<TSchema>,
): AssistantTool => ({
  name: definition.name,
  description: definition.description,
  kind: definition.kind,
  schema: definition.schema,
  run: async (rawArgs, context) => {
    const parsed = definition.schema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues
          .map(
            (issue) =>
              `${issue.path.join('.') || 'argumentos'}: ${issue.message}`,
          )
          .join('; '),
      };
    }
    return {
      ok: true,
      outcome: await definition.execute(parsed.data, context),
    };
  },
});

const ATTENTION_FILTER = {
  qualquer: 'any',
  urgente: 'critical',
  alerta: 'warning',
} as const;
const opportunityCode = z
  .string()
  .regex(/^OPP-\d{3,6}$/i, 'Use o código no formato OPP-2003')
  .transform((value) => value.toUpperCase());
const stageEnum = z.enum(STAGES);

const money = (value: number | null) =>
  value === null
    ? null
    : `R$ ${value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;

const summarize = (opportunity: OpportunityView) => ({
  codigo: opportunity.code,
  empresa: opportunity.companyName,
  etapa: STAGE_LABELS[opportunity.stage],
  vendedor: opportunity.sellerName,
  valor_estimado: money(opportunity.estimatedValue),
  atencao: opportunity.attention.level,
  motivos: opportunity.attention.signals.map((signal) => signal.message),
});

const notFound = (code: string): ToolOutcome => ({
  output: { erro: `Oportunidade ${code} não encontrada no CRM.` },
});

export const ASSISTANT_TOOLS: AssistantTool[] = [
  defineTool({
    name: 'buscar_base_conhecimento',
    kind: 'read',
    description:
      'Busca trechos da base de conhecimento da Nobre Brindes: processo comercial, prazos de produção, técnicas de personalização, catálogo e quantidades mínimas, políticas de pagamento e desconto, frete, objeções e roteiro de ligação. Use para qualquer pergunta sobre regras, produtos ou como vender. Cite as fontes pelo número.',
    schema: z.object({
      pergunta: z
        .string()
        .min(3)
        .max(300)
        .describe('A dúvida reformulada como busca, em português.'),
    }),
    execute: async ({ pergunta }, context) => {
      const hits = await context.searchKnowledge(pergunta);
      const safe = hits.filter((hit) => !looksLikeInjection(hit.content));
      const numbered = context.registerSources(safe);
      return {
        suspiciousContentDropped: safe.length < hits.length,
        output:
          numbered.length === 0
            ? {
                resultado: 'Nada relevante encontrado na base de conhecimento.',
              }
            : {
                fontes: numbered.map(({ number, hit }) => ({
                  fonte: number,
                  documento: hit.documentTitle,
                  secao: hit.section,
                  trecho: hit.content,
                })),
              },
      };
    },
  }),
  defineTool({
    name: 'listar_oportunidades',
    kind: 'read',
    description:
      'Lista oportunidades do funil com atenção calculada, já ordenadas da mais urgente para a menos urgente. Filtre por vendedor, etapa, nível de atenção ou texto (empresa, código ou item).',
    schema: z.object({
      vendedor: z.string().max(80).optional(),
      etapa: stageEnum.optional(),
      atencao: z
        .enum(['qualquer', 'urgente', 'alerta'])
        .optional()
        .describe('"qualquer" traz urgentes e alertas.'),
      busca: z.string().max(100).optional(),
    }),
    execute: async ({ vendedor, etapa, atencao, busca }, context) => {
      const list = await context.opportunities.list({
        seller: vendedor,
        stage: etapa ? [etapa] : undefined,
        attention: atencao ? ATTENTION_FILTER[atencao] : undefined,
        search: busca,
      });
      const shown = list.slice(0, 15);
      return {
        opportunityCodes: shown.map((item) => item.code),
        output: { total: list.length, oportunidades: shown.map(summarize) },
      };
    },
  }),
  defineTool({
    name: 'detalhar_oportunidade',
    kind: 'read',
    description:
      'Mostra tudo sobre uma oportunidade: itens, datas, motivos de atenção, histórico de etapas e para quais etapas ela pode ir.',
    schema: z.object({ codigo: opportunityCode }),
    execute: async ({ codigo }, context) => {
      const detail = await context.opportunities.findByCode(codigo);
      if (!detail) return notFound(codigo);
      return {
        opportunityCodes: [detail.code],
        output: {
          ...summarize(detail),
          itens: detail.items.map(
            (item) => `${item.quantity} × ${item.productName}`,
          ),
          ultimo_contato: detail.lastContactAt,
          validade_proposta: detail.proposalValidUntil,
          evento_do_cliente: detail.clientEventDate,
          motivo_da_perda: detail.lossReason,
          pode_ir_para: detail.allowedTransitions.map(
            (stage) => STAGE_LABELS[stage],
          ),
          historico: detail.history.slice(-5).map((change) => ({
            de: change.fromStage ? STAGE_LABELS[change.fromStage] : null,
            para: STAGE_LABELS[change.toStage],
            quando: change.changedAt,
            motivo: change.reason,
          })),
        },
      };
    },
  }),
  defineTool({
    name: 'listar_retornos',
    kind: 'read',
    description:
      'Lista os retornos (follow-ups) pendentes criados pela automação diária, com prazo e o que fazer. Filtre por vendedor.',
    schema: z.object({ vendedor: z.string().max(80).optional() }),
    execute: async ({ vendedor }, context) => {
      const tasks = await context.followUps.listTasks({
        status: 'OPEN',
        seller: vendedor,
      });
      return {
        opportunityCodes: tasks.map((task) => task.opportunityCode),
        output: {
          total: tasks.length,
          retornos: tasks.map((task) => ({
            codigo: task.opportunityCode,
            empresa: task.companyName,
            vendedor: task.sellerName,
            tarefa: task.title,
            prazo: task.dueDate,
            atrasado_em_dias: Math.max(task.daysOverdue, 0),
            prioridade: task.priority === 'HIGH' ? 'alta' : 'normal',
          })),
        },
      };
    },
  }),
  defineTool({
    name: 'resumo_funil',
    kind: 'read',
    description:
      'Resumo numérico do funil: quantidade e valor por etapa, valor em aberto, valor ganho e quantas negociações precisam de atenção. Filtre por vendedor.',
    schema: z.object({ vendedor: z.string().max(80).optional() }),
    execute: async ({ vendedor }, context) => {
      const list = await context.opportunities.list({ seller: vendedor });
      const byStage = STAGES.map((stage) => {
        const items = list.filter((item) => item.stage === stage);
        return {
          etapa: STAGE_LABELS[stage],
          quantidade: items.length,
          valor: money(
            items.reduce((sum, item) => sum + (item.estimatedValue ?? 0), 0),
          ),
        };
      });
      const open = list.filter(
        (item) => item.stage !== 'FECHAMENTO' && item.stage !== 'PERDIDA',
      );
      return {
        output: {
          por_etapa: byStage,
          valor_em_aberto: money(
            open.reduce((sum, item) => sum + (item.estimatedValue ?? 0), 0),
          ),
          precisam_de_atencao: list.filter(
            (item) => item.attention.level !== 'ok',
          ).length,
          urgentes: list.filter((item) => item.attention.level === 'critical')
            .length,
        },
      };
    },
  }),
  defineTool({
    name: 'propor_mudanca_etapa',
    kind: 'action',
    description:
      'Prepara a mudança de etapa de uma oportunidade para o vendedor confirmar na tela. NÃO executa nada. Use quando o usuário pedir para mover, avançar, voltar, fechar ou marcar como perdida. Perda e retorno de etapa exigem motivo.',
    schema: z.object({
      codigo: opportunityCode,
      destino: stageEnum,
      motivo: z.string().max(300).optional(),
    }),
    execute: async ({ codigo, destino, motivo }, context) => {
      const detail = await context.opportunities.findByCode(codigo);
      if (!detail) return notFound(codigo);

      if (!allowedTargets(detail.stage).includes(destino)) {
        return {
          opportunityCodes: [detail.code],
          output: {
            erro: `${detail.code} está em ${STAGE_LABELS[detail.stage]} e não pode ir para ${STAGE_LABELS[destino]}.`,
            destinos_possiveis: detail.allowedTransitions.map(
              (stage) => STAGE_LABELS[stage],
            ),
          },
        };
      }

      const isBackward =
        destino !== 'PERDIDA' &&
        STAGES.indexOf(destino) < STAGES.indexOf(detail.stage);
      const requiresReason = destino === 'PERDIDA' || isBackward;
      const summary = `Mover ${detail.code} (${detail.companyName}) de ${STAGE_LABELS[detail.stage]} para ${STAGE_LABELS[destino]}`;
      return {
        opportunityCodes: [detail.code],
        proposedAction: {
          type: 'CHANGE_STAGE',
          opportunityId: detail.id,
          opportunityCode: detail.code,
          companyName: detail.companyName,
          fromStage: detail.stage,
          toStage: destino,
          reason: motivo?.trim() || null,
          requiresReason,
          summary,
        },
        output: {
          status: 'proposta criada, aguardando confirmação do usuário na tela',
          resumo: summary,
          precisa_de_motivo: requiresReason && !motivo,
        },
      };
    },
  }),
  defineTool({
    name: 'propor_registro_contato',
    kind: 'action',
    description:
      'Prepara o registro de um contato feito hoje com o cliente, para o vendedor confirmar na tela. NÃO executa nada.',
    schema: z.object({ codigo: opportunityCode }),
    execute: async ({ codigo }, context) => {
      const detail = await context.opportunities.findByCode(codigo);
      if (!detail) return notFound(codigo);
      const summary = `Registrar contato de hoje com ${detail.companyName} (${detail.code})`;
      return {
        opportunityCodes: [detail.code],
        proposedAction: {
          type: 'REGISTER_CONTACT',
          opportunityId: detail.id,
          opportunityCode: detail.code,
          companyName: detail.companyName,
          summary,
        },
        output: {
          status: 'proposta criada, aguardando confirmação do usuário na tela',
          resumo: summary,
        },
      };
    },
  }),
];

export const TOOL_NAMES = ASSISTANT_TOOLS.map((tool) => tool.name);

export const toolDeclarations = (): ToolDeclaration[] =>
  ASSISTANT_TOOLS.map((tool) => {
    const { $schema: _ignored, ...parameters } = z.toJSONSchema(tool.schema, {
      io: 'input',
    }) as Record<string, unknown>;
    return { name: tool.name, description: tool.description, parameters };
  });
