import { Metadata } from "next";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import LoginForm from "./LoginForm";
import GoogleSigninButton from "./GoogleSignInButton";

export const metadata: Metadata = {
  title: "Login",
};

function Login() {
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
            Welcome back
          </h1>
          <p className="text-muted-foreground mb-6 text-sm">
            Sign in to your account to continue
          </p>
          <GoogleSigninButton />
          <div className="flex items-center gap-3">
            <div className="bg-muted h-px flex-1" />
            <span>OR</span>
            <div className="bg-muted h-px flex-1" />
          </div>

          <LoginForm />

          <p className="text-muted-foreground mt-6 text-center text-xs">
            Don&apos;t have an account?{" "}
            <Link
              href="/signup"
              className="text-foreground font-semibold hover:underline"
            >
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
