import { validateRequest } from "@/auth";
import prisma from "@/lib/prisma";
import { messageInclude, MessagesPage } from "@/lib/types";
import { NextRequest } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> },
) {
  try {
    const { user } = await validateRequest();
    const { chatId } = await params;
    const cursor = req.nextUrl.searchParams.get("cursor") || undefined;
    const pageSize = 20;
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const membership = await prisma.chatParticipant.findUnique({
      where: {
        chatId_userId: { chatId, userId: user.id },
      },
    });
    if (!membership) {
      return Response.json(
        { error: "You are not a member of this chat" },
        { status: 403 },
      );
    }

    const messageHistory = await prisma.message.findMany({
      where: {
        chatId,
      },
      include: messageInclude,
      take: -pageSize - 1,
      orderBy: { createdAt: "asc" },
      cursor: cursor ? { id: cursor } : undefined,
    });
    const previousCursor =
      messageHistory.length > pageSize ? messageHistory[0].id : null;

    const data: MessagesPage = {
      messages:
        messageHistory.length > pageSize
          ? messageHistory.slice(1)
          : messageHistory,

      previousCursor: previousCursor,
    };

    return Response.json(data);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
