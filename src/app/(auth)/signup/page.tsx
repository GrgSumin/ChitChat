import { Metadata } from "next";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import OAuthButtons from "../OAuthButtons";
import SignUpForm from "./SignUpForm";

export const metadata: Metadata = {
  title: "Sign up",
};

function SignUp() {
  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2">
          <div className="bg-primary flex h-8 w-8 items-center justify-center rounded-lg">
            <MessageCircle
              size={16}
              strokeWidth={2.5}
              className="text-primary-foreground"
            />
          </div>
          <span className="text-foreground text-xl font-bold tracking-tight">
            ChitChat
          </span>
        </div>

        <div className="bg-card border-border rounded-2xl border p-8 shadow-sm">
          <h1 className="text-foreground mb-1 text-xl font-bold">
            Create an account
          </h1>
          <p className="text-muted-foreground mb-6 text-sm">
            Join the conversation today
          </p>

          <SignUpForm />

          <OAuthButtons />

          <p className="text-muted-foreground mt-6 text-center text-xs">
            Already have an account?{" "}
            <Link
              href="/login"
              className="text-foreground font-semibold hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default SignUp;
