import { Server } from "socket.io";
import type { Server as HttpServer } from "http";
import prisma from "../lib/prisma";
import {
  ChatData,
  chatInclude,
  ChatUser,
  ClientToServerEvents,
  messageInclude,
  ServerToClientEvents,
} from "../lib/types";
import { createChatSchema, sendMessageSchema } from "../lib/validation";

function getCookie(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) return null;

  const match = cookieHeader
    .split("; ")
    .find((part) => part.startsWith(name + "="));
  return match ? match.slice(name.length + 1) : null;
}

const onlineUsers = new Map<string, Set<string>>(); // a Map where each key is a userId, and each value is a Set of that user's socket ids (one per tab). New words: Map = a list of key→value pairs you can add/remove quickly.
export function createSocketServer(httpServer: HttpServer) {
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    { user: ChatUser }
  >(httpServer);

  io.use(async (socket, next) => {
    const sessionId = getCookie(
      socket.handshake.headers.cookie,
      "auth_session",
    );

    if (!sessionId) return next(new Error("Unauthorized"));

    const session = await prisma.session.findUnique({
      where: {
        id: sessionId,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });
    if (!session || session.expiresAt < new Date()) {
      return next(new Error("Unauthorized"));
    }
    socket.data.user = session.user;
    next();
  });

  io.on("connection", async (socket) => {
    const userId = socket.data.user.id;
    const memberships = await prisma.chatParticipant.findMany({
      where: { userId },
      select: { chatId: true },
    });
    for (const m of memberships) {
      socket.join(`chat:${m.chatId}`);
    }

    // was this user already in the register before this tab?
    const wasOnline = onlineUsers.has(userId);

    // get their bag of tabs, or make a new empty bag

    const sockets = onlineUsers.get(userId) ?? new Set<string>();
    sockets.add(socket.id);
    onlineUsers.set(userId, sockets);

    // first tab ever → they just came online → tell everyone else
    if (!wasOnline) {
      socket.broadcast.emit("presence:online", { userId });
    }

    socket.emit("presence:state", [...onlineUsers.keys()]);

    console.log("socket connected", socket.data.user.username);

    socket.on("chat:create", async (data, callback) => {
      try {
        const parsed = createChatSchema.safeParse(data);
        if (!parsed.success) return callback({ error: "Invalid data" });

        const otherIds = [
          ...new Set(parsed.data.userIds.filter((id) => id !== userId)),
        ];
        if (!otherIds.length) {
          return callback({ error: "Select at least one user" });
        }

        const isGroup = otherIds.length > 1;

        const name = parsed.data.name?.trim();

        if (isGroup && !name) {
          return callback({ error: "Group name is required" });
        }
        if (!isGroup) {
          const existing = await prisma.chat.findFirst({
            where: {
              isGroup: false,
              AND: [
                { participants: { some: { userId } } },
                { participants: { some: { userId: otherIds[0] } } },
              ],
            },
            include: chatInclude,
          });
          if (existing) {
            return callback({ chat: { ...existing, unreadCount: 0 } });
          }
        }

        const chat = await prisma.chat.create({
          data: {
            isGroup,
            name: isGroup ? name : null,
            participants: {
              create: [userId, ...otherIds].map((id) => ({ userId: id })),
            },
          },
          include: chatInclude,
        });
        for (const memberId of [userId, ...otherIds]) {
          for (const socketId of onlineUsers.get(memberId) ?? []) {
            io.sockets.sockets.get(socketId)?.join(`chat:${chat.id}`);
          }
        }

        const chatData: ChatData = { ...chat, unreadCount: 0 };
        io.to(`chat:${chat.id}`).emit("chat:new", chatData);
        callback({ chat: chatData });
      } catch (error) {
        console.error("chat:create error", error);
        callback({ error: "Failed to create chat" });
      }
    });

    socket.on("message:send", async (data, callback) => {
      try {
        const parsed = sendMessageSchema.safeParse(data);
        if (!parsed.success) return callback({ error: "Invalid data" });

        const { chatId, attachmentIds, content } = parsed.data;

        if (!content && !attachmentIds.length) {
          return callback({ error: "Message is empty" });
        }

        const membership = await prisma.chatParticipant.findUnique({
          where: { chatId_userId: { chatId, userId } },
        });
        if (!membership) {
          return callback({ error: "You are not a member of this chat" });
        }

        if (attachmentIds.length) {
          const validCount = await prisma.media.count({
            where: {
              id: { in: attachmentIds },
              postId: null,
              messageId: null,
            },
          });
          if (validCount !== attachmentIds.length) {
            return callback({ error: "Invalid attachment" });
          }
        }
        const [message] = await prisma.$transaction([
          prisma.message.create({
            data: {
              content,
              chatId,
              senderId: userId,
              attachments: {
                connect: attachmentIds.map((id) => ({ id })),
              },
            },
            include: messageInclude,
          }),
          prisma.chat.update({
            where: { id: chatId },
            data: { lastMessageAt: new Date() },
          }),
          prisma.chatParticipant.update({
            where: { chatId_userId: { chatId, userId } },
            data: { lastReadAt: new Date() },
          }),
        ]);
        io.to(`chat:${chatId}`).emit("message:new", message);
        callback({});
      } catch (error) {
        console.error("message:send error", error);
        callback({ error: "Failed to send message" });
      }
    });

    socket.on("chat:read", async ({ chatId }) => {
      await prisma.chatParticipant.updateMany({
        where: { chatId, userId },
        data: { lastReadAt: new Date() },
      });
    });

    socket.on("typing:start", ({ chatId }) => {
      socket.to(`chat:${chatId}`).emit("typing", {
        chatId,
        userId,
        displayName: socket.data.user.displayName,
        isTyping: true,
      });
    });

    socket.on("typing:stop", ({ chatId }) => {
      socket.to(`chat:${chatId}`).emit("typing", {
        chatId,
        userId,
        displayName: socket.data.user.displayName,
        isTyping: false,
      });
    });

    socket.on("disconnect", () => {
      const sockets = onlineUsers.get(userId);
      if (!sockets) return;

      sockets.delete(socket.id);

      if (sockets.size === 0) {
        onlineUsers.delete(userId);
        socket.broadcast.emit("presence:offline", { userId });
      }
      console.log("socket disconnected", socket.data.user.username);
    });
  });

  return io;
}
