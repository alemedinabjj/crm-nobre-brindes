import { Fragment, type ReactNode } from "react";

/**
 * Markdown mínimo para respostas do assistente: parágrafos, listas, **negrito**,
 * _itálico_ e marcadores de fonte [n]. Monta elementos React em vez de HTML
 * bruto, então nada vindo do modelo é interpretado como markup.
 */

type RichAnswerProps = {
  text: string;
  onCite: (source: number) => void;
};

const INLINE = /(\*\*[^*]+\*\*|_[^_]+_|\[\d{1,2}\])/g;

const renderInline = (text: string, onCite: (source: number) => void): ReactNode[] =>
  text.split(INLINE).map((part, index) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (/^_[^_]+_$/.test(part)) return <em key={index}>{part.slice(1, -1)}</em>;
    const citation = /^\[(\d{1,2})\]$/.exec(part);
    if (citation) {
      const source = Number(citation[1]);
      return (
        <button
          key={index}
          type="button"
          onClick={() => onCite(source)}
          className="mx-0.5 inline-grid size-[1.15rem] place-items-center rounded-full bg-moss align-text-top text-[10px] font-bold text-forest-deep hover:bg-forest hover:text-white"
          aria-label={`Ver fonte ${source}`}
        >
          {source}
        </button>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });

type Block = { kind: "paragraph"; lines: string[] } | { kind: "list"; ordered: boolean; items: string[] };

const toBlocks = (text: string): Block[] => {
  const blocks: Block[] = [];
  for (const line of text.split("\n")) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const item = bullet?.[1] ?? numbered?.[1];
    const last = blocks.at(-1);

    if (item !== undefined) {
      const ordered = Boolean(numbered);
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(item);
      else blocks.push({ kind: "list", ordered, items: [item] });
    } else if (!line.trim()) {
      blocks.push({ kind: "paragraph", lines: [] });
    } else if (last?.kind === "paragraph") {
      last.lines.push(line);
    } else {
      blocks.push({ kind: "paragraph", lines: [line] });
    }
  }
  return blocks.filter((block) => (block.kind === "list" ? block.items.length > 0 : block.lines.length > 0));
};

export const RichAnswer = ({ text, onCite }: RichAnswerProps) => (
  <div className="space-y-2 text-sm leading-relaxed">
    {toBlocks(text).map((block, index) => {
      if (block.kind === "paragraph") {
        return <p key={index}>{renderInline(block.lines.join(" "), onCite)}</p>;
      }
      const List = block.ordered ? "ol" : "ul";
      return (
        <List key={index} className={block.ordered ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5"}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item, onCite)}</li>
          ))}
        </List>
      );
    })}
  </div>
);
