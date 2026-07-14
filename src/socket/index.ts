import { Server } from "socket.io";
import type { Server as HttpServer } from "http";
import prisma from "../lib/prisma";
import {
  ChatUser,
  ClientToServerEvents,
  ServerToClientEvents,
} from "../lib/types";

function getCookie(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) return null;

  const match = cookieHeader
    .split("; ")
    .find((part) => part.startsWith(name + "="));
  return match ? match.slice(name.length + 1) : null;
}

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

  io.on("connection", (socket) => {
    console.log("socket connected", socket.id);

    socket.on("disconnect", () => {
      console.log("socket disconncted", socket.id);
    });
  });

  return io;
}
