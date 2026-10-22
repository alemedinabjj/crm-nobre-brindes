/** Sincroniza api/knowledge com o banco. Usa o Gemini se GEMINI_API_KEY existir. */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { syncKnowledge } from '../src/assistant/knowledge/knowledge.repository.js';
import { GeminiProvider } from '../src/assistant/llm/gemini.provider.js';
import { EMBEDDING_DIMENSIONS } from '../src/database/schema.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const key = process.env.GEMINI_API_KEY;
  const provider = key
    ? new GeminiProvider({
        apiKey: key,
        chatModel: process.env.GEMINI_CHAT_MODEL ?? 'gemini-flash-latest',
        embeddingModel:
          process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001',
        embeddingDimensions: EMBEDDING_DIMENSIONS,
        timeoutMs: 60_000,
      })
    : null;
  const report = await syncKnowledge(drizzle(pool), provider);
  console.log(
    provider
      ? 'Com embeddings:'
      : 'Sem GEMINI_API_KEY, só texto (busca por palavra-chave):',
    report,
  );
} finally {
  await pool.end();
}
