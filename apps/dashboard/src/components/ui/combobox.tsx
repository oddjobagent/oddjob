import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "../../lib/utils.ts";

export interface ComboboxOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  allowCustom?: boolean;
  placeholder?: string;
  className?: string;
}

export function Combobox({
  value,
  onChange,
  options,
  allowCustom,
  placeholder,
  className,
}: ComboboxProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const filtered = options.filter(
    (o) =>
      !query ||
      o.label.toLowerCase().includes(query.toLowerCase()) ||
      o.value.toLowerCase().includes(query.toLowerCase()),
  );

  const showCustom = allowCustom && query.length > 0 && !options.some((o) => o.value === query);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm shadow-sm hover:bg-accent/40"
      >
        <span className={cn(!value && "text-muted-foreground")}>
          {value || placeholder || "Select…"}
        </span>
        <ChevronDown className="size-4 opacity-50" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={allowCustom ? "Search or type to add custom…" : "Search…"}
            className="h-9 w-full bg-transparent px-3 text-sm border-b focus:outline-none"
          />
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                disabled={o.disabled}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                  setQuery("");
                }}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-1.5 text-sm hover:bg-accent",
                  value === o.value && "bg-accent/60",
                  o.disabled && "opacity-50 cursor-not-allowed",
                )}
              >
                <span>{o.label}</span>
                {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
              </button>
            ))}
            {showCustom && (
              <button
                type="button"
                onClick={() => {
                  onChange(query);
                  setOpen(false);
                  setQuery("");
                }}
                className="flex w-full items-center px-3 py-1.5 text-sm hover:bg-accent border-t"
              >
                Use custom: <span className="ml-1 font-mono">{query}</span>
              </button>
            )}
            {filtered.length === 0 && !showCustom && (
              <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
