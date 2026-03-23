// AirWind Server v2 — Node.js + WebSocket + PostgreSQL
// Запуск: npm install && node server.js

const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const crypto    = require('crypto');
const WebSocket = require('ws');
const { Pool }  = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:WcJASiKKkIBbYieWGemjbKXFDXpPMXTa@postgres.railway.internal:5432/railway',
  ssl: { rejectUnauthorized: false }
});

// ─── pg helpers ───────────────────────────────────
async function dbAll(sql, p = []) {
  try { return (await pool.query(sql, p)).rows; }
  catch(e) { console.error('dbAll:', e.message); return []; }
}
async function dbGet(sql, p = []) { return (await dbAll(sql, p))[0] || null; }
async function dbRun(sql, p = []) {
  try { await pool.query(sql, p); }
  catch(e) { console.error('dbRun:', e.message); }
}
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function hashPw(pw) { return crypto.createHash('sha256').update(pw + 'airwind_v2').digest('hex'); }

const COLORS = ['#5b8cff','#7c5cfc','#3ecf8e','#ff6b6b','#ffd93d','#6bcb77','#ff8e53','#4ecdc4'];

async function initDB() {
  // Проверяем соединение — если упадёт, сервер не запустится
  await pool.query('SELECT 1');
  console.log('🔌 Соединение с PostgreSQL установлено');

  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL, password TEXT NOT NULL,
    avatar_color TEXT NOT NULL, status TEXT DEFAULT '',
    last_seen BIGINT DEFAULT 0, created_at BIGINT DEFAULT 0
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY, is_group INTEGER DEFAULT 0,
    name TEXT, created_at BIGINT DEFAULT 0
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS chat_members (
    chat_id TEXT NOT NULL, user_id TEXT NOT NULL,
    PRIMARY KEY (chat_id, user_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, chat_id TEXT NOT NULL,
    sender_id TEXT NOT NULL, text TEXT NOT NULL,
    ts BIGINT NOT NULL, edited INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS read_receipts (
    msg_id TEXT NOT NULL, user_id TEXT NOT NULL,
    PRIMARY KEY (msg_id, user_id)
  )`);

  const exists = await dbGet(`SELECT id FROM chats WHERE id='__global__'`);
  if (!exists) {
    await pool.query(`INSERT INTO chats(id,is_group,name,created_at) VALUES('__global__',1,'Общий чат',$1)`, [Date.now()]);
    console.log('🌐 Общий чат создан');
  }
  console.log('✅ База данных готова');
}

// ─── User ops ─────────────────────────────────────
async function createUser(username, displayName, password) {
  const id = newId(), now = Date.now();
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  await dbRun(`INSERT INTO users(id,username,display_name,password,avatar_color,status,last_seen,created_at)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, username, displayName, hashPw(password), color, '', now, now]);
  return getUserById(id);
}
async function getUserByUsername(u) { return dbGet(`SELECT * FROM users WHERE username=$1`, [u]); }
async function getUserById(id)      { return dbGet(`SELECT * FROM users WHERE id=$1`, [id]); }
async function getAllUsers()         { return dbAll(`SELECT * FROM users ORDER BY display_name`); }
function safe(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username,
    displayName: u.display_name, avatarColor: u.avatar_color,
    status: u.status, lastSeen: Number(u.last_seen), createdAt: Number(u.created_at)
  };
}

// ─── Chat ops ─────────────────────────────────────
async function getChatMembers(chatId) {
  return (await dbAll(`SELECT user_id FROM chat_members WHERE chat_id=$1`, [chatId])).map(r => r.user_id);
}
async function getUserChats(userId) {
  const chats = await dbAll(`
    SELECT c.* FROM chats c
    INNER JOIN chat_members cm ON c.id=cm.chat_id
    WHERE cm.user_id=$1 AND c.id!='__global__'
  `, [userId]);
  return Promise.all(chats.map(async c => ({
    id: c.id, isGroup: !!c.is_group, name: c.name,
    createdAt: Number(c.created_at), members: await getChatMembers(c.id)
  })));
}
async function createPrivateChat(uid1, uid2) {
  const ex = await dbGet(`
    SELECT c.id FROM chats c
    JOIN chat_members a ON c.id=a.chat_id AND a.user_id=$1
    JOIN chat_members b ON c.id=b.chat_id AND b.user_id=$2
    WHERE c.is_group=0`, [uid1, uid2]);
  if (ex) return { id: ex.id, isGroup: false, members: [uid1, uid2] };
  const id = newId();
  await dbRun(`INSERT INTO chats(id,is_group,created_at) VALUES($1,0,$2)`, [id, Date.now()]);
  await dbRun(`INSERT INTO chat_members(chat_id,user_id) VALUES($1,$2)`, [id, uid1]);
  await dbRun(`INSERT INTO chat_members(chat_id,user_id) VALUES($1,$2)`, [id, uid2]);
  return { id, isGroup: false, members: [uid1, uid2] };
}
async function createGroupChat(name, memberIds) {
  const id = newId();
  await dbRun(`INSERT INTO chats(id,is_group,name,created_at) VALUES($1,1,$2,$3)`, [id, name, Date.now()]);
  await Promise.all(memberIds.map(uid =>
    dbRun(`INSERT INTO chat_members(chat_id,user_id) VALUES($1,$2)`, [id, uid])
  ));
  return { id, isGroup: true, name, members: memberIds };
}

// ─── Message ops ──────────────────────────────────
async function getMessages(chatId, limit = 200, before = null) {
  const p = [chatId];
  let sql = `SELECT m.*, STRING_AGG(rr.user_id, ',') as read_by
    FROM messages m LEFT JOIN read_receipts rr ON m.id=rr.msg_id
    WHERE m.chat_id=$1 AND m.deleted=0`;
  if (before) { p.push(before); sql += ` AND m.ts<$${p.length}`; }
  p.push(limit);
  sql += ` GROUP BY m.id ORDER BY m.ts ASC LIMIT $${p.length}`;
  return (await dbAll(sql, p)).map(toMsg);
}
async function getMessageById(id) {
  const m = await dbGet(`SELECT m.*, STRING_AGG(rr.user_id, ',') as read_by
    FROM messages m LEFT JOIN read_receipts rr ON m.id=rr.msg_id
    WHERE m.id=$1 GROUP BY m.id`, [id]);
  return m ? toMsg(m) : null;
}
function toMsg(m) {
  return { id: m.id, chatId: m.chat_id, senderId: m.sender_id,
    text: m.text, ts: Number(m.ts), edited: !!m.edited,
    readBy: m.read_by ? m.read_by.split(',') : [m.sender_id] };
}
async function insertMessage(chatId, senderId, text) {
  const id = newId(), ts = Date.now();
  await dbRun(`INSERT INTO messages(id,chat_id,sender_id,text,ts) VALUES($1,$2,$3,$4,$5)`,
    [id, chatId, senderId, text, ts]);
  await dbRun(`INSERT INTO read_receipts(msg_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [id, senderId]);
  return getMessageById(id);
}
async function markRead(chatId, userId) {
  const rows = await dbAll(`
    SELECT m.id FROM messages m WHERE m.chat_id=$1 AND m.sender_id!=$2 AND m.deleted=0
    AND m.id NOT IN (SELECT msg_id FROM read_receipts WHERE user_id=$3)
  `, [chatId, userId, userId]);
  await Promise.all(rows.map(r =>
    dbRun(`INSERT INTO read_receipts(msg_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [r.id, userId])
  ));
  return rows.map(r => r.id);
}
async function editMsg(msgId, text, userId) {
  const m = await dbGet(`SELECT * FROM messages WHERE id=$1 AND sender_id=$2 AND deleted=0`, [msgId, userId]);
  if (!m) return null;
  await dbRun(`UPDATE messages SET text=$1, edited=1 WHERE id=$2`, [text, msgId]);
  return getMessageById(msgId);
}
async function deleteMsg(msgId, userId) {
  const m = await getMessageById(msgId);
  if (!m || m.senderId !== userId) return null;
  await dbRun(`UPDATE messages SET deleted=1 WHERE id=$1`, [msgId]);
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

const send     = (ws, d)          => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(d));
const bcastAll = (d, exc = null)  => wss.clients.forEach(w => w !== exc && send(w, d));
async function bcastChat(chatId, d, exc = null) {
  const json = JSON.stringify(d);
  const memberIds = chatId !== '__global__' ? await getChatMembers(chatId) : null;
  clients.forEach((inf, w) => {
    if (w === exc || w.readyState !== WebSocket.OPEN) return;
    if (chatId === '__global__' || memberIds.includes(inf.userId)) w.send(json);
  });
}
const onlineIds = () => [...new Set([...clients.values()].map(c => c.userId))];

wss.on('connection', ws => {
  console.log(`+ клиент, всего: ${wss.clients.size}`);

  ws.on('message', async raw => {
    let pkt; try { pkt = JSON.parse(raw); } catch { return; }
    const { type, payload } = pkt;
    const inf = clients.get(ws);

    if (type === 'register') {
      const { username, displayName, password } = payload;
      if (!username||!displayName||!password) return send(ws,{type:'error',payload:{msg:'Заполните все поля'}});
      if (!/^[a-z0-9_]{3,}$/.test(username)) return send(ws,{type:'error',payload:{msg:'Юзернейм: мин. 3 символа, a-z 0-9 _'}});
      if (await getUserByUsername(username)) return send(ws,{type:'error',payload:{msg:'Имя пользователя занято'}});
      const user = await createUser(username, displayName, password);
      clients.set(ws, { userId: user.id, username });
      send(ws,{type:'auth_ok',payload:{user:safe(user)}});
      send(ws,{type:'chats',payload:{chats:[]}});
      send(ws,{type:'chat_history',payload:{chatId:'__global__',messages:await getMessages('__global__')}});
      send(ws,{type:'users',payload:{users:(await getAllUsers()).map(safe)}});
      send(ws,{type:'online',payload:{userIds:onlineIds()}});
      bcastAll({type:'user_joined',payload:{user:safe(user)}},ws);
      bcastAll({type:'online',payload:{userIds:onlineIds()}});
      console.log('register:', username);

    } else if (type === 'login') {
      const { username, password } = payload;
      const user = await getUserByUsername(username);
      if (!user||user.password!==hashPw(password)) return send(ws,{type:'error',payload:{msg:'Неверное имя пользователя или пароль'}});
      await dbRun(`UPDATE users SET last_seen=$1 WHERE id=$2`,[Date.now(),user.id]);
      clients.set(ws, { userId: user.id, username });
      const myChats = await getUserChats(user.id);
      send(ws,{type:'auth_ok',payload:{user:safe(await getUserById(user.id))}});
      send(ws,{type:'chats',payload:{chats:myChats}});
      send(ws,{type:'chat_history',payload:{chatId:'__global__',messages:await getMessages('__global__')}});
      await Promise.all(myChats.map(async c =>
        send(ws,{type:'chat_history',payload:{chatId:c.id,messages:await getMessages(c.id)}})
      ));
      send(ws,{type:'users',payload:{users:(await getAllUsers()).map(safe)}});
      send(ws,{type:'online',payload:{userIds:onlineIds()}});
      bcastAll({type:'online',payload:{userIds:onlineIds()}},ws);
      console.log('login:', username);

    } else if (type === 'send_message') {
      if (!inf) return;
      const { chatId, text } = payload;
      if (!text||!text.trim()) return;
      const members = await getChatMembers(chatId);
      if (chatId!=='__global__' && !members.includes(inf.userId)) return;
      const msg = await insertMessage(chatId, inf.userId, text.trim());
      await bcastChat(chatId, {type:'new_message',payload:{msg}});
      if (typing[chatId]) { typing[chatId].delete(inf.userId); await bcastChat(chatId,{type:'typing',payload:{chatId,userIds:[...typing[chatId]]}}); }

    } else if (type === 'edit_message') {
      if (!inf) return;
      const updated = await editMsg(payload.msgId, payload.text.trim(), inf.userId);
      if (updated) await bcastChat(updated.chatId, {type:'message_edited',payload:{msg:updated}});

    } else if (type === 'delete_message') {
      if (!inf) return;
      const deleted = await deleteMsg(payload.msgId, inf.userId);
      if (deleted) await bcastChat(deleted.chatId, {type:'message_deleted',payload:{msgId:deleted.id,chatId:deleted.chatId}});

    } else if (type === 'mark_read') {
      if (!inf) return;
      const ids = await markRead(payload.chatId, inf.userId);
      if (ids.length) await bcastChat(payload.chatId, {type:'messages_read',payload:{chatId:payload.chatId,userId:inf.userId,msgIds:ids}});

    } else if (type === 'typing_start') {
      if (!inf) return;
      if (!typing[payload.chatId]) typing[payload.chatId] = new Set();
      typing[payload.chatId].add(inf.userId);
      await bcastChat(payload.chatId,{type:'typing',payload:{chatId:payload.chatId,userIds:[...typing[payload.chatId]]}},ws);
      setTimeout(async ()=>{ if(typing[payload.chatId]){ typing[payload.chatId].delete(inf.userId); await bcastChat(payload.chatId,{type:'typing',payload:{chatId:payload.chatId,userIds:[...typing[payload.chatId]]}}); }},5000);

    } else if (type === 'typing_stop') {
      if (!inf||!typing[payload.chatId]) return;
      typing[payload.chatId].delete(inf.userId);
      await bcastChat(payload.chatId,{type:'typing',payload:{chatId:payload.chatId,userIds:[...typing[payload.chatId]]}},ws);

    } else if (type === 'create_private_chat') {
      if (!inf) return;
      const chat = await createPrivateChat(inf.userId, payload.targetUserId);
      clients.forEach((ci,cw)=>{ if([inf.userId,payload.targetUserId].includes(ci.userId)) send(cw,{type:'chat_created',payload:{chat}}); });

    } else if (type === 'create_group_chat') {
      if (!inf) return;
      const chat = await createGroupChat(payload.name||'Группа', payload.memberIds);
      clients.forEach((ci,cw)=>{ if(payload.memberIds.includes(ci.userId)) send(cw,{type:'chat_created',payload:{chat}}); });

    } else if (type === 'load_more') {
      if (!inf) return;
      send(ws,{type:'chat_history_more',payload:{chatId:payload.chatId,messages:await getMessages(payload.chatId,50,payload.before)}});

    } else if (type === 'update_profile') {
      if (!inf) return;
      if (payload.displayName) await dbRun(`UPDATE users SET display_name=$1 WHERE id=$2`,[payload.displayName,inf.userId]);
      if (payload.status!==undefined) await dbRun(`UPDATE users SET status=$1 WHERE id=$2`,[payload.status,inf.userId]);
      await dbRun(`UPDATE users SET last_seen=$1 WHERE id=$2`,[Date.now(),inf.userId]);
      const u = safe(await getUserById(inf.userId));
      send(ws,{type:'profile_updated',payload:{user:u}});
      bcastAll({type:'user_updated',payload:{user:u}},ws);
    }
  });

  ws.on('close', async () => {
    const inf = clients.get(ws);
    if (inf) {
      await dbRun(`UPDATE users SET last_seen=$1 WHERE id=$2`,[Date.now(),inf.userId]);
      clients.delete(ws);
      Object.values(typing).forEach(s=>s.delete(inf.userId));
      bcastAll({type:'online',payload:{userIds:onlineIds()}});
      bcastAll({type:'user_updated',payload:{user:safe(await getUserById(inf.userId))}});
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
