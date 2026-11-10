"use client";

import { useEffect, useState } from "react";

import { useToasts } from "@/hooks/useLive";
import { dismissToast, TOAST_MS, type Toast } from "@/lib/toasts";

import { CloseIcon, DrawnCheck, ErrorIcon } from "./icons";

function ToastCard({ toast }: { toast: Toast }) {
  // The countdown stops while the pointer or the keyboard focus is on the toast.
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(() => dismissToast(toast.id), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [held, toast.id]);

  return (
    <li
      data-testid="toast"
      data-tone={toast.tone}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className="pointer-events-auto flex max-w-full items-start gap-2.5 rounded-lg border border-line-strong bg-raised py-2 pl-3 pr-2 shadow-pop animate-rise"
    >
      {toast.tone === "success" ? (
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success text-bg animate-pop">
          <DrawnCheck className="h-3.5 w-3.5" />
        </span>
      ) : (
        <ErrorIcon className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
      )}

      <p className="min-w-0 py-0.5 text-body text-ink-2">
        <span data-testid="toast-title" className="font-semibold text-ink">
          {toast.title}
        </span>
        {toast.description !== undefined && <> · {toast.description}</>}
      </p>

      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        aria-label={`Dismiss: ${toast.title}`}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-xs text-ink-3 transition-colors duration-150 hover:bg-surface hover:text-ink"
      >
        <CloseIcon className="h-4 w-4" />
      </button>
    </li>
  );
}

/**
 * Confirmations as one-line notes: centred under the header on a wide screen, where they
 * cover no figure and no form, and at the bottom of a phone. The list is an aria-live
 * region, so a confirmation is also announced when the tab that caused it is no longer the
 * one on screen.
 */
export function Toaster() {
  const toasts = useToasts();
  return (
    <ol
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-40 flex flex-col items-center gap-1.5 sm:bottom-auto sm:top-[4.125rem]"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </ol>
  );
}
