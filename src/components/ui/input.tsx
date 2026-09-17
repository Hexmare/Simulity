import { cn } from "@/lib/utils";
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)] outline-none placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
      suppressHydrationWarning
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full rounded-md bg-card-2 px-3 py-2 text-sm text-foreground shadow-[var(--shadow-border)] outline-none placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}
