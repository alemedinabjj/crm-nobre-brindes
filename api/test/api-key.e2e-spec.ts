import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestContext } from './setup-test-app.js';

describe('proteção por API key', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp({ API_KEY: 'chave-de-teste' });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('recusa requisição sem a chave', async () => {
    const response = await request(ctx.app.getHttpServer())
      .get('/opportunities')
      .expect(401);
    expect(response.body.error).toBe('UNAUTHORIZED');
  });

  it('aceita a chave correta', async () => {
    await request(ctx.app.getHttpServer())
      .get('/opportunities')
      .set('x-api-key', 'chave-de-teste')
      .expect(200);
  });

  it('mantém o health check público para o orquestrador', async () => {
    await request(ctx.app.getHttpServer()).get('/health').expect(200);
  });
});
