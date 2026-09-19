import { cn } from "@/lib/utils";

export function TabBar<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { id: T; label: string }[];
  className?: string;
}) {
  return (
    <div className={cn("flex gap-0 overflow-x-auto border-b border-border px-2", className)}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={cn(
            "h-11 shrink-0 px-3 text-xs font-medium capitalize transition-colors",
            value === o.id
              ? "text-foreground shadow-[inset_0_-1px_0_0_var(--color-accent)]"
              : "text-muted hover:text-foreground",
          )}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
