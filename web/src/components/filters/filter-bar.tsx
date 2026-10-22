"use client";

import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AttentionFilter, OpportunityFilters } from "@/lib/api/types";
import { cn } from "@/lib/cn";

type FilterBarProps = {
  filters: OpportunityFilters;
  sellers: string[];
  hasActiveFilters: boolean;
  onSearch: (value: string) => void;
  onSeller: (value: string | undefined) => void;
  onAttention: (value: AttentionFilter | undefined) => void;
  onClear: () => void;
};

const ATTENTION_OPTIONS: { value: AttentionFilter | undefined; label: string }[] = [
  { value: undefined, label: "Todas" },
  { value: "any", label: "Precisam de atenção" },
  { value: "critical", label: "Só urgentes" },
];

const SEARCH_DEBOUNCE_MS = 300;

export const FilterBar = ({
  filters,
  sellers,
  hasActiveFilters,
  onSearch,
  onSeller,
  onAttention,
  onClear,
}: FilterBarProps) => {
  const [search, setSearch] = useState(filters.search ?? "");
  const [syncedSearch, setSyncedSearch] = useState(filters.search);

  // Mantém o campo em sincronia quando a URL muda por fora (ex.: "limpar filtros").
  if (syncedSearch !== filters.search) {
    setSyncedSearch(filters.search);
    setSearch(filters.search ?? "");
  }

  useEffect(() => {
    if (search.trim() === (filters.search ?? "")) return;
    const timer = window.setTimeout(() => onSearch(search), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search, filters.search, onSearch]);

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
      <label className="relative min-w-60 flex-1 sm:max-w-sm">
        <span className="sr-only">Buscar oportunidades</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Empresa, código ou brinde"
          className="w-full rounded-full border border-line bg-white py-2 pl-9 pr-3 text-sm outline-none placeholder:text-ink-soft/70 focus:border-forest focus:ring-2 focus:ring-forest/20"
        />
      </label>

      <label className="sr-only" htmlFor="seller-filter">
        Vendedor
      </label>
      <select
        id="seller-filter"
        value={filters.seller ?? ""}
        onChange={(event) => onSeller(event.target.value || undefined)}
        className="rounded-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
      >
        <option value="">Todos os vendedores</option>
        {sellers.map((seller) => (
          <option key={seller} value={seller}>
            {seller}
          </option>
        ))}
      </select>

      <div role="radiogroup" aria-label="Filtrar por atenção" className="flex rounded-full border border-line bg-white p-0.5">
        {ATTENTION_OPTIONS.map((option) => {
          const checked = filters.attention === option.value;
          return (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onAttention(option.value)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                checked ? "bg-forest text-white" : "text-ink-soft hover:text-ink",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-semibold text-forest hover:bg-moss"
        >
          <X className="size-3.5" aria-hidden /> Limpar filtros
        </button>
      )}
    </div>
  );
};
