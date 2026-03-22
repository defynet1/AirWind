// AirWind Server v2 — Node.js + WebSocket + SQLite (sql.js)
// Запуск: npm install && node server.js

const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const crypto    = require('crypto');
const WebSocket = require('ws');
const initSqlJs = require('sql.js');

const DB_FILE = path.join(__dirname, 'airwind.db');

// ─── sql.js helpers ───────────────────────────────
let db = null;

async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
    console.log('📂 База данных загружена:', DB_FILE);
  } else {
    db = new SQL.Database();
    console.log('🆕 Создана новая база данных');
  }

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL, password TEXT NOT NULL,
    avatar_color TEXT NOT NULL, status TEXT DEFAULT '',
    last_seen INTEGER DEFAULT 0, created_at INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY, is_group INTEGER DEFAULT 0,
    name TEXT, created_at INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS chat_members (
    chat_id TEXT NOT NULL, user_id TEXT NOT NULL,
    PRIMARY KEY (chat_id, user_id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, chat_id TEXT NOT NULL,
    sender_id TEXT NOT NULL, text TEXT NOT NULL,
    ts INTEGER NOT NULL, edited INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS read_receipts (
    msg_id TEXT NOT NULL, user_id TEXT NOT NULL,
    PRIMARY KEY (msg_id, user_id)
  )`);

  const exists = dbGet(`SELECT id FROM chats WHERE id='__global__'`);
  if (!exists) {
    dbRun(`INSERT INTO chats(id,is_group,name,created_at) VALUES('__global__',1,'Общий чат',?)`, [Date.now()]);
    console.log('🌐 Общий чат создан');
  }
  flush();
}

let flushTimer = null;
function flush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
  }, 400);
}

function dbAll(sql, p = []) {
  try {
    const res = db.exec(sql, p);
    if (!res.length) return [];
    const { columns, values } = res[0];
    return values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
  } catch(e) { console.error('dbAll:', e.message); return []; }
}
function dbGet(sql, p = []) { return dbAll(sql, p)[0] || null; }
function dbRun(sql, p = []) { try { db.run(sql, p); flush(); } catch(e) { console.error('dbRun:', e.message); } }
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function hashPw(pw) { return crypto.createHash('sha256').update(pw + 'airwind_v2').digest('hex'); }

const COLORS = ['#5b8cff','#7c5cfc','#3ecf8e','#ff6b6b','#ffd93d','#6bcb77','#ff8e53','#4ecdc4'];

// ─── User ops ─────────────────────────────────────
function createUser(username, displayName, password) {
  const id = newId(), now = Date.now();
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  dbRun(`INSERT INTO users(id,username,display_name,password,avatar_color,status,last_seen,created_at)
         VALUES(?,?,?,?,?,?,?,?)`, [id, username, displayName, hashPw(password), color, '', now, now]);
  return getUserById(id);
}
function getUserByUsername(u) { return dbGet(`SELECT * FROM users WHERE username=?`, [u]); }
function getUserById(id) { return dbGet(`SELECT * FROM users WHERE id=?`, [id]); }
function getAllUsers() { return dbAll(`SELECT * FROM users ORDER BY display_name`); }
function safe(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username,
    displayName: u.display_name, avatarColor: u.avatar_color,
    status: u.status, lastSeen: u.last_seen, createdAt: u.created_at
  };
}

// ─── Chat ops ─────────────────────────────────────
function getChatMembers(chatId) {
  return dbAll(`SELECT user_id FROM chat_members WHERE chat_id=?`, [chatId]).map(r => r.user_id);
}
function getUserChats(userId) {
  return dbAll(`
    SELECT c.* FROM chats c
    INNER JOIN chat_members cm ON c.id=cm.chat_id
    WHERE cm.user_id=? AND c.id!='__global__'
  `, [userId]).map(c => ({ id: c.id, isGroup: !!c.is_group, name: c.name, createdAt: c.created_at, members: getChatMembers(c.id) }));
}
function createPrivateChat(uid1, uid2) {
  const ex = dbGet(`
    SELECT c.id FROM chats c
    JOIN chat_members a ON c.id=a.chat_id AND a.user_id=?
    JOIN chat_members b ON c.id=b.chat_id AND b.user_id=?
    WHERE c.is_group=0`, [uid1, uid2]);
  if (ex) return { id: ex.id, isGroup: false, members: [uid1, uid2] };
  const id = newId();
  dbRun(`INSERT INTO chats(id,is_group,created_at) VALUES(?,0,?)`, [id, Date.now()]);
  dbRun(`INSERT INTO chat_members(chat_id,user_id) VALUES(?,?)`, [id, uid1]);
  dbRun(`INSERT INTO chat_members(chat_id,user_id) VALUES(?,?)`, [id, uid2]);
  return { id, isGroup: false, members: [uid1, uid2] };
}
function createGroupChat(name, memberIds) {
  const id = newId();
  dbRun(`INSERT INTO chats(id,is_group,name,created_at) VALUES(?,1,?,?)`, [id, name, Date.now()]);
  memberIds.forEach(uid => dbRun(`INSERT INTO chat_members(chat_id,user_id) VALUES(?,?)`, [id, uid]));
  return { id, isGroup: true, name, members: memberIds };
}

// ─── Message ops ──────────────────────────────────
function getMessages(chatId, limit = 200, before = null) {
  let sql = `SELECT m.*, GROUP_CONCAT(rr.user_id) as read_by
    FROM messages m LEFT JOIN read_receipts rr ON m.id=rr.msg_id
    WHERE m.chat_id=? AND m.deleted=0`;
  const p = [chatId];
  if (before) { sql += ` AND m.ts<?`; p.push(before); }
  sql += ` GROUP BY m.id ORDER BY m.ts ASC LIMIT ?`;
  p.push(limit);
  return dbAll(sql, p).map(toMsg);
}
function getMessageById(id) {
  const m = dbGet(`SELECT m.*, GROUP_CONCAT(rr.user_id) as read_by
    FROM messages m LEFT JOIN read_receipts rr ON m.id=rr.msg_id
    WHERE m.id=? GROUP BY m.id`, [id]);
  return m ? toMsg(m) : null;
}
function toMsg(m) {
  return { id: m.id, chatId: m.chat_id, senderId: m.sender_id,
    text: m.text, ts: m.ts, edited: !!m.edited,
    readBy: m.read_by ? m.read_by.split(',') : [m.sender_id] };
}
function insertMessage(chatId, senderId, text) {
  const id = newId(), ts = Date.now();
  dbRun(`INSERT INTO messages(id,chat_id,sender_id,text,ts) VALUES(?,?,?,?,?)`, [id, chatId, senderId, text, ts]);
  dbRun(`INSERT OR IGNORE INTO read_receipts(msg_id,user_id) VALUES(?,?)`, [id, senderId]);
  return getMessageById(id);
}
function markRead(chatId, userId) {
  const rows = dbAll(`
    SELECT m.id FROM messages m WHERE m.chat_id=? AND m.sender_id!=? AND m.deleted=0
    AND m.id NOT IN (SELECT msg_id FROM read_receipts WHERE user_id=?)
  `, [chatId, userId, userId]);
  rows.forEach(r => dbRun(`INSERT OR IGNORE INTO read_receipts(msg_id,user_id) VALUES(?,?)`, [r.id, userId]));
  if (rows.length) flush();
  return rows.map(r => r.id);
}
function editMsg(msgId, text, userId) {
  const m = dbGet(`SELECT * FROM messages WHERE id=? AND sender_id=? AND deleted=0`, [msgId, userId]);
  if (!m) return null;
  dbRun(`UPDATE messages SET text=?, edited=1 WHERE id=?`, [text, msgId]);
  return getMessageById(msgId);
}
function deleteMsg(msgId, userId) {
  const m = getMessageById(msgId);
  if (!m || m.senderId !== userId) return null;
  dbRun(`UPDATE messages SET deleted=1 WHERE id=?`, [msgId]);
  return m;
}

// ─── HTTP server ──────────────────────────────────
const httpServer = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const fp = path.join(__dirname, p);
  if (!fp.startsWith(__dirname)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css'};
    res.writeHead(200, { 'Content-Type': mime[path.extname(fp)] || 'text/plain' });
    res.end(data);
  });
});

// ─── WebSocket ────────────────────────────────────
const wss = new WebSocket.Server({ server: httpServer });
const clients = new Map(); // ws → { userId, username }
const typing  = {};        // chatId → Set<userId>

const send    = (ws, d)           => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(d));
const bcastAll = (d, exc = null)  => wss.clients.forEach(w => w !== exc && send(w, d));
function bcastChat(chatId, d, exc = null) {
  const json = JSON.stringify(d);
  clients.forEach((inf, w) => {
    if (w === exc || w.readyState !== WebSocket.OPEN) return;
    if (chatId === '__global__' || getChatMembers(chatId).includes(inf.userId))
      w.send(json);
  });
}
const onlineIds = () => [...new Set([...clients.values()].map(c => c.userId))];

wss.on('connection', ws => {
  console.log(`+ клиент, всего: ${wss.clients.size}`);

  ws.on('message', raw => {
    let pkt; try { pkt = JSON.parse(raw); } catch { return; }
    const { type, payload } = pkt;
    const inf = clients.get(ws);

    if (type === 'register') {
      const { username, displayName, password } = payload;
      if (!username||!displayName||!password) return send(ws,{type:'error',payload:{msg:'Заполните все поля'}});
      if (!/^[a-z0-9_]{3,}$/.test(username)) return send(ws,{type:'error',payload:{msg:'Юзернейм: мин. 3 символа, a-z 0-9 _'}});
      if (getUserByUsername(username)) return send(ws,{type:'error',payload:{msg:'Имя пользователя занято'}});
      const user = createUser(username, displayName, password);
      clients.set(ws, { userId: user.id, username });
      send(ws,{type:'auth_ok',payload:{user:safe(user)}});
      send(ws,{type:'chats',payload:{chats:[]}});
      send(ws,{type:'chat_history',payload:{chatId:'__global__',messages:getMessages('__global__')}});
      send(ws,{type:'users',payload:{users:getAllUsers().map(safe)}});
      send(ws,{type:'online',payload:{userIds:onlineIds()}});
      bcastAll({type:'user_joined',payload:{user:safe(user)}},ws);
      bcastAll({type:'online',payload:{userIds:onlineIds()}});
      console.log('register:', username);

    } else if (type === 'login') {
      const { username, password } = payload;
      const user = getUserByUsername(username);
      if (!user||user.password!==hashPw(password)) return send(ws,{type:'error',payload:{msg:'Неверное имя пользователя или пароль'}});
      dbRun(`UPDATE users SET last_seen=? WHERE id=?`,[Date.now(),user.id]);
      clients.set(ws, { userId: user.id, username });
      const myChats = getUserChats(user.id);
      send(ws,{type:'auth_ok',payload:{user:safe(getUserById(user.id))}});
      send(ws,{type:'chats',payload:{chats:myChats}});
      send(ws,{type:'chat_history',payload:{chatId:'__global__',messages:getMessages('__global__')}});
      myChats.forEach(c => send(ws,{type:'chat_history',payload:{chatId:c.id,messages:getMessages(c.id)}}));
      send(ws,{type:'users',payload:{users:getAllUsers().map(safe)}});
      send(ws,{type:'online',payload:{userIds:onlineIds()}});
      bcastAll({type:'online',payload:{userIds:onlineIds()}},ws);
      console.log('login:', username);

    } else if (type === 'send_message') {
      if (!inf) return;
      const { chatId, text } = payload;
      if (!text||!text.trim()) return;
      if (chatId!=='__global__' && !getChatMembers(chatId).includes(inf.userId)) return;
      const msg = insertMessage(chatId, inf.userId, text.trim());
      bcastChat(chatId, {type:'new_message',payload:{msg}});
      if (typing[chatId]) { typing[chatId].delete(inf.userId); bcastChat(chatId,{type:'typing',payload:{chatId,userIds:[...typing[chatId]]}}); }

    } else if (type === 'edit_message') {
      if (!inf) return;
      const updated = editMsg(payload.msgId, payload.text.trim(), inf.userId);
      if (updated) bcastChat(updated.chatId, {type:'message_edited',payload:{msg:updated}});

    } else if (type === 'delete_message') {
      if (!inf) return;
      const deleted = deleteMsg(payload.msgId, inf.userId);
      if (deleted) bcastChat(deleted.chatId, {type:'message_deleted',payload:{msgId:deleted.id,chatId:deleted.chatId}});

    } else if (type === 'mark_read') {
      if (!inf) return;
      const ids = markRead(payload.chatId, inf.userId);
      if (ids.length) bcastChat(payload.chatId, {type:'messages_read',payload:{chatId:payload.chatId,userId:inf.userId,msgIds:ids}});

    } else if (type === 'typing_start') {
      if (!inf) return;
      if (!typing[payload.chatId]) typing[payload.chatId] = new Set();
      typing[payload.chatId].add(inf.userId);
      bcastChat(payload.chatId,{type:'typing',payload:{chatId:payload.chatId,userIds:[...typing[payload.chatId]]}},ws);
      setTimeout(()=>{ if(typing[payload.chatId]){typing[payload.chatId].delete(inf.userId);bcastChat(payload.chatId,{type:'typing',payload:{chatId:payload.chatId,userIds:[...typing[payload.chatId]]}});}},5000);

    } else if (type === 'typing_stop') {
      if (!inf||!typing[payload.chatId]) return;
      typing[payload.chatId].delete(inf.userId);
      bcastChat(payload.chatId,{type:'typing',payload:{chatId:payload.chatId,userIds:[...typing[payload.chatId]]}},ws);

    } else if (type === 'create_private_chat') {
      if (!inf) return;
      const chat = createPrivateChat(inf.userId, payload.targetUserId);
      clients.forEach((ci,cw)=>{ if([inf.userId,payload.targetUserId].includes(ci.userId)) send(cw,{type:'chat_created',payload:{chat}}); });

    } else if (type === 'create_group_chat') {
      if (!inf) return;
      const chat = createGroupChat(payload.name||'Группа', payload.memberIds);
      clients.forEach((ci,cw)=>{ if(payload.memberIds.includes(ci.userId)) send(cw,{type:'chat_created',payload:{chat}}); });

    } else if (type === 'load_more') {
      if (!inf) return;
      send(ws,{type:'chat_history_more',payload:{chatId:payload.chatId,messages:getMessages(payload.chatId,50,payload.before)}});

    } else if (type === 'update_profile') {
      if (!inf) return;
      if (payload.displayName) dbRun(`UPDATE users SET display_name=? WHERE id=?`,[payload.displayName,inf.userId]);
      if (payload.status!==undefined) dbRun(`UPDATE users SET status=? WHERE id=?`,[payload.status,inf.userId]);
      dbRun(`UPDATE users SET last_seen=? WHERE id=?`,[Date.now(),inf.userId]);
      const u = safe(getUserById(inf.userId));
      send(ws,{type:'profile_updated',payload:{user:u}});
      bcastAll({type:'user_updated',payload:{user:u}},ws);
    }
  });

  ws.on('close', () => {
    const inf = clients.get(ws);
    if (inf) {
      dbRun(`UPDATE users SET last_seen=? WHERE id=?`,[Date.now(),inf.userId]);
      clients.delete(ws);
      Object.values(typing).forEach(s=>s.delete(inf.userId));
      bcastAll({type:'online',payload:{userIds:onlineIds()}});
      bcastAll({type:'user_updated',payload:{user:safe(getUserById(inf.userId))}});
      console.log('- отключился:', inf.username);
    }
  });
});

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`\n✅ AirWind → http://localhost:${PORT}`);
    console.log(`📡 Локальная сеть → найди свой IP и открой http://<IP>:${PORT}\n`);
  });
});
