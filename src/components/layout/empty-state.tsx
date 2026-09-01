import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Empty states are a product surface, not a fallback. Each one names what is
 * missing and offers the single action that resolves it, so a new user is
 * never left looking at a blank panel wondering what to do.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-16 text-center">
      <div className="bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-full">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-base font-semibold tracking-tight">{title}</h2>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm text-pretty">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
