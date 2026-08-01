"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, getDefaultClassNames } from "react-day-picker";
import type { ComponentProps } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Calendar({ className, classNames, showOutsideDays = true, ...props }: ComponentProps<typeof DayPicker>) {
  const defaults = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("bg-popover p-3 text-popover-foreground", className)}
      classNames={{
        root: cn("relative w-fit", defaults.root),
        months: cn("flex flex-col gap-4 sm:flex-row", defaults.months),
        month: cn("space-y-4", defaults.month),
        month_caption: cn("flex h-9 items-center justify-center text-sm font-medium", defaults.month_caption),
        nav: cn("absolute inset-x-3 top-3 flex items-center justify-between", defaults.nav),
        button_previous: cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), defaults.button_previous),
        button_next: cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), defaults.button_next),
        month_grid: cn("w-full border-collapse", defaults.month_grid),
        weekdays: cn("grid grid-cols-7", defaults.weekdays),
        weekday: cn("w-9 text-center text-xs font-normal text-muted-foreground", defaults.weekday),
        week: cn("mt-1 grid grid-cols-7", defaults.week),
        day: cn("relative size-9 p-0 text-center text-sm", defaults.day),
        day_button: cn(
          "size-9 rounded-md text-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          defaults.day_button,
        ),
        range_start: cn("rounded-l-md bg-primary text-primary-foreground", defaults.range_start),
        range_middle: cn("rounded-none bg-accent text-accent-foreground", defaults.range_middle),
        range_end: cn("rounded-r-md bg-primary text-primary-foreground", defaults.range_end),
        selected: cn("bg-primary text-primary-foreground", defaults.selected),
        today: cn("font-semibold ring-1 ring-ring", defaults.today),
        outside: cn("text-muted-foreground opacity-50", defaults.outside),
        disabled: cn("pointer-events-none text-muted-foreground opacity-40", defaults.disabled),
        hidden: cn("invisible", defaults.hidden),
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClassName }) => orientation === "left"
          ? <ChevronLeft aria-hidden="true" className={cn("size-4", chevronClassName)} />
          : <ChevronRight aria-hidden="true" className={cn("size-4", chevronClassName)} />,
      }}
      {...props}
    />
  );
}
