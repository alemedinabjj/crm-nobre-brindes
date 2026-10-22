"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { Opportunity, OpportunityDetail, OpportunityFilters, Stage } from "@/lib/api/types";

export const queryKeys = {
  meta: ["meta"] as const,
  opportunities: ["opportunities"] as const,
  list: (filters: OpportunityFilters) => ["opportunities", "list", filters] as const,
  detail: (id: string) => ["opportunities", "detail", id] as const,
};

export const useMeta = () =>
  useQuery({ queryKey: queryKeys.meta, queryFn: api.meta, staleTime: 5 * 60_000 });

export const useOpportunities = (filters: OpportunityFilters) =>
  useQuery({
    queryKey: queryKeys.list(filters),
    queryFn: () => api.listOpportunities(filters),
    placeholderData: (previous) => previous,
  });

export const useOpportunityDetail = (id: string | null) =>
  useQuery({
    queryKey: queryKeys.detail(id ?? ""),
    queryFn: () => api.getOpportunity(id ?? ""),
    enabled: id !== null,
  });

type ChangeStageVariables = { id: string; to: Stage; reason?: string };

/**
 * Atualização otimista: o card muda de coluna na hora. Se o backend recusar
 * (regra de negócio ou conflito), o quadro volta ao estado anterior e a tela
 * mostra o motivo.
 */
export const useChangeStage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, to, reason }: ChangeStageVariables) => api.changeStage(id, { to, reason }),
    onMutate: async ({ id, to }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.opportunities });
      const snapshot = queryClient.getQueriesData<Opportunity[]>({
        queryKey: [...queryKeys.opportunities, "list"],
      });
      queryClient.setQueriesData<Opportunity[]>(
        { queryKey: [...queryKeys.opportunities, "list"] },
        (current) => current?.map((item) => (item.id === id ? { ...item, stage: to } : item)),
      );
      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      context?.snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSuccess: (detail: OpportunityDetail) => {
      queryClient.setQueryData(queryKeys.detail(detail.id), detail);
    },
    // Mover de etapa conclui ou cancela o retorno aberto no backend.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.opportunities }),
        queryClient.invalidateQueries({ queryKey: ["follow-ups"] }),
      ]),
  });
};

export const useRegisterContact = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.registerContact(id),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.detail(detail.id), detail);
      // Registrar contato conclui o retorno aberto dessa negociação.
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: [...queryKeys.opportunities, "list"] }),
        queryClient.invalidateQueries({ queryKey: ["follow-ups"] }),
      ]);
    },
  });
};
