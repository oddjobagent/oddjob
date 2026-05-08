import * as React from "react";
import * as RadixAccordion from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";

import { cn } from "../../lib/utils.ts";

export const Accordion = RadixAccordion.Root;

export const AccordionItem = React.forwardRef<
  React.ElementRef<typeof RadixAccordion.Item>,
  React.ComponentPropsWithoutRef<typeof RadixAccordion.Item>
>(({ className, ...props }, ref) => (
  <RadixAccordion.Item
    ref={ref}
    className={cn("border-b border-(--border-subtle) last:border-0", className)}
    {...props}
  />
));
AccordionItem.displayName = "AccordionItem";

export const AccordionTrigger = React.forwardRef<
  React.ElementRef<typeof RadixAccordion.Trigger>,
  React.ComponentPropsWithoutRef<typeof RadixAccordion.Trigger>
>(({ className, children, ...props }, ref) => (
  <RadixAccordion.Header className="flex">
    <RadixAccordion.Trigger
      ref={ref}
      className={cn(
        "group flex flex-1 items-center justify-between gap-2 py-3 text-sm font-medium text-(--text) transition-colors hover:text-(--accent-9)",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown
        className="size-4 shrink-0 text-(--text-muted) transition-transform duration-(--duration-fast) group-data-[state=open]:rotate-180"
        aria-hidden
      />
    </RadixAccordion.Trigger>
  </RadixAccordion.Header>
));
AccordionTrigger.displayName = "AccordionTrigger";

export const AccordionContent = React.forwardRef<
  React.ElementRef<typeof RadixAccordion.Content>,
  React.ComponentPropsWithoutRef<typeof RadixAccordion.Content>
>(({ className, children, ...props }, ref) => (
  <RadixAccordion.Content
    ref={ref}
    className={cn(
      "overflow-hidden text-sm",
      "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-top-1 data-[state=open]:slide-in-from-top-1",
      className,
    )}
    {...props}
  >
    <div className="pb-4 pt-1 text-(--text-muted)">{children}</div>
  </RadixAccordion.Content>
));
AccordionContent.displayName = "AccordionContent";
