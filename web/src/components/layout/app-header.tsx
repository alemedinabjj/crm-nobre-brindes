import { CalendarDays } from "lucide-react";
import type { ReactNode } from "react";
import { formatShortDate } from "@/lib/format";

/**
 * Faixa verde viva e marca em caixa baixa seguem o cabeçalho do site
 * nobrebrindes.com.br. O logotipo oficial pode substituir a marca em texto
 * colocando o SVG da marca em /public.
 */
export const AppHeader = ({ today, actions }: { today?: string; actions?: ReactNode }) => (
  <header className="bg-lime text-forest-deep">
    <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-2xl font-extrabold lowercase leading-none tracking-tight">
          nobre
          <span className="ml-0.5 align-top text-[10px] font-bold uppercase tracking-[0.25em]">brindes</span>
        </span>
        <span className="hidden h-5 w-px bg-forest-deep/25 sm:block" aria-hidden />
        <span className="hidden text-xs font-semibold uppercase tracking-[0.18em] sm:block">CRM Comercial</span>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {today && (
          <span className="hidden items-center gap-1.5 rounded-full bg-forest-deep/10 px-3 py-1 text-xs font-semibold sm:inline-flex">
            <CalendarDays className="size-3.5" aria-hidden />
            Hoje, {formatShortDate(today)}
          </span>
        )}
      </div>
    </div>
  </header>
);
