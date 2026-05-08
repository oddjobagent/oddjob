import * as React from "react";
import * as RadixSwitch from "@radix-ui/react-switch";

import { cn } from "../../lib/utils.ts";

export const Switch = React.forwardRef<
  React.ElementRef<typeof RadixSwitch.Root>,
  React.ComponentPropsWithoutRef<typeof RadixSwitch.Root>
>(({ className, ...props }, ref) => (
  <RadixSwitch.Root
    ref={ref}
    className={cn(
      "peer relative inline-flex h-5 w-8 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-(--duration-fast)",
      "bg-(--surface-2) data-[state=checked]:bg-(--accent-9)",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <RadixSwitch.Thumb
      className={cn(
        "pointer-events-none block size-3.5 translate-x-0.5 rounded-full bg-white shadow ring-0 transition-transform duration-(--duration-fast)",
        "data-[state=checked]:translate-x-3.5",
      )}
    />
  </RadixSwitch.Root>
));
Switch.displayName = "Switch";
