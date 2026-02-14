import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { io } from 'socket.io-client';

const App = () => {
  const mountRef = useRef(null);
  const socketRef = useRef(null);
  const playersRef = useRef({});
  const obstaclesRef = useRef({});
  const bulletsRef = useRef([]);
  const localPlayerId = useRef(null);
  const sceneRef = useRef(null);
  const [isMobile, setIsMobile] = useState(false);
  const [joystick, setJoystick] = useState({ active: false, x: 0, y: 0, startX: 0, startY: 0 });
  const [health, setHealth] = useState(100);

  useEffect(() => {
    // Check if mobile
    setIsMobile('ontouchstart' in window || navigator.maxTouchPoints > 0);
    // Scene setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const aspect = window.innerWidth / window.innerHeight;
    const frustumSize = 1000;
    const camera = new THREE.OrthographicCamera(
      frustumSize * aspect / -2, frustumSize * aspect / 2,
      frustumSize / 2, frustumSize / -2,
      0.1, 2000
    );
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    mountRef.current.appendChild(renderer.domElement);

    // Grid Helper
    const gridHelper = new THREE.GridHelper(5000, 50, 0x444444, 0x222222);
    gridHelper.rotation.x = Math.PI / 2;
    gridHelper.position.z = -2;
    scene.add(gridHelper);

    // Floor
    const floorGeometry = new THREE.PlaneGeometry(5000, 5000);
    const floorMaterial = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.position.z = -3;
    scene.add(floor);

    // Socket.io setup
    const socketUrl = window.location.hostname === 'localhost' ? 'http://localhost:3001' : window.location.origin;
    console.log('Connecting to socket at:', socketUrl);
    const socket = io(socketUrl, {
      transports: ['websocket'],
      upgrade: false
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      localPlayerId.current = socket.id;
    });

    socket.on('currentPlayers', (players) => {
      localPlayerId.current = socket.id; // Ensure ID is set
      Object.keys(players).forEach((id) => {
        addPlayer(id, players[id]);
      });
    });

    socket.on('newPlayer', (playerInfo) => {
      addPlayer(playerInfo.id, playerInfo);
    });

    socket.on('playerMoved', (playerInfo) => {
      if (playersRef.current[playerInfo.id]) {
        playersRef.current[playerInfo.id].mesh.position.set(playerInfo.x, playerInfo.y, 0);
        playersRef.current[playerInfo.id].mesh.rotation.z = playerInfo.angle;
        playersRef.current[playerInfo.id].turret.rotation.z = playerInfo.turretAngle;
      }
    });

    socket.on('playerDisconnected', (id) => {
      if (playersRef.current[id]) {
        scene.remove(playersRef.current[id].mesh);
        delete playersRef.current[id];
      }
    });

    socket.on('bulletFired', (bulletData) => {
      createBullet(bulletData);
    });

    socket.on('currentObstacles', (obstacles) => {
      Object.keys(obstacles).forEach((id) => {
        addObstacle(id, obstacles[id]);
      });
    });

    socket.on('newObstacle', (obstacle) => {
      addObstacle(obstacle.id, obstacle);
    });

    socket.on('obstacleHit', (data) => {
      if (obstaclesRef.current[data.id]) {
        obstaclesRef.current[data.id].health = data.health;
        // Visual feedback
        obstaclesRef.current[data.id].mesh.material.color.set(0xff0000);
        setTimeout(() => {
          if (obstaclesRef.current[data.id]) {
            obstaclesRef.current[data.id].mesh.material.color.set(0x888888);
          }
        }, 100);
      }
    });

    socket.on('obstacleDestroyed', (id) => {
      if (obstaclesRef.current[id]) {
        scene.remove(obstaclesRef.current[id].mesh);
        delete obstaclesRef.current[id];
      }
    });

    socket.on('playerHit', (data) => {
      if (data.id === localPlayerId.current) {
        setHealth(data.health);
      }
      if (playersRef.current[data.id]) {
        playersRef.current[data.id].health = data.health;
      }
    });

    socket.on('playerRespawn', (playerInfo) => {
      if (playerInfo.id === localPlayerId.current) {
        setHealth(100);
      }
      if (playersRef.current[playerInfo.id]) {
        playersRef.current[playerInfo.id].mesh.position.set(playerInfo.x, playerInfo.y, 0);
        playersRef.current[playerInfo.id].health = 100;
      }
    });

    const addObstacle = (id, info) => {
      if (obstaclesRef.current[id]) return;
      const geometry = new THREE.BoxGeometry(50, 50, 50);
      const material = new THREE.MeshBasicMaterial({ color: 0x888888 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(info.x, info.y, 25);
      scene.add(mesh);
      obstaclesRef.current[id] = { ...info, mesh };
    };

    const addPlayer = (id, info) => {
      if (playersRef.current[id]) return; // Avoid duplicates

      const group = new THREE.Group();
      
      // Tank Body
      const bodyGeometry = new THREE.BoxGeometry(40, 30, 2);
      const bodyMaterial = new THREE.MeshBasicMaterial({ color: info.color });
      const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
      group.add(body);

      // Tank Turret Group (to rotate separately)
      const turretGroup = new THREE.Group();
      const turretBaseGeometry = new THREE.BoxGeometry(20, 20, 2);
      const turretBaseMaterial = new THREE.MeshBasicMaterial({ color: info.color });
      const turretBase = new THREE.Mesh(turretBaseGeometry, turretBaseMaterial);
      turretGroup.add(turretBase);

      const barrelGeometry = new THREE.BoxGeometry(25, 8, 2);
      const barrelMaterial = new THREE.MeshBasicMaterial({ color: 0x333333 });
      const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
      barrel.position.x = 15;
      turretGroup.add(barrel);
      
      turretGroup.position.z = 1; // Explicitly above body
      group.add(turretGroup);

      group.position.set(info.x, info.y, 0);
      group.rotation.z = info.angle;
      
      scene.add(group);
      playersRef.current[id] = { 
        ...info, 
        mesh: group, 
        turret: turretGroup,
        health: 100 
      };
      console.log('Player added:', id, 'Local?', id === localPlayerId.current);
    };

    const createBullet = (data) => {
      const geometry = new THREE.CircleGeometry(4, 16);
      const material = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
      const bullet = new THREE.Mesh(geometry, material);
      bullet.position.set(data.x, data.y, 0.5); // Bullet above tank
      
      const velocity = new THREE.Vector3(
        Math.cos(data.angle) * 12,
        Math.sin(data.angle) * 12,
        0
      );
      
      scene.add(bullet);
      bulletsRef.current.push({ mesh: bullet, velocity, life: 100 });
    };

    // Input handling
    const keys = {};
    const mouse = new THREE.Vector2();
    
    const handleKeyDown = (e) => {
      keys[e.code] = true;
      keys[e.key.toLowerCase()] = true; // Fallback to key
      // Prevent scrolling with WASD
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'w', 'a', 's', 'd', 'Space', ' '].includes(e.code) || ['w', 'a', 's', 'd', ' '].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    };
    const handleKeyUp = (e) => {
      keys[e.code] = false;
      keys[e.key.toLowerCase()] = false;
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const handleMouseMove = (e) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', handleMouseMove);

    const handleMouseDown = (e) => {
      const localPlayer = playersRef.current[localPlayerId.current];
      if (localPlayer) {
        // Calculate barrel tip position
        const angle = localPlayer.mesh.rotation.z + localPlayer.turret.rotation.z;
        const bulletData = {
          x: localPlayer.mesh.position.x + Math.cos(angle) * 40,
          y: localPlayer.mesh.position.y + Math.sin(angle) * 40,
          angle: angle
        };
        createBullet(bulletData);
        socket.emit('fire', bulletData);
      }
    };
    window.addEventListener('mousedown', handleMouseDown);

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);

      // Local movement
      const localPlayer = playersRef.current[localPlayerId.current];
      if (localPlayer) {
        // Camera follows player
        camera.position.x = localPlayer.mesh.position.x;
        camera.position.y = localPlayer.mesh.position.y;

        let moved = false;
        const speed = 4;
        const rotationSpeed = 0.04;

        if (keys['KeyW'] || keys['w'] || (joystick.active && joystick.y < -10)) {
          localPlayer.mesh.position.x += Math.cos(localPlayer.mesh.rotation.z) * speed;
          localPlayer.mesh.position.y += Math.sin(localPlayer.mesh.rotation.z) * speed;
          moved = true;
        }
        if (keys['KeyS'] || keys['s'] || (joystick.active && joystick.y > 10)) {
          localPlayer.mesh.position.x -= Math.cos(localPlayer.mesh.rotation.z) * speed;
          localPlayer.mesh.position.y -= Math.sin(localPlayer.mesh.rotation.z) * speed;
          moved = true;
        }
        if (keys['KeyA'] || keys['a'] || (joystick.active && joystick.x < -10)) {
          localPlayer.mesh.rotation.z += rotationSpeed;
          moved = true;
        }
        if (keys['KeyD'] || keys['d'] || (joystick.active && joystick.x > 10)) {
          localPlayer.mesh.rotation.z -= rotationSpeed;
          moved = true;
        }

        // Turret rotation towards mouse
        const vector = new THREE.Vector3(mouse.x, mouse.y, 0.5);
        vector.unproject(camera);
        
        // Calculate direction from player to mouse in world space
        const targetAngle = Math.atan2(vector.y - localPlayer.mesh.position.y, vector.x - localPlayer.mesh.position.x);
        
        // Set turret rotation relative to tank body
        localPlayer.turret.rotation.z = targetAngle - localPlayer.mesh.rotation.z;
        moved = true; 

        if (moved) {
          socket.emit('playerMovement', {
            x: localPlayer.mesh.position.x,
            y: localPlayer.mesh.position.y,
            angle: localPlayer.mesh.rotation.z,
            turretAngle: localPlayer.turret.rotation.z
          });
          
          // Smooth camera follow
          camera.position.x += (localPlayer.mesh.position.x - camera.position.x) * 0.1;
          camera.position.y += (localPlayer.mesh.position.y - camera.position.y) * 0.1;
        }
      }

      // Update bullets
      for (let i = bulletsRef.current.length - 1; i >= 0; i--) {
        const bullet = bulletsRef.current[i];
        bullet.mesh.position.add(bullet.velocity);
        bullet.life--;

        // Check collisions with other players
        Object.keys(playersRef.current).forEach((id) => {
          if (id === localPlayerId.current) return;
          
          const player = playersRef.current[id];
          const dist = bullet.mesh.position.distanceTo(player.mesh.position);
          
          if (dist < 25) {
            bullet.life = 0;
            socket.emit('bulletHit', { targetId: id, type: 'player', damage: 10 });
          }
        });

        // Check collisions with obstacles
        Object.keys(obstaclesRef.current).forEach((id) => {
          const obs = obstaclesRef.current[id];
          const dist = bullet.mesh.position.distanceTo(obs.mesh.position);
          if (dist < 35) {
            bullet.life = 0;
            socket.emit('bulletHit', { targetId: id, type: 'obstacle', damage: 10 });
          }
        });

        if (bullet.life <= 0) {
          scene.remove(bullet.mesh);
          bulletsRef.current.splice(i, 1);
        }
      }

      renderer.render(scene, camera);
    };
    animate();

    // Handle resize
    const handleResize = () => {
      const aspect = window.innerWidth / window.innerHeight;
      camera.left = frustumSize * aspect / -2;
      camera.right = frustumSize * aspect / 2;
      camera.top = frustumSize / 2;
      camera.bottom = frustumSize / -2;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      socket.disconnect();
      mountRef.current?.removeChild(renderer.domElement);
    };
  }, []);

  const handleFire = () => {
    const localPlayer = playersRef.current[localPlayerId.current];
    if (localPlayer) {
      const angle = localPlayer.mesh.rotation.z + localPlayer.turret.rotation.z;
      const bulletData = {
        x: localPlayer.mesh.position.x + Math.cos(angle) * 40,
        y: localPlayer.mesh.position.y + Math.sin(angle) * 40,
        angle: angle
      };
      createBullet(bulletData);
      socketRef.current.emit('fire', bulletData);
    }
  };

  const handleJoystickStart = (e) => {
    const touch = e.touches[0];
    setJoystick({ active: true, x: 0, y: 0, startX: touch.clientX, startY: touch.clientY });
  };

  const handleJoystickMove = (e) => {
    if (!joystick.active) return;
    const touch = e.touches[0];
    const dx = touch.clientX - joystick.startX;
    const dy = touch.clientY - joystick.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = 50;
    const limitedX = (dx / dist) * Math.min(dist, maxDist);
    const limitedY = (dy / dist) * Math.min(dist, maxDist);
    setJoystick(prev => ({ ...prev, x: limitedX, y: limitedY }));
  };

  const handleJoystickEnd = () => {
    setJoystick({ active: false, x: 0, y: 0, startX: 0, startY: 0 });
  };

  return (
    <div 
      style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', touchAction: 'none' }}
      onTouchMove={handleJoystickMove}
      onTouchEnd={handleJoystickEnd}
    >
      <div ref={mountRef} style={{ width: '100vw', height: '100vh' }} />
      
      {/* UI Overlay */}
      <div style={{
        position: 'absolute',
        top: 20,
        left: 20,
        color: 'white',
        fontFamily: 'Arial, sans-serif',
        pointerEvents: 'none',
        background: 'rgba(0,0,0,0.5)',
        padding: '10px',
        borderRadius: '5px'
      }}>
        <h2 style={{ margin: '0 0 5px 0' }}>Tanki.io</h2>
        <div style={{ width: '200px', height: '20px', background: '#333', borderRadius: '10px', overflow: 'hidden' }}>
          <div style={{ width: `${health}%`, height: '100%', background: '#ff3333', transition: 'width 0.2s' }} />
        </div>
        <p style={{ margin: '5px 0' }}>Здоровье: {health}%</p>
        {!isMobile && (
          <div style={{ fontSize: '12px', opacity: 0.8 }}>
            <p>Управление: WASD</p>
            <p>Стрельба: ЛКМ</p>
          </div>
        )}
      </div>

      {/* Mobile Controls */}
      {isMobile && (
        <>
          {/* Joystick */}
          <div 
            onTouchStart={handleJoystickStart}
            style={{
              position: 'absolute',
              bottom: 50,
              left: 50,
              width: 100,
              height: 100,
              background: 'rgba(255,255,255,0.1)',
              borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.3)'
            }}
          >
            {joystick.active && (
              <div style={{
                position: 'absolute',
                left: 50 + joystick.x - 20,
                top: 50 + joystick.y - 20,
                width: 40,
                height: 40,
                background: 'rgba(255,255,255,0.5)',
                borderRadius: '50%'
              }} />
            )}
          </div>

          {/* Fire Button */}
          <div 
            onTouchStart={(e) => { e.preventDefault(); handleFire(); }}
            style={{
              position: 'absolute',
              bottom: 70,
              right: 50,
              width: 80,
              height: 80,
              background: 'rgba(255,50,50,0.5)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: 'bold',
              fontSize: '18px',
              border: '4px solid rgba(255,255,255,0.3)'
            }}
          >
            FIRE
          </div>
        </>
      )}
    </div>
  );
};

export default App;
