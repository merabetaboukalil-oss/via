import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import { nanoid } from "nanoid";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Socket.io logic
  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    // PC client requests a session
    socket.on("request_session", () => {
      const sessionId = nanoid(10);
      socket.join(sessionId);
      socket.emit("session_created", sessionId);
      console.log(`Session created: ${sessionId} for socket ${socket.id}`);
    });

    // Mobile client joins a session
    socket.on("join_session", (sessionId) => {
      socket.join(sessionId);
      io.to(sessionId).emit("mobile_connected");
      console.log(`Mobile joined session: ${sessionId}`);
    });

    // Mobile sends file link to PC
    socket.on("send_to_pc", ({ sessionId, url }) => {
      console.log(`Sending URL to session ${sessionId}: ${url}`);
      io.to(sessionId).emit("file_received", url);
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
