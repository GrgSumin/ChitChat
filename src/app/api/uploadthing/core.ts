import { validateRequest } from "@/auth";
import prisma from "@/lib/prisma";
import { createUploadthing, FileRouter } from "uploadthing/next";
import { UploadThingError, UTApi } from "uploadthing/server";

const f = createUploadthing();

export const fileRouter = {
  avatar: f({
    image: { maxFileSize: "512KB" },
  })
    .middleware(async () => {
      const { user } = await validateRequest();
      if (!user) throw new UploadThingError("Unauthorized");
      return { user };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      const oldAvatarUrl = metadata.user.avatarUrl;

      if (oldAvatarUrl) {
        const key = oldAvatarUrl.split("/f/")[1];
        await new UTApi().deleteFiles(key);
      }
      // save the new photo's URL onto the logged-in user
      await prisma.user.update({
        where: { id: metadata.user.id }, // which user (from middleware)
        data: { avatarUrl: file.ufsUrl }, // the new photo link (v7 gives it directly)
      });

      // hand the new URL back to the browser so the UI can show it
      return { avatarUrl: file.ufsUrl };
    }),
  attachments: f({
    image: { maxFileSize: "4MB", maxFileCount: 5 },
    video: { maxFileSize: "1024MB", maxFileCount: 5 },
  })
    .middleware(async () => {
      const { user } = await validateRequest();
      if (!user) throw new UploadThingError("Unauthorized");
      return { userID: user.id };
    })
    .onUploadComplete(async ({ file }) => {
      const media = await prisma.media.create({
        data: {
          url: file.ufsUrl,
          type: file.type.startsWith("image") ? "IMAGE" : "VIDEO",
        },
      });
      return { mediaId: media.id };
    }),
} satisfies FileRouter;

export type AppFileRouter = typeof fileRouter;
