"use server";
import { getUserDataSelect } from "@/lib/types";

import { validateRequest } from "@/auth";
import prisma from "@/lib/prisma";
import {
  updateUserProfileSchema,
  UpdateUserProfileValue,
} from "@/lib/validation";

export async function updateUserProfile(values: UpdateUserProfileValue) {
  const validatedValues = updateUserProfileSchema.parse(values);

  const { user } = await validateRequest();

  if (!user) throw new Error("Unauthorized");

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: validatedValues,
    select: getUserDataSelect(user.id),
  });

  return updatedUser;
}
