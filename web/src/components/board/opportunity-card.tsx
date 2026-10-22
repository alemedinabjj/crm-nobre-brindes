"use client";

import { useDraggable } from "@dnd-kit/core";
import { CalendarClock, FileText, PhoneCall } from "lucide-react";
import type { Opportunity, Severity } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import {
  formatCurrency,
  formatProposalDeadline,
  formatQuantity,
  formatRelativeDays,
  formatShortDate,
} from "@/lib/format";
import { AttentionBadge } from "../ui/attention-badge";

type CardProps = {
  opportunity: Opportunity;
  today: string;
  onOpen: (id: string) => void;
  isOverlay?: boolean;
};

const SIGNAL_GROUPS = {
  contact: ["NO_CONTACT_RECORDED", "CONTACT_OVERDUE"],
  proposal: ["PROPOSAL_EXPIRED", "PROPOSAL_EXPIRING"],
  event: ["EVENT_PASSED", "EVENT_IMMINENT", "EVENT_APPROACHING"],
} as const;

const severityFor = (opportunity: Opportunity, group: keyof typeof SIGNAL_GROUPS): Severity | null =>
  opportunity.attention.signals.find((signal) =>
    (SIGNAL_GROUPS[group] as readonly string[]).includes(signal.code),
  )?.severity ?? null;

const chipTone = (severity: Severity | null) =>
  severity === "critical"
    ? "bg-critical-soft text-critical"
    : severity === "warning"
      ? "bg-warning-soft text-warning"
      : "bg-paper-shade text-ink-soft";

const DateChip = ({
  icon: Icon,
  label,
  value,
  severity,
}: {
  icon: typeof PhoneCall;
  label: string;
  value: string;
  severity: Severity | null;
}) => (
  <span
    className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", chipTone(severity))}
    title={label}
  >
    <Icon className="size-3" aria-hidden />
    <span className="sr-only">{label}: </span>
    {value}
  </span>
);

export const OpportunityCard = ({ opportunity, today, onOpen, isOverlay = false }: CardProps) => {
  const isFinal = opportunity.allowedTransitions.length === 0;
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: opportunity.id,
    data: { opportunity },
    disabled: isFinal || isOverlay,
  });

  const [firstItem, ...otherItems] = opportunity.items;
  const topSignal = opportunity.attention.signals[0];
  const level = opportunity.attention.level;

  return (
    <article
      ref={setNodeRef}
      // Arrastar é pelo mouse/toque; pelo teclado, o "Mover para" do detalhe faz o mesmo.
      {...listeners}
      className={cn(
        "group relative rounded-xl border bg-white p-3 text-left shadow-sm transition-[box-shadow,transform,opacity]",
        level === "critical" && "border-critical/40 shadow-critical/10",
        level === "warning" && "border-warning-line",
        level === "ok" && "border-line",
        !isFinal && !isOverlay && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-30",
        isOverlay && "rotate-1 shadow-xl shadow-forest-deep/20",
        isFinal && "bg-paper-shade/60",
      )}
    >
      {level !== "ok" && (
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-3 left-0 w-1 rounded-r-full",
            level === "critical" ? "bg-critical" : "bg-warning-line",
          )}
        />
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="tabular text-[11px] font-semibold tracking-wider text-ink-soft">{opportunity.code}</span>
        <AttentionBadge level={level} />
      </div>

      <h3 className="mt-1 font-display text-[15px] font-bold leading-snug">
        <button
          type="button"
          onClick={() => onOpen(opportunity.id)}
          className="text-left after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-forest"
        >
          {opportunity.companyName}
        </button>
      </h3>

      {firstItem ? (
        <p className="mt-0.5 truncate text-[13px] text-ink-soft">
          <span className="tabular">{formatQuantity(firstItem.quantity)}</span> × {firstItem.productName}
          {otherItems.length > 0 && ` +${otherItems.length}`}
        </p>
      ) : (
        <p className="mt-0.5 text-[13px] italic text-ink-soft">Nenhum item informado</p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="tabular font-display text-sm font-bold">{formatCurrency(opportunity.estimatedValue)}</span>
        <span className="flex items-center gap-1.5 text-xs text-ink-soft">
          <span
            aria-hidden
            className="grid size-5 place-items-center rounded-full bg-moss text-[10px] font-bold text-forest-deep"
          >
            {opportunity.sellerName.slice(0, 1)}
          </span>
          {opportunity.sellerName}
        </span>
      </div>

      {!isFinal && (
        <div className="mt-2 flex flex-wrap gap-1">
          <DateChip
            icon={PhoneCall}
            label="Último contato"
            value={opportunity.lastContactAt ? formatRelativeDays(opportunity.lastContactAt, today) : "sem contato"}
            severity={severityFor(opportunity, "contact")}
          />
          {opportunity.proposalValidUntil && opportunity.stage !== "PRIMEIRO_CONTATO" && (
            <DateChip
              icon={FileText}
              label="Validade da proposta"
              value={formatProposalDeadline(opportunity.proposalValidUntil, today)}
              severity={severityFor(opportunity, "proposal")}
            />
          )}
          {opportunity.clientEventDate && (
            <DateChip
              icon={CalendarClock}
              label="Evento do cliente"
              value={formatShortDate(opportunity.clientEventDate)}
              severity={severityFor(opportunity, "event")}
            />
          )}
        </div>
      )}

      {topSignal && (
        <p
          className={cn(
            "mt-2 border-t border-dashed pt-2 text-xs leading-snug",
            topSignal.severity === "critical" ? "border-critical/20 text-critical" : "border-warning-line text-warning",
          )}
        >
          {topSignal.message}
          {opportunity.attention.signals.length > 1 && ` (+${opportunity.attention.signals.length - 1})`}
        </p>
      )}

      {opportunity.stage === "PERDIDA" && opportunity.lossReason && (
        <p className="mt-2 border-t border-dashed border-line pt-2 text-xs text-ink-soft">
          Motivo: {opportunity.lossReason}
        </p>
      )}
    </article>
  );
};
