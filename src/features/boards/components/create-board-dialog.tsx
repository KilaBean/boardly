"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useCreateBoard } from "@/features/boards/queries";

const formSchema = z.object({
  name: z.string().trim().min(1, "Board name is required").max(120),
  visibility: z.enum(["workspace", "private"]),
});

type FormValues = z.infer<typeof formSchema>;

export function CreateBoardDialog({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const createBoard = useCreateBoard(workspaceId);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", visibility: "workspace" },
  });

  // See create-workspace-dialog: useWatch keeps React Compiler enabled.
  const visibility = useWatch({ control, name: "visibility" });

  async function onSubmit(values: FormValues) {
    const created = await createBoard.mutateAsync(values);
    reset();
    setOpen(false);
    // Straight into the board: creating one is almost always a prelude to
    // drawing on it.
    router.push(`/board/${created.id}`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden="true" />
          New board
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create board</DialogTitle>
          <DialogDescription>Give it a name. You can rename it at any time.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <TextField
            label="Board name"
            placeholder="Q3 Roadmap"
            autoFocus
            error={errors.name?.message}
            {...register("name")}
          />

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Who can open it</legend>
            <div className="grid gap-2">
              {(
                [
                  {
                    value: "workspace",
                    title: "Everyone in the workspace",
                    hint: "Members can view and edit.",
                  },
                  {
                    value: "private",
                    title: "Only me",
                    hint: "Invite people individually later.",
                  },
                ] as const
              ).map((option) => (
                <label
                  key={option.value}
                  className="hover:bg-accent has-[:checked]:border-primary flex cursor-pointer items-start gap-3 rounded-md border p-3"
                >
                  <input
                    type="radio"
                    value={option.value}
                    checked={visibility === option.value}
                    onChange={() => setValue("visibility", option.value)}
                    className="accent-primary mt-1"
                    name="visibility"
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">{option.title}</span>
                    <span className="text-muted-foreground block text-xs">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <Button type="submit" className="w-full" disabled={createBoard.isPending}>
            {createBoard.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            {createBoard.isPending ? "Creating…" : "Create board"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
