"use client";
import { signIn, signOut } from "next-auth/react";

export function SignInButton() {
  return <button className="btn" onClick={() => signIn("github", { callbackUrl: "/" })}>Sign in with GitHub</button>;
}
export function SignOutButton() {
  return <button className="btn secondary" onClick={() => signOut({ callbackUrl: "/signin" })}>Sign out</button>;
}
