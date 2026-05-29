import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Notifications",
};

export default function NotificationsPage() {
  return (
    <div className="bg-card border-border rounded-2xl border p-8">
      <h1 className="text-foreground text-xl font-bold">Notifications</h1>
      <p className="text-muted-foreground mt-1 text-sm">Coming soon.</p>
    </div>
  );
}
