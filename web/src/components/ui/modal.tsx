"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  variant?: "dialog" | "drawer";
};

/**
 * Usa o <dialog> nativo: foco preso, Esc para fechar e fundo inerte
 * sem dependência extra.
 */
export const Modal = ({ open, onClose, title, children, variant = "dialog" }: ModalProps) => {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-label={title}
      className={cn(
        "bg-white p-0 text-ink backdrop:bg-forest-deep/40 backdrop:backdrop-blur-[2px]",
        variant === "drawer"
          ? "m-0 ml-auto h-dvh max-h-dvh w-full max-w-xl border-l border-line"
          : "m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl shadow-2xl",
      )}
    >
      {open && (
        <div className="flex h-full flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <h2 className="font-display text-lg font-bold leading-tight">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="-mr-2 rounded-lg p-2 text-ink-soft hover:bg-paper-shade focus-visible:outline-2 focus-visible:outline-forest"
              aria-label="Fechar"
            >
              <X className="size-5" aria-hidden />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      )}
    </dialog>
  );
};
