"use client";

import { useState } from "react";
import type { RuleViolation } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import type { MoveKind } from "@/lib/stages";
import { Modal } from "../ui/modal";

const LOSS_SUGGESTIONS = [
  "Preço acima do orçamento do cliente",
  "Prazo de produção não atende o evento",
  "Fechou com concorrente",
  "Cliente parou de responder",
  "Evento cancelado",
];

type ReasonDialogProps = {
  open: boolean;
  kind: Extract<MoveKind, "loss" | "backward">;
  companyName: string;
  fromLabel: string;
  toLabel: string;
  isSubmitting: boolean;
  violations: RuleViolation[];
  onCancel: () => void;
  onConfirm: (reason: string) => void;
};

export const ReasonDialog = ({
  open,
  kind,
  companyName,
  fromLabel,
  toLabel,
  isSubmitting,
  violations,
  onCancel,
  onConfirm,
}: ReasonDialogProps) => {
  const [reason, setReason] = useState("");
  const isLoss = kind === "loss";
  const trimmed = reason.trim();

  return (
    <Modal open={open} onClose={onCancel} title={isLoss ? "Marcar como perdida" : "Voltar etapa"}>
      <form
        className="space-y-4 px-6 py-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) onConfirm(trimmed);
        }}
      >
        <p className="text-sm text-ink-soft">
          <strong className="text-ink">{companyName}</strong> vai de <strong className="text-ink">{fromLabel}</strong>{" "}
          para <strong className="text-ink">{toLabel}</strong>.
          {isLoss
            ? " O motivo fica registrado e ajuda a entender por que perdemos vendas."
            : " Registre o que mudou para quem pegar a negociação depois."}
        </p>

        {isLoss && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Motivos frequentes">
            {LOSS_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setReason(suggestion)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  reason === suggestion
                    ? "border-forest bg-moss font-semibold text-forest-deep"
                    : "border-line text-ink-soft hover:border-forest/50",
                )}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        <label className="block">
          <span className="text-sm font-semibold">{isLoss ? "Motivo da perda" : "Motivo do retorno"}</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={500}
            required
            autoFocus
            placeholder={isLoss ? "Ex.: cliente fechou com concorrente por preço" : "Ex.: cliente pediu revisão de quantidade"}
            className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none placeholder:text-ink-soft/60 focus:border-forest focus:ring-2 focus:ring-forest/20"
          />
        </label>

        {violations.length > 0 && (
          <ul role="alert" className="space-y-1 rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical">
            {violations.map((violation) => (
              <li key={violation.code}>{violation.message}</li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-paper-shade"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!trimmed || isSubmitting}
            className={cn(
              "rounded-full px-5 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              isLoss ? "bg-critical hover:bg-critical/90" : "bg-forest hover:bg-forest-deep",
            )}
          >
            {isSubmitting ? "Salvando…" : isLoss ? "Marcar como perdida" : "Voltar etapa"}
          </button>
        </div>
      </form>
    </Modal>
  );
};
