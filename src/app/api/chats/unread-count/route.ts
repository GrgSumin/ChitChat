import { validateRequest } from "@/auth";
import prisma from "@/lib/prisma";
import { MessagesCountInfo } from "@/lib/types";

export async function GET() {
  try {
    const { user } = await validateRequest();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const membership = await prisma.chatParticipant.findMany({
      where: { userId: user.id },
      select: { chatId: true, lastReadAt: true },
    });

    const counts = await Promise.all(
      membership.map((m) =>
        prisma.message.count({
          where: {
            chatId: m.chatId,
            senderId: { not: user.id },
            createdAt: { gt: m.lastReadAt },
          },
        }),
      ),
    );

    const unreadCount = counts.reduce((sum, n) => sum + n, 0);
    const data: MessagesCountInfo = { unreadCount };
    return Response.json(data);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
