"use client";

import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * Toast notifications (design spec §68).
 *
 * Quick feedback only — "Project created", "Changes saved". Anything the user
 * must act on belongs in a dialog or an inline error state, not here.
 *
 * Position: bottom-right on desktop, bottom-center on mobile (§68).
 */

type ToastTone = "default" | "success" | "warning" | "danger";

type ToastRecord = {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
};

type ToastInput = Omit<ToastRecord, "id" | "tone"> & { tone?: ToastTone };

const ToastContext = React.createContext<((toast: ToastInput) => void) | null>(null);

const toneIcon: Record<ToastTone, typeof Info> = {
  default: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  danger: CircleAlert,
};

const toneClasses: Record<ToastTone, string> = {
  default: "text-fg-subtle",
  success: "text-success-strong",
  warning: "text-warning-strong",
  danger: "text-danger-strong",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);
  const nextId = React.useRef(0);

  const push = React.useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { tone: "default", ...toast, id }]);
  }, []);

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={push}>
      <ToastPrimitive.Provider swipeDirection="right" duration={5000}>
        {children}

        {toasts.map((toast) => {
          const ToneIcon = toneIcon[toast.tone];
          return (
            <ToastPrimitive.Root
              key={toast.id}
              onOpenChange={(open) => {
                if (!open) dismiss(toast.id);
              }}
              className={cn(
                "nesto-card flex items-start gap-3 p-3.5 shadow-menu",
                "data-[state=open]:animate-[nesto-slide-in-right_180ms_var(--nesto-ease)]",
                "data-[state=closed]:animate-[nesto-fade-out_150ms_var(--nesto-ease)]",
                "data-[swipe=end]:animate-[nesto-slide-out-right_180ms_var(--nesto-ease)]",
              )}
            >
              <ToneIcon
                aria-hidden="true"
                className={cn("mt-px size-4 shrink-0", toneClasses[toast.tone])}
              />
              <div className="min-w-0 flex-1">
                <ToastPrimitive.Title className="text-table font-medium text-fg">
                  {toast.title}
                </ToastPrimitive.Title>
                {toast.description ? (
                  <ToastPrimitive.Description className="mt-0.5 text-meta text-fg-muted">
                    {toast.description}
                  </ToastPrimitive.Description>
                ) : null}
              </div>
              <ToastPrimitive.Close
                aria-label="Dismiss"
                className="-m-1 grid size-6 shrink-0 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
              >
                <X className="size-3.5" />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}

        <ToastPrimitive.Viewport
          className={cn(
            "fixed z-[70] flex max-h-dvh w-full flex-col gap-2 p-4 outline-none",
            "bottom-0 left-1/2 max-w-[420px] -translate-x-1/2",
            "sm:left-auto sm:right-0 sm:translate-x-0",
          )}
        />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

/** Raise a toast. Throws if used outside ToastProvider, which is a wiring bug. */
export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>.");
  }
  return context;
}
