import { validateRequest } from "@/auth";
import prisma from "@/lib/prisma";
import { chatUserSelect } from "@/lib/types";

export async function GET() {
  try {
    const { user } = await validateRequest();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const follows = await prisma.follow.findMany({
      where: { followerId: user.id },
      select: { following: { select: chatUserSelect } },
      orderBy: { following: { displayName: "asc" } },
    });

    return Response.json(follows.map((f) => f.following));
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
