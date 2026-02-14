const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const path = require('path');
const app = express();
app.use(cors());

// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../client/dist')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// For any other request, send back the index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const players = {};

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Create new player
  players[socket.id] = {
    id: socket.id,
    x: Math.random() * 800 - 400,
    y: Math.random() * 600 - 300,
    angle: 0,
    turretAngle: 0,
    color: '#' + Math.floor(Math.random()*16777215).toString(16)
  };

  // Send current players to the new player
  socket.emit('currentPlayers', players);

  // Inform other players about the new player
  socket.broadcast.emit('newPlayer', players[socket.id]);

  socket.on('playerMovement', (movementData) => {
    if (players[socket.id]) {
      players[socket.id].x = movementData.x;
      players[socket.id].y = movementData.y;
      players[socket.id].angle = movementData.angle;
      players[socket.id].turretAngle = movementData.turretAngle;
      
      // Broadcast movement to all other players
      socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });

  socket.on('fire', (bulletData) => {
    socket.broadcast.emit('bulletFired', {
      ...bulletData,
      playerId: socket.id
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
