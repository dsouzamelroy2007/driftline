import Fastify from "fastify";
import { Server as SocketIOServer } from "socket.io";

const PORT = Number(process.env.PORT ?? 4000);

const app = Fastify({ logger: true });

app.get("/health", async () => ({ status: "ok" }));

await app.listen({ port: PORT, host: "0.0.0.0" });

const io = new SocketIOServer(app.server, {
  cors: { origin: "*" },
});

io.on("connection", (socket) => {
  socket.on("ping", () => socket.emit("pong"));
});
