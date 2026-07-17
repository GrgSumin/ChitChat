import { validateRequest } from "@/auth";
import prisma from "@/lib/prisma";
import { chatUserSelect } from "@/lib/types";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const { user } = await validateRequest();
    const q = req.nextUrl.searchParams.get("q") || "";

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!q) return Response.json([]);

    const users = await prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: q, mode: "insensitive" } },
          { displayName: { contains: q, mode: "insensitive" } },
        ],
        id: { not: user.id },
      },
      select: chatUserSelect,
      take: 8,
    });

    return Response.json(users);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
