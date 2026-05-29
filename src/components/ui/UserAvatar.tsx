import { cn } from "@/lib/utils";
import { UserIcon } from "lucide-react";
import Image from "next/image";

interface UserAvatarProps {
  avatarUrl: string | null | undefined;
  size?: number;
  className?: string;
}

export default function UserAvatar({
  avatarUrl,
  size = 48,
  className,
}: UserAvatarProps) {
  if (!avatarUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className={cn(
          "bg-muted text-muted-foreground flex aspect-square h-fit flex-none items-center justify-center rounded-full",
          className,
        )}
      >
        <UserIcon
          style={{ width: size * 0.6, height: size * 0.6 }}
          strokeWidth={1.75}
        />
      </div>
    );
  }

  return (
    <Image
      src={avatarUrl}
      alt="User Avatar"
      width={size}
      height={size}
      className={cn(
        "aspect-square h-fit flex-none rounded-full object-cover",
        className,
      )}
    />
  );
}
