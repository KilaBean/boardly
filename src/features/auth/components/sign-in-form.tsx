"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { signInAction, signInWithGoogleAction } from "@/features/auth/actions";
import { rethrowIfNavigation, UNEXPECTED_ERROR } from "@/lib/forms/action-error";
import { signInSchema, type SignInInput } from "@/lib/validation/auth";

import { GoogleButton } from "./google-button";

export function SignInForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [formError, setFormError] = useState<string | null>(initialError ?? null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  function onSubmit(values: SignInInput) {
    setFormError(null);
    startTransition(async () => {
      try {
        // On success this redirects, so control never returns here.
        const result = await signInAction(values, next);
        if ("error" in result) setFormError(result.error);
      } catch (error) {
        rethrowIfNavigation(error);
        setFormError(UNEXPECTED_ERROR);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-muted-foreground text-sm">Sign in to your Boardly account</p>
      </div>

      {formError ? (
        // role="alert" so the failure is announced, not just recoloured.
        <Alert variant="destructive" role="alert">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <GoogleButton
        label="Continue with Google"
        onClick={() =>
          startTransition(async () => {
            try {
              const result = await signInWithGoogleAction(next);
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
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          error={errors.email?.message}
          {...register("email")}
        />

        <div className="space-y-2">
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register("password")}
          />
          <div className="text-right">
            <Link
              href="/forgot-password"
              className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
            >
              Forgot password?
            </Link>
          </div>
        </div>

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="text-muted-foreground text-center text-sm">
        Don&apos;t have an account?{" "}
        <Link href="/sign-up" className="text-foreground underline underline-offset-4">
          Sign up
        </Link>
      </p>
    </div>
  );
}
