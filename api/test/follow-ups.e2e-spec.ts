import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestContext } from './setup-test-app.js';

type Task = {
  id: string;
  opportunityId: string;
  opportunityCode: string;
  sellerName: string;
  priority: string;
  title: string;
  dueDate: string;
  daysOverdue: number;
  status: string;
  resolution: string | null;
};

let ctx: TestContext;
const http = () => request(ctx.app.getHttpServer());

const runAutomation = () =>
  http().post('/automations/follow-ups/run').expect(200);
const openTasks = async (seller?: string): Promise<Task[]> =>
  (
    await http()
      .get('/follow-up-tasks')
      .query(seller ? { seller } : {})
      .expect(200)
  ).body as Task[];
const taskFor = async (code: string) =>
  (await openTasks()).find((task) => task.opportunityCode === code);

beforeAll(async () => {
  ctx = await setupTestApp();
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await ctx.resetDatabase();
});

describe('automação de follow-up', () => {
  it('gera um retorno para cada negociação em risco, com dono e prazo', async () => {
    const run = await runAutomation();
    expect(run.body).toMatchObject({
      trigger: 'manual',
      referenceDate: '2026-10-15',
      createdCount: 3,
      canceledCount: 0,
    });

    const tasks = await openTasks();
    expect(
      tasks.map((task) => [
        task.opportunityCode,
        task.sellerName,
        task.priority,
        task.dueDate,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['OPP-2002', 'Bruno', 'HIGH', '2026-10-15'],
        ['OPP-2003', 'Ana', 'HIGH', '2026-10-15'],
        ['OPP-2004', 'Carla', 'HIGH', '2026-10-15'],
      ]),
    );
    expect(tasks).toHaveLength(3);
  });

  it('é idempotente: rodar de novo não duplica tarefas', async () => {
    await runAutomation();
    const second = await runAutomation();
    expect(second.body.createdCount).toBe(0);
    expect(await openTasks()).toHaveLength(3);
  });

  it('execuções simultâneas não duplicam (lock + índice único)', async () => {
    const runs = await Promise.all([
      runAutomation(),
      runAutomation(),
      runAutomation(),
    ]);
    const created = runs.reduce(
      (total, response) => total + (response.body.createdCount as number),
      0,
    );
    expect(created).toBe(3);
    expect(await openTasks()).toHaveLength(3);
  });

  it('filtra a fila pelo vendedor', async () => {
    await runAutomation();
    const ana = await openTasks('Ana');
    expect(ana.map((task) => task.opportunityCode)).toEqual(['OPP-2003']);
  });

  it('registrar contato conclui o retorno automaticamente', async () => {
    await runAutomation();
    const task = await taskFor('OPP-2004');
    await http()
      .post(`/opportunities/${task?.opportunityId}/contacts`)
      .send({})
      .expect(200);

    expect(await taskFor('OPP-2004')).toBeUndefined();
    const done = (
      await http().get('/follow-up-tasks').query({ status: 'DONE' }).expect(200)
    ).body as Task[];
    expect(done[0]).toMatchObject({
      opportunityCode: 'OPP-2004',
      resolution: 'Contato registrado em 2026-10-15.',
    });
  });

  it('marcar como perdida cancela o retorno', async () => {
    await runAutomation();
    const task = await taskFor('OPP-2002');
    await http()
      .post(`/opportunities/${task?.opportunityId}/stage-transitions`)
      .send({ to: 'PERDIDA', reason: 'Cliente sem verba' })
      .expect(200);

    const canceled = (
      await http()
        .get('/follow-up-tasks')
        .query({ status: 'CANCELED' })
        .expect(200)
    ).body as Task[];
    expect(canceled.map((item) => item.opportunityCode)).toEqual(['OPP-2002']);
  });

  it('o vendedor conclui ou dispensa uma tarefa; tarefa encerrada não reabre', async () => {
    await runAutomation();
    const task = await taskFor('OPP-2003');
    await http()
      .patch(`/follow-up-tasks/${task?.id}`)
      .send({ status: 'DONE', resolution: 'Liguei e confirmei a produção' })
      .expect(204);

    const again = await http()
      .patch(`/follow-up-tasks/${task?.id}`)
      .send({ status: 'CANCELED' })
      .expect(422);
    expect(again.body.error).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('tarefa concluída à mão volta a ser gerada se o risco continuar', async () => {
    await runAutomation();
    const task = await taskFor('OPP-2003');
    await http()
      .patch(`/follow-up-tasks/${task?.id}`)
      .send({ status: 'DONE' })
      .expect(204);

    const run = await runAutomation();
    expect(run.body.createdCount).toBe(1);
    expect(await taskFor('OPP-2003')).toBeDefined();
  });

  it('registra cada execução para auditoria', async () => {
    await runAutomation();
    await runAutomation();
    const runs = await http().get('/automations/follow-ups/runs').expect(200);
    expect(runs.body).toHaveLength(2);
    expect(runs.body[0]).toMatchObject({ trigger: 'manual', createdCount: 0 });
    expect(runs.body[1]).toMatchObject({ trigger: 'manual', createdCount: 3 });
  });
});

describe('segredo da automação', () => {
  let protectedCtx: TestContext;

  beforeAll(async () => {
    protectedCtx = await setupTestApp({ AUTOMATION_SECRET: 'segredo-do-cron' });
  });

  afterAll(async () => {
    await protectedCtx.close();
  });

  it('exige o segredo para disparar e aceita o correto', async () => {
    const server = protectedCtx.app.getHttpServer();
    await request(server).post('/automations/follow-ups/cron').expect(401);
    const ok = await request(server)
      .post('/automations/follow-ups/cron')
      .set('x-automation-secret', 'segredo-do-cron')
      .expect(200);
    expect(ok.body.trigger).toBe('cron');
  });
});
