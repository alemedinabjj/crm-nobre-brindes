"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { api } from "@/lib/api/client";
import type { AssistantReply } from "@/lib/api/types";

export type ChatEntry =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string; reply: AssistantReply }
  | { id: string; role: "error"; content: string };

const nextId = () => crypto.randomUUID();

export const useAssistantStatus = (enabled: boolean) =>
  useQuery({ queryKey: ["assistant", "status"], queryFn: api.assistantStatus, enabled, staleTime: 60_000 });

/**
 * Conversa mantida no cliente: a API é stateless e recebe o histórico recente.
 * Só texto volta como histórico; fontes e ações ficam na tela.
 */
export const useAssistantChat = (seller?: string) => {
  const [entries, setEntries] = useState<ChatEntry[]>([]);

  const mutation = useMutation({
    mutationFn: (message: string) =>
      api.askAssistant({
        message,
        seller,
        history: entries
          .filter((entry): entry is Extract<ChatEntry, { role: "user" | "assistant" }> => entry.role !== "error")
          .slice(-6)
          .map((entry) => ({ role: entry.role, content: entry.content })),
      }),
    onSuccess: (reply) =>
      setEntries((current) => [...current, { id: nextId(), role: "assistant", content: reply.answer, reply }]),
    onError: (error) =>
      setEntries((current) => [...current, { id: nextId(), role: "error", content: error.message }]),
  });

  const send = useCallback(
    (message: string) => {
      const text = message.trim();
      if (!text || mutation.isPending) return;
      setEntries((current) => [...current, { id: nextId(), role: "user", content: text }]);
      mutation.mutate(text);
    },
    [mutation],
  );

  return { entries, send, isThinking: mutation.isPending, reset: () => setEntries([]) };
};
