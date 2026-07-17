import { validateRequest } from "@/auth";
import prisma from "@/lib/prisma";
import { chatInclude, ChatsPage } from "@/lib/types";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const { user } = await validateRequest();
    const pageSize = 10;
    const cursor = req.nextUrl.searchParams.get("cursor") || undefined;

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const chats = await prisma.chat.findMany({
      where: {
        participants: { some: { userId: user.id } },
      },
      include: chatInclude,
      orderBy: { lastMessageAt: "desc" },
      take: pageSize + 1,
      cursor: cursor ? { id: cursor } : undefined,
    });
    const nextCursor = chats.length > pageSize ? chats[pageSize].id : null;

    const chatsWithUnread = await Promise.all(
      chats.slice(0, pageSize).map(async (chat) => {
        const me = chat.participants.find((p) => p.userId === user.id);
        const unreadCount = await prisma.message.count({
          where: {
            chatId: chat.id,
            senderId: { not: user.id },
            createdAt: { gt: me?.lastReadAt ?? new Date(0) },
          },
        });
        return { ...chat, unreadCount };
      }),
    );

    const data: ChatsPage = {
      chats: chatsWithUnread,
      nextCursor,
    };

    return Response.json(data);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
