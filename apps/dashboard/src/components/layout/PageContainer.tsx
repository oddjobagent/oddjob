import * as React from "react";

import { cn } from "../../lib/utils.ts";

export function PageContainer({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div className={cn("mx-auto w-full max-w-7xl", className)} {...props}>
      {children}
    </div>
  );
}
