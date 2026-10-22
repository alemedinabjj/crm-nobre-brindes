"use client";

import { ArrowLeft, ArrowRight, CircleAlert, PhoneCall, RotateCw, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useOpportunityDetail, useRegisterContact } from "@/hooks/use-opportunities";
import type { OpportunityDetail, Stage, StageMeta } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDateTime, formatQuantity, formatRelativeDays, formatShortDate } from "@/lib/format";
import { classifyMove, stageLabel } from "@/lib/stages";
import { AttentionBadge } from "../ui/attention-badge";
import { Modal } from "../ui/modal";
import { useToast } from "../ui/toast";

type DrawerProps = {
  id: string | null;
  stages: StageMeta[];
  today: string;
  onClose: () => void;
  onMove: (opportunity: OpportunityDetail, to: Stage) => void;
  isMoving: boolean;
};

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">{label}</dt>
    <dd className="mt-0.5 text-sm font-medium">{children}</dd>
  </div>
);

const Missing = ({ children }: { children: ReactNode }) => (
  <span className="italic text-ink-soft">{children}</span>
);

const dateWithDistance = (value: string | null, today: string, empty: string) =>
  value ? (
    <>
      {formatShortDate(value)} <span className="text-ink-soft">({formatRelativeDays(value, today)})</span>
    </>
  ) : (
    <Missing>{empty}</Missing>
  );

const MoveButton = ({
  from,
  to,
  label,
  disabled,
  onClick,
}: {
  from: Stage;
  to: Stage;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) => {
  const kind = classifyMove(from, to);
  const Icon = kind === "loss" ? XCircle : kind === "backward" ? ArrowLeft : ArrowRight;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50",
        kind === "forward" && "bg-forest text-white hover:bg-forest-deep",
        kind === "backward" && "border border-forest/40 text-forest hover:bg-moss",
        kind === "loss" && "border border-critical/40 text-critical hover:bg-critical-soft",
      )}
    >
      {kind === "backward" && <Icon className="size-4" aria-hidden />}
      {kind === "loss" ? "Marcar como perdida" : kind === "backward" ? `Voltar para ${label}` : `Avançar para ${label}`}
      {kind !== "backward" && <Icon className="size-4" aria-hidden />}
    </button>
  );
};

const DetailBody = ({
  opportunity,
  stages,
  today,
  onMove,
  isMoving,
}: {
  opportunity: OpportunityDetail;
  stages: StageMeta[];
  today: string;
  onMove: DrawerProps["onMove"];
  isMoving: boolean;
}) => {
  const registerContact = useRegisterContact();
  const toast = useToast();
  const label = (stage: Stage) => stageLabel(stages, stage);
  const isFinal = opportunity.allowedTransitions.length === 0;

  return (
    <div className="space-y-6 px-6 py-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-moss px-3 py-1 text-xs font-semibold uppercase tracking-wide text-forest-deep">
          {label(opportunity.stage)}
        </span>
        <AttentionBadge level={opportunity.attention.level} />
        <span className="tabular text-xs font-semibold tracking-wider text-ink-soft">{opportunity.code}</span>
      </div>

      {opportunity.attention.signals.length > 0 && (
        <ul className="space-y-1.5" aria-label="Por que precisa de atenção">
          {opportunity.attention.signals.map((signal) => (
            <li
              key={signal.code}
              className={cn(
                "flex items-start gap-2 rounded-lg px-3 py-2 text-sm",
                signal.severity === "critical" ? "bg-critical-soft text-critical" : "bg-warning-soft text-warning",
              )}
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {signal.message}
            </li>
          ))}
        </ul>
      )}

      {!isFinal && (
        <section aria-labelledby="actions-title" className="space-y-3">
          <h3 id="actions-title" className="font-display text-sm font-bold uppercase tracking-wide">
            Próximo passo
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={registerContact.isPending}
              onClick={() =>
                registerContact.mutate(opportunity.id, {
                  onSuccess: () => toast({ tone: "success", title: "Contato de hoje registrado" }),
                  onError: (error) => toast({ tone: "error", title: "Não foi possível registrar", description: error.message }),
                })
              }
              className="inline-flex items-center gap-1.5 rounded-full border border-forest/40 px-4 py-2 text-sm font-semibold text-forest hover:bg-moss disabled:opacity-50"
            >
              <PhoneCall className="size-4" aria-hidden />
              {registerContact.isPending ? "Registrando…" : "Registrei contato hoje"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {opportunity.allowedTransitions.map((to) => (
              <MoveButton
                key={to}
                from={opportunity.stage}
                to={to}
                label={label(to)}
                disabled={isMoving}
                onClick={() => onMove(opportunity, to)}
              />
            ))}
          </div>
        </section>
      )}

      <dl className="grid grid-cols-2 gap-4 rounded-xl border border-line bg-paper p-4">
        <Field label="Valor estimado">
          {opportunity.estimatedValue === null ? (
            <Missing>Não informado</Missing>
          ) : (
            <span className="tabular">{formatCurrency(opportunity.estimatedValue)}</span>
          )}
        </Field>
        <Field label="Vendedor">{opportunity.sellerName}</Field>
        <Field label="Último contato">{dateWithDistance(opportunity.lastContactAt, today, "Nenhum contato")}</Field>
        <Field label="Validade da proposta">
          {dateWithDistance(opportunity.proposalValidUntil, today, "Proposta não enviada")}
        </Field>
        <Field label="Evento do cliente">{dateWithDistance(opportunity.clientEventDate, today, "Não informado")}</Field>
        {opportunity.lossReason && <Field label="Motivo da perda">{opportunity.lossReason}</Field>}
      </dl>

      <section aria-labelledby="items-title">
        <h3 id="items-title" className="font-display text-sm font-bold uppercase tracking-wide">
          Itens de brinde
        </h3>
        {opportunity.items.length === 0 ? (
          <p className="mt-2 text-sm italic text-ink-soft">
            Nenhum item informado. É obrigatório para apresentar o orçamento.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
            {opportunity.items.map((item) => (
              <li key={item.id} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                <span>{item.productName}</span>
                <span className="tabular font-semibold">{formatQuantity(item.quantity)} un.</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="history-title">
        <h3 id="history-title" className="font-display text-sm font-bold uppercase tracking-wide">
          Histórico de etapas
        </h3>
        <ol className="mt-3 space-y-4 border-l-2 border-moss pl-4">
          {[...opportunity.history].reverse().map((change) => (
            <li key={change.id} className="relative">
              <span aria-hidden className="absolute -left-[1.4rem] top-1 size-3 rounded-full border-2 border-white bg-forest" />
              <p className="text-sm font-semibold">
                {change.fromStage ? `${label(change.fromStage)} → ${label(change.toStage)}` : `Entrou em ${label(change.toStage)}`}
              </p>
              <p className="text-xs text-ink-soft">
                {formatDateTime(change.changedAt)}
                {change.changedBy && ` · ${change.changedBy}`}
              </p>
              {change.reason && <p className="mt-0.5 text-sm text-ink-soft">“{change.reason}”</p>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
};

export const OpportunityDrawer = ({ id, stages, today, onClose, onMove, isMoving }: DrawerProps) => {
  const { data, isPending, isError, error, refetch } = useOpportunityDetail(id);

  return (
    <Modal open={id !== null} onClose={onClose} title={data?.companyName ?? "Oportunidade"} variant="drawer">
      {isPending && (
        <div className="space-y-3 px-6 py-5" aria-busy="true" aria-label="Carregando oportunidade">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="h-10 animate-pulse rounded-lg bg-paper-shade" />
          ))}
        </div>
      )}
      {isError && (
        <div className="space-y-3 px-6 py-8 text-center">
          <p className="text-sm text-critical">{error.message}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 rounded-full bg-forest px-4 py-2 text-sm font-semibold text-white"
          >
            <RotateCw className="size-4" aria-hidden /> Tentar de novo
          </button>
        </div>
      )}
      {data && <DetailBody opportunity={data} stages={stages} today={today} onMove={onMove} isMoving={isMoving} />}
    </Modal>
  );
};
