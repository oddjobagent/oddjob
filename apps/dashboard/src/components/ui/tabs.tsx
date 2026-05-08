import * as React from "react";
import * as RadixTabs from "@radix-ui/react-tabs";

import { cn } from "../../lib/utils.ts";

export const Tabs = RadixTabs.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof RadixTabs.List>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.List>
>(({ className, ...props }, ref) => (
  <RadixTabs.List
    ref={ref}
    className={cn(
      "inline-flex h-9 items-center gap-4 border-b border-(--border-subtle)",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof RadixTabs.Trigger>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.Trigger>
>(({ className, ...props }, ref) => (
  <RadixTabs.Trigger
    ref={ref}
    className={cn(
      "relative -mb-px inline-flex h-9 items-center px-0.5 text-sm font-medium",
      "text-(--text-muted) transition-colors duration-(--duration-fast) hover:text-(--text)",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm",
      "data-[state=active]:text-(--text)",
      "data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:bg-(--accent-9)",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof RadixTabs.Content>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.Content>
>(({ className, ...props }, ref) => (
  <RadixTabs.Content
    ref={ref}
    className={cn("mt-6 focus-visible:outline-none", "data-[state=inactive]:hidden", className)}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
