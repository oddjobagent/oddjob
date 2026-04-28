import * as React from "react";
import { cn } from "../lib/cn.ts";

export interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  spacing?: "tight" | "default" | "loose";
}

const spacingClasses = {
  tight: "py-12 sm:py-16",
  default: "py-20 sm:py-28",
  loose: "py-28 sm:py-40",
} as const;

export const Section = React.forwardRef<HTMLElement, SectionProps>(function Section(
  { className, spacing = "default", ...props },
  ref,
) {
  return <section ref={ref} className={cn(spacingClasses[spacing], className)} {...props} />;
});
