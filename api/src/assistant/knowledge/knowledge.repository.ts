import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { knowledgeChunks } from '../../database/schema.js';
import type { LlmProvider } from '../llm/llm-provider.js';
import { tokenize } from '../llm/fake.provider.js';
import {
  chunkDocument,
  parseDocument,
  type KnowledgeChunk,
} from './chunker.js';

// Aceita tanto o banco tipado da aplicação quanto o dos scripts e testes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = NodePgDatabase<any>;

export const KNOWLEDGE_DIR = join(import.meta.dirname, '../../../knowledge');

/** Constante padrão do RRF (Cormack et al., 2009): suaviza o peso do 1º lugar. */
const RRF_K = 60;

export type SearchHit = {
  id: string;
  documentSlug: string;
  documentTitle: string;
  section: string;
  content: string;
  score: number;
  similarity: number | null;
  semanticRank: number | null;
  keywordRank: number | null;
};

export type SearchOptions = {
  limit: number;
  /** Similaridade de cosseno mínima para um resultado semântico contar. */
  minSimilarity: number;
  candidates: number;
};

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  limit: 4,
  minSimilarity: 0.35,
  candidates: 20,
};

export type SyncReport = {
  documents: number;
  chunks: number;
  inserted: number;
  updated: number;
  embedded: number;
  removed: number;
  unchanged: number;
};

export const loadKnowledgeChunks = async (
  directory = KNOWLEDGE_DIR,
): Promise<KnowledgeChunk[]> => {
  const files = (await readdir(directory))
    .filter((file) => file.endsWith('.md'))
    .sort();
  const chunks: KnowledgeChunk[] = [];
  for (const file of files) {
    const raw = await readFile(join(directory, file), 'utf8');
    chunks.push(
      ...chunkDocument(parseDocument(file.replace(/\.md$/, ''), raw)),
    );
  }
  return chunks;
};

const toVectorLiteral = (vector: number[]): string => `[${vector.join(',')}]`;

/**
 * Consulta de texto para o full-text: termos em OU, não em E. Perguntas
 * naturais raramente contêm todas as palavras do trecho; o OU deixa o
 * ts_rank decidir quem tem mais termos em comum. Só letras e dígitos passam,
 * então a string não carrega sintaxe de tsquery vinda do usuário.
 */
export const toKeywordQuery = (text: string): string | null => {
  const terms = [...new Set(tokenize(text))].slice(0, 16);
  return terms.length > 0 ? terms.join(' | ') : null;
};

/**
 * Sincroniza a tabela com os arquivos: insere o novo, atualiza o que mudou
 * (pelo hash), remove o que sumiu e gera embedding só do necessário. Rodar
 * duas vezes seguidas não chama o provedor de IA nenhuma vez.
 */
export const syncKnowledge = async (
  db: Db,
  provider: LlmProvider | null,
  chunks?: KnowledgeChunk[],
): Promise<SyncReport> => {
  const desired = chunks ?? (await loadKnowledgeChunks());
  const existing = await db
    .select({
      id: knowledgeChunks.id,
      contentHash: knowledgeChunks.contentHash,
      embeddingModel: knowledgeChunks.embeddingModel,
    })
    .from(knowledgeChunks);
  const current = new Map(existing.map((row) => [row.id, row]));

  const changed = desired.filter(
    (chunk) => current.get(chunk.id)?.contentHash !== chunk.contentHash,
  );
  const needsEmbedding = provider
    ? desired.filter((chunk) => {
        const row = current.get(chunk.id);
        return (
          !row ||
          row.contentHash !== chunk.contentHash ||
          row.embeddingModel !== provider.embeddingModel
        );
      })
    : [];

  const vectors = new Map<string, number[]>();
  if (provider && needsEmbedding.length > 0) {
    const embedded = await provider.embed(
      needsEmbedding.map((chunk) => chunk.embeddingText),
      'document',
    );
    needsEmbedding.forEach((chunk, index) =>
      vectors.set(chunk.id, embedded[index] ?? []),
    );
  }

  const toWrite = [
    ...new Map(
      [...changed, ...needsEmbedding].map((chunk) => [chunk.id, chunk]),
    ).values(),
  ];
  const desiredIds = new Set(desired.map((chunk) => chunk.id));
  const stale = existing
    .filter((row) => !desiredIds.has(row.id))
    .map((row) => row.id);

  await db.transaction(async (tx) => {
    for (const chunk of toWrite) {
      const vector = vectors.get(chunk.id);
      const values = {
        id: chunk.id,
        documentSlug: chunk.documentSlug,
        documentTitle: chunk.documentTitle,
        category: chunk.category,
        section: chunk.section,
        ordinal: chunk.ordinal,
        content: chunk.content,
        contentHash: chunk.contentHash,
        embedding: vector ?? null,
        embeddingModel: vector ? (provider?.embeddingModel ?? null) : null,
        updatedAt: new Date(),
      };
      await tx
        .insert(knowledgeChunks)
        .values(values)
        .onConflictDoUpdate({ target: knowledgeChunks.id, set: values });
    }
    if (stale.length > 0) {
      await tx
        .delete(knowledgeChunks)
        .where(inArray(knowledgeChunks.id, stale));
    }
  });

  return {
    documents: new Set(desired.map((chunk) => chunk.documentSlug)).size,
    chunks: desired.length,
    inserted: toWrite.filter((chunk) => !current.has(chunk.id)).length,
    updated: toWrite.filter((chunk) => current.has(chunk.id)).length,
    embedded: vectors.size,
    removed: stale.length,
    unchanged: desired.length - toWrite.length,
  };
};

type HitRow = {
  id: string;
  document_slug: string;
  document_title: string;
  section: string;
  content: string;
  score: string | number;
  similarity: string | number | null;
  semantic_rank: string | number | null;
  keyword_rank: string | number | null;
};

const toNumberOrNull = (value: string | number | null): number | null =>
  value === null ? null : Number(value);

/**
 * Busca híbrida: top-N por similaridade de cosseno (pgvector, HNSW) e top-N
 * por full-text, fundidos por Reciprocal Rank Fusion. Um trecho que aparece
 * bem nas duas listas sobe; um que só uma delas acha ainda entra. Sem vetor
 * da consulta (provedor fora do ar), a busca segue só por palavra-chave.
 */
export const searchKnowledge = async (
  db: Db,
  query: string,
  queryVector: number[] | null,
  options: SearchOptions = DEFAULT_SEARCH_OPTIONS,
): Promise<SearchHit[]> => {
  const keywordQuery = toKeywordQuery(query);
  if (!keywordQuery && !queryVector) return [];

  const semantic = queryVector
    ? sql`
      select id, similarity, row_number() over (order by distance) as rank
      from (
        select id, embedding <=> ${toVectorLiteral(queryVector)}::vector as distance,
               1 - (embedding <=> ${toVectorLiteral(queryVector)}::vector) as similarity
        from knowledge_chunks
        where embedding is not null
        order by distance
        limit ${options.candidates}
      ) nearest
      where similarity >= ${options.minSimilarity}`
    : sql`select null::varchar as id, null::float as similarity, null::bigint as rank where false`;

  const keyword = keywordQuery
    ? sql`
      select id, row_number() over (order by rank_value desc) as rank
      from (
        select id, ts_rank_cd(search_vector, query) as rank_value
        from knowledge_chunks, to_tsquery('portuguese', ${keywordQuery}) query
        where search_vector @@ query
        order by rank_value desc
        limit ${options.candidates}
      ) matched`
    : sql`select null::varchar as id, null::bigint as rank where false`;

  const result = await db.execute<HitRow>(sql`
    with semantic as (${semantic}), keyword as (${keyword})
    select c.id, c.document_slug, c.document_title, c.section, c.content,
           coalesce(1.0 / (${RRF_K} + s.rank), 0) + coalesce(1.0 / (${RRF_K} + k.rank), 0) as score,
           s.similarity, s.rank as semantic_rank, k.rank as keyword_rank
    from knowledge_chunks c
    left join semantic s on s.id = c.id
    left join keyword k on k.id = c.id
    where s.id is not null or k.id is not null
    order by score desc, c.id
    limit ${options.limit}`);

  return result.rows.map((row) => ({
    id: row.id,
    documentSlug: row.document_slug,
    documentTitle: row.document_title,
    section: row.section,
    content: row.content,
    score: Number(row.score),
    similarity: toNumberOrNull(row.similarity),
    semanticRank: toNumberOrNull(row.semantic_rank),
    keywordRank: toNumberOrNull(row.keyword_rank),
  }));
};
