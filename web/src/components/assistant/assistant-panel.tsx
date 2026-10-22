"use client";

import { BookOpen, Database, SendHorizontal, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useAssistantChat, useAssistantStatus, type ChatEntry } from "@/hooks/use-assistant";
import type { AssistantReply } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { Modal } from "../ui/modal";
import { ActionCard } from "./action-card";
import { RichAnswer } from "./rich-answer";

type AssistantPanelProps = {
  open: boolean;
  seller?: string;
  onClose: () => void;
};

const SUGGESTIONS = [
  "O que eu preciso priorizar hoje?",
  "Qual o prazo de produção do bordado?",
  "O cliente disse que está caro. O que eu respondo?",
  "Fecha a OPP-2005, o cliente aprovou.",
];

const TOOL_LABELS: Record<string, string> = {
  buscar_base_conhecimento: "base de conhecimento",
  listar_oportunidades: "oportunidades",
  detalhar_oportunidade: "detalhe da oportunidade",
  listar_retornos: "retornos",
  resumo_funil: "resumo do funil",
  propor_mudanca_etapa: "proposta de etapa",
  propor_registro_contato: "proposta de contato",
};

const GUARDRAIL_NOTES: Record<string, string> = {
  PII_MASKED: "Dados pessoais (CPF ou cartão) foram removidos antes de enviar à IA.",
  INVALID_CITATION: "Uma citação sem fonte correspondente foi removida.",
  UNKNOWN_OPPORTUNITY_CODE: "A resposta citou um código que não está no CRM.",
  RETRIEVED_CONTENT_SUSPICIOUS: "Um trecho da base com instruções suspeitas foi ignorado.",
  TOOL_LIMIT_REACHED: "A pergunta atingiu o limite de consultas.",
};

const AssistantMessage = ({ reply }: { reply: AssistantReply }) => {
  const [openSource, setOpenSource] = useState<number | null>(null);
  const cited = reply.citations.filter((citation) => citation.cited);
  const tools = [...new Set(reply.toolCalls.filter((call) => call.ok).map((call) => TOOL_LABELS[call.name] ?? call.name))];
  const notes = reply.guardrailFlags.map((flag) => GUARDRAIL_NOTES[flag]).filter(Boolean);

  return (
    <div className="space-y-2">
      <div className={cn("rounded-2xl rounded-tl-sm bg-white px-4 py-3 shadow-sm ring-1 ring-line", reply.outcome === "blocked" && "ring-warning-line")}>
        <RichAnswer text={reply.answer} onCite={(source) => setOpenSource(openSource === source ? null : source)} />
      </div>

      {openSource !== null &&
        reply.citations
          .filter((citation) => citation.number === openSource)
          .map((citation) => (
            <blockquote key={citation.number} className="rounded-xl border-l-4 border-forest bg-moss/40 px-3 py-2 text-xs">
              <p className="font-semibold text-forest-deep">
                [{citation.number}] {citation.documentTitle} › {citation.section}
              </p>
              <p className="mt-1 whitespace-pre-line text-ink-soft">{citation.excerpt}</p>
            </blockquote>
          ))}

      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-soft">
        {tools.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-paper-shade px-2 py-0.5">
            <Database className="size-3" aria-hidden /> Consultou: {tools.join(", ")}
          </span>
        )}
        {cited.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-paper-shade px-2 py-0.5">
            <BookOpen className="size-3" aria-hidden />
            {cited.map((citation) => citation.documentTitle).filter((title, index, all) => all.indexOf(title) === index).join(" · ")}
          </span>
        )}
        <span className="tabular">{(reply.latencyMs / 1000).toFixed(1)}s</span>
      </div>

      {notes.map((note) => (
        <p key={note} className="flex items-center gap-1.5 text-[11px] text-warning">
          <ShieldCheck className="size-3.5" aria-hidden /> {note}
        </p>
      ))}

      {reply.proposedActions.map((action, index) => (
        <ActionCard key={`${action.opportunityId}-${index}`} action={action} />
      ))}
    </div>
  );
};

const Entry = ({ entry }: { entry: ChatEntry }) => {
  if (entry.role === "user") {
    return (
      <div className="ml-10 rounded-2xl rounded-tr-sm bg-forest px-4 py-2.5 text-sm text-white">{entry.content}</div>
    );
  }
  if (entry.role === "error") {
    return <p className="rounded-xl bg-critical-soft px-4 py-2.5 text-sm text-critical">{entry.content}</p>;
  }
  return <AssistantMessage reply={entry.reply} />;
};

export const AssistantPanel = ({ open, seller, onClose }: AssistantPanelProps) => {
  const status = useAssistantStatus(open);
  const chat = useAssistantChat(seller);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.entries.length, chat.isThinking]);

  const submit = (text = draft) => {
    chat.send(text);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const disabled = status.data?.enabled === false;

  return (
    <Modal open={open} onClose={onClose} title="Assistente comercial" variant="drawer">
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-line px-6 py-2 text-[11px] text-ink-soft">
          <Sparkles className="size-3.5 text-forest" aria-hidden />
          {status.data?.enabled
            ? `${status.data.chatModel} · busca ${status.data.knowledge.mode === "hybrid" ? "híbrida (semântica + palavra-chave)" : "por palavra-chave"} em ${status.data.knowledge.chunks} trechos`
            : status.isPending
              ? "Verificando o assistente…"
              : "Assistente desligado neste ambiente (sem chave de IA)."}
          {seller && <span className="ml-auto rounded-full bg-moss px-2 py-0.5 text-forest-deep">Contexto: {seller}</span>}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {chat.entries.length === 0 && (
            <div className="space-y-4">
              <div className="rounded-xl bg-moss/50 p-4 text-sm text-forest-deep">
                <p className="font-semibold">Pergunte sobre o funil ou sobre como vender.</p>
                <p className="mt-1 text-ink-soft">
                  Eu consulto o CRM ao vivo e a base de conhecimento (prazos, técnicas, políticas, objeções) e cito as
                  fontes. Ações como mover etapa só acontecem quando você confirma.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={disabled}
                    onClick={() => submit(suggestion)}
                    className="rounded-xl border border-line bg-white px-4 py-2.5 text-left text-sm hover:border-forest/50 hover:bg-paper disabled:opacity-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {chat.entries.map((entry) => (
            <Entry key={entry.id} entry={entry} />
          ))}

          {chat.isThinking && (
            <p className="flex items-center gap-2 text-sm text-ink-soft" role="status">
              <Wrench className="size-4 animate-pulse" aria-hidden /> Consultando o CRM e a base…
            </p>
          )}
          <div ref={endRef} />
        </div>

        <form
          className="border-t border-line bg-white px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex items-end gap-2">
            <label className="sr-only" htmlFor="assistant-input">
              Pergunta para o assistente
            </label>
            <textarea
              id="assistant-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              maxLength={1500}
              disabled={disabled}
              placeholder={disabled ? "Assistente indisponível" : "Pergunte algo… (Enter envia, Shift+Enter quebra linha)"}
              className="min-h-11 flex-1 resize-none rounded-xl border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-forest focus:ring-2 focus:ring-forest/20 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={disabled || chat.isThinking || !draft.trim()}
              className="grid size-11 place-items-center rounded-full bg-forest text-white hover:bg-forest-deep disabled:opacity-40"
              aria-label="Enviar"
            >
              <SendHorizontal className="size-4" aria-hidden />
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-ink-soft">
            Respostas geradas por IA a partir do CRM e de documentos internos. Confira antes de enviar ao cliente.
          </p>
        </form>
      </div>
    </Modal>
  );
};
