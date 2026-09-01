"use client";

import { useId, type ComponentProps } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type TextFieldProps = Omit<ComponentProps<typeof Input>, "id"> & {
  label: string;
  /** Validation message. Presence switches the field into its invalid state. */
  error?: string;
  description?: string;
};

/**
 * Label + input + error, wired together for assistive technology.
 *
 * The generated id links the label to the input, and `aria-describedby`
 * points at whichever of the description/error is present, so a screen
 * reader announces the failure instead of leaving the user with a field that
 * is silently red. `aria-invalid` is what drives the visual state too, so the
 * two can never disagree.
 *
 * React 19 passes `ref` as an ordinary prop, so this composes directly with
 * React Hook Form's `register()` without `forwardRef`.
 */
export function TextField({ label, error, description, ...props }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;

  const describedBy =
    [error ? errorId : null, description ? descriptionId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  );
}
