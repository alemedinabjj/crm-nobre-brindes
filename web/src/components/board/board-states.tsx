import { RotateCw, SearchX, ServerCrash } from "lucide-react";
import { BOARD_ORDER } from "@/lib/stages";

export const BoardSkeleton = () => (
  <div className="flex gap-3 overflow-hidden px-4 pb-6 sm:px-6" aria-busy="true" aria-label="Carregando oportunidades">
    {BOARD_ORDER.map((stage) => (
      <div key={stage} className="w-[17.5rem] shrink-0 2xl:w-auto 2xl:flex-1 space-y-2 rounded-2xl border border-line bg-white/60 p-3">
        <div className="h-4 w-32 animate-pulse rounded bg-paper-shade" />
        <div className="h-3 w-24 animate-pulse rounded bg-paper-shade" />
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-xl bg-paper-shade" />
        ))}
      </div>
    ))}
  </div>
);

export const BoardError = ({ message, onRetry }: { message: string; onRetry: () => void }) => (
  <div role="alert" className="mx-4 flex flex-col items-center gap-3 rounded-2xl border border-critical/20 bg-white px-6 py-12 text-center sm:mx-6">
    <ServerCrash className="size-10 text-critical" aria-hidden />
    <div>
      <p className="font-display text-lg font-bold">Não conseguimos carregar o funil</p>
      <p className="mt-1 max-w-md text-sm text-ink-soft">{message}</p>
    </div>
    <button
      type="button"
      onClick={onRetry}
      className="inline-flex items-center gap-1.5 rounded-full bg-forest px-5 py-2 text-sm font-semibold text-white hover:bg-forest-deep"
    >
      <RotateCw className="size-4" aria-hidden /> Tentar de novo
    </button>
  </div>
);

export const BoardEmpty = ({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) => (
  <div className="mx-4 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-white px-6 py-12 text-center sm:mx-6">
    <SearchX className="size-10 text-ink-soft" aria-hidden />
    <div>
      <p className="font-display text-lg font-bold">
        {hasFilters ? "Nenhuma oportunidade com esses filtros" : "Nenhuma oportunidade cadastrada ainda"}
      </p>
      <p className="mt-1 text-sm text-ink-soft">
        {hasFilters
          ? "Tente outra busca ou limpe os filtros para ver o funil completo."
          : "Quando um lead entrar, ele aparece em Primeiro Contato."}
      </p>
    </div>
    {hasFilters && (
      <button
        type="button"
        onClick={onClear}
        className="rounded-full border border-forest/40 px-5 py-2 text-sm font-semibold text-forest hover:bg-moss"
      >
        Limpar filtros
      </button>
    )}
  </div>
);
