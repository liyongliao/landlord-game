/* ============================================================
   多人联机模块 — BroadcastChannel（同设备多标签页）
   + 本地房间模拟（localStorage）
   ============================================================ */

const Network = (() => {
  const CHANNEL_NAME = 'doudizhu_room';
  const STORAGE_KEY  = 'doudizhu_rooms';
  let channel = null;
  let myId = null;           // 本玩家唯一ID
  let currentRoomId = null;
  let onMessageCb = null;    // 收到消息时的回调
  let onRoomUpdateCb = null; // 房间状态更新回调

  // 生成唯一ID
  function genId(prefix = '') {
    return prefix + Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  function getMyId() { return myId; }
  function getRoomId() { return currentRoomId; }

  // ── 房间存储 ─────────────────────────────────────────────
  function loadRooms() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveRooms(rooms) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
  }
  function getRoom(roomId) {
    return loadRooms()[roomId] || null;
  }
  function updateRoom(roomId, updater) {
    const rooms = loadRooms();
    if (rooms[roomId]) {
      rooms[roomId] = updater(rooms[roomId]);
      saveRooms(rooms);
      // 广播房间状态更新
      broadcast({ type: 'ROOM_UPDATE', room: rooms[roomId] });
    }
    return rooms[roomId];
  }

  // ── BroadcastChannel ────────────────────────────────────
  function initChannel() {
    if (channel) { channel.close(); }
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 'ROOM_UPDATE' && onRoomUpdateCb) {
        onRoomUpdateCb(msg.room);
      }
      if (onMessageCb) onMessageCb(msg);
    };
  }

  function broadcast(msg) {
    if (channel) channel.postMessage(msg);
  }

  function send(msg) {
    // 同时处理本地（直接调回调）+ 广播
    broadcast({ ...msg, fromId: myId, roomId: currentRoomId });
  }

  // ── 公开 API ─────────────────────────────────────────────

  // 初始化网络，生成玩家ID
  function init(playerName) {
    myId = genId('P');
    initChannel();
    return myId;
  }

  // 创建房间，返回 roomId
  function createRoom(playerName, roomName) {
    const roomId = genId('R');
    currentRoomId = roomId;
    const seats = [
      { id: myId, name: playerName, isAI: false, ready: false },
      null,
      null
    ];
    const room = {
      id: roomId,
      name: roomName || `${playerName}的房间`,
      seats,           // 3个席位
      hostId: myId,
      state: 'waiting', // waiting | playing | ended
      gameData: null,
      createdAt: Date.now()
    };
    const rooms = loadRooms();
    rooms[roomId] = room;
    saveRooms(rooms);
    broadcast({ type: 'ROOM_CREATED', room });
    return roomId;
  }

  // 加入房间
  function joinRoom(roomId, playerName) {
    const rooms = loadRooms();
    const room = rooms[roomId];
    if (!room) return { ok: false, msg: '房间不存在' };
    if (room.state !== 'waiting') return { ok: false, msg: '游戏已开始' };
    // 找空席位
    const emptyIdx = room.seats.findIndex(s => s === null);
    if (emptyIdx === -1) return { ok: false, msg: '房间已满' };
    room.seats[emptyIdx] = { id: myId, name: playerName, isAI: false, ready: false };
    currentRoomId = roomId;
    rooms[roomId] = room;
    saveRooms(rooms);
    broadcast({ type: 'ROOM_UPDATE', room });
    broadcast({ type: 'PLAYER_JOIN', roomId, playerId: myId, name: playerName });
    return { ok: true, room };
  }

  // 添加机器人到指定席位
  function addBot(roomId, seatIdx, botName) {
    return updateRoom(roomId, (room) => {
      if (!room.seats[seatIdx]) {
        const botId = genId('BOT');
        room.seats[seatIdx] = { id: botId, name: botName || randomBotName(), isAI: true, ready: true };
      }
      return room;
    });
  }

  // 移除席位（机器人或玩家离开）
  function removeSeat(roomId, seatIdx) {
    return updateRoom(roomId, (room) => {
      room.seats[seatIdx] = null;
      return room;
    });
  }

  // 玩家准备
  function setReady(roomId, playerId, ready) {
    return updateRoom(roomId, (room) => {
      const seat = room.seats.find(s => s && s.id === playerId);
      if (seat) seat.ready = ready;
      return room;
    });
  }

  // 发送游戏事件
  function sendGameEvent(eventType, data) {
    send({ type: 'GAME_EVENT', eventType, data, fromId: myId, roomId: currentRoomId });
  }

  // 同步游戏状态（房主广播）
  function syncGameState(gameState) {
    broadcast({ type: 'GAME_STATE', gameState, roomId: currentRoomId, fromId: myId });
  }

  // 获取所有房间列表
  function getRoomList() {
    const rooms = loadRooms();
    // 清理过期房间（超过2小时）
    const now = Date.now();
    let changed = false;
    Object.keys(rooms).forEach(id => {
      if (now - rooms[id].createdAt > 7200000) { delete rooms[id]; changed = true; }
    });
    if (changed) saveRooms(rooms);
    return Object.values(rooms).filter(r => r.state === 'waiting');
  }

  // 更新房间游戏状态
  function updateGameState(roomId, gameState) {
    const rooms = loadRooms();
    if (rooms[roomId]) {
      rooms[roomId].gameData = gameState;
      rooms[roomId].state = 'playing';
      saveRooms(rooms);
      broadcast({ type: 'GAME_STATE', gameState, roomId, fromId: myId });
    }
  }

  // 结束房间
  function endRoom(roomId) {
    const rooms = loadRooms();
    if (rooms[roomId]) {
      rooms[roomId].state = 'ended';
      saveRooms(rooms);
      broadcast({ type: 'ROOM_ENDED', roomId });
    }
  }

  // 离开房间
  function leaveRoom() {
    if (!currentRoomId) return;
    const rooms = loadRooms();
    const room = rooms[currentRoomId];
    if (room) {
      const idx = room.seats.findIndex(s => s && s.id === myId);
      if (idx !== -1) room.seats[idx] = null;
      // 如果房间空了就删除
      if (room.seats.every(s => s === null || s.isAI)) {
        delete rooms[currentRoomId];
      } else {
        // 转移房主
        if (room.hostId === myId) {
          const newHost = room.seats.find(s => s && !s.isAI);
          if (newHost) room.hostId = newHost.id;
        }
        rooms[currentRoomId] = room;
      }
      saveRooms(rooms);
      broadcast({ type: 'ROOM_UPDATE', room: rooms[currentRoomId] || null });
    }
    currentRoomId = null;
  }

  function onMessage(cb) { onMessageCb = cb; }
  function onRoomUpdate(cb) { onRoomUpdateCb = cb; }

  function randomBotName() {
    const names = ['小虎AI', '机器猫', '数字侠', '算法王', '铁牌手', '无敌Bot', '牌神AI', '超级鸡'];
    return names[Math.floor(Math.random() * names.length)];
  }

  return {
    init, getMyId, getRoomId,
    createRoom, joinRoom, leaveRoom,
    addBot, removeSeat, setReady,
    sendGameEvent, syncGameState, updateGameState, endRoom,
    getRoomList, getRoom, updateRoom,
    onMessage, onRoomUpdate,
    broadcast, randomBotName
  };
})();
