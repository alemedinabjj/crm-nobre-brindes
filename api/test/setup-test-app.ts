import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { AppModule } from '../src/app.module.js';
import { seedDatabase } from '../src/database/seed.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/crm_nobre_test';

export type TestContext = {
  app: INestApplication;
  resetDatabase: () => Promise<void>;
  close: () => Promise<void>;
};

/**
 * Sobe a aplicação real contra um banco de teste dedicado, com a data de
 * referência do case. Cada teste pode chamar resetDatabase() para isolar dados.
 */
export const setupTestApp = async (
  env: Record<string, string> = {},
): Promise<TestContext> => {
  Object.assign(process.env, {
    DATABASE_URL: TEST_DATABASE_URL,
    REFERENCE_DATE: '2026-10-15',
    API_KEY: '',
    AUTOMATION_SECRET: '',
    FOLLOW_UP_CRON: '',
    ...env,
  });

  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: './drizzle' });

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();

  return {
    app,
    resetDatabase: () => seedDatabase(db),
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
};
