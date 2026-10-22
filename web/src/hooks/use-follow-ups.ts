"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";

export const followUpKeys = {
  all: ["follow-ups"] as const,
  list: (seller?: string) => ["follow-ups", "list", seller ?? "todos"] as const,
  lastRun: ["follow-ups", "last-run"] as const,
};

export const useFollowUps = (seller?: string) =>
  useQuery({ queryKey: followUpKeys.list(seller), queryFn: () => api.listFollowUps(seller) });

export const useLastAutomationRun = () =>
  useQuery({
    queryKey: followUpKeys.lastRun,
    queryFn: async () => (await api.listAutomationRuns())[0] ?? null,
  });

export const useResolveFollowUp = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "DONE" | "CANCELED" }) =>
      api.resolveFollowUp(id, status),
    onSettled: () => queryClient.invalidateQueries({ queryKey: followUpKeys.all }),
  });
};

export const useRunFollowUps = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.runFollowUps,
    onSettled: () => queryClient.invalidateQueries({ queryKey: followUpKeys.all }),
  });
};
