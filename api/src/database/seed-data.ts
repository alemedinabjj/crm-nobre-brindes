import type { Stage } from '../domain/stage.js';

export type SeedOpportunity = {
  code: string;
  companyName: string;
  sellerName: string;
  item: { productName: string; quantity: number };
  estimatedValue: number;
  lastContactAt: string | null;
  proposalValidUntil: string | null;
  clientEventDate: string | null;
  stage: Stage;
  lossReason: string | null;
};

/**
 * Dados fictícios do case (data de referência 15/10/2026).
 *
 * Campos em branco e como foram tratados:
 * - OPP-2001 tem só duas datas. Interpretamos como validade da proposta em
 *   branco: em Primeiro Contato ainda não existe proposta enviada.
 * - OPP-2007 está Perdida sem motivo, o que viola a regra do funil. Em vez de
 *   inventar um motivo, registramos explicitamente que ele não veio na origem.
 *   O banco exige motivo para Perdida, então o registro fica auditável.
 */
export const SEED_OPPORTUNITIES: readonly SeedOpportunity[] = [
  {
    code: 'OPP-2001',
    companyName: 'Tech Alpha Ltda',
    sellerName: 'Ana',
    item: { productName: 'Caneca personalizada', quantity: 300 },
    estimatedValue: 4500,
    lastContactAt: '2026-10-14',
    proposalValidUntil: null,
    clientEventDate: '2026-11-30',
    stage: 'PRIMEIRO_CONTATO',
    lossReason: null,
  },
  {
    code: 'OPP-2002',
    companyName: 'Construtora Horizonte',
    sellerName: 'Bruno',
    item: { productName: 'Kit escritório', quantity: 120 },
    estimatedValue: 9800,
    lastContactAt: '2026-10-06',
    proposalValidUntil: '2026-10-13',
    clientEventDate: '2026-10-25',
    stage: 'APRESENTACAO_ORCAMENTO',
    lossReason: null,
  },
  {
    code: 'OPP-2003',
    companyName: 'Clínica Vida',
    sellerName: 'Ana',
    item: { productName: 'Squeeze personalizado', quantity: 500 },
    estimatedValue: 7200,
    lastContactAt: '2026-10-13',
    proposalValidUntil: '2026-10-20',
    clientEventDate: '2026-10-18',
    stage: 'FOLLOW_UP',
    lossReason: null,
  },
  {
    code: 'OPP-2004',
    companyName: 'Agência Pulso',
    sellerName: 'Carla',
    item: { productName: 'Camiseta estampada', quantity: 80 },
    estimatedValue: 3900,
    lastContactAt: '2026-10-02',
    proposalValidUntil: '2026-10-10',
    clientEventDate: '2026-11-05',
    stage: 'FOLLOW_UP',
    lossReason: null,
  },
  {
    code: 'OPP-2005',
    companyName: 'Banco Norte',
    sellerName: 'Bruno',
    item: { productName: 'Agenda executiva', quantity: 1000 },
    estimatedValue: 38000,
    lastContactAt: '2026-10-15',
    proposalValidUntil: '2026-10-22',
    clientEventDate: '2026-12-12',
    stage: 'FORECAST',
    lossReason: null,
  },
  {
    code: 'OPP-2006',
    companyName: 'Escola Saber',
    sellerName: 'Carla',
    item: { productName: 'Mochila infantil', quantity: 250 },
    estimatedValue: 11500,
    lastContactAt: '2026-10-09',
    proposalValidUntil: '2026-10-16',
    clientEventDate: '2026-10-17',
    stage: 'FECHAMENTO',
    lossReason: null,
  },
  {
    code: 'OPP-2007',
    companyName: 'Padaria do Bairro',
    sellerName: 'Ana',
    item: { productName: 'Caneta promocional', quantity: 50 },
    estimatedValue: 350,
    lastContactAt: '2026-10-01',
    proposalValidUntil: '2026-10-08',
    clientEventDate: '2026-10-20',
    stage: 'PERDIDA',
    lossReason: 'Não informado na planilha de origem (registro importado)',
  },
];
