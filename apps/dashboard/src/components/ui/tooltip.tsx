import * as React from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";

import { cn } from "../../lib/utils.ts";

export const TooltipProvider = RadixTooltip.Provider;

interface TooltipProps {
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delayDuration?: number;
  children: React.ReactNode;
  className?: string;
}

export function Tooltip({
  content,
  side = "top",
  align = "center",
  delayDuration,
  children,
  className,
}: TooltipProps): React.JSX.Element {
  return (
    <RadixTooltip.Root delayDuration={delayDuration}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          align={align}
          sideOffset={6}
          className={cn(
            "z-50 max-w-xs rounded-md border border-(--border-subtle) bg-(--surface-raised) px-2.5 py-1.5 text-xs text-(--text) shadow-md shadow-(--gray-12)/10",
            "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95",
            className,
          )}
        >
          {content}
          <RadixTooltip.Arrow className="fill-(--surface-raised) stroke-(--border-subtle)" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
