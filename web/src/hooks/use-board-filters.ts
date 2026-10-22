"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import type { AttentionFilter, OpportunityFilters } from "@/lib/api/types";

const ATTENTION_VALUES: readonly AttentionFilter[] = ["any", "critical", "warning"];

const isAttentionFilter = (value: string | null): value is AttentionFilter =>
  value !== null && (ATTENTION_VALUES as readonly string[]).includes(value);

/**
 * Filtros vivem na URL: o vendedor pode favoritar "minhas negociações em
 * atenção" e o gestor pode mandar o link de uma visão para o time.
 */
export const useBoardFilters = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters = useMemo<OpportunityFilters>(() => {
    const attention = searchParams.get("attention");
    return {
      search: searchParams.get("search") ?? undefined,
      seller: searchParams.get("seller") ?? undefined,
      attention: isAttentionFilter(attention) ? attention : undefined,
    };
  }, [searchParams]);

  const selectedId = searchParams.get("oportunidade");

  const update = useCallback(
    (changes: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const hasActiveFilters = Boolean(filters.search || filters.seller || filters.attention);

  return {
    filters,
    hasActiveFilters,
    selectedId,
    setSearch: (search: string) => update({ search: search.trim() || undefined }),
    setSeller: (seller: string | undefined) => update({ seller }),
    setAttention: (attention: AttentionFilter | undefined) => update({ attention }),
    clearFilters: () => update({ search: undefined, seller: undefined, attention: undefined }),
    openOpportunity: (id: string) => update({ oportunidade: id }),
    closeOpportunity: () => update({ oportunidade: undefined }),
  };
};
