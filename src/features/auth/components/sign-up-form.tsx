"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { signInWithGoogleAction, signUpAction } from "@/features/auth/actions";
import { rethrowIfNavigation, UNEXPECTED_ERROR } from "@/lib/forms/action-error";
import { signUpSchema, type SignUpInput } from "@/lib/validation/auth";

import { GoogleButton } from "./google-button";

export function SignUpForm() {
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { displayName: "", email: "", password: "", confirmPassword: "" },
  });

  function onSubmit(values: SignUpInput) {
    setFormError(null);
    startTransition(async () => {
      try {
        const result = await signUpAction(values);
        if ("error" in result) {
          setFormError(result.error);
        } else if (result.message) {
          setConfirmation(result.message);
        }
      } catch (error) {
        rethrowIfNavigation(error);
        setFormError(UNEXPECTED_ERROR);
      }
    });
  }

  // Terminal success state: the account may exist but needs email confirmation,
  // so there is nothing further to do on this page.
  if (confirmation) {
    return (
      <div className="space-y-6 text-center">
        <CheckCircle2 className="text-primary mx-auto size-10" aria-hidden="true" />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Almost there</h1>
          <p className="text-muted-foreground text-sm">{confirmation}</p>
        </div>
        <Button asChild variant="outline" className="w-full">
          <Link href="/sign-in">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-muted-foreground text-sm">Start collaborating on Boardly</p>
      </div>

      {formError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <GoogleButton
        label="Sign up with Google"
        onClick={() =>
          startTransition(async () => {
            try {
              const result = await signInWithGoogleAction();
              if ("error" in result) setFormError(result.error);
            } catch (error) {
              rethrowIfNavigation(error);
              setFormError(UNEXPECTED_ERROR);
            }
          })
        }
        disabled={isPending}
      />

      <div className="flex items-center gap-3">
        <span className="bg-border h-px flex-1" />
        <span className="text-muted-foreground text-xs uppercase">or</span>
        <span className="bg-border h-px flex-1" />
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <TextField
          label="Name"
          autoComplete="name"
          placeholder="Ada Lovelace"
          error={errors.displayName?.message}
          {...register("displayName")}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          error={errors.email?.message}
          {...register("email")}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          description="At least 8 characters."
          error={errors.password?.message}
          {...register("password")}
        />
        <TextField
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register("confirmPassword")}
        />

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {isPending ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="text-muted-foreground text-center text-sm">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
