"use client";

import { useState } from "react";
import { useChangeStage, useMeta } from "@/hooks/use-opportunities";
import { ApiError } from "@/lib/api/client";
import type { Opportunity, RuleViolation, Stage } from "@/lib/api/types";
import { classifyMove, stageLabel } from "@/lib/stages";
import { useToast } from "../ui/toast";
import { ReasonDialog } from "./reason-dialog";

type PendingMove = { opportunity: Opportunity; to: Stage; kind: "loss" | "backward" };

/**
 * Ponto único para mover uma oportunidade de etapa, usado pelo arrastar no
 * quadro e pelos botões do detalhe. Pede motivo quando a regra exige e traduz
 * a recusa do backend em uma mensagem que diz o que fazer.
 */
export const useStageMove = ({ onOpenDetail }: { onOpenDetail: (id: string) => void }) => {
  const { data: meta } = useMeta();
  const changeStage = useChangeStage();
  const toast = useToast();
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [dialogViolations, setDialogViolations] = useState<RuleViolation[]>([]);

  const label = (stage: Stage) => stageLabel(meta?.stages, stage);

  const reportFailure = (error: unknown, opportunity: Opportunity, to: Stage) => {
    const isRule = error instanceof ApiError && error.isBusinessRule;
    toast({
      tone: "error",
      title: isRule
        ? `Não foi possível mover ${opportunity.code} para ${label(to)}`
        : "Não foi possível salvar a mudança",
      description: error instanceof Error ? error.message : undefined,
      action: isRule ? { label: "Abrir oportunidade para completar", onClick: () => onOpenDetail(opportunity.id) } : undefined,
    });
  };

  const submit = (opportunity: Opportunity, to: Stage, reason?: string) =>
    changeStage.mutateAsync({ id: opportunity.id, to, reason }).then(() =>
      toast({ tone: "success", title: `${opportunity.code} movida para ${label(to)}` }),
    );

  const requestMove = (opportunity: Opportunity, to: Stage) => {
    if (opportunity.stage === to) return;

    if (!opportunity.allowedTransitions.includes(to)) {
      toast({
        tone: "error",
        title: `De ${label(opportunity.stage)} não é possível ir para ${label(to)}`,
        description:
          opportunity.allowedTransitions.length > 0
            ? `Destinos possíveis: ${opportunity.allowedTransitions.map(label).join(", ")}.`
            : "Esta oportunidade está em um estado final.",
      });
      return;
    }

    const kind = classifyMove(opportunity.stage, to);
    if (kind === "forward") {
      submit(opportunity, to).catch((error: unknown) => reportFailure(error, opportunity, to));
      return;
    }
    setDialogViolations([]);
    setPending({ opportunity, to, kind });
  };

  const dialog = pending && (
    <ReasonDialog
      key={`${pending.opportunity.id}-${pending.to}`}
      open
      kind={pending.kind}
      companyName={pending.opportunity.companyName}
      fromLabel={label(pending.opportunity.stage)}
      toLabel={label(pending.to)}
      isSubmitting={changeStage.isPending}
      violations={dialogViolations}
      onCancel={() => setPending(null)}
      onConfirm={(reason) => {
        submit(pending.opportunity, pending.to, reason)
          .then(() => setPending(null))
          .catch((error: unknown) => {
            if (error instanceof ApiError && error.violations.length > 0) setDialogViolations(error.violations);
            else reportFailure(error, pending.opportunity, pending.to);
          });
      }}
    />
  );

  return { requestMove, dialog, isMoving: changeStage.isPending };
};
