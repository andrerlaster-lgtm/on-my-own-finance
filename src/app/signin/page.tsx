import { redirect } from "next/navigation";
import { ownerOrNull, githubSignInConfigured } from "@/lib/auth";
import { SignInButton } from "@/components/AuthButtons";

export const dynamic = "force-dynamic";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await ownerOrNull()) redirect("/");
  const { error } = await searchParams;
  const configured = githubSignInConfigured();
  return (
    <main className="auth">
      <div className="card auth-card">
        <svg className="mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#2f6b58" /><path d="M9 21c0-6 4-10 14-10 0 8-4 12-10 12-1.6 0-3-.5-4-2z" fill="#faf6ee" /><path d="M9 24c3-6 6-8 10-10" stroke="#2f6b58" strokeWidth="1.6" fill="none" strokeLinecap="round" /></svg>
        <h1>On My Own Finance</h1>
        <p>Private. Only the owner&rsquo;s GitHub account can sign in.</p>
        {error && <p className="err" role="alert">That GitHub account is not allowed, or sign-in failed.</p>}
        {configured ? <SignInButton /> : <p className="err">Sign-in is not set up yet. See docs/SETUP.md.</p>}
      </div>
    </main>
  );
}
