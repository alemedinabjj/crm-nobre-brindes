import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestContext } from './setup-test-app.js';

type OpportunitySummary = {
  id: string;
  code: string;
  stage: string;
  attention: { level: string };
};

let ctx: TestContext;
const http = () => request(ctx.app.getHttpServer());

const idOf = async (code: string): Promise<string> => {
  const response = await http()
    .get('/opportunities')
    .query({ search: code })
    .expect(200);
  const match = (response.body as OpportunitySummary[]).find(
    (opportunity) => opportunity.code === code,
  );
  if (!match) throw new Error(`${code} não encontrada no seed`);
  return match.id;
};

const move = async (code: string, body: Record<string, unknown>) =>
  http()
    .post(`/opportunities/${await idOf(code)}/stage-transitions`)
    .send(body);

beforeAll(async () => {
  ctx = await setupTestApp();
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await ctx.resetDatabase();
});

describe('GET /opportunities', () => {
  it('lista as oportunidades com as mais urgentes primeiro', async () => {
    const response = await http().get('/opportunities').expect(200);
    const codes = (response.body as OpportunitySummary[]).map(
      (opportunity) => opportunity.code,
    );
    expect(codes.slice(0, 3)).toEqual(['OPP-2002', 'OPP-2004', 'OPP-2003']);
    expect(codes).toHaveLength(7);
  });

  it('filtra por "precisa de atenção"', async () => {
    const response = await http()
      .get('/opportunities')
      .query({ attention: 'any' })
      .expect(200);
    expect(
      (response.body as OpportunitySummary[]).map(
        (opportunity) => opportunity.code,
      ),
    ).toEqual(['OPP-2002', 'OPP-2004', 'OPP-2003']);
  });

  it('filtra por etapa e vendedor combinados', async () => {
    const response = await http()
      .get('/opportunities')
      .query({ stage: 'FOLLOW_UP,FORECAST', seller: 'ana' })
      .expect(200);
    expect(
      (response.body as OpportunitySummary[]).map(
        (opportunity) => opportunity.code,
      ),
    ).toEqual(['OPP-2003']);
  });

  it('busca por empresa, código ou item de brinde', async () => {
    const byItem = await http()
      .get('/opportunities')
      .query({ search: 'agenda' })
      .expect(200);
    const byCompany = await http()
      .get('/opportunities')
      .query({ search: 'horizonte' })
      .expect(200);
    expect(
      byItem.body.map((opportunity: OpportunitySummary) => opportunity.code),
    ).toEqual(['OPP-2005']);
    expect(
      byCompany.body.map((opportunity: OpportunitySummary) => opportunity.code),
    ).toEqual(['OPP-2002']);
  });

  it('trata curingas do LIKE como texto literal', async () => {
    const response = await http()
      .get('/opportunities')
      .query({ search: '%' })
      .expect(200);
    expect(response.body).toEqual([]);
  });

  it('rejeita filtro de etapa inválido', async () => {
    const response = await http()
      .get('/opportunities')
      .query({ stage: 'GANHA' })
      .expect(400);
    expect(response.body.error).toBe('INVALID_INPUT');
  });
});

describe('GET /opportunities/:id', () => {
  it('retorna detalhe com itens, atenção, histórico e destinos permitidos', async () => {
    const response = await http()
      .get(`/opportunities/${await idOf('OPP-2003')}`)
      .expect(200);
    expect(response.body).toMatchObject({
      code: 'OPP-2003',
      items: [{ productName: 'Squeeze personalizado', quantity: 500 }],
      attention: { level: 'critical' },
      allowedTransitions: ['FORECAST', 'APRESENTACAO_ORCAMENTO', 'PERDIDA'],
      history: [{ fromStage: null, toStage: 'FOLLOW_UP' }],
    });
  });

  it('responde 404 para id inexistente e 400 para id malformado', async () => {
    await http()
      .get('/opportunities/6f1c1f5e-3b9a-4c1e-9d55-111111111111')
      .expect(404);
    await http().get('/opportunities/OPP-2001').expect(400);
  });
});

describe('POST /opportunities/:id/stage-transitions', () => {
  it('move de Forecast para Fechamento e registra o histórico', async () => {
    const response = await move('OPP-2005', {
      to: 'FECHAMENTO',
      changedBy: 'Bruno',
    });
    expect(response.status).toBe(200);
    expect(response.body.stage).toBe('FECHAMENTO');
    expect(response.body.allowedTransitions).toEqual([]);
    expect(response.body.history.at(-1)).toMatchObject({
      fromStage: 'FORECAST',
      toStage: 'FECHAMENTO',
      changedBy: 'Bruno',
    });
  });

  it('bloqueia Fechamento fora de Forecast com 422 e explica o motivo', async () => {
    const response = await move('OPP-2003', { to: 'FECHAMENTO' });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      error: 'BUSINESS_RULE_VIOLATION',
      violations: [{ code: 'TRANSITION_NOT_ALLOWED' }],
    });
  });

  it('exige motivo para Perdida e grava o motivo na oportunidade', async () => {
    const withoutReason = await move('OPP-2004', { to: 'PERDIDA' });
    expect(withoutReason.status).toBe(422);
    expect(withoutReason.body.violations[0].code).toBe('MISSING_LOSS_REASON');

    const withReason = await move('OPP-2004', {
      to: 'PERDIDA',
      reason: '  Cliente sem verba  ',
    });
    expect(withReason.status).toBe(200);
    expect(withReason.body).toMatchObject({
      stage: 'PERDIDA',
      lossReason: 'Cliente sem verba',
    });
  });

  it('permite retorno Follow-up → Orçamento com justificativa', async () => {
    const response = await move('OPP-2003', {
      to: 'APRESENTACAO_ORCAMENTO',
      reason: 'Cliente pediu revisão de quantidade',
    });
    expect(response.status).toBe(200);
    expect(response.body.history.at(-1)).toMatchObject({
      fromStage: 'FOLLOW_UP',
      toStage: 'APRESENTACAO_ORCAMENTO',
      reason: 'Cliente pediu revisão de quantidade',
    });
  });

  it('não altera nada quando a transição é rejeitada', async () => {
    const id = await idOf('OPP-2006');
    await http()
      .post(`/opportunities/${id}/stage-transitions`)
      .send({ to: 'FORECAST', reason: 'x' })
      .expect(422);
    const detail = await http().get(`/opportunities/${id}`).expect(200);
    expect(detail.body.stage).toBe('FECHAMENTO');
    expect(detail.body.history).toHaveLength(1);
  });

  it('valida o payload antes das regras de negócio', async () => {
    const response = await move('OPP-2001', { to: 'GANHA' });
    expect(response.status).toBe(400);
    expect(response.body.fields[0].path).toBe('to');
  });

  it('serializa movimentos concorrentes no mesmo card: só um vence', async () => {
    const id = await idOf('OPP-2005');
    const attempts = await Promise.all([
      http()
        .post(`/opportunities/${id}/stage-transitions`)
        .send({ to: 'FECHAMENTO' }),
      http()
        .post(`/opportunities/${id}/stage-transitions`)
        .send({ to: 'FECHAMENTO' }),
    ]);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([
      200, 422,
    ]);
    const detail = await http().get(`/opportunities/${id}`).expect(200);
    expect(detail.body.history).toHaveLength(2);
  });
});

describe('POST /opportunities', () => {
  it('cria em Primeiro Contato com código sequencial e histórico de criação', async () => {
    const response = await http()
      .post('/opportunities')
      .send({ companyName: 'Hotel Atlântico', sellerName: 'Carla', items: [] })
      .expect(201);
    expect(response.body).toMatchObject({
      code: expect.stringMatching(/^OPP-\d{4,}$/),
      stage: 'PRIMEIRO_CONTATO',
      estimatedValue: null,
      attention: {
        level: 'critical',
        signals: [{ code: 'NO_CONTACT_RECORDED' }],
      },
      history: [{ fromStage: null, toStage: 'PRIMEIRO_CONTATO' }],
    });
  });

  it('não permite escolher a etapa na criação', async () => {
    const response = await http()
      .post('/opportunities')
      .send({ companyName: 'X', sellerName: 'Ana', stage: 'FECHAMENTO' })
      .expect(201);
    expect(response.body.stage).toBe('PRIMEIRO_CONTATO');
  });

  it('valida campos obrigatórios e formatos', async () => {
    const response = await http()
      .post('/opportunities')
      .send({
        companyName: ' ',
        sellerName: 'Ana',
        estimatedValue: 10.555,
        lastContactAt: '2026-02-30',
      })
      .expect(400);
    const paths = response.body.fields.map(
      (field: { path: string }) => field.path,
    );
    expect(paths).toEqual(
      expect.arrayContaining([
        'companyName',
        'estimatedValue',
        'lastContactAt',
      ]),
    );
  });
});

describe('PATCH /opportunities/:id', () => {
  it('completa os dados e libera o avanço para Orçamento', async () => {
    const created = await http()
      .post('/opportunities')
      .send({ companyName: 'Hotel Atlântico', sellerName: 'Carla' })
      .expect(201);
    const id = created.body.id;

    const blocked = await http()
      .post(`/opportunities/${id}/stage-transitions`)
      .send({ to: 'APRESENTACAO_ORCAMENTO' });
    expect(
      blocked.body.violations.map(
        (violation: { code: string }) => violation.code,
      ),
    ).toEqual(['MISSING_ESTIMATED_VALUE', 'MISSING_ITEMS']);

    await http()
      .patch(`/opportunities/${id}`)
      .send({
        estimatedValue: 2500,
        items: [{ productName: 'Ecobag', quantity: 200 }],
      })
      .expect(200);
    await http()
      .post(`/opportunities/${id}/stage-transitions`)
      .send({ to: 'APRESENTACAO_ORCAMENTO' })
      .expect(200);
  });

  it('impede remover itens de uma oportunidade que já tem proposta', async () => {
    const response = await http()
      .patch(`/opportunities/${await idOf('OPP-2003')}`)
      .send({ items: [] })
      .expect(422);
    expect(response.body.violations[0].code).toBe('MISSING_ITEMS');
  });

  it('bloqueia edição de oportunidades em estado final', async () => {
    const response = await http()
      .patch(`/opportunities/${await idOf('OPP-2006')}`)
      .send({ estimatedValue: 1 })
      .expect(422);
    expect(response.body.violations[0].code).toBe('FINAL_STAGE_READ_ONLY');
  });

  it('não aceita mudar a etapa por PATCH', async () => {
    await http()
      .patch(`/opportunities/${await idOf('OPP-2001')}`)
      .send({ stage: 'FECHAMENTO' })
      .expect(400);
  });
});

describe('POST /opportunities/:id/contacts', () => {
  it('registrar contato hoje tira a oportunidade do alerta de contato parado', async () => {
    const id = await idOf('OPP-2004');
    const response = await http()
      .post(`/opportunities/${id}/contacts`)
      .send({})
      .expect(200);
    expect(response.body.lastContactAt).toBe('2026-10-15');
    expect(
      response.body.attention.signals.map(
        (signal: { code: string }) => signal.code,
      ),
    ).toEqual(['PROPOSAL_EXPIRED']);
  });

  it('não regride o último contato ao registrar um contato antigo', async () => {
    const id = await idOf('OPP-2001');
    const response = await http()
      .post(`/opportunities/${id}/contacts`)
      .send({ contactedOn: '2026-10-01' })
      .expect(200);
    expect(response.body.lastContactAt).toBe('2026-10-14');
  });

  it('rejeita contato com data futura', async () => {
    const response = await http()
      .post(`/opportunities/${await idOf('OPP-2001')}/contacts`)
      .send({ contactedOn: '2026-10-16' })
      .expect(422);
    expect(response.body.violations[0].code).toBe('CONTACT_IN_FUTURE');
  });
});

describe('GET /meta', () => {
  it('expõe etapas, transições e a data de referência', async () => {
    const response = await http().get('/meta').expect(200);
    expect(response.body.today).toBe('2026-10-15');
    expect(response.body.sellers).toEqual(['Ana', 'Bruno', 'Carla']);
    expect(response.body.stages).toHaveLength(6);
  });
});
