import * as React from "react";
import * as RadixDropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight } from "lucide-react";

import { cn } from "../../lib/utils.ts";

export const DropdownMenu = RadixDropdownMenu.Root;
export const DropdownMenuTrigger = RadixDropdownMenu.Trigger;
export const DropdownMenuGroup = RadixDropdownMenu.Group;
export const DropdownMenuRadioGroup = RadixDropdownMenu.RadioGroup;
export const DropdownMenuSub = RadixDropdownMenu.Sub;

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof RadixDropdownMenu.Content>,
  React.ComponentPropsWithoutRef<typeof RadixDropdownMenu.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <RadixDropdownMenu.Portal>
    <RadixDropdownMenu.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-44 overflow-hidden rounded-md border border-(--border-subtle) bg-(--surface-raised) p-1 shadow-lg shadow-(--gray-12)/10",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
        className,
      )}
      {...props}
    />
  </RadixDropdownMenu.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

const itemClasses =
  "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-(--text) outline-none transition-colors data-[highlighted]:bg-(--surface-2) data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof RadixDropdownMenu.Item>,
  React.ComponentPropsWithoutRef<typeof RadixDropdownMenu.Item> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <RadixDropdownMenu.Item
    ref={ref}
    className={cn(itemClasses, inset && "pl-7", className)}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof RadixDropdownMenu.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof RadixDropdownMenu.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <RadixDropdownMenu.CheckboxItem
    ref={ref}
    checked={checked}
    className={cn(itemClasses, "pl-7", className)}
    {...props}
  >
    <span className="absolute left-2 flex size-4 items-center justify-center">
      <RadixDropdownMenu.ItemIndicator>
        <Check className="size-3.5" />
      </RadixDropdownMenu.ItemIndicator>
    </span>
    {children}
  </RadixDropdownMenu.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";

export const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof RadixDropdownMenu.Label>,
  React.ComponentPropsWithoutRef<typeof RadixDropdownMenu.Label> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <RadixDropdownMenu.Label
    ref={ref}
    className={cn(
      "px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-(--text-muted)",
      inset && "pl-7",
      className,
    )}
    {...props}
  />
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";

export const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof RadixDropdownMenu.Separator>,
  React.ComponentPropsWithoutRef<typeof RadixDropdownMenu.Separator>
>(({ className, ...props }, ref) => (
  <RadixDropdownMenu.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-(--border-subtle)", className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

export function DropdownMenuShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return (
    <span
      className={cn(
        "ml-auto pl-4 font-mono text-[10px] tracking-widest text-(--text-muted)",
        className,
      )}
      {...props}
    />
  );
}

export const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof RadixDropdownMenu.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof RadixDropdownMenu.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <RadixDropdownMenu.SubTrigger
    ref={ref}
    className={cn(itemClasses, "data-[state=open]:bg-(--surface-2)", className)}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto size-3.5" />
  </RadixDropdownMenu.SubTrigger>
));
DropdownMenuSubTrigger.displayName = "DropdownMenuSubTrigger";

export const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof RadixDropdownMenu.SubContent>,
  React.ComponentPropsWithoutRef<typeof RadixDropdownMenu.SubContent>
>(({ className, ...props }, ref) => (
  <RadixDropdownMenu.SubContent
    ref={ref}
    className={cn(
      "z-50 min-w-44 overflow-hidden rounded-md border border-(--border-subtle) bg-(--surface-raised) p-1 shadow-lg shadow-(--gray-12)/10",
      className,
    )}
    {...props}
  />
));
DropdownMenuSubContent.displayName = "DropdownMenuSubContent";
