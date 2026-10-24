"use client";
import { useFormStatus } from "react-dom";

/** A submit button that turns itself off while its form is being saved, so a double tap cannot enter something twice. */
export function SubmitButton({ children, className = "btn" }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className={className} disabled={pending} aria-busy={pending}>{pending ? "Working…" : children}</button>;
}
