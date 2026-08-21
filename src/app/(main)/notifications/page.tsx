import { Metadata } from "next";
import Notifications from "./Notifications";

export const metadata: Metadata = {
  title: "Notifications",
};

export default function NotificationsPage() {
  return (
    <div className="w-full min-w-0 space-y-4">
      <div className="bg-card border-border rounded-2xl border p-5 shadow-sm">
        <h1 className="text-foreground text-xl font-bold">Notifications</h1>
      </div>
      <Notifications />
    </div>
  );
}
