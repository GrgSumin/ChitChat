import { Server } from "socket.io";
import type { Server as HttpServer } from "http";

export function createSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer);

  io.on("connection", (socket) => {
    console.log("socket connected", socket.id);

    socket.on("disconnect", () => {
      console.log("socket disconnected", socket.id);
    });
  });

  return io;
}
