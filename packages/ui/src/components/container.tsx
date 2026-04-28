import * as React from "react";
import { cn } from "../lib/cn.ts";

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg" | "xl";
}

const sizeClasses = {
  sm: "max-w-2xl",
  md: "max-w-4xl",
  lg: "max-w-5xl",
  xl: "max-w-6xl",
} as const;

export const Container = React.forwardRef<HTMLDivElement, ContainerProps>(function Container(
  { className, size = "lg", ...props },
  ref,
) {
  return (
    <div ref={ref} className={cn("mx-auto w-full px-6", sizeClasses[size], className)} {...props} />
  );
});
