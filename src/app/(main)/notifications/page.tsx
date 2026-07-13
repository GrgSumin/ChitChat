import { Metadata } from "next";
import Notifications from "./Notifications";

export const metadata: Metadata = {
  title: "Notifications",
};

export default function NotificationsPage() {
  return (
    <div className="bg-card border-border rounded-2xl border p-8">
      <h1 className="text-foreground text-xl font-bold">Notifications</h1>
      <div className="">
        <Notifications />
      </div>
    </div>
  );
}
