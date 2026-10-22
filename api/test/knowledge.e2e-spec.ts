import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  hashingEmbedding,
  FakeLlmProvider,
} from '../src/assistant/llm/fake.provider.js';
import {
  searchKnowledge,
  syncKnowledge,
  toKeywordQuery,
} from '../src/assistant/knowledge/knowledge.repository.js';
import {
  chunkDocument,
  parseDocument,
} from '../src/assistant/knowledge/chunker.js';
import { knowledgeChunks } from '../src/database/schema.js';
import { TEST_DATABASE_URL } from './setup-test-app.js';

/** RAG contra Postgres real com pgvector: ingestão, índice e busca híbrida. */
const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const db = drizzle(pool);
const provider = new FakeLlmProvider();

const search = async (question: string, withVector = true) =>
  searchKnowledge(
    db,
    question,
    withVector ? hashingEmbedding(question, 768) : null,
    { limit: 3, minSimilarity: 0.05, candidates: 20 },
  );

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.delete(knowledgeChunks);
});

describe('sincronização da base', () => {
  it('ingere todos os documentos com embedding', async () => {
    const report = await syncKnowledge(db, provider);
    expect(report.documents).toBeGreaterThanOrEqual(8);
    expect(report.embedded).toBe(report.chunks);
    expect(report.inserted).toBe(report.chunks);
  });

  it('é idempotente: a segunda execução não gera nenhum embedding', async () => {
    await syncKnowledge(db, provider);
    const second = await syncKnowledge(db, provider);
    expect(second).toMatchObject({
      embedded: 0,
      inserted: 0,
      updated: 0,
      removed: 0,
    });
    expect(second.unchanged).toBe(second.chunks);
  });

  it('reprocessa só o chunk que mudou e remove o que sumiu', async () => {
    const original = chunkDocument(
      parseDocument(
        'doc',
        '# Doc\n\n## A\n\nTexto A original bem descrito.\n\n## B\n\nTexto B que vai sumir daqui.',
      ),
    );
    await syncKnowledge(db, provider, original);

    const edited = chunkDocument(
      parseDocument('doc', '# Doc\n\n## A\n\nTexto A revisado e bem descrito.'),
    );
    const report = await syncKnowledge(db, provider, edited);
    expect(report).toMatchObject({
      updated: 1,
      embedded: 1,
      removed: 1,
      inserted: 0,
    });
  });

  it('sem provedor de IA, ingere só o texto (busca por palavra-chave continua)', async () => {
    const report = await syncKnowledge(db, null);
    expect(report.embedded).toBe(0);
    const hits = await search('prazo do bordado', false);
    expect(hits[0]?.documentSlug).toBe('prazos-producao');
  });
});

describe('busca híbrida', () => {
  beforeEach(async () => {
    await syncKnowledge(db, provider);
  });

  it.each([
    ['Qual o prazo de produção do bordado?', 'prazos-producao'],
    ['Até quanto de desconto o vendedor pode dar?', 'politicas-comerciais'],
    ['Como responder quando o cliente diz que está caro?', 'playbook-objecoes'],
    [
      'Qual técnica usar para gravar logo em garrafa de inox?',
      'tecnicas-personalizacao',
    ],
    ['Quais perguntas fazer na ligação de qualificação?', 'roteiro-ligacao'],
    ['Qual a quantidade mínima de caneta metálica?', 'catalogo-produtos'],
  ])('"%s" encontra %s no topo', async (question, expected) => {
    const hits = await search(question);
    expect(hits[0]?.documentSlug).toBe(expected);
  });

  it('acha o trecho mesmo com a pergunta digitada sem acento', async () => {
    const hits = await search(
      'quais perguntas fazer na ligacao de qualificacao',
      false,
    );
    expect(hits[0]?.documentSlug).toBe('roteiro-ligacao');
    const prazo = await search('producao expressa', false);
    expect(prazo[0]?.documentSlug).toBe('prazos-producao');
  });

  it('combina as duas buscas e expõe a posição em cada uma', async () => {
    const [top] = await search('validade padrão da proposta');
    expect(top?.semanticRank).not.toBeNull();
    expect(top?.keywordRank).not.toBeNull();
    expect(top?.score).toBeGreaterThan(1 / 61);
  });

  it('pergunta fora do assunto não traz nada relevante', async () => {
    const hits = await searchKnowledge(
      db,
      'receita de bolo de chocolate',
      hashingEmbedding('receita de bolo de chocolate', 768),
      {
        limit: 3,
        minSimilarity: 0.35,
        candidates: 20,
      },
    );
    expect(hits).toEqual([]);
  });

  it('não interpreta sintaxe de tsquery vinda do usuário', async () => {
    expect(toKeywordQuery("prazo & !bordado | ') ; drop table x")).toBe(
      'prazo | bordado | drop | table',
    );
    await expect(search("prazo & !bordado:* | ')")).resolves.toBeDefined();
  });
});
