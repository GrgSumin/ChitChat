import { validateRequest } from "@/auth";

export default async function Home() {
  const { user } = await validateRequest();

  return (
    <div className="bg-card border-border rounded-2xl border p-8">
      <h1 className="text-foreground mb-1 text-xl font-bold">
        Welcome, {user?.displayName}
      </h1>
      <p className="text-muted-foreground text-sm">
        You&apos;re signed in as @{user?.username}. Your feed will appear here.
      </p>
    </div>
  );
}
