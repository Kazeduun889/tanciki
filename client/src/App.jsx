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
  const [moveJoystick, setMoveJoystick] = useState({ active: false, x: 0, y: 0 });
  const [fireJoystick, setFireJoystick] = useState({ active: false, x: 0, y: 0 });
  const moveJoystickRef = useRef({ active: false, x: 0, y: 0, startX: 0, startY: 0, touchId: null });
  const fireJoystickRef = useRef({ active: false, x: 0, y: 0, startX: 0, startY: 0, touchId: null });
  const [health, setHealth] = useState(100);
  const [level, setLevel] = useState(1);
  const [xp, setXp] = useState(0);
  const lastFireTime = useRef(0);

  useEffect(() => {
    // Check if mobile (more robust check)
    const checkMobile = () => {
      return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
             ('ontouchstart' in window) || 
             (navigator.maxTouchPoints > 0);
    };
    setIsMobile(checkMobile());
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
        const obs = obstaclesRef.current[data.id];
        obs.health = data.health;
        
        // Clear existing timeout if any
        if (obs.hitTimeout) clearTimeout(obs.hitTimeout);
        
        // Visual feedback
        obs.mesh.material.color.set(0xff0000);
        obs.hitTimeout = setTimeout(() => {
          if (obstaclesRef.current[data.id]) {
            obstaclesRef.current[data.id].mesh.material.color.set(0x888888);
            obstaclesRef.current[data.id].hitTimeout = null;
          }
        }, 100);
      }
    });

    socket.on('obstacleDestroyed', (id) => {
      if (obstaclesRef.current[id]) {
        if (obstaclesRef.current[id].hitTimeout) {
          clearTimeout(obstaclesRef.current[id].hitTimeout);
        }
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

    socket.on('playerXPUpdate', (data) => {
      if (data.id === localPlayerId.current) {
        setXp(data.xp);
      }
    });

    socket.on('playerLevelUp', (data) => {
      if (data.id === localPlayerId.current) {
        setLevel(data.level);
        setHealth(100);
        // Show level up message
        console.log("LEVEL UP! Level: " + data.level);
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
      bulletsRef.current.push({ 
        mesh: bullet, 
        velocity, 
        life: 100, 
        shooterId: data.shooterId 
      });
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
          angle: angle,
          shooterId: socket.id
        };
        createBullet(bulletData);
        socket.emit('fire', bulletData);
      }
    };
    window.addEventListener('mousedown', handleMouseDown);

    // Animation loop
    let animationFrameId;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      // Local movement
      const localPlayer = playersRef.current[localPlayerId.current];
      if (localPlayer) {
        // Camera follows player
        camera.position.x = localPlayer.mesh.position.x;
        camera.position.y = localPlayer.mesh.position.y;

        let moved = false;
        const speed = 4;
        const rotationSpeed = 0.04;

        if (keys['KeyW'] || keys['w'] || (moveJoystickRef.current.active && moveJoystickRef.current.y < -10)) {
          localPlayer.mesh.position.x += Math.cos(localPlayer.mesh.rotation.z) * speed;
          localPlayer.mesh.position.y += Math.sin(localPlayer.mesh.rotation.z) * speed;
          moved = true;
        }
        if (keys['KeyS'] || keys['s'] || (moveJoystickRef.current.active && moveJoystickRef.current.y > 10)) {
          localPlayer.mesh.position.x -= Math.cos(localPlayer.mesh.rotation.z) * speed;
          localPlayer.mesh.position.y -= Math.sin(localPlayer.mesh.rotation.z) * speed;
          moved = true;
        }
        if (keys['KeyA'] || keys['a'] || (moveJoystickRef.current.active && moveJoystickRef.current.x < -10)) {
          localPlayer.mesh.rotation.z += rotationSpeed;
          moved = true;
        }
        if (keys['KeyD'] || keys['d'] || (moveJoystickRef.current.active && moveJoystickRef.current.x > 10)) {
          localPlayer.mesh.rotation.z -= rotationSpeed;
          moved = true;
        }

        // Turret rotation
        if (!isMobile) {
          // Turret rotation towards mouse
          const vector = new THREE.Vector3(mouse.x, mouse.y, 0.5);
          vector.unproject(camera);
          const targetAngle = Math.atan2(vector.y - localPlayer.mesh.position.y, vector.x - localPlayer.mesh.position.x);
          localPlayer.turret.rotation.z = targetAngle - localPlayer.mesh.rotation.z;
        } else if (fireJoystickRef.current.active) {
          // Turret follows fire joystick direction
          const targetAngle = Math.atan2(-fireJoystickRef.current.y, fireJoystickRef.current.x);
          localPlayer.turret.rotation.z = targetAngle - localPlayer.mesh.rotation.z;
          
          // Auto fire only if joystick is tilted enough
          const dist = Math.sqrt(fireJoystickRef.current.x * fireJoystickRef.current.x + fireJoystickRef.current.y * fireJoystickRef.current.y);
          if (dist > 20) {
            const now = Date.now();
            if (now - lastFireTime.current >= 300) {
              handleFire();
              lastFireTime.current = now;
            }
          }
        } else if (moveJoystickRef.current.active) {
          // Turret follows movement if not firing
          const targetAngle = Math.atan2(-moveJoystickRef.current.y, moveJoystickRef.current.x);
          localPlayer.turret.rotation.z = targetAngle - localPlayer.mesh.rotation.z;
        }

        if (moved || (isMobile && (moveJoystickRef.current.active || fireJoystickRef.current.active))) {
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
          if (id === bullet.shooterId) return;
          
          const player = playersRef.current[id];
          const dist = bullet.mesh.position.distanceTo(player.mesh.position);
          
          if (dist < 40) {
            bullet.life = 0;
            const currentDamage = 10 + (level - 1) * 5;
            socket.emit('bulletHit', { targetId: id, type: 'player', damage: currentDamage, shooterId: bullet.shooterId });
          }
        });

        // Check collisions with obstacles
        Object.keys(obstaclesRef.current).forEach((id) => {
          const obs = obstaclesRef.current[id];
          const dist = bullet.mesh.position.distanceTo(obs.mesh.position);
          if (dist < 40) {
            bullet.life = 0;
            const currentDamage = 10 + (level - 1) * 5;
            socket.emit('bulletHit', { targetId: id, type: 'obstacle', damage: currentDamage, shooterId: bullet.shooterId });
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
      cancelAnimationFrame(animationFrameId);
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
        angle: angle,
        shooterId: localPlayerId.current
      };
      createBullet(bulletData);
      socketRef.current.emit('fire', bulletData);
    }
  };

  const handleJoystickStart = (e, type) => {
    e.preventDefault();
    e.stopPropagation();
    const touch = e.changedTouches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const data = { 
      active: true, 
      x: 0, 
      y: 0, 
      startX: centerX, 
      startY: centerY,
      touchId: touch.identifier 
    };
    
    if (type === 'move') {
      moveJoystickRef.current = data;
      setMoveJoystick({ active: true, x: 0, y: 0 });
    } else {
      fireJoystickRef.current = data;
      setFireJoystick({ active: true, x: 0, y: 0 });
      // Single tap to fire once immediately
      const now = Date.now();
      if (now - lastFireTime.current >= 300) {
        handleFire();
        lastFireTime.current = now;
      }
    }
  };

  const handleJoystickMove = (e) => {
    // Check all touches
    for (let i = 0; i < e.touches.length; i++) {
      const touch = e.touches[i];
      
      // Update move joystick
      if (moveJoystickRef.current.active && touch.identifier === moveJoystickRef.current.touchId) {
        const dx = touch.clientX - moveJoystickRef.current.startX;
        const dy = touch.clientY - moveJoystickRef.current.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = 50;
        const limitedX = dist > 0 ? (dx / dist) * Math.min(dist, maxDist) : 0;
        const limitedY = dist > 0 ? (dy / dist) * Math.min(dist, maxDist) : 0;
        moveJoystickRef.current.x = limitedX;
        moveJoystickRef.current.y = limitedY;
        setMoveJoystick({ active: true, x: limitedX, y: limitedY });
      }
      
      // Update fire joystick
      if (fireJoystickRef.current.active && touch.identifier === fireJoystickRef.current.touchId) {
        const dx = touch.clientX - fireJoystickRef.current.startX;
        const dy = touch.clientY - fireJoystickRef.current.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = 50;
        const limitedX = dist > 0 ? (dx / dist) * Math.min(dist, maxDist) : 0;
        const limitedY = dist > 0 ? (dy / dist) * Math.min(dist, maxDist) : 0;
        fireJoystickRef.current.x = limitedX;
        fireJoystickRef.current.y = limitedY;
        setFireJoystick({ active: true, x: limitedX, y: limitedY });
      }
    }
  };

  const handleJoystickEnd = (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const tid = e.changedTouches[i].identifier;
      if (moveJoystickRef.current.touchId === tid) {
        moveJoystickRef.current = { active: false, x: 0, y: 0, startX: 0, startY: 0, touchId: null };
        setMoveJoystick({ active: false, x: 0, y: 0 });
      }
      if (fireJoystickRef.current.touchId === tid) {
        fireJoystickRef.current = { active: false, x: 0, y: 0, startX: 0, startY: 0, touchId: null };
        setFireJoystick({ active: false, x: 0, y: 0 });
      }
    }
  };

  return (
    <div 
      style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', touchAction: 'none' }}
      onTouchMove={handleJoystickMove}
      onTouchEnd={handleJoystickEnd}
      onTouchCancel={handleJoystickEnd}
    >
      <div ref={mountRef} style={{ width: '100vw', height: '100vh' }} />
      
      {/* Health Bar */}
      <div style={{
        position: 'absolute',
        top: '20px',
        left: '20px',
        width: '200px',
        height: '20px',
        backgroundColor: '#333',
        borderRadius: '10px',
        border: '2px solid #fff',
        pointerEvents: 'none'
      }}>
        <div style={{
          width: `${health}%`,
          height: '100%',
          backgroundColor: '#ff4444',
          borderRadius: '8px',
          transition: 'width 0.3s ease'
        }} />
        <div style={{
          position: 'absolute',
          top: '0',
          left: '0',
          width: '100%',
          height: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          color: '#fff',
          fontSize: '12px',
          fontWeight: 'bold',
          textShadow: '1px 1px 2px #000'
        }}>
          HP: {Math.round(health)}
        </div>
      </div>

      {/* Level and XP */}
      <div style={{
        position: 'absolute',
        top: '50px',
        left: '20px',
        color: '#fff',
        fontFamily: 'Arial, sans-serif',
        textShadow: '2px 2px 4px #000',
        pointerEvents: 'none'
      }}>
        <div style={{ fontSize: '24px', fontWeight: 'bold' }}>LVL {level}</div>
        <div style={{
          width: '150px',
          height: '10px',
          backgroundColor: '#333',
          borderRadius: '5px',
          marginTop: '5px',
          border: '1px solid #fff'
        }}>
          <div style={{
            width: `${(xp / (level * 50)) * 100}%`,
            height: '100%',
            backgroundColor: '#44ff44',
            borderRadius: '4px',
            transition: 'width 0.3s ease'
          }} />
        </div>
        <div style={{ fontSize: '10px', marginTop: '2px' }}>XP: {xp} / {level * 50}</div>
      </div>

      {/* Mobile Controls */}
      {isMobile && (
        <>
          {/* Movement Joystick */}
          <div 
            onTouchStart={(e) => handleJoystickStart(e, 'move')}
            onTouchMove={handleJoystickMove}
            onTouchEnd={handleJoystickEnd}
            style={{
              position: 'absolute',
              bottom: 50,
              left: 50,
              width: 120,
              height: 120,
              background: 'rgba(255,255,255,0.1)',
              borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.3)',
              touchAction: 'none',
              zIndex: 1000
            }}
          >
            {moveJoystick.active && (
              <div style={{
                position: 'absolute',
                left: 60 + moveJoystick.x - 25,
                top: 60 + moveJoystick.y - 25,
                width: 50,
                height: 50,
                background: 'rgba(255,255,255,0.5)',
                borderRadius: '50%',
                pointerEvents: 'none'
              }} />
            )}
          </div>

          {/* Fire/Aim Joystick */}
          <div 
            onTouchStart={(e) => handleJoystickStart(e, 'fire')}
            onTouchMove={handleJoystickMove}
            onTouchEnd={handleJoystickEnd}
            style={{
              position: 'absolute',
              bottom: 50,
              right: 50,
              width: 120,
              height: 120,
              background: 'rgba(255, 0, 0, 0.1)',
              borderRadius: '50%',
              border: '2px solid rgba(255, 0, 0, 0.3)',
              touchAction: 'none',
              zIndex: 1000
            }}
          >
            {fireJoystick.active && (
              <div style={{
                position: 'absolute',
                left: 60 + fireJoystick.x - 25,
                top: 60 + fireJoystick.y - 25,
                width: 50,
                height: 50,
                background: 'rgba(255, 0, 0, 0.5)',
                borderRadius: '50%',
                pointerEvents: 'none'
              }} />
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default App;
