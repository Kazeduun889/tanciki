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
const obstacles = {};

// Initialize some obstacles
for (let i = 0; i < 10; i++) {
  const id = Math.random().toString(36).substr(2, 9);
  obstacles[id] = {
    id: id,
    x: Math.random() * 1600 - 800,
    y: Math.random() * 1200 - 600,
    health: 50,
    color: 0x888888
  };
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Create new player
  players[socket.id] = {
    id: socket.id,
    x: Math.random() * 1600 - 800,
    y: Math.random() * 1200 - 600,
    rotation: 0,
    turretRotation: 0,
    color: Math.random() * 0xffffff,
    health: 100,
    xp: 0,
    level: 1
  };

  // Send current players and obstacles to the new player
  socket.emit('currentPlayers', players);
  socket.emit('currentObstacles', obstacles);

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

  socket.on('bulletHit', (data) => {
    const { targetId, type, damage, shooterId } = data;
    
    if (type === 'obstacle' && obstacles[targetId]) {
      obstacles[targetId].health -= damage;
      if (obstacles[targetId].health <= 0) {
        // Give XP to shooter
        if (players[shooterId]) {
          players[shooterId].xp += 10;
          if (players[shooterId].xp >= players[shooterId].level * 50) {
            players[shooterId].level += 1;
            players[shooterId].health = 100; // Heal on level up
            io.emit('playerLevelUp', { id: shooterId, level: players[shooterId].level });
          }
          io.emit('playerXPUpdate', { id: shooterId, xp: players[shooterId].xp });
        }

        const oldId = targetId;
        delete obstacles[oldId];
        io.emit('obstacleDestroyed', oldId);
        
        // Respawn obstacle
        const newId = Math.random().toString(36).substr(2, 9);
        obstacles[newId] = {
          id: newId,
          x: Math.random() * 1600 - 800,
          y: Math.random() * 1200 - 600,
          health: 50,
          color: 0x888888
        };
        io.emit('newObstacle', obstacles[newId]);
      } else {
        io.emit('obstacleHit', { id: targetId, health: obstacles[targetId].health });
      }
    }

    if (type === 'player' && players[targetId]) {
      players[targetId].health -= damage;
      if (players[targetId].health <= 0) {
        // Give more XP for killing player
        if (players[shooterId]) {
          players[shooterId].xp += 30;
          if (players[shooterId].xp >= players[shooterId].level * 50) {
            players[shooterId].level += 1;
            players[shooterId].health = 100;
            io.emit('playerLevelUp', { id: shooterId, level: players[shooterId].level });
          }
          io.emit('playerXPUpdate', { id: shooterId, xp: players[shooterId].xp });
        }

        players[targetId].health = 100;
        players[targetId].x = Math.random() * 1600 - 800;
        players[targetId].y = Math.random() * 1200 - 600;
        io.emit('playerRespawn', players[targetId]);
      } else {
        io.emit('playerHit', { id: targetId, health: players[targetId].health });
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
