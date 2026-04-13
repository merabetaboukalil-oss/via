import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import { nanoid } from "nanoid";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const ADMIN_PASS = (process.env.ADMIN_PASS || "admin123").trim().replace(/^["']|["']$/g, '');
console.log(`Admin password initialized (${process.env.ADMIN_PASS ? 'from environment' : 'using default: admin123'})`);

interface PCInfo {
  id: string;
  socketId: string;
  name: string;
  ip: string;
  location: {
    city: string;
    country: string;
    lat: number;
    lon: number;
    isPrecise?: boolean;
  };
  isPaired: boolean;
  isRelais?: boolean;
  printers?: Printer[];
}

interface Printer {
  id: string;
  name: string;
  type: 'usb' | 'network';
  status: 'online' | 'offline';
  ip?: string;
}

const connectedPCs = new Map<string, PCInfo>();

async function startServer() {
  const app = express();
  app.set('trust proxy', true);
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Allow all origins to support credentials: true correctly
        callback(null, true);
      },
      methods: ["GET", "POST"],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    perMessageDeflate: {
      threshold: 1024
    },
    maxHttpBufferSize: 1e7,
    pingTimeout: 120000,
    pingInterval: 30000,
    connectTimeout: 60000,
    allowUpgrades: true,
    httpCompression: true
  });

  const PORT = Number(process.env.PORT) || 3000;

  io.on("connection_error", (err) => {
    console.error(`[SOCKET] Connection error (handshake):`, {
      message: err.message,
      context: err.context
    });
  });

  io.on("connection", async (socket) => {
    try {
      const query = socket.handshake.query;
      const role = (Array.isArray(query.role) ? query.role[0] : query.role) || 'unknown';
      
      const forwarded = socket.handshake.headers['x-forwarded-for'];
      let ip = '127.0.0.1';
      try {
        if (typeof forwarded === 'string') {
          ip = forwarded.split(',')[0].trim();
        } else if (Array.isArray(forwarded)) {
          ip = forwarded[0].trim();
        } else {
          ip = socket.handshake.address || '127.0.0.1';
        }
        ip = ip.replace('::ffff:', '');
        if (ip === '::1') ip = '127.0.0.1';
      } catch (e) {
        console.warn("Failed to parse IP, using default", e);
      }
      
      console.log(`[CONN] New connection: ${socket.id} | Role: ${role} | IP: ${ip}`);

      if (role === 'pc') {
        const pcName = (Array.isArray(query.name) ? query.name[0] : query.name) || `PC-${nanoid(4)}`;
        const providedId = Array.isArray(query.id) ? query.id[0] : query.id;
        const validId = (providedId && providedId !== 'null' && providedId !== 'undefined') ? providedId : null;
        
        let location = { city: 'Unknown', country: 'Unknown', lat: 0, lon: 0 };

        // Async geo lookup - don't let it block the main connection flow if it hangs
        const performGeoLookup = async () => {
          try {
            const lookupIp = (ip === '127.0.0.1' || ip === 'localhost' || ip.startsWith('10.') || ip.startsWith('192.168.')) ? '' : ip;
            const geoResponse = await axios.get(`http://ip-api.com/json/${lookupIp}`, { timeout: 2000 });
            if (geoResponse.data && geoResponse.data.status === 'success') {
              const newLocation = {
                city: geoResponse.data.city || 'Unknown',
                country: geoResponse.data.country || 'Unknown',
                lat: geoResponse.data.lat || 0,
                lon: geoResponse.data.lon || 0
              };
              
              const pc = connectedPCs.get(socket.id);
              if (pc) {
                pc.location = { ...pc.location, ...newLocation };
                connectedPCs.set(socket.id, pc);
                io.to('dashboard_room').emit("pc_list_update", Array.from(connectedPCs.values()));
              }
            }
          } catch (err) {
            console.error("[GEO] Lookup failed:", err instanceof Error ? err.message : "timeout");
          }
        };

        const pcInfo: PCInfo = {
          id: validId || nanoid(10),
          socketId: socket.id,
          name: pcName,
          ip: ip,
          location: location,
          isPaired: false
        };

        connectedPCs.set(socket.id, pcInfo);
        socket.join(pcInfo.id);
        console.log(`[PC] Initialized: ${pcInfo.name} (${pcInfo.id})`);
        socket.emit("pc_initialized", pcInfo);
        
        // Start geo lookup in background
        performGeoLookup();
      
      socket.on("request_pc_info", () => {
        const pc = connectedPCs.get(socket.id);
        if (pc) {
          socket.emit("pc_initialized", pc);
        }
      });

      socket.on("rename_pc", (newName: string) => {
        const pc = connectedPCs.get(socket.id);
        if (pc) {
          pc.name = newName;
          connectedPCs.set(socket.id, pc);
          socket.emit("pc_initialized", pc);
          io.to('dashboard_room').emit("pc_list_update", Array.from(connectedPCs.values()));
        }
      });

    socket.on("update_pc_location", async (coords: { lat: number, lon: number }) => {
      const pc = connectedPCs.get(socket.id);
      if (pc) {
        let cityName = pc.location.city;
        try {
          const revGeo = await axios.get(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.lat}&lon=${coords.lon}`, {
            headers: { 'User-Agent': 'VIA-App-Reverse-Geocoding' },
            timeout: 5000
          });
          if (revGeo.data && revGeo.data.address) {
            cityName = revGeo.data.address.city || revGeo.data.address.town || revGeo.data.address.village || revGeo.data.address.suburb || cityName;
          }
        } catch (e) {
          console.error("Reverse geocoding failed", e);
        }

        pc.location = {
          ...pc.location,
          city: cityName,
          lat: coords.lat,
          lon: coords.lon,
          isPrecise: true
        };
        connectedPCs.set(socket.id, pc);
        console.log(`PC ${pc.name} location updated: ${cityName} (${coords.lat}, ${coords.lon})`);
        io.to('dashboard_room').emit("pc_list_update", Array.from(connectedPCs.values()));
      }
    });
      
      // Notify dashboard
      io.to('dashboard_room').emit("pc_list_update", Array.from(connectedPCs.values()));
    }

      if (role === 'dashboard') {
        const pass = (Array.isArray(query.pass) ? query.pass[0] : query.pass || '').trim();
        const isMatch = pass === ADMIN_PASS;
        
        console.log(`[AUTH] Dashboard connection attempt. Pass provided: ${!!pass}, Match: ${isMatch}`);
        
        if (isMatch) {
          console.log("[AUTH] Dashboard authenticated successfully");
          socket.join('dashboard_room');
          socket.emit("pc_list_update", Array.from(connectedPCs.values()));
        } else {
          console.log(`[AUTH] Dashboard authentication failed. Expected length: ${ADMIN_PASS.length}, Received length: ${pass.length}`);
          socket.emit("auth_failed");
          socket.disconnect();
          return;
        }
      }

    socket.on("request_pc_list", () => {
      // Only allow if in dashboard room
      if (socket.rooms.has('dashboard_room')) {
        socket.emit("pc_list_update", Array.from(connectedPCs.values()));
      }
    });

    socket.on("join_pc_room", (pcId) => {
      console.log(`Mobile ${socket.id} joining PC room: ${pcId}`);
      socket.join(pcId);
      socket.emit("joined_room", pcId);
      
      // Log rooms to verify
      console.log(`Socket ${socket.id} rooms:`, Array.from(socket.rooms));
      
      // Notify the PC that a mobile has paired
      io.to(pcId).emit("mobile_paired");
      
      // Update PC status
      for (let pc of connectedPCs.values()) {
        if (pc.id === pcId) {
          pc.isPaired = true;
          console.log(`PC ${pc.name} is now paired with mobile`);
          break;
        }
      }
      io.to('dashboard_room').emit("pc_list_update", Array.from(connectedPCs.values()));
    });

    socket.on("transfer_start", ({ toId, fileName, mimeType, totalChunks, totalSize, transferId, senderName }) => {
      console.log(`[TRANSFER_START] To: ${toId}, File: ${fileName}, Chunks: ${totalChunks}, ID: ${transferId}`);
      io.to(toId).emit("transfer_started", { fileName, mimeType, totalChunks, totalSize, fromId: socket.id, transferId, senderName });
    });

    socket.on("transfer_ready", ({ toId, transferId }) => {
      console.log(`[TRANSFER_READY] To: ${toId}, ID: ${transferId}`);
      io.to(toId).emit("transfer_ready", { transferId });
    });

    socket.on("transfer_chunk", ({ toId, chunkIndex, chunkData, transferId }) => {
      // Forward chunk to target
      io.to(toId).emit("transfer_chunk_received", { chunkIndex, chunkData, fromId: socket.id, transferId });
    });

    socket.on("transfer_chunk_ack", ({ toId, chunkIndex, transferId }) => {
      io.to(toId).emit("transfer_chunk_acked", { chunkIndex, transferId });
    });

    socket.on("transfer_complete", ({ toId, transferId }) => {
      console.log(`[TRANSFER_COMPLETE] To: ${toId}, ID: ${transferId}`);
      io.to(toId).emit("transfer_finished", { transferId });
    });

    socket.on("transfer_pause", ({ toId, transferId }) => {
      io.to(toId).emit("transfer_paused", { fromId: socket.id, transferId });
    });

    socket.on("transfer_resume", ({ toId, transferId }) => {
      io.to(toId).emit("transfer_resumed", { fromId: socket.id, transferId });
    });

    socket.on("pc_to_pc_transfer", ({ fromId, toId, data, type = 'link', fileName, mimeType }) => {
      console.log(`[TRANSFER] From: ${fromId} To: ${toId} Type: ${type} Name: ${fileName || 'N/A'}`);
      
      let targetSocketId = null;
      for (const [sid, pc] of connectedPCs.entries()) {
        if (pc.id === toId) {
          targetSocketId = sid;
          break;
        }
      }

      if (targetSocketId) {
        // Emit ONLY to the room. The PC socket is already in this room.
        // This prevents double delivery.
        io.to(toId).emit("data_received", { data, type, fromId, fileName, mimeType });
        socket.emit("transfer_sent_to_server", { toId, success: true });
      } else {
        console.error(`[ERROR] Target ${toId} not found`);
        socket.emit("transfer_sent_to_server", { toId, success: false, error: "Machine cible hors ligne" });
      }
    });

    socket.on("delete_pc", (pcId) => {
      console.log(`[DELETE] Request for PC: ${pcId}`);
      let socketToDisconnect = null;
      for (const [sid, pc] of connectedPCs.entries()) {
        if (pc.id === pcId) {
          socketToDisconnect = sid;
          break;
        }
      }

      if (socketToDisconnect) {
        const socketObj = io.sockets.sockets.get(socketToDisconnect);
        if (socketObj) socketObj.disconnect();
        connectedPCs.delete(socketToDisconnect);
        io.to('dashboard_room').emit("pc_list_update", Array.from(connectedPCs.values()));
      }
    });

    socket.on("delete_selected_pcs", (pcIds: string[]) => {
      console.log(`[DELETE_MANY] Request for: ${pcIds.join(', ')}`);
      pcIds.forEach(pcId => {
        for (const [sid, pc] of connectedPCs.entries()) {
          if (pc.id === pcId) {
            const socketObj = io.sockets.sockets.get(sid);
            if (socketObj) socketObj.disconnect();
            connectedPCs.delete(sid);
            break;
          }
        }
      });
      io.to('dashboard_room').emit("pc_list_update", Array.from(connectedPCs.values()));
    });

    socket.on("trigger_mobile_scan", ({ pcId }) => {
      // Notify the paired mobile in that PC room to start scanning
      io.to(pcId).emit("start_mobile_scan");
    });

    socket.on("send_to_pc", ({ pcId, data, type, fileName, mimeType }) => {
      console.log(`Transfer request: Sending ${type} to room ${pcId}. Data length: ${data?.length || 0}`);
      io.to(pcId).emit("data_received", { data, type, fileName, mimeType });
      socket.emit("transfer_success"); // Acknowledge to sender
    });

    socket.on("mobile_update_location", async ({ pcId, lat, lon }) => {
      console.log(`Mobile updating location for PC ${pcId}: ${lat}, ${lon}`);
      
      let cityName = 'Unknown';
      try {
        const revGeo = await axios.get(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`, {
          headers: { 'User-Agent': 'VIA-App-Reverse-Geocoding' }
        });
        if (revGeo.data && revGeo.data.address) {
          cityName = revGeo.data.address.city || revGeo.data.address.town || revGeo.data.address.village || revGeo.data.address.suburb || 'Unknown';
        }
      } catch (e) {
        console.error("Reverse geocoding failed", e);
      }

      // Update the PC info in our map
      for (let pc of connectedPCs.values()) {
        if (pc.id === pcId) {
          pc.location = {
            ...pc.location,
            city: cityName !== 'Unknown' ? cityName : pc.location.city,
            lat,
            lon,
            isPrecise: true
          };
          connectedPCs.set(pc.socketId, pc);
          console.log(`PC ${pc.name} location updated via mobile: ${cityName}`);
          break;
        }
      }
      // Notify dashboard
      io.to('dashboard_room').emit("pc_list_update", Array.from(connectedPCs.values()));
    });

    socket.on("broadcast_all", (url) => {
      console.log(`Broadcasting URL to all: ${url}`);
      io.emit("data_received", { data: url, type: 'link' });
    });

    // --- VIA PRINTER SYSTEM EVENTS ---
    
    socket.on("register_relais", (relaisInfo: { id: string, name: string }) => {
      const pc = connectedPCs.get(socket.id);
      if (pc) {
        pc.isRelais = true;
        pc.name = relaisInfo.name || pc.name;
        connectedPCs.set(socket.id, pc);
        console.log(`[VIA] PC ${pc.name} registered as Relais Agent`);
        io.to('dashboard_room').emit("pc_list_update", Array.from(connectedPCs.values()));
      }
    });

    socket.on("update_printers", (printers: Printer[]) => {
      const pc = connectedPCs.get(socket.id);
      if (pc) {
        pc.printers = printers;
        connectedPCs.set(socket.id, pc);
        console.log(`[VIA] PC ${pc.name} updated printer list (${printers.length} printers)`);
        io.to('dashboard_room').emit("pc_list_update", Array.from(connectedPCs.values()));
      }
    });

    socket.on("print_test_page", ({ relaisId, printerName }) => {
      console.log(`[VIA] Test page request for printer ${printerName} on relais ${relaisId}`);
      let targetSocketId = null;
      for (const [sid, pc] of connectedPCs.entries()) {
        if (pc.id === relaisId) {
          targetSocketId = sid;
          break;
        }
      }

      if (targetSocketId) {
        io.to(targetSocketId).emit("print_test_page", { printerName });
      }
    });

    socket.on("print_request", ({ printerId, relaisId, fileData, fileName }) => {
      console.log(`[VIA] Print request for printer ${printerId} on relais ${relaisId}`);
      // Find the relais socket
      let targetSocketId = null;
      for (const [sid, pc] of connectedPCs.entries()) {
        if (pc.id === relaisId) {
          targetSocketId = sid;
          break;
        }
      }

      if (targetSocketId) {
        io.to(targetSocketId).emit("incoming_print_job", { printerId, fileData, fileName });
        socket.emit("print_status", { success: true, message: "Job envoyé au relais" });
      } else {
        socket.emit("print_status", { success: false, error: "Relais hors ligne" });
      }
    });

      socket.on("disconnect", () => {
        if (connectedPCs.has(socket.id)) {
          connectedPCs.delete(socket.id);
          io.to('dashboard_room').emit("pc_list_update", Array.from(connectedPCs.values()));
        }
        console.log("User disconnected:", socket.id);
      });
    } catch (err) {
      console.error("CRITICAL: Socket connection handler crashed:", err);
      socket.disconnect();
    }
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
