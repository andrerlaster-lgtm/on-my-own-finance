import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

// The sign-in endpoints themselves; access is decided by the signIn callback (owner's GitHub ID only).
const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
