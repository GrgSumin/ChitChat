import "dotenv/config";
import { createServer } from "http";
import next from "next";
import { createSocketServer } from "./src/socket";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();
const port = parseInt(process.env.PORT || "3000", 10);

app.prepare().then(() => {
  const httpServer = createServer(handle);

  createSocketServer(httpServer);

  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
