export type Toast = {
  id: number;
  tone: "success" | "error";
  title: string;
  description?: string;
};

/** How long a toast stays unless the pointer or the keyboard focus is on it. */
export const TOAST_MS = 7_000;

/** At most this many toasts are on screen; older ones make room. */
const MAX_TOASTS = 2;

let toasts: readonly Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const publish = (next: readonly Toast[]) => {
  toasts = next;
  for (const listener of [...listeners]) listener();
};

export const getToasts = () => toasts;

const NO_TOASTS: readonly Toast[] = [];
export const getServerToasts = () => NO_TOASTS;

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function pushToast(toast: Omit<Toast, "id">): number {
  const id = nextId++;
  publish([...toasts, { ...toast, id }].slice(-MAX_TOASTS));
  return id;
}

export function dismissToast(id: number): void {
  if (toasts.some((toast) => toast.id === id)) publish(toasts.filter((toast) => toast.id !== id));
}
