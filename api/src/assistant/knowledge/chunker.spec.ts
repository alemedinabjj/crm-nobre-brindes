import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkDocument, parseDocument } from './chunker.js';

const KNOWLEDGE_DIR = join(import.meta.dirname, '../../../knowledge');

const sample = `---
title: Guia de teste
category: teste
---

> Documento fictício criado para o case técnico.

# Guia de teste

Introdução curta do guia.

## Primeira seção

Parágrafo um da primeira seção.

| Coluna | Valor |
| --- | --- |
| A | 1 |

## Segunda seção

- item um
- item dois
`;

describe('parseDocument', () => {
  it('lê o frontmatter e remove o aviso de documento fictício do corpo', () => {
    const document = parseDocument('guia', sample);
    expect(document).toMatchObject({
      slug: 'guia',
      title: 'Guia de teste',
      category: 'teste',
    });
    expect(document.body).not.toContain('Documento fictício');
  });

  it('usa o primeiro título quando não há frontmatter', () => {
    expect(parseDocument('x', '# Título do arquivo\n\nTexto').title).toBe(
      'Título do arquivo',
    );
  });
});

describe('chunkDocument', () => {
  const chunks = chunkDocument(parseDocument('guia', sample));

  it('cria um chunk por seção, com o texto de introdução separado', () => {
    expect(chunks.map((chunk) => chunk.section)).toEqual([
      'Introdução',
      'Primeira seção',
      'Segunda seção',
    ]);
  });

  it('nunca corta uma tabela ao meio', () => {
    const table = chunks.find((chunk) => chunk.section === 'Primeira seção');
    expect(table?.content).toContain(
      '| Coluna | Valor |\n| --- | --- |\n| A | 1 |',
    );
  });

  it('coloca documento e seção no texto do embedding', () => {
    expect(chunks[1]?.embeddingText).toMatch(
      /^Documento: Guia de teste\nSeção: Primeira seção\n\n/,
    );
  });

  it('gera ids estáveis e hash que muda junto com o conteúdo', () => {
    const again = chunkDocument(parseDocument('guia', sample));
    expect(again.map((chunk) => [chunk.id, chunk.contentHash])).toEqual(
      chunks.map((chunk) => [chunk.id, chunk.contentHash]),
    );
    const edited = chunkDocument(
      parseDocument('guia', sample.replace('Parágrafo um', 'Parágrafo 1')),
    );
    expect(edited[1]?.contentHash).not.toBe(chunks[1]?.contentHash);
    expect(edited[0]?.contentHash).toBe(chunks[0]?.contentHash);
  });

  it('quebra seção longa respeitando o limite, com sobreposição de um parágrafo', () => {
    const paragraphs = Array.from(
      { length: 6 },
      (_, index) => `Parágrafo ${index} ${'x'.repeat(280)}`,
    );
    const long = `## Longa\n\n${paragraphs.join('\n\n')}`;
    const parts = chunkDocument(parseDocument('longo', long), {
      maxChars: 700,
      overlapBlocks: 1,
    });

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts)
      expect(part.content.length).toBeLessThanOrEqual(700);
    const [first, second] = parts;
    const lastOfFirst = first?.content.split('\n\n').at(-1);
    expect(second?.content.startsWith(lastOfFirst ?? '')).toBe(true);
  });
});

describe('base de conhecimento do repositório', () => {
  const files = readdirSync(KNOWLEDGE_DIR).filter((file) =>
    file.endsWith('.md'),
  );
  const all = files.flatMap((file) =>
    chunkDocument(
      parseDocument(
        file.replace(/\.md$/, ''),
        readFileSync(join(KNOWLEDGE_DIR, file), 'utf8'),
      ),
    ),
  );

  it('tem documentos e todos os chunks dentro do limite', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const chunk of all)
      expect(chunk.content.length).toBeLessThanOrEqual(1400);
  });

  it('não tem ids duplicados', () => {
    expect(new Set(all.map((chunk) => chunk.id)).size).toBe(all.length);
  });

  it('não tem chunk vazio nem só com título', () => {
    for (const chunk of all)
      expect(chunk.content.trim().length).toBeGreaterThan(40);
  });
});
