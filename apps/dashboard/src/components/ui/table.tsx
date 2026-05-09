import * as React from "react";
import { useNavigate, type LinkProps } from "@tanstack/react-router";

import { cn } from "../../lib/utils.ts";

export const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto rounded-md border border-(--border-subtle) bg-(--surface-1)">
      <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  ),
);
Table.displayName = "Table";

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn("bg-(--surface-2)/60 [&_tr]:border-b [&_tr]:border-(--border-subtle)", className)}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b border-(--border-subtle) transition-colors duration-(--duration-fast)",
      "hover:bg-(--surface-2)/50 data-[state=selected]:bg-(--surface-2)",
      className,
    )}
    {...props}
  />
));
TableRow.displayName = "TableRow";

/**
 * Clickable row that navigates on click + Enter/Space. Use for tables where the
 * sole row action is to open a detail page; pair with `TableRowAction` for any
 * inline buttons that should NOT trigger navigation.
 */
export type TableRowLinkProps = Pick<LinkProps, "to" | "params" | "search"> &
  Omit<React.HTMLAttributes<HTMLTableRowElement>, "onClick">;

export const TableRowLink = React.forwardRef<HTMLTableRowElement, TableRowLinkProps>(
  ({ className, to, params, search, children, onKeyDown, ...rest }, ref) => {
    const navigate = useNavigate();
    const go = () => {
      void navigate({ to, params, search } as never);
    };
    return (
      <tr
        ref={ref}
        role="link"
        tabIndex={0}
        onClick={go}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            go();
          }
        }}
        className={cn(
          "border-b border-(--border-subtle) transition-colors duration-(--duration-fast)",
          "cursor-pointer hover:bg-(--surface-2) focus:outline-none focus-visible:bg-(--surface-2) focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--accent-9)",
          className,
        )}
        {...rest}
      >
        {children}
      </tr>
    );
  },
);
TableRowLink.displayName = "TableRowLink";

/**
 * Wrapper for a button/link that lives inside a TableRowLink and should NOT
 * propagate its click up to the row navigation. Renders as a `<span>` so it
 * doesn't add semantics; the inner button keeps a11y.
 */
export function TableRowAction({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return (
    <span
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn("contents", className)}
      {...props}
    >
      {children}
    </span>
  );
}

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-9 px-3 text-left align-middle text-[11px] font-medium uppercase tracking-wide text-(--text-muted) [&:has([role=checkbox])]:pr-0",
      className,
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn("py-2.5 px-3 align-middle [&:has([role=checkbox])]:pr-0", className)}
    {...props}
  />
));
TableCell.displayName = "TableCell";
