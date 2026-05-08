import * as React from "react";
import { X } from "lucide-react";

import { cn } from "../../lib/utils.ts";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps): React.JSX.Element | null {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-(--gray-12)/40"
        onClick={() => onOpenChange(false)}
        aria-hidden
      />
      {children}
    </div>
  );
}

export function DialogContent({
  className,
  children,
  onClose,
}: {
  className?: string;
  children: React.ReactNode;
  onClose?: () => void;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "relative z-10 w-full max-w-md rounded-md border border-(--border-subtle) bg-(--surface-raised) p-5 shadow-2xl shadow-(--gray-12)/15",
        className,
      )}
      role="dialog"
      aria-modal="true"
    >
      {onClose && (
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-sm text-(--text-muted) opacity-70 transition-opacity hover:opacity-100"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      )}
      {children}
    </div>
  );
}

export function DialogHeader({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="mb-4 space-y-1">{children}</div>;
}

export function DialogTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h2 className="text-base font-semibold tracking-(--tracking-tight)">{children}</h2>;
}

export function DialogDescription({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="text-sm text-(--text-muted)">{children}</p>;
}

export function DialogFooter({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="mt-5 flex justify-end gap-2">{children}</div>;
}
