import { z } from "zod";

const requiredString = z.string().trim().min(1, "Required");
export const signUpSchema = z
  .object({
    email: requiredString.email("Invalid email address"),
    username: requiredString.regex(
      /^[a-zA-Z0-9_-]+$/,
      "Only letters, numbers or - and _ allowed",
    ),
    password: requiredString.min(8, "Must be at least 8 characters"),
    confirm: requiredString,
  })
  .refine((data) => data.password === data.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });

export type SignUpValues = z.infer<typeof signUpSchema>;

export const loginSchema = z.object({
  username: requiredString,
  password: requiredString,
});

export type LoginValues = z.infer<typeof loginSchema>;

export const createPostSchema = z.object({
  content: requiredString,
  mediaIds: z
    .array(z.string())
    .max(5, "Maximum 5 media files attachments allowed"),
});

export const updateUserProfileSchema = z.object({
  displayName: requiredString,
  bio: z.string().max(1000, "Must be less that 1000 character"),
});
export type UpdateUserProfileValue = z.infer<typeof updateUserProfileSchema>;

export const createCommentsSchema = z.object({
  content: requiredString,
});

export const createChatSchema = z.object({
  userIds: z.array(requiredString).min(1, "Select at least one user").max(20),
  name: z.string().trim().max(50).optional(),
});

export const sendMessageSchema = z.object({
  chatId: requiredString,
  content: z.string().trim().max(2000),
  attachmentIds: z.array(z.string()).max(5),
});
