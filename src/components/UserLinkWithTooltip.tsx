"use client";

import kyInstance from "@/lib/ky";
import { UserData } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";
import { HTTPError } from "ky";
import Link from "next/link";
import { PropsWithChildren } from "react";
import UserTooltip from "./UserTooltip";

interface UserLinkWithTooltipProps extends PropsWithChildren {
  username: string;
}

export default function UserLinkWithTooltip({
  children,
  username,
}: UserLinkWithTooltipProps) {
  const { data } = useQuery({
    queryKey: ["user-data", username],
    queryFn: () =>
      kyInstance.get(`/api/users/username/${username}`).json<UserData>(),
    retry(failureCount, error) {
      if (error instanceof HTTPError && error.response.status === 404) {
        return false;
      }
      return failureCount < 3;
    },
    staleTime: Infinity,
  });

  // data is undefined (still loading or user not found) → plain link, no tooltip
  if (!data) {
    return (
      <Link
        href={`/users/${username}`}
        className="text-blue-500 hover:underline"
      >
        {children}
      </Link>
    );
  }

  // past the guard, data is narrowed to UserData → tooltip is valid
  return (
    <UserTooltip user={data}>
      <Link
        href={`/users/${username}`}
        className="text-blue-500 hover:underline"
      >
        {children}
      </Link>
    </UserTooltip>
  );
}
