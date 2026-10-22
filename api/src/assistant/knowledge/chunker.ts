import { createHash } from 'node:crypto';

/**
 * Divide documentos Markdown em pedaços (chunks) para o RAG.
 *
 * Estratégia: um chunk por seção (## ou ###), porque seção é a menor unidade
 * que ainda faz sentido sozinha ("Prazos por técnica", "Alçadas de desconto").
 * Seções longas são quebradas por parágrafo, nunca no meio de uma tabela ou
 * lista, com um parágrafo de sobreposição para não perder contexto na borda.
 * Cada chunk carrega "Documento > Seção" no texto que vai para o embedding:
 * isso faz "qual o prazo do bordado?" achar a seção certa mesmo que o
 * parágrafo não repita a palavra "prazo".
 */

export type KnowledgeDocument = {
  /** Identificador estável: o nome do arquivo sem extensão. */
  slug: string;
  title: string;
  category: string;
  body: string;
};

export type KnowledgeChunk = {
  /** `${slug}#${ordinal}`: estável enquanto a estrutura do documento não muda. */
  id: string;
  documentSlug: string;
  documentTitle: string;
  category: string;
  section: string;
  ordinal: number;
  content: string;
  /** Texto enviado ao modelo de embedding (com o caminho do documento). */
  embeddingText: string;
  contentHash: string;
};

export type ChunkerOptions = { maxChars: number; overlapBlocks: number };

export const DEFAULT_CHUNKER_OPTIONS: ChunkerOptions = {
  maxChars: 900,
  overlapBlocks: 1,
};

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;
const DISCLAIMER = /^>\s*Documento fictício.*$/gim;

export const parseDocument = (slug: string, raw: string): KnowledgeDocument => {
  const match = FRONTMATTER.exec(raw);
  const meta = new Map<string, string>();
  for (const line of match?.[1]?.split('\n') ?? []) {
    const separator = line.indexOf(':');
    if (separator > 0) {
      meta.set(
        line.slice(0, separator).trim(),
        line.slice(separator + 1).trim(),
      );
    }
  }
  const body = (match ? raw.slice(match[0].length) : raw)
    .replace(DISCLAIMER, '')
    .trim();
  const firstHeading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();

  return {
    slug,
    title: meta.get('title') ?? firstHeading ?? slug,
    category: meta.get('category') ?? 'geral',
    body,
  };
};

type Section = { heading: string; blocks: string[] };

/** Agrupa blocos (parágrafos, tabelas, listas) sob o título da seção. */
const splitSections = (body: string, documentTitle: string): Section[] => {
  const sections: Section[] = [];
  let current: Section = { heading: 'Introdução', blocks: [] };

  for (const block of body.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading && !trimmed.includes('\n')) {
      const level = heading[1]?.length ?? 1;
      const title = heading[2]?.trim() ?? '';
      if (level === 1) {
        if (title !== documentTitle) current.heading = title;
        continue;
      }
      if (current.blocks.length > 0) sections.push(current);
      current = { heading: title, blocks: [] };
      continue;
    }
    current.blocks.push(trimmed);
  }
  if (current.blocks.length > 0) sections.push(current);
  return sections;
};

/** Junta blocos até o limite; um bloco maior que o limite vira um chunk sozinho. */
const packBlocks = (blocks: string[], options: ChunkerOptions): string[][] => {
  const groups: string[][] = [];
  let group: string[] = [];
  let size = 0;

  for (const block of blocks) {
    if (group.length > 0 && size + block.length > options.maxChars) {
      groups.push(group);
      const overlap = group.slice(-options.overlapBlocks);
      group =
        overlap.reduce((total, item) => total + item.length, 0) +
          block.length <=
        options.maxChars
          ? [...overlap]
          : [];
      size = group.reduce((total, item) => total + item.length, 0);
    }
    group.push(block);
    size += block.length;
  }
  if (group.length > 0) groups.push(group);
  return groups;
};

export const hashContent = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

export const chunkDocument = (
  document: KnowledgeDocument,
  options: ChunkerOptions = DEFAULT_CHUNKER_OPTIONS,
): KnowledgeChunk[] => {
  const chunks: KnowledgeChunk[] = [];

  for (const section of splitSections(document.body, document.title)) {
    for (const blocks of packBlocks(section.blocks, options)) {
      const content = blocks.join('\n\n');
      const embeddingText = `Documento: ${document.title}\nSeção: ${section.heading}\n\n${content}`;
      const ordinal = chunks.length;
      chunks.push({
        id: `${document.slug}#${ordinal}`,
        documentSlug: document.slug,
        documentTitle: document.title,
        category: document.category,
        section: section.heading,
        ordinal,
        content,
        embeddingText,
        contentHash: hashContent(embeddingText),
      });
    }
  }
  return chunks;
};
