"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";
import { useChangeStage, useRegisterContact } from "@/hooks/use-opportunities";
import type { AssistantAction } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { useToast } from "../ui/toast";

type ActionState = "pending" | "done" | "dismissed";

/**
 * A ação sugerida pelo assistente só acontece aqui, com o clique do vendedor,
 * pelas mesmas rotas do quadro: o backend valida as regras de novo.
 */
export const ActionCard = ({ action }: { action: AssistantAction }) => {
  const [state, setState] = useState<ActionState>("pending");
  const [reason, setReason] = useState(action.type === "CHANGE_STAGE" ? (action.reason ?? "") : "");
  const [error, setError] = useState<string | null>(null);
  const changeStage = useChangeStage();
  const registerContact = useRegisterContact();
  const toast = useToast();

  const needsReason = action.type === "CHANGE_STAGE" && action.requiresReason;
  const isPending = changeStage.isPending || registerContact.isPending;

  const confirm = () => {
    setError(null);
    const onSuccess = () => {
      setState("done");
      toast({ tone: "success", title: action.summary });
    };
    const onError = (failure: Error) => setError(failure.message);

    if (action.type === "CHANGE_STAGE") {
      changeStage.mutate(
        { id: action.opportunityId, to: action.toStage, reason: reason.trim() || undefined },
        { onSuccess, onError },
      );
    } else {
      registerContact.mutate(action.opportunityId, { onSuccess, onError });
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border p-3 text-sm",
        state === "pending" && "border-forest/40 bg-moss/40",
        state === "done" && "border-forest/30 bg-white",
        state === "dismissed" && "border-line bg-paper-shade text-ink-soft",
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
        {state === "done" ? "Feito" : state === "dismissed" ? "Descartado" : "Ação sugerida · confirme para executar"}
      </p>
      <p className="mt-1 font-semibold">{action.summary}</p>

      {state === "pending" && needsReason && (
        <label className="mt-2 block">
          <span className="text-xs font-semibold">Motivo (obrigatório)</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={300}
            className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-1.5 text-sm outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
          />
        </label>
      )}

      {error && <p className="mt-2 rounded-lg bg-critical-soft px-3 py-2 text-xs text-critical">{error}</p>}

      {state === "pending" && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={confirm}
            disabled={isPending || (needsReason && !reason.trim())}
            className="inline-flex items-center gap-1 rounded-full bg-forest px-3 py-1.5 text-xs font-semibold text-white hover:bg-forest-deep disabled:opacity-50"
          >
            <Check className="size-3.5" aria-hidden /> {isPending ? "Executando…" : "Confirmar"}
          </button>
          <button
            type="button"
            onClick={() => setState("dismissed")}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-paper-shade"
          >
            <X className="size-3.5" aria-hidden /> Descartar
          </button>
        </div>
      )}
    </div>
  );
};
