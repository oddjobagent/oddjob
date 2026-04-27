import * as React from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

import { cn } from "../../lib/utils.ts";

export type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface Ctx {
  push: (kind: ToastKind, message: string) => void;
}

const ToastCtx = React.createContext<Ctx | null>(null);

export function useToast(): Ctx {
  const ctx = React.useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [items, setItems] = React.useState<Toast[]>([]);
  const counter = React.useRef(0);

  const push = React.useCallback((kind: ToastKind, message: string) => {
    const id = ++counter.current;
    setItems((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const dismiss = (id: number) => setItems((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
        {items.map((t) => {
          const Icon =
            t.kind === "success" ? CheckCircle2 : t.kind === "error" ? AlertCircle : Info;
          return (
            <div
              key={t.id}
              className={cn(
                "flex items-start gap-2 rounded-md border bg-card p-3 shadow-lg text-sm",
                t.kind === "success" && "border-emerald-500/50",
                t.kind === "error" && "border-destructive/60",
              )}
            >
              <Icon
                className={cn(
                  "size-4 mt-0.5 shrink-0",
                  t.kind === "success" && "text-emerald-500",
                  t.kind === "error" && "text-destructive",
                  t.kind === "info" && "text-foreground/70",
                )}
              />
              <div className="flex-1 break-words">{t.message}</div>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="shrink-0 opacity-60 hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
