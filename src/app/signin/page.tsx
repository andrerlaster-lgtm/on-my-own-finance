import { redirect } from "next/navigation";
import { ownerOrNull, githubSignInConfigured } from "@/lib/auth";
import { SignInButton } from "@/components/AuthButtons";

export const dynamic = "force-dynamic";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await ownerOrNull()) redirect("/");
  const { error } = await searchParams;
  const configured = githubSignInConfigured();
  return (
    <main>
      <h1>On My Own Finance</h1>
      <div className="card">
        <p>Private. Only the owner's GitHub account can sign in.</p>
        {error && <p className="err">That GitHub account is not allowed, or sign-in failed.</p>}
        {configured ? <SignInButton /> : <p className="err">Sign-in is not set up yet. See docs/SETUP.md.</p>}
      </div>
    </main>
  );
}
