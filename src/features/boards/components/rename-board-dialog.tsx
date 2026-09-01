"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BoardSummary } from "@/features/boards/data";
import { useRenameBoard } from "@/features/boards/queries";

const formSchema = z.object({
  name: z.string().trim().min(1, "Board name is required").max(120),
});

type FormValues = z.infer<typeof formSchema>;

export function RenameBoardDialog({
  board,
  workspaceId,
  open,
  onOpenChange,
}: {
  board: BoardSummary;
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const renameBoard = useRenameBoard(workspaceId);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: board.name },
  });

  // The card stays mounted across renames, so reset when reopening — otherwise
  // the field would still hold the value from the previous edit.
  useEffect(() => {
    if (open) reset({ name: board.name });
  }, [open, board.name, reset]);

  async function onSubmit(values: FormValues) {
    if (values.name !== board.name) {
      await renameBoard.mutateAsync({ boardId: board.id, name: values.name });
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename board</DialogTitle>
          <DialogDescription>Everyone with access will see the new name.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <TextField
            label="Board name"
            autoFocus
            error={errors.name?.message}
            {...register("name")}
          />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={renameBoard.isPending}>
              {renameBoard.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
