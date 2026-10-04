"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";
import { UxieCharacter } from "@uxie/character";

/** Interactive auth parts (HANDOFF §4, §7, §10). */

function AlertIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
      className="mt-0.5 shrink-0"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16.5v.01" />
    </svg>
  );
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Element rendered at the right of the label row (e.g. "Forgot password?" on wide screens). */
  labelAside?: ReactNode;
  trailing?: ReactNode;
};

export function TextField({
  label,
  hint,
  error,
  labelAside,
  trailing,
  className = "",
  ...input
}: InputProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="flex flex-col gap-1.5 lg:gap-2">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-base font-bold text-ink">
          {label}
        </label>
        {labelAside}
      </div>
      <div className="relative">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
          className={`h-[50px] w-full rounded-field bg-surface px-4 text-[17px] text-ink placeholder:text-placeholder read-only:opacity-80 lg:h-[52px] ${
            error ? "border-2 border-danger" : "border-[1.5px] border-line"
          } ${trailing ? "pr-14" : ""} ${className}`}
          {...input}
        />
        {trailing}
      </div>
      {hint && (
        <div id={hintId} className="text-sm text-ink-subtle">
          {hint}
        </div>
      )}
      {error && (
        <p id={errorId} className="flex gap-1.5 text-[15px] font-bold text-danger-ink">
          <AlertIcon />
          {error}
        </p>
      )}
    </div>
  );
}

export function PasswordField(props: Omit<InputProps, "type" | "trailing">) {
  const [shown, setShown] = useState(false);
  return (
    <TextField
      {...props}
      type={shown ? "text" : "password"}
      trailing={
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          className="absolute right-1 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-field text-ink-muted hover:text-ink"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
            {shown && <path d="M3 3l18 18" />}
          </svg>
        </button>
      }
    />
  );
}

/** "At least 10 characters" with an icon that turns into a check (never color alone). */
export function PasswordLengthHint({ value, min }: { value: string; min: number }) {
  const ok = value.length >= min;
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        {ok && <path d="M8 12.5l2.5 2.5L16 9.5" />}
      </svg>
      <span>
        At least {min} characters{ok ? " (met)" : ""}
      </span>
    </span>
  );
}

export function PrimaryButton({
  children,
  pendingLabel,
}: {
  children: ReactNode;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-disabled={pending}
      disabled={pending}
      className="relative inline-flex h-[54px] w-full items-center justify-center gap-2 rounded-field bg-primary text-lg font-bold text-on-primary transition-colors hover:bg-primary-hover active:translate-y-px disabled:bg-primary/60"
    >
      {pending && (
        <span
          aria-hidden="true"
          className="size-[18px] animate-spin rounded-full border-2 border-on-primary border-t-transparent motion-reduce:animate-none"
        />
      )}
      {pending ? pendingLabel : children}
    </button>
  );
}

export function SecondaryButton({
  children,
  ...props
}: { children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="inline-flex h-[54px] w-full items-center justify-center rounded-field border-2 border-primary bg-surface text-lg font-bold text-primary hover:text-primary-hover disabled:opacity-60"
    >
      {children}
    </button>
  );
}

/** Error alert with Pip (puzzled → idle after 2 s); receives focus when it appears (HANDOFF §6.2). */
export function FormAlert({
  title,
  children,
  character = true,
}: {
  title: string;
  children: ReactNode;
  character?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"puzzled" | "idle">("puzzled");
  useEffect(() => {
    ref.current?.focus();
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [title, children]);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="uxie-alert-in flex items-start gap-3 rounded-alert border-[1.5px] border-danger-line bg-danger-bg p-4 outline-none focus-visible:outline-3 focus-visible:outline-primary"
    >
      {character && <UxieCharacter character="pip" state={state} size={56} decorative />}
      <div>
        <p className="font-bold text-danger-ink">{title}</p>
        <p className="text-[16px] leading-[1.45] text-ink">{children}</p>
      </div>
    </div>
  );
}
