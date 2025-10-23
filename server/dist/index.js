import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const HOST = process.env.HOST || '127.0.0.1';
const NODE_ENV = process.env.NODE_ENV || 'development';
const app = express();
// CORS for dev; in prod we serve same origin
if (NODE_ENV !== 'production') {
    app.use(cors({ origin: true, credentials: true }));
}
const server = http.createServer(app);
const io = new SocketIOServer(server, NODE_ENV !== 'production'
    ? { cors: { origin: true, credentials: true } }
    : {});
io.on('connection', (socket) => {
    socket.on('join-room', (roomId) => {
        const room = io.sockets.adapter.rooms.get(roomId);
        const size = room ? room.size : 0;
        if (size >= 2) {
            socket.emit('room-full');
            return;
        }
        socket.join(roomId);
        socket.to(roomId).emit('peer-joined');
    });
    socket.on('offer', ({ roomId, sdp }) => {
        socket.to(roomId).emit('offer', sdp);
    });
    socket.on('answer', ({ roomId, sdp }) => {
        socket.to(roomId).emit('answer', sdp);
    });
    socket.on('candidate', ({ roomId, candidate }) => {
        socket.to(roomId).emit('candidate', candidate);
    });
    const notifyLeave = () => {
        for (const roomId of socket.rooms) {
            if (roomId !== socket.id) {
                socket.to(roomId).emit('leave');
            }
        }
    };
    socket.on('leave', notifyLeave);
    socket.on('disconnecting', notifyLeave);
});
// Serve built client in production
if (NODE_ENV === 'production') {
    const clientDist = path.join(__dirname, '../../client/dist');
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => {
        res.sendFile(path.join(clientDist, 'index.html'));
    });
}
server.listen(PORT, HOST, () => {
    console.log(`[server] listening on http://${HOST}:${PORT} (${NODE_ENV})`);
});
//# sourceMappingURL=index.js.map