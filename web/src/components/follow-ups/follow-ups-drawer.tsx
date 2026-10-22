"use client";

import { Bot, Check, ExternalLink, RotateCw, X } from "lucide-react";
import { useFollowUps, useLastAutomationRun, useResolveFollowUp, useRunFollowUps } from "@/hooks/use-follow-ups";
import type { AutomationRun, FollowUpTask } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatDateTime, formatShortDate } from "@/lib/format";
import { Modal } from "../ui/modal";
import { useToast } from "../ui/toast";

type FollowUpsDrawerProps = {
  open: boolean;
  seller?: string;
  onClose: () => void;
  onOpenOpportunity: (id: string) => void;
};

/** Disparo manual existe para demonstração local; em produção quem dispara é o cron. */
const MANUAL_RUN_ENABLED = process.env.NEXT_PUBLIC_ENABLE_MANUAL_AUTOMATION !== "false";

const TRIGGER_LABEL: Record<AutomationRun["trigger"], string> = {
  schedule: "agenda da API",
  cron: "cron diário",
  manual: "disparo manual",
};

const groups = (tasks: FollowUpTask[]) => [
  { id: "late", title: "Atrasados", tasks: tasks.filter((task) => task.daysOverdue > 0) },
  { id: "today", title: "Para hoje", tasks: tasks.filter((task) => task.daysOverdue === 0) },
  { id: "next", title: "Próximos dias úteis", tasks: tasks.filter((task) => task.daysOverdue < 0) },
];

const dueLabel = (task: FollowUpTask) => {
  if (task.daysOverdue > 0) return `atrasado ${task.daysOverdue}d`;
  if (task.daysOverdue === 0) return "hoje";
  return formatShortDate(task.dueDate);
};

const TaskItem = ({
  task,
  onOpen,
}: {
  task: FollowUpTask;
  onOpen: (id: string) => void;
}) => {
  const resolve = useResolveFollowUp();
  const toast = useToast();

  const act = (status: "DONE" | "CANCELED") =>
    resolve.mutate(
      { id: task.id, status },
      {
        onSuccess: () =>
          toast({ tone: "success", title: status === "DONE" ? "Retorno concluído" : "Retorno dispensado" }),
        onError: (error) => toast({ tone: "error", title: "Não foi possível atualizar", description: error.message }),
      },
    );

  return (
    <li
      className={cn(
        "rounded-xl border bg-white p-3",
        task.priority === "HIGH" ? "border-critical/30" : "border-warning-line",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold leading-snug">{task.title}</p>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            task.daysOverdue >= 0 && task.priority === "HIGH"
              ? "bg-critical text-white"
              : "bg-warning-soft text-warning",
          )}
        >
          {dueLabel(task)}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-ink-soft">
        {task.opportunityCode} · {task.stageLabel} · {task.sellerName}
      </p>
      <p className="mt-1.5 text-sm text-ink-soft">{task.details}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onOpen(task.opportunityId)}
          className="inline-flex items-center gap-1 rounded-full bg-forest px-3 py-1.5 text-xs font-semibold text-white hover:bg-forest-deep"
        >
          <ExternalLink className="size-3.5" aria-hidden /> Abrir negociação
        </button>
        <button
          type="button"
          disabled={resolve.isPending}
          onClick={() => act("DONE")}
          className="inline-flex items-center gap-1 rounded-full border border-forest/40 px-3 py-1.5 text-xs font-semibold text-forest hover:bg-moss disabled:opacity-50"
        >
          <Check className="size-3.5" aria-hidden /> Concluir
        </button>
        <button
          type="button"
          disabled={resolve.isPending}
          onClick={() => act("CANCELED")}
          className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-paper-shade disabled:opacity-50"
        >
          <X className="size-3.5" aria-hidden /> Dispensar
        </button>
      </div>
    </li>
  );
};

export const FollowUpsDrawer = ({ open, seller, onClose, onOpenOpportunity }: FollowUpsDrawerProps) => {
  const tasks = useFollowUps(seller);
  const lastRun = useLastAutomationRun();
  const run = useRunFollowUps();
  const toast = useToast();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={seller ? `Retornos de ${seller}` : "Retornos do time"}
      variant="drawer"
    >
      <div className="space-y-5 px-6 py-5">
        <div className="flex items-start gap-3 rounded-xl bg-moss/60 p-3 text-sm text-forest-deep">
          <Bot className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p>
              Todo dia útil, antes do expediente, a automação revisa o funil e cria um retorno para cada
              negociação em risco. Registrar contato ou mudar a etapa conclui o retorno sozinho.
            </p>
            {lastRun.data && (
              <p className="mt-1 text-xs text-ink-soft">
                Última execução: {formatDateTime(lastRun.data.startedAt)} ({TRIGGER_LABEL[lastRun.data.trigger]}) ·{" "}
                {lastRun.data.createdCount} criado(s), {lastRun.data.canceledCount} cancelado(s)
              </p>
            )}
          </div>
          {MANUAL_RUN_ENABLED && (
            <button
              type="button"
              disabled={run.isPending}
              onClick={() =>
                run.mutate(undefined, {
                  onSuccess: (result) =>
                    toast({
                      tone: "success",
                      title: `Automação executada: ${result.createdCount} retorno(s) criado(s)`,
                      description: result.createdCount === 0 ? "Nada novo: nenhum retorno duplicado." : undefined,
                    }),
                  onError: (error) => toast({ tone: "error", title: "Falha ao executar", description: error.message }),
                })
              }
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-forest px-3 py-1.5 text-xs font-semibold text-white hover:bg-forest-deep disabled:opacity-50"
            >
              <RotateCw className={cn("size-3.5", run.isPending && "animate-spin")} aria-hidden />
              Rodar agora
            </button>
          )}
        </div>

        {tasks.isPending && (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="h-28 animate-pulse rounded-xl bg-paper-shade" />
            ))}
          </div>
        )}
        {tasks.isError && <p className="text-sm text-critical">{tasks.error.message}</p>}
        {tasks.data?.length === 0 && (
          <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-soft">
            Nenhum retorno pendente. Tudo em dia.
          </p>
        )}

        {tasks.data &&
          groups(tasks.data)
            .filter((group) => group.tasks.length > 0)
            .map((group) => (
              <section key={group.id} aria-labelledby={`follow-ups-${group.id}`}>
                <h3
                  id={`follow-ups-${group.id}`}
                  className="mb-2 font-display text-sm font-bold uppercase tracking-wide"
                >
                  {group.title} <span className="text-ink-soft">({group.tasks.length})</span>
                </h3>
                <ul className="space-y-2">
                  {group.tasks.map((task) => (
                    <TaskItem key={task.id} task={task} onOpen={onOpenOpportunity} />
                  ))}
                </ul>
              </section>
            ))}
      </div>
    </Modal>
  );
};
