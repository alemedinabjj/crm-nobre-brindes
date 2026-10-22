import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export const DATABASE = Symbol('DATABASE');
const POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 }),
    },
    {
      provide: DATABASE,
      inject: [POOL],
      useFactory: (pool: pg.Pool): Database => drizzle(pool, { schema }),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
