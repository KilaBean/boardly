"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createWorkspaceAction } from "@/features/workspaces/actions";
import { rethrowIfNavigation, UNEXPECTED_ERROR } from "@/lib/forms/action-error";
import { slugify } from "@/lib/workspaces/slug";

// Only the name is collected; the slug is derived. Letting users hand-craft a
// slug up front is a decision they have no context for yet, and it is
// changeable later in workspace settings.
const formSchema = z.object({
  name: z.string().trim().min(1, "Workspace name is required").max(80),
});

type FormValues = z.infer<typeof formSchema>;

export function CreateWorkspaceDialog({
  trigger,
  /** Rendered inline rather than in a dialog, for the onboarding page. */
  inline = false,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: ReactNode;
  inline?: boolean;
  /** Omit for an uncontrolled dialog driven by `trigger`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);

  // Controlled when a parent supplies `open` (e.g. opened from a menu item),
  // uncontrolled when it just passes a trigger.
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [formError, setFormError] = useState<string | null>(null);
  const router = useRouter();

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "" },
  });

  // `useWatch` rather than `watch()`: the latter returns a fresh function each
  // render, so React Compiler bails out of memoizing the whole component.
  const name = useWatch({ control, name: "name" }) ?? "";
  const slugPreview = name.trim() ? slugify(name) : "";

  async function onSubmit(values: FormValues) {
    setFormError(null);
    try {
      const result = await createWorkspaceAction(values);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      toast.success("Workspace created");
      reset();
      setOpen(false);
      router.push(`/w/${result.data.slug}`);
      router.refresh();
    } catch (error) {
      rethrowIfNavigation(error);
      setFormError(UNEXPECTED_ERROR);
    }
  }

  const form = (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      {formError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <TextField
        label="Workspace name"
        placeholder="Acme Design"
        autoFocus
        error={errors.name?.message}
        description={slugPreview ? `Address: /w/${slugPreview}` : "You can rename this later."}
        {...register("name")}
      />

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {isSubmitting ? "Creating…" : "Create workspace"}
      </Button>
    </form>
  );

  if (inline) return form;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create workspace</DialogTitle>
          <DialogDescription>
            Workspaces keep boards and collaborators grouped together.
          </DialogDescription>
        </DialogHeader>
        {form}
        <DialogFooter className="sr-only">
          <span>Press Escape to close</span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
