import { pathToFileURL } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { parseCalendarDate } from '../domain/calendar-date.js';
import { checkStageInvariants } from '../domain/stage-transition.js';
import { opportunities, opportunityItems, stageChanges } from './schema.js';
import { SEED_OPPORTUNITIES, type SeedOpportunity } from './seed-data.js';

const IMPORT_REASON = 'Carga inicial: etapa importada da planilha comercial';

/** A carga passa pelas mesmas invariantes da API: dado inválido não entra calado. */
const assertValid = (seed: SeedOpportunity): void => {
  const violations = checkStageInvariants(seed.stage, {
    estimatedValue: seed.estimatedValue,
    itemCount: 1,
    proposalValidUntil:
      seed.proposalValidUntil === null
        ? null
        : parseCalendarDate(seed.proposalValidUntil),
  });
  if (violations.length > 0) {
    const messages = violations.map((violation) => violation.message).join(' ');
    throw new Error(
      `${seed.code} viola as regras da etapa ${seed.stage}: ${messages}`,
    );
  }
};

/** Apaga as oportunidades e recarrega os dados do case. Uso: dev e testes. */
export const seedDatabase = async (db: NodePgDatabase): Promise<void> => {
  SEED_OPPORTUNITIES.forEach(assertValid);

  await db.transaction(async (tx) => {
    await tx.delete(opportunities);

    for (const seed of SEED_OPPORTUNITIES) {
      const { item, ...opportunity } = seed;
      const [created] = await tx
        .insert(opportunities)
        .values(opportunity)
        .returning({ id: opportunities.id });
      if (!created) throw new Error(`Falha ao inserir ${seed.code}`);

      await tx
        .insert(opportunityItems)
        .values({ opportunityId: created.id, ...item });
      await tx.insert(stageChanges).values({
        opportunityId: created.id,
        fromStage: null,
        toStage: seed.stage,
        reason: IMPORT_REASON,
        changedBy: 'seed',
      });
    }
  });
};

const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await seedDatabase(drizzle(pool));
    console.log(`${SEED_OPPORTUNITIES.length} oportunidades carregadas.`);
  } finally {
    await pool.end();
  }
}
