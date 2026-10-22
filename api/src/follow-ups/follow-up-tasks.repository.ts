import { and, eq } from 'drizzle-orm';
import type { Database } from '../database/database.module.js';
import { followUpTasks } from '../database/schema.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;

/**
 * Fecha a tarefa aberta de uma negociação quando o vendedor age sobre ela
 * (registra contato, muda a etapa). Assim a fila de retornos reflete o
 * trabalho feito sem exigir um clique a mais.
 */
export const resolveOpenFollowUp = async (
  executor: Executor,
  opportunityId: string,
  status: 'DONE' | 'CANCELED',
  resolution: string,
): Promise<void> => {
  await executor
    .update(followUpTasks)
    .set({ status, resolution, resolvedAt: new Date() })
    .where(
      and(
        eq(followUpTasks.opportunityId, opportunityId),
        eq(followUpTasks.status, 'OPEN'),
      ),
    );
};
