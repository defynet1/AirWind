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

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS coins INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS frame TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS owned_frames TEXT DEFAULT '[]'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS used_promos TEXT DEFAULT '[]'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status_badge TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS owned_badges TEXT DEFAULT '[]'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verified INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banner TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_bg TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS owned_bgs TEXT DEFAULT '[]'`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS sticker TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS media TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to TEXT DEFAULT ''`);

  await pool.query(`CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    media_data TEXT NOT NULL, caption TEXT DEFAULT '',
    ts BIGINT NOT NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS post_likes (
    post_id TEXT NOT NULL, user_id TEXT NOT NULL,
    PRIMARY KEY (post_id, user_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS post_comments (
    id TEXT PRIMARY KEY, post_id TEXT NOT NULL,
    user_id TEXT NOT NULL, text TEXT NOT NULL,
    ts BIGINT NOT NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS message_reactions (
    msg_id TEXT NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL,
    PRIMARY KEY (msg_id, user_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS post_reactions (
    post_id TEXT NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL,
    PRIMARY KEY (post_id, user_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    description TEXT DEFAULT '', owner_id TEXT NOT NULL,
    avatar_color TEXT DEFAULT '#6366f1', created_at BIGINT DEFAULT 0
  )`);
  await pool.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT ''`);
  await pool.query(`CREATE TABLE IF NOT EXISTS channel_members (
    channel_id TEXT NOT NULL, user_id TEXT NOT NULL,
    role TEXT DEFAULT 'member', joined_at BIGINT DEFAULT 0,
    PRIMARY KEY (channel_id, user_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS channel_posts (
    id TEXT PRIMARY KEY, channel_id TEXT NOT NULL,
    text TEXT DEFAULT '', media TEXT DEFAULT '',
    ts BIGINT NOT NULL, edited INTEGER DEFAULT 0
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS channel_post_reactions (
    post_id TEXT NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL,
    PRIMARY KEY (post_id, user_id)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS gifts (
    id TEXT PRIMARY KEY, from_user_id TEXT NOT NULL, to_user_id TEXT NOT NULL,
    gift_id TEXT NOT NULL, ts BIGINT NOT NULL
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS galleries (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE,
    created_at BIGINT DEFAULT 0
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS gallery_photos (
    id TEXT PRIMARY KEY, gallery_id TEXT NOT NULL,
    user_id TEXT NOT NULL, data TEXT NOT NULL,
    caption TEXT DEFAULT '', ts BIGINT NOT NULL
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS sticker_packs (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL,
    cover TEXT DEFAULT '', created_at BIGINT DEFAULT 0
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sticker_items (
    id TEXT PRIMARY KEY, pack_id TEXT NOT NULL, data TEXT NOT NULL,
    emoji TEXT DEFAULT '', ts BIGINT DEFAULT 0
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS user_packs (
    user_id TEXT NOT NULL, pack_id TEXT NOT NULL,
    PRIMARY KEY (user_id, pack_id)
  )`);

  // Indexes for performance (non-fatal if they fail)
  try {
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_id, ts DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_channel_members_channel ON channel_members(channel_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_channel_posts_channel_ts ON channel_posts(channel_id, ts DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_channel_post_reactions_post ON channel_post_reactions(post_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_ts ON posts(ts DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_read_receipts_msg ON read_receipts(msg_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_to ON gifts(to_user_id)`);
  } catch(e) { console.warn('Index creation warning:', e.message); }

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
const FRAME_COSTS  = { gold:10, purple:20, blue:30, pulse:40, fire:50, neon:60, electro:70, rainbow:80, lava:90, cosmos:100 };
const PROMO_CODES  = { '67': {coins:1000000,set:false}, '68': {coins:0,set:true} };
const BADGE_COSTS  = { active:50, popular:200, legend:500, god:2000 };
const BG_COSTS     = { aurora:30, particles:50, waves:40, matrix:60, starfield:70, gradient:20, fireflies:45, rain:35, nebula:80, plasma:100 };
const GIFT_COSTS   = { darwin:25, heart:15, star:30, fuzzy:45, crown:60, diamond:100 };

function safe(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username,
    displayName: u.display_name, avatarColor: u.avatar_color,
    avatarUrl: u.avatar_url || '',
    status: u.status, lastSeen: Number(u.last_seen), createdAt: Number(u.created_at),
    coins: Number(u.coins || 0),
    frame: u.frame || '',
    ownedFrames: JSON.parse(u.owned_frames || '[]'),
    statusBadge: u.status_badge || '',
    ownedBadges: JSON.parse(u.owned_badges || '[]'),
    verified: !!u.verified,
    isAdmin: !!u.is_admin,
    banner: u.banner || '',
    chatBg: u.chat_bg || '',
    ownedBgs: JSON.parse(u.owned_bgs || '[]')
  };
}
async function addCoins(userId, amount) {
  await dbRun(`UPDATE users SET coins = COALESCE(coins, 0) + $1 WHERE id=$2`, [amount, userId]);
  const u = await getUserById(userId);
  if (u) bcastAll({type:'user_updated', payload:{user:safe(u)}});
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
  const msgs = (await dbAll(sql, p)).map(toMsg);
  if (msgs.length) {
    const reacMap = await getMsgReactionsMap(msgs.map(m => m.id));
    msgs.forEach(m => { m.reactions = reacMap[m.id] || {}; });
  }
  return msgs;
}
async function getMessageById(id) {
  const m = await dbGet(`SELECT m.*, STRING_AGG(rr.user_id, ',') as read_by
    FROM messages m LEFT JOIN read_receipts rr ON m.id=rr.msg_id
    WHERE m.id=$1 GROUP BY m.id`, [id]);
  if (!m) return null;
  const msg = toMsg(m);
  const reacMap = await getMsgReactionsMap([id]);
  msg.reactions = reacMap[id] || {};
  return msg;
}
function toMsg(m) {
  return { id: m.id, chatId: m.chat_id, senderId: m.sender_id,
    text: m.text, ts: Number(m.ts), edited: !!m.edited,
    readBy: m.read_by ? m.read_by.split(',') : [m.sender_id],
    sticker: m.sticker || '',
    media: m.media || '',
    replyTo: m.reply_to || '',
    reactions: {} };
}
async function insertMessage(chatId, senderId, text, sticker = '', media = '', replyTo = '') {
  const id = newId(), ts = Date.now();
  await dbRun(`INSERT INTO messages(id,chat_id,sender_id,text,ts,sticker,media,reply_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, chatId, senderId, text, ts, sticker, media, replyTo]);
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

// ─── Reaction helpers ─────────────────────────────
async function getMsgReactionsMap(msgIds) {
  if (!msgIds.length) return {};
  const rows = await dbAll(
    `SELECT msg_id, emoji, STRING_AGG(user_id, ',') as user_ids
     FROM message_reactions WHERE msg_id = ANY($1::text[]) GROUP BY msg_id, emoji`,
    [msgIds]
  );
  const map = {};
  for (const r of rows) {
    if (!map[r.msg_id]) map[r.msg_id] = {};
    map[r.msg_id][r.emoji] = r.user_ids.split(',').filter(Boolean);
  }
  return map;
}
async function getPostReactionsMap(postIds) {
  if (!postIds.length) return {};
  const rows = await dbAll(
    `SELECT post_id, emoji, STRING_AGG(user_id, ',') as user_ids
     FROM post_reactions WHERE post_id = ANY($1::text[]) GROUP BY post_id, emoji`,
    [postIds]
  );
  const map = {};
  for (const r of rows) {
    if (!map[r.post_id]) map[r.post_id] = {};
    map[r.post_id][r.emoji] = r.user_ids.split(',').filter(Boolean);
  }
  return map;
}

// ─── Post ops ─────────────────────────────────────
async function getFeed(limit = 20, before = null) {
  const p = before ? [before, limit] : [Date.now() + 1, limit];
  const rows = await dbAll(`
    SELECT p.*, STRING_AGG(DISTINCT pl.user_id, ',') as likes,
      COUNT(DISTINCT pc.id)::int as comment_count
    FROM posts p
    LEFT JOIN post_likes pl ON p.id = pl.post_id
    LEFT JOIN post_comments pc ON p.id = pc.post_id
    WHERE p.ts < $1
    GROUP BY p.id ORDER BY p.ts DESC LIMIT $2
  `, p);
  const posts = rows.map(toPost);
  if (posts.length) {
    const reacMap = await getPostReactionsMap(posts.map(p => p.id));
    posts.forEach(p => { p.reactions = reacMap[p.id] || {}; });
  }
  return posts;
}
function toPost(p) {
  return {
    id: p.id, userId: p.user_id,
    mediaData: p.media_data, caption: p.caption,
    ts: Number(p.ts),
    likes: p.likes ? p.likes.split(',').filter(Boolean) : [],
    commentCount: Number(p.comment_count || 0),
    reactions: {}
  };
}
async function getPostComments(postId) {
  return dbAll(`SELECT * FROM post_comments WHERE post_id=$1 ORDER BY ts ASC`, [postId]);
}

// ─── Channel ops ──────────────────────────────────
async function getChanPostReactionsMap(postIds) {
  if (!postIds.length) return {};
  const rows = await dbAll(
    `SELECT post_id, emoji, STRING_AGG(user_id, ',') as user_ids
     FROM channel_post_reactions WHERE post_id = ANY($1::text[]) GROUP BY post_id, emoji`,
    [postIds]
  );
  const map = {};
  for (const r of rows) {
    if (!map[r.post_id]) map[r.post_id] = {};
    map[r.post_id][r.emoji] = r.user_ids.split(',').filter(Boolean);
  }
  return map;
}
function toChanPost(p, reactMap = {}) {
  return { id: p.id, channelId: p.channel_id, text: p.text || '',
    media: p.media || '', ts: Number(p.ts), edited: !!p.edited,
    reactions: reactMap[p.id] || {} };
}
async function getChanPostById(id) {
  const p = await dbGet(`SELECT * FROM channel_posts WHERE id=$1`, [id]);
  if (!p) return null;
  const rm = await getChanPostReactionsMap([id]);
  return toChanPost(p, rm);
}
async function getChannelPosts(channelId, limit = 60, before = null) {
  const p = [channelId];
  let sql = `SELECT * FROM channel_posts WHERE channel_id=$1`;
  if (before) { p.push(before); sql += ` AND ts<$${p.length}`; }
  p.push(limit);
  sql += ` ORDER BY ts DESC LIMIT $${p.length}`;
  const rows = (await dbAll(sql, p)).reverse();
  if (!rows.length) return [];
  const rm = await getChanPostReactionsMap(rows.map(r => r.id));
  return rows.map(r => toChanPost(r, rm));
}
function toChan(c) {
  return { id: c.id, name: c.name, description: c.description || '',
    ownerId: c.owner_id, avatarColor: c.avatar_color || '#6366f1',
    avatarUrl: c.avatar_url || '',
    memberCount: Number(c.member_count || 0), isMember: !!Number(c.is_member || 0),
    isOwner: (c.my_role || '') === 'owner', createdAt: Number(c.created_at) };
}
async function getAllChannelsForUser(userId) {
  const rows = await dbAll(`
    SELECT c.*, mc.cnt::int as member_count,
      CASE WHEN um.user_id IS NOT NULL THEN 1 ELSE 0 END as is_member,
      um.role as my_role
    FROM channels c
    LEFT JOIN (SELECT channel_id, COUNT(*) as cnt FROM channel_members GROUP BY channel_id) mc ON mc.channel_id=c.id
    LEFT JOIN channel_members um ON um.channel_id=c.id AND um.user_id=$1
    ORDER BY c.created_at DESC`, [userId]);
  return rows.map(toChan);
}
async function getChannelForUser(channelId, userId) {
  const c = await dbGet(`
    SELECT c.*,
      (SELECT COUNT(*) FROM channel_members WHERE channel_id=c.id)::int as member_count,
      (SELECT COUNT(*) FROM channel_members WHERE channel_id=c.id AND user_id=$1)::int as is_member,
      (SELECT role FROM channel_members WHERE channel_id=c.id AND user_id=$1) as my_role
    FROM channels c WHERE c.id=$2`, [userId, channelId]);
  return c ? toChan(c) : null;
}
async function bcastChannel(channelId, d) {
  const subs = await dbAll(`SELECT user_id FROM channel_members WHERE channel_id=$1`, [channelId]);
  const subSet = new Set(subs.map(s => s.user_id));
  clients.forEach((inf, w) => { if (subSet.has(inf.userId)) send(w, d); });
}
async function bcastChannelUpdate(channelId, excludeWs = null) {
  const promises = [];
  clients.forEach((inf, w) => {
    if (w === excludeWs) return;
    promises.push(getChannelForUser(channelId, inf.userId).then(chan => {
      if (chan) send(w, {type:'channel_updated', payload:{channel:chan}});
    }));
  });
  await Promise.all(promises);
}

// ─── Uploads ──────────────────────────────────────
const UPLOADS_DIR = path.join(process.env.DATA_DIR || __dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function readBody(req, maxBytes = 100 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) { req.destroy(); return reject(new Error('too large')); }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const MEDIA_MIME = {
  '.mp3':'audio/mpeg','.mp4':'video/mp4','.wav':'audio/wav','.ogg':'audio/ogg',
  '.webm':'video/webm','.m4a':'audio/mp4','.aac':'audio/aac','.flac':'audio/flac',
  '.mov':'video/quicktime','.mkv':'video/x-matroska','.avi':'video/x-msvideo',
  '.opus':'audio/opus','.3gp':'video/3gpp'
};

// ─── HTTP server ──────────────────────────────────
const httpServer = http.createServer(async (req, res) => {
  const p = req.url.split('?')[0];

  // ── POST /upload ──
  if (req.method === 'POST' && p === '/upload') {
    try {
      const name  = decodeURIComponent(req.headers['x-filename'] || 'file');
      const ext   = path.extname(name).replace(/[^a-z0-9.]/gi,'').toLowerCase().slice(0,10) || '.bin';
      const body  = await readBody(req);
      const fname = newId() + ext;
      fs.writeFileSync(path.join(UPLOADS_DIR, fname), body);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ url: '/uploads/' + fname }));
    } catch(e) {
      console.error('upload:', e.message);
      res.writeHead(e.message === 'too large' ? 413 : 500); res.end(e.message);
    }
    return;
  }

  // ── GET /uploads/:file ──
  if (req.method === 'GET' && p.startsWith('/uploads/')) {
    const fname = path.basename(p);
    const fp    = path.join(UPLOADS_DIR, fname);
    if (!fp.startsWith(UPLOADS_DIR)) { res.writeHead(403); res.end(); return; }
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, {'Content-Type': MEDIA_MIME[path.extname(fname)] || 'application/octet-stream'});
      res.end(data);
    });
    return;
  }

  // ── Static files ──
  let sp = p === '/' ? '/index.html' : p;
  const fp = path.join(__dirname, sp);
  if (!fp.startsWith(__dirname)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css'};
    res.writeHead(200, {'Content-Type': mime[path.extname(fp)] || 'text/plain'});
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
    try {

    if (type === 'register') {
      const { username, displayName, password } = payload;
      if (!username||!displayName||!password) return send(ws,{type:'error',payload:{msg:'Заполните все поля'}});
      if (!/^[a-z0-9_]{3,}$/.test(username)) return send(ws,{type:'error',payload:{msg:'Юзернейм: мин. 3 символа, a-z 0-9 _'}});
      if (await getUserByUsername(username)) return send(ws,{type:'error',payload:{msg:'Имя пользователя занято'}});
      const user = await createUser(username, displayName, password);
      clients.set(ws, { userId: user.id, username });
      const [globalMsgs, allUsers, feedPosts, channels] = await Promise.all([
        getMessages('__global__'), getAllUsers(), getFeed(20), getAllChannelsForUser(user.id)
      ]);
      send(ws,{type:'auth_ok',payload:{user:safe(user)}});
      send(ws,{type:'chats',payload:{chats:[]}});
      send(ws,{type:'chat_history',payload:{chatId:'__global__',messages:globalMsgs}});
      send(ws,{type:'users',payload:{users:allUsers.map(safe)}});
      send(ws,{type:'online',payload:{userIds:onlineIds()}});
      bcastAll({type:'user_joined',payload:{user:safe(user)}},ws);
      bcastAll({type:'online',payload:{userIds:onlineIds()}});
      send(ws,{type:'feed',payload:{posts:feedPosts,reset:true}});
      send(ws,{type:'channels_list',payload:{channels}});
      console.log('register:', username);

    } else if (type === 'login') {
      const { username, password } = payload;
      const user = await getUserByUsername(username);
      if (!user||user.password!==hashPw(password)) return send(ws,{type:'error',payload:{msg:'Неверное имя пользователя или пароль'}});
      await dbRun(`UPDATE users SET last_seen=$1 WHERE id=$2`,[Date.now(),user.id]);
      clients.set(ws, { userId: user.id, username });
      const [freshUser, myChats, allUsers, globalMsgs, feedPosts, channels] = await Promise.all([
        getUserById(user.id),
        getUserChats(user.id),
        getAllUsers(),
        getMessages('__global__'),
        getFeed(20),
        getAllChannelsForUser(user.id)
      ]);
      send(ws,{type:'auth_ok',payload:{user:safe(freshUser)}});
      send(ws,{type:'chats',payload:{chats:myChats}});
      send(ws,{type:'chat_history',payload:{chatId:'__global__',messages:globalMsgs}});
      send(ws,{type:'users',payload:{users:allUsers.map(safe)}});
      send(ws,{type:'online',payload:{userIds:onlineIds()}});
      bcastAll({type:'online',payload:{userIds:onlineIds()}},ws);
      send(ws,{type:'feed',payload:{posts:feedPosts,reset:true}});
      send(ws,{type:'channels_list',payload:{channels}});
      // Load chat histories in parallel
      await Promise.all(myChats.map(async c =>
        send(ws,{type:'chat_history',payload:{chatId:c.id,messages:await getMessages(c.id)}})
      ));
      console.log('login:', username);

    } else if (type === 'send_message') {
      if (!inf) return;
      const { chatId, text, sticker, media, replyTo } = payload;
      if (!text?.trim() && !sticker && !media) return;
      const members = await getChatMembers(chatId);
      if (chatId!=='__global__' && !members.includes(inf.userId)) return;
      const msg = await insertMessage(chatId, inf.userId, text?.trim()||'', sticker||'', media||'', replyTo||'');
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

    } else if (type === 'invite_to_group') {
      if (!inf) return;
      const { chatId, userIds } = payload;
      if (!chatId || !userIds?.length) return;
      const chat = await dbGet(`SELECT * FROM chats WHERE id=$1 AND is_group=1`, [chatId]);
      if (!chat) return send(ws,{type:'error',payload:{msg:'Группа не найдена'}});
      const existing = (await dbAll(`SELECT user_id FROM chat_members WHERE chat_id=$1`, [chatId])).map(r=>r.user_id);
      const newIds = userIds.filter(id => !existing.includes(id));
      if (!newIds.length) return;
      await Promise.all(newIds.map(uid => dbRun(`INSERT INTO chat_members(chat_id,user_id) VALUES($1,$2)`, [chatId, uid])));
      const allMembers = [...existing, ...newIds];
      const updatedChat = { id: chatId, isGroup: true, name: chat.name, members: allMembers };
      const inviterName = (await getUserById(inf.userId))?.display_name || 'Кто-то';
      const invitedNames = [];
      for (const uid of newIds) { const u = await getUserById(uid); if (u) invitedNames.push(u.display_name); }
      const sysText = `${inviterName} пригласил(а) ${invitedNames.join(', ')}`;
      const sysMsg = { id: newId(), chatId, senderId: '__system__', text: sysText, ts: Date.now(), readBy: [] };
      await dbRun(`INSERT INTO messages(id,chat_id,sender_id,text,ts) VALUES($1,$2,$3,$4,$5)`, [sysMsg.id, chatId, '__system__', sysText, sysMsg.ts]);
      clients.forEach((ci,cw)=>{
        if(allMembers.includes(ci.userId)){
          send(cw,{type:'group_updated',payload:{chat:updatedChat}});
          send(cw,{type:'new_message',payload:{msg:sysMsg}});
        }
      });
      // Отправляем чат новым участникам
      for (const uid of newIds) {
        clients.forEach((ci,cw)=>{ if(ci.userId===uid) send(cw,{type:'chat_created',payload:{chat:updatedChat}}); });
      }

    } else if (type === 'leave_group') {
      if (!inf) return;
      const { chatId } = payload;
      if (!chatId) return;
      const chat = await dbGet(`SELECT * FROM chats WHERE id=$1 AND is_group=1`, [chatId]);
      if (!chat) return send(ws,{type:'error',payload:{msg:'Группа не найдена'}});
      await dbRun(`DELETE FROM chat_members WHERE chat_id=$1 AND user_id=$2`, [chatId, inf.userId]);
      const remaining = (await dbAll(`SELECT user_id FROM chat_members WHERE chat_id=$1`, [chatId])).map(r=>r.user_id);
      const leaver = await getUserById(inf.userId);
      const sysText = `${leaver?.display_name||'Пользователь'} покинул(а) группу`;
      const sysMsg = { id: newId(), chatId, senderId: '__system__', text: sysText, ts: Date.now(), readBy: [] };
      await dbRun(`INSERT INTO messages(id,chat_id,sender_id,text,ts) VALUES($1,$2,$3,$4,$5)`, [sysMsg.id, chatId, '__system__', sysText, sysMsg.ts]);
      send(ws,{type:'group_left',payload:{chatId}});
      const updatedChat = { id: chatId, isGroup: true, name: chat.name, members: remaining };
      clients.forEach((ci,cw)=>{
        if(remaining.includes(ci.userId)){
          send(cw,{type:'group_updated',payload:{chat:updatedChat}});
          send(cw,{type:'new_message',payload:{msg:sysMsg}});
        }
      });

    } else if (type === 'load_more') {
      if (!inf) return;
      send(ws,{type:'chat_history_more',payload:{chatId:payload.chatId,messages:await getMessages(payload.chatId,50,payload.before)}});

    } else if (type === 'update_profile') {
      if (!inf) return;
      if (payload.displayName) await dbRun(`UPDATE users SET display_name=$1 WHERE id=$2`,[payload.displayName,inf.userId]);
      if (payload.status!==undefined) await dbRun(`UPDATE users SET status=$1 WHERE id=$2`,[payload.status,inf.userId]);
      if (payload.avatarUrl!==undefined) await dbRun(`UPDATE users SET avatar_url=$1 WHERE id=$2`,[payload.avatarUrl,inf.userId]);
      if (payload.banner!==undefined) await dbRun(`UPDATE users SET banner=$1 WHERE id=$2`,[payload.banner,inf.userId]);
      await dbRun(`UPDATE users SET last_seen=$1 WHERE id=$2`,[Date.now(),inf.userId]);
      const u = safe(await getUserById(inf.userId));
      send(ws,{type:'profile_updated',payload:{user:u}});
      bcastAll({type:'user_updated',payload:{user:u}},ws);

    } else if (type === 'load_feed') {
      if (!inf) return;
      const posts = await getFeed(20, payload.before||null);
      send(ws,{type:'feed',payload:{posts,reset:!payload.before}});

    } else if (type === 'create_post') {
      if (!inf) return;
      const { mediaData, caption } = payload;
      if (!mediaData) return;
      const id = newId(), ts = Date.now();
      await dbRun(`INSERT INTO posts(id,user_id,media_data,caption,ts) VALUES($1,$2,$3,$4,$5)`,
        [id, inf.userId, mediaData, caption||'', ts]);
      const post = (await getFeed(1, ts+1)).find(p=>p.id===id) || {id,userId:inf.userId,mediaData,caption:caption||'',ts,likes:[],commentCount:0};
      bcastAll({type:'new_post',payload:{post}});

    } else if (type === 'like_post') {
      if (!inf) return;
      const { postId } = payload;
      const existing = await dbGet(`SELECT 1 FROM post_likes WHERE post_id=$1 AND user_id=$2`,[postId,inf.userId]);
      if (existing) {
        await dbRun(`DELETE FROM post_likes WHERE post_id=$1 AND user_id=$2`,[postId,inf.userId]);
      } else {
        await dbRun(`INSERT INTO post_likes(post_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[postId,inf.userId]);
        const post = await dbGet(`SELECT user_id FROM posts WHERE id=$1`,[postId]);
        if (post && post.user_id !== inf.userId) await addCoins(post.user_id, 1);
      }
      const likes = (await dbAll(`SELECT user_id FROM post_likes WHERE post_id=$1`,[postId])).map(r=>r.user_id);
      bcastAll({type:'post_liked',payload:{postId,likes}});

    } else if (type === 'add_comment') {
      if (!inf) return;
      const { postId, text } = payload;
      if (!text||!text.trim()) return;
      const id = newId(), ts = Date.now();
      await dbRun(`INSERT INTO post_comments(id,post_id,user_id,text,ts) VALUES($1,$2,$3,$4,$5)`,
        [id, postId, inf.userId, text.trim(), ts]);
      bcastAll({type:'new_comment',payload:{comment:{id,postId,userId:inf.userId,text:text.trim(),ts}}});

    } else if (type === 'react_message') {
      if (!inf) return;
      const { msgId, emoji } = payload;
      const msg = await getMessageById(msgId);
      if (!msg) return;
      const existing = await dbGet(`SELECT emoji FROM message_reactions WHERE msg_id=$1 AND user_id=$2`, [msgId, inf.userId]);
      if (existing && existing.emoji === emoji) {
        await dbRun(`DELETE FROM message_reactions WHERE msg_id=$1 AND user_id=$2`, [msgId, inf.userId]);
      } else {
        await dbRun(`INSERT INTO message_reactions(msg_id,user_id,emoji) VALUES($1,$2,$3) ON CONFLICT(msg_id,user_id) DO UPDATE SET emoji=$3`, [msgId, inf.userId, emoji]);
      }
      const reacMap = await getMsgReactionsMap([msgId]);
      await bcastChat(msg.chatId, {type:'message_reacted', payload:{msgId, chatId:msg.chatId, reactions:reacMap[msgId]||{}}});

    } else if (type === 'react_post') {
      if (!inf) return;
      const { postId, emoji } = payload;
      const existing = await dbGet(`SELECT emoji FROM post_reactions WHERE post_id=$1 AND user_id=$2`, [postId, inf.userId]);
      if (existing && existing.emoji === emoji) {
        await dbRun(`DELETE FROM post_reactions WHERE post_id=$1 AND user_id=$2`, [postId, inf.userId]);
      } else {
        await dbRun(`INSERT INTO post_reactions(post_id,user_id,emoji) VALUES($1,$2,$3) ON CONFLICT(post_id,user_id) DO UPDATE SET emoji=$3`, [postId, inf.userId, emoji]);
      }
      const reacMap = await getPostReactionsMap([postId]);
      bcastAll({type:'post_reacted', payload:{postId, reactions:reacMap[postId]||{}}});

    } else if (type === 'load_comments') {
      if (!inf) return;
      const rows = await getPostComments(payload.postId);
      send(ws,{type:'comments',payload:{postId:payload.postId,comments:rows.map(c=>({id:c.id,postId:c.post_id,userId:c.user_id,text:c.text,ts:Number(c.ts)}))}});

    // ── CHANNELS ──────────────────────────────────
    } else if (type === 'create_channel') {
      if (!inf) return;
      const { name, description } = payload;
      if (!name?.trim()) return;
      const cid = newId(), now = Date.now();
      const col = COLORS[Math.floor(Math.random()*COLORS.length)];
      await dbRun(`INSERT INTO channels(id,name,description,owner_id,avatar_color,created_at) VALUES($1,$2,$3,$4,$5,$6)`,
        [cid, name.trim(), description?.trim()||'', inf.userId, col, now]);
      await dbRun(`INSERT INTO channel_members(channel_id,user_id,role,joined_at) VALUES($1,$2,'owner',$3)`,
        [cid, inf.userId, now]);
      const chan = await getChannelForUser(cid, inf.userId);
      send(ws, {type:'channel_created', payload:{channel:chan}});
      await bcastChannelUpdate(cid, ws);

    } else if (type === 'join_channel') {
      if (!inf) return;
      const alreadyMember = await dbGet(`SELECT 1 FROM channel_members WHERE channel_id=$1 AND user_id=$2`,[payload.channelId,inf.userId]);
      await dbRun(`INSERT INTO channel_members(channel_id,user_id,role,joined_at) VALUES($1,$2,'member',$3) ON CONFLICT DO NOTHING`,
        [payload.channelId, inf.userId, Date.now()]);
      if (!alreadyMember) {
        const chanRow = await dbGet(`SELECT owner_id FROM channels WHERE id=$1`,[payload.channelId]);
        if (chanRow && chanRow.owner_id !== inf.userId) await addCoins(chanRow.owner_id, 2);
      }
      const chan = await getChannelForUser(payload.channelId, inf.userId);
      if (!chan) return;
      send(ws,{type:'channel_joined', payload:{channel:chan}});
      await bcastChannelUpdate(payload.channelId, ws);

    } else if (type === 'leave_channel') {
      if (!inf) return;
      const own = await dbGet(`SELECT owner_id FROM channels WHERE id=$1`, [payload.channelId]);
      if (own?.owner_id === inf.userId) return;
      await dbRun(`DELETE FROM channel_members WHERE channel_id=$1 AND user_id=$2`, [payload.channelId, inf.userId]);
      send(ws,{type:'channel_left', payload:{channelId:payload.channelId}});
      await bcastChannelUpdate(payload.channelId, ws);

    } else if (type === 'post_to_channel') {
      if (!inf) return;
      const mem = await dbGet(`SELECT role FROM channel_members WHERE channel_id=$1 AND user_id=$2`,
        [payload.channelId, inf.userId]);
      if (!mem || !['owner','admin'].includes(mem.role)) return;
      const { channelId, text, media } = payload;
      if (!text?.trim() && !media) return;
      const pid = newId();
      await dbRun(`INSERT INTO channel_posts(id,channel_id,text,media,ts) VALUES($1,$2,$3,$4,$5)`,
        [pid, channelId, text?.trim()||'', media||'', Date.now()]);
      const post = await getChanPostById(pid);
      await bcastChannel(channelId, {type:'channel_post_new', payload:{post}});

    } else if (type === 'load_channel_posts') {
      if (!inf) return;
      const mem2 = await dbGet(`SELECT 1 FROM channel_members WHERE channel_id=$1 AND user_id=$2`,
        [payload.channelId, inf.userId]);
      if (!mem2) return;
      const posts = await getChannelPosts(payload.channelId, 60, payload.before||null);
      send(ws,{type:'channel_posts', payload:{channelId:payload.channelId, posts, reset:!payload.before}});

    } else if (type === 'react_channel_post') {
      if (!inf) return;
      const cpRow = await dbGet(`SELECT channel_id FROM channel_posts WHERE id=$1`, [payload.postId]);
      if (!cpRow) return;
      const mem3 = await dbGet(`SELECT 1 FROM channel_members WHERE channel_id=$1 AND user_id=$2`,
        [cpRow.channel_id, inf.userId]);
      if (!mem3) return;
      const ex = await dbGet(`SELECT emoji FROM channel_post_reactions WHERE post_id=$1 AND user_id=$2`,
        [payload.postId, inf.userId]);
      if (ex && ex.emoji === payload.emoji) {
        await dbRun(`DELETE FROM channel_post_reactions WHERE post_id=$1 AND user_id=$2`, [payload.postId, inf.userId]);
      } else {
        await dbRun(`INSERT INTO channel_post_reactions(post_id,user_id,emoji) VALUES($1,$2,$3) ON CONFLICT(post_id,user_id) DO UPDATE SET emoji=$3`,
          [payload.postId, inf.userId, payload.emoji]);
      }
      const rm = await getChanPostReactionsMap([payload.postId]);
      await bcastChannel(cpRow.channel_id, {type:'channel_post_reacted',
        payload:{postId:payload.postId, channelId:cpRow.channel_id, reactions:rm[payload.postId]||{}}});

    } else if (type === 'edit_channel') {
      if (!inf) return;
      const { channelId, name, description, avatarColor, avatarUrl } = payload;
      const own = await dbGet(`SELECT owner_id FROM channels WHERE id=$1`, [channelId]);
      if (!own || own.owner_id !== inf.userId) return;
      if (name?.trim()) await dbRun(`UPDATE channels SET name=$1 WHERE id=$2`, [name.trim(), channelId]);
      if (description !== undefined) await dbRun(`UPDATE channels SET description=$1 WHERE id=$2`, [description||'', channelId]);
      if (avatarColor) await dbRun(`UPDATE channels SET avatar_color=$1 WHERE id=$2`, [avatarColor, channelId]);
      if (avatarUrl !== undefined) await dbRun(`UPDATE channels SET avatar_url=$1 WHERE id=$2`, [avatarUrl||'', channelId]);
      await bcastChannelUpdate(channelId);

    } else if (type === 'delete_channel') {
      if (!inf) return;
      const { channelId } = payload;
      const ch = await dbGet(`SELECT owner_id FROM channels WHERE id=$1`, [channelId]);
      if (!ch || ch.owner_id !== inf.userId) return;
      await dbRun(`DELETE FROM channel_post_reactions WHERE post_id IN (SELECT id FROM channel_posts WHERE channel_id=$1)`, [channelId]);
      await dbRun(`DELETE FROM channel_posts WHERE channel_id=$1`, [channelId]);
      await dbRun(`DELETE FROM channel_members WHERE channel_id=$1`, [channelId]);
      await dbRun(`DELETE FROM channels WHERE id=$1`, [channelId]);
      bcastAll({type:'channel_deleted', payload:{channelId}});

    } else if (type === 'delete_post') {
      if (!inf) return;
      const { postId } = payload;
      const post = await dbGet(`SELECT user_id FROM posts WHERE id=$1`, [postId]);
      if (!post || post.user_id !== inf.userId) return;
      await dbRun(`DELETE FROM post_reactions WHERE post_id=$1`, [postId]);
      await dbRun(`DELETE FROM post_likes WHERE post_id=$1`, [postId]);
      await dbRun(`DELETE FROM post_comments WHERE post_id=$1`, [postId]);
      await dbRun(`DELETE FROM posts WHERE id=$1`, [postId]);
      bcastAll({type:'post_deleted', payload:{postId}});

    } else if (type === 'delete_channel_post') {
      if (!inf) return;
      const cpDel = await dbGet(`SELECT channel_id FROM channel_posts WHERE id=$1`, [payload.postId]);
      if (!cpDel) return;
      const memDel = await dbGet(`SELECT role FROM channel_members WHERE channel_id=$1 AND user_id=$2`,
        [cpDel.channel_id, inf.userId]);
      if (!memDel || !['owner','admin'].includes(memDel.role)) return;
      await dbRun(`DELETE FROM channel_posts WHERE id=$1`, [payload.postId]);
      await dbRun(`DELETE FROM channel_post_reactions WHERE post_id=$1`, [payload.postId]);
      await bcastChannel(cpDel.channel_id, {type:'channel_post_deleted',
        payload:{postId:payload.postId, channelId:cpDel.channel_id}});
    } else if (type === 'buy_frame') {
      if (!inf) return;
      const { frameId } = payload;
      const cost = FRAME_COSTS[frameId];
      if (!cost) return;
      const u = await getUserById(inf.userId);
      if (!u) return;
      const owned = JSON.parse(u.owned_frames || '[]');
      if (owned.includes(frameId)) {
        // already owned — just equip
        await dbRun(`UPDATE users SET frame=$1 WHERE id=$2`, [frameId, inf.userId]);
      } else {
        if (Number(u.coins || 0) < cost) return send(ws,{type:'error',payload:{msg:'Недостаточно монет'}});
        owned.push(frameId);
        await dbRun(`UPDATE users SET coins=coins-$1, owned_frames=$2, frame=$3 WHERE id=$4`,
          [cost, JSON.stringify(owned), frameId, inf.userId]);
      }
      const updated = await getUserById(inf.userId);
      send(ws, {type:'frame_ok', payload:{frameId}});
      bcastAll({type:'user_updated', payload:{user:safe(updated)}});

    } else if (type === 'redeem_promo') {
      if (!inf) return;
      const code = String(payload.code||'').trim();
      const ADMIN_PROMO = 'absdgsBhfvj_ejds=hscgbfsejghEc';
      if (code === ADMIN_PROMO) {
        const u = await getUserById(inf.userId);
        const used = JSON.parse(u?.used_promos||'[]');
        if (used.includes(code)) return send(ws,{type:'error',payload:{msg:'Промокод уже использован'}});
        used.push(code);
        await dbRun(`UPDATE users SET is_admin=1, used_promos=$1 WHERE id=$2`,[JSON.stringify(used),inf.userId]);
        const updated = await getUserById(inf.userId);
        send(ws,{type:'promo_ok',payload:{msg:'Вы стали администратором!'}});
        bcastAll({type:'user_updated',payload:{user:safe(updated)}});
        return;
      }
      const promo = PROMO_CODES[code];
      if (!promo) return send(ws,{type:'error',payload:{msg:'Неверный промокод'}});
      const u = await getUserById(inf.userId);
      const used = JSON.parse(u?.used_promos||'[]');
      if (used.includes(code)) return send(ws,{type:'error',payload:{msg:'Промокод уже использован'}});
      used.push(code);
      if (promo.set) {
        await dbRun(`UPDATE users SET coins=$1, used_promos=$2 WHERE id=$3`,[promo.coins,JSON.stringify(used),inf.userId]);
      } else {
        await dbRun(`UPDATE users SET coins=coins+$1, used_promos=$2 WHERE id=$3`,[promo.coins,JSON.stringify(used),inf.userId]);
      }
      const updated = await getUserById(inf.userId);
      send(ws,{type:'promo_ok',payload:{coins:promo.coins,set:promo.set}});
      bcastAll({type:'user_updated',payload:{user:safe(updated)}});

    } else if (type === 'equip_frame') {
      if (!inf) return;
      const { frameId } = payload; // '' to remove frame
      if (frameId) {
        const u = await getUserById(inf.userId);
        const owned = JSON.parse(u?.owned_frames || '[]');
        if (!owned.includes(frameId)) return;
      }
      await dbRun(`UPDATE users SET frame=$1 WHERE id=$2`, [frameId||'', inf.userId]);
      const updated = await getUserById(inf.userId);
      bcastAll({type:'user_updated', payload:{user:safe(updated)}});

    } else if (type === 'buy_badge') {
      if (!inf) return;
      const { badgeId } = payload;
      const cost = BADGE_COSTS[badgeId];
      if (!cost) return;
      const u = await getUserById(inf.userId);
      if (!u) return;
      const owned = JSON.parse(u.owned_badges || '[]');
      if (owned.includes(badgeId)) {
        await dbRun(`UPDATE users SET status_badge=$1 WHERE id=$2`, [badgeId, inf.userId]);
      } else {
        if (Number(u.coins || 0) < cost) return send(ws,{type:'error',payload:{msg:'Недостаточно монет'}});
        owned.push(badgeId);
        await dbRun(`UPDATE users SET coins=coins-$1, owned_badges=$2, status_badge=$3 WHERE id=$4`,
          [cost, JSON.stringify(owned), badgeId, inf.userId]);
      }
      const updatedB = await getUserById(inf.userId);
      send(ws, {type:'badge_ok', payload:{badgeId}});
      bcastAll({type:'user_updated', payload:{user:safe(updatedB)}});

    } else if (type === 'equip_badge') {
      if (!inf) return;
      const { badgeId } = payload; // '' to remove badge
      if (badgeId) {
        const u = await getUserById(inf.userId);
        const owned = JSON.parse(u?.owned_badges || '[]');
        if (!owned.includes(badgeId)) return;
      }
      await dbRun(`UPDATE users SET status_badge=$1 WHERE id=$2`, [badgeId||'', inf.userId]);
      const updatedB = await getUserById(inf.userId);
      bcastAll({type:'user_updated', payload:{user:safe(updatedB)}});

    } else if (type === 'buy_bg') {
      if (!inf) return;
      const { bgId } = payload;
      const cost = BG_COSTS[bgId];
      if (!cost) return;
      const u = await getUserById(inf.userId);
      if (!u) return;
      const owned = JSON.parse(u.owned_bgs || '[]');
      if (owned.includes(bgId)) {
        await dbRun(`UPDATE users SET chat_bg=$1 WHERE id=$2`, [bgId, inf.userId]);
      } else {
        if (Number(u.coins || 0) < cost) return send(ws,{type:'error',payload:{msg:'Недостаточно монет'}});
        owned.push(bgId);
        await dbRun(`UPDATE users SET coins=coins-$1, owned_bgs=$2, chat_bg=$3 WHERE id=$4`,
          [cost, JSON.stringify(owned), bgId, inf.userId]);
      }
      const updBg = await getUserById(inf.userId);
      send(ws, {type:'bg_ok', payload:{bgId}});
      send(ws, {type:'profile_updated', payload:{user:safe(updBg)}});

    } else if (type === 'equip_bg') {
      if (!inf) return;
      const { bgId } = payload;
      if (bgId) {
        const u = await getUserById(inf.userId);
        const owned = JSON.parse(u?.owned_bgs || '[]');
        if (!owned.includes(bgId)) return;
      }
      await dbRun(`UPDATE users SET chat_bg=$1 WHERE id=$2`, [bgId||'', inf.userId]);
      const updBg = await getUserById(inf.userId);
      send(ws, {type:'profile_updated', payload:{user:safe(updBg)}});

    // ── Sticker Packs ──
    } else if (type === 'create_sticker_pack') {
      if (!inf) return;
      const name = String(payload.name||'').trim();
      if (!name) return send(ws,{type:'error',payload:{msg:'Введите название набора'}});
      const id = newId();
      await dbRun(`INSERT INTO sticker_packs(id,name,owner_id,created_at) VALUES($1,$2,$3,$4)`, [id, name, inf.userId, Date.now()]);
      await dbRun(`INSERT INTO user_packs(user_id,pack_id) VALUES($1,$2)`, [inf.userId, id]);
      send(ws,{type:'pack_created',payload:{pack:{id,name,ownerId:inf.userId,cover:'',stickers:[]}}});

    } else if (type === 'add_sticker_to_pack') {
      if (!inf) return;
      const { packId, data, emoji } = payload;
      if (!packId||!data) return;
      const pack = await dbGet(`SELECT * FROM sticker_packs WHERE id=$1`, [packId]);
      if (!pack||pack.owner_id!==inf.userId) return send(ws,{type:'error',payload:{msg:'Нет прав'}});
      const id = newId();
      await dbRun(`INSERT INTO sticker_items(id,pack_id,data,emoji,ts) VALUES($1,$2,$3,$4,$5)`, [id, packId, data, emoji||'', Date.now()]);
      if (!pack.cover) await dbRun(`UPDATE sticker_packs SET cover=$1 WHERE id=$2`, [data, packId]);
      send(ws,{type:'sticker_added',payload:{packId,sticker:{id,data,emoji:emoji||''}}});

    } else if (type === 'delete_sticker') {
      if (!inf) return;
      const { stickerId } = payload;
      const st = await dbGet(`SELECT si.*, sp.owner_id FROM sticker_items si JOIN sticker_packs sp ON sp.id=si.pack_id WHERE si.id=$1`, [stickerId]);
      if (!st||st.owner_id!==inf.userId) return;
      await dbRun(`DELETE FROM sticker_items WHERE id=$1`, [stickerId]);
      send(ws,{type:'sticker_deleted',payload:{stickerId,packId:st.pack_id}});

    } else if (type === 'delete_sticker_pack') {
      if (!inf) return;
      const { packId } = payload;
      const pack = await dbGet(`SELECT * FROM sticker_packs WHERE id=$1`, [packId]);
      if (!pack||pack.owner_id!==inf.userId) return;
      await dbRun(`DELETE FROM sticker_items WHERE pack_id=$1`, [packId]);
      await dbRun(`DELETE FROM user_packs WHERE pack_id=$1`, [packId]);
      await dbRun(`DELETE FROM sticker_packs WHERE id=$1`, [packId]);
      send(ws,{type:'pack_deleted',payload:{packId}});

    } else if (type === 'get_my_packs') {
      if (!inf) return;
      const packs = await dbAll(`SELECT sp.* FROM sticker_packs sp JOIN user_packs up ON up.pack_id=sp.id WHERE up.user_id=$1 ORDER BY sp.created_at DESC`, [inf.userId]);
      const result = [];
      for (const p of packs) {
        const stickers = await dbAll(`SELECT id,data,emoji FROM sticker_items WHERE pack_id=$1 ORDER BY ts`, [p.id]);
        result.push({id:p.id, name:p.name, ownerId:p.owner_id, cover:p.cover||'', stickers});
      }
      send(ws,{type:'my_packs',payload:{packs:result}});

    } else if (type === 'get_all_packs') {
      if (!inf) return;
      const packs = await dbAll(`SELECT sp.*, CASE WHEN up.user_id IS NOT NULL THEN 1 ELSE 0 END as installed FROM sticker_packs sp LEFT JOIN user_packs up ON up.pack_id=sp.id AND up.user_id=$1 ORDER BY sp.created_at DESC`, [inf.userId]);
      const result = [];
      for (const p of packs) {
        const stickers = await dbAll(`SELECT id,data,emoji FROM sticker_items WHERE pack_id=$1 ORDER BY ts`, [p.id]);
        result.push({id:p.id, name:p.name, ownerId:p.owner_id, cover:p.cover||'', installed:!!p.installed, stickers});
      }
      send(ws,{type:'all_packs',payload:{packs:result}});

    } else if (type === 'install_pack') {
      if (!inf) return;
      const { packId } = payload;
      const exists = await dbGet(`SELECT 1 FROM user_packs WHERE user_id=$1 AND pack_id=$2`, [inf.userId, packId]);
      if (!exists) await dbRun(`INSERT INTO user_packs(user_id,pack_id) VALUES($1,$2)`, [inf.userId, packId]);
      send(ws,{type:'pack_installed',payload:{packId}});

    } else if (type === 'uninstall_pack') {
      if (!inf) return;
      const { packId } = payload;
      const pack = await dbGet(`SELECT * FROM sticker_packs WHERE id=$1`, [packId]);
      if (pack&&pack.owner_id===inf.userId) return send(ws,{type:'error',payload:{msg:'Нельзя удалить свой набор'}});
      await dbRun(`DELETE FROM user_packs WHERE user_id=$1 AND pack_id=$2`, [inf.userId, packId]);
      send(ws,{type:'pack_uninstalled',payload:{packId}});

    } else if (type === 'admin_verify') {
      if (!inf) return;
      const admin = await getUserById(inf.userId);
      if (!admin?.is_admin) return send(ws,{type:'error',payload:{msg:'Нет прав'}});
      const { userId, verified } = payload;
      await dbRun(`UPDATE users SET verified=$1 WHERE id=$2`, [verified?1:0, userId]);
      const target = await getUserById(userId);
      if (target) bcastAll({type:'user_updated', payload:{user:safe(target)}});
      send(ws,{type:'admin_ok',payload:{msg:verified?'Галочка выдана':'Галочка снята'}});

    } else if (type === 'admin_get_users') {
      if (!inf) return;
      const admin = await getUserById(inf.userId);
      if (!admin?.is_admin) return send(ws,{type:'error',payload:{msg:'Нет прав'}});
      const all = await getAllUsers();
      send(ws,{type:'admin_users',payload:{users:all.map(safe)}});

    } else if (type === 'admin_clear_chat') {
      if (!inf) return;
      const admin = await getUserById(inf.userId);
      if (!admin?.is_admin) return send(ws,{type:'error',payload:{msg:'Нет прав'}});
      const { chatId } = payload;
      if (!chatId) return;
      await dbRun(`DELETE FROM messages WHERE chat_id=$1`, [chatId]);
      flush();
      // Уведомляем всех участников чата
      const members = await getChatMembers(chatId);
      clients.forEach((ci, cw) => {
        if (chatId === '__global__' || members.includes(ci.userId)) {
          send(cw, {type:'chat_cleared', payload:{chatId}});
        }
      });
      send(ws,{type:'admin_ok',payload:{msg:'История чата очищена'}});

    } else if (type === 'admin_get_chats') {
      if (!inf) return;
      const admin = await getUserById(inf.userId);
      if (!admin?.is_admin) return send(ws,{type:'error',payload:{msg:'Нет прав'}});
      const rows = await dbAll(`SELECT c.id, c.name, c.is_group, (SELECT COUNT(*) FROM messages WHERE chat_id=c.id) as msg_count FROM chats c ORDER BY c.name`);
      const chats = rows.map(r => ({id:r.id, name:r.name, isGroup:!!r.is_group, msgCount:Number(r.msg_count)}));
      send(ws,{type:'admin_chats',payload:{chats}});

    // ── GALLERY ──
    } else if (type === 'gallery_create') {
      if (!inf) return;
      const existing = await dbGet(`SELECT id FROM galleries WHERE user_id=$1`, [inf.userId]);
      if (existing) return send(ws, {type:'error', payload:{msg:'У вас уже есть галерея'}});
      const id = newId();
      await dbRun(`INSERT INTO galleries(id,user_id,created_at) VALUES($1,$2,$3)`, [id, inf.userId, Date.now()]);
      const gallery = {id, userId:inf.userId};
      send(ws, {type:'gallery_created', payload:{gallery}});
      bcastAll({type:'galleries_updated', payload:{}});

    } else if (type === 'gallery_upload') {
      if (!inf) return;
      const gal = await dbGet(`SELECT id FROM galleries WHERE user_id=$1`, [inf.userId]);
      if (!gal) return send(ws, {type:'error', payload:{msg:'Сначала создайте галерею'}});
      const { data, caption } = payload;
      if (!data) return;
      const id = newId(), ts = Date.now();
      await dbRun(`INSERT INTO gallery_photos(id,gallery_id,user_id,data,caption,ts) VALUES($1,$2,$3,$4,$5,$6)`,
        [id, gal.id, inf.userId, data, caption||'', ts]);
      send(ws, {type:'gallery_uploaded', payload:{photo:{id,galleryId:gal.id,userId:inf.userId,data,caption:caption||'',ts}}});

    } else if (type === 'gallery_delete_photo') {
      if (!inf) return;
      const { photoId } = payload;
      const photo = await dbGet(`SELECT * FROM gallery_photos WHERE id=$1`, [photoId]);
      if (!photo || photo.user_id !== inf.userId) return;
      await dbRun(`DELETE FROM gallery_photos WHERE id=$1`, [photoId]);
      send(ws, {type:'gallery_photo_deleted', payload:{photoId}});

    } else if (type === 'gallery_get') {
      const { userId } = payload;
      if (!userId) return;
      const gal = await dbGet(`SELECT id FROM galleries WHERE user_id=$1`, [userId]);
      if (!gal) return send(ws, {type:'gallery_data', payload:{userId, gallery:null, photos:[]}});
      const photos = await dbAll(`SELECT * FROM gallery_photos WHERE gallery_id=$1 ORDER BY ts DESC`, [gal.id]);
      send(ws, {type:'gallery_data', payload:{userId, gallery:{id:gal.id,userId}, photos: photos.map(p=>({id:p.id,userId:p.user_id,data:p.data,caption:p.caption||'',ts:Number(p.ts)}))}});

    } else if (type === 'galleries_list') {
      const gals = await dbAll(`SELECT g.id, g.user_id, (SELECT COUNT(*) FROM gallery_photos WHERE gallery_id=g.id) as cnt FROM galleries g ORDER BY g.created_at DESC`);
      send(ws, {type:'galleries_list', payload:{galleries: gals.map(g=>({id:g.id, userId:g.user_id, photoCount:Number(g.cnt)}))}});

    } else if (type === 'gallery_delete') {
      if (!inf) return;
      const gal = await dbGet(`SELECT id FROM galleries WHERE user_id=$1`, [inf.userId]);
      if (!gal) return;
      await dbRun(`DELETE FROM gallery_photos WHERE gallery_id=$1`, [gal.id]);
      await dbRun(`DELETE FROM galleries WHERE id=$1`, [gal.id]);
      send(ws, {type:'gallery_deleted', payload:{}});
      bcastAll({type:'galleries_updated', payload:{}});

    } else if (type === 'send_gift') {
      if (!inf) return;
      const { toUserId, giftId } = payload;
      const cost = GIFT_COSTS[giftId];
      if (!cost) return send(ws,{type:'error',payload:{msg:'Неизвестная медаль'}});
      if (toUserId === inf.userId) return send(ws,{type:'error',payload:{msg:'Нельзя наградить себя'}});
      const sender = await getUserById(inf.userId);
      if (!sender || Number(sender.coins||0) < cost) return send(ws,{type:'error',payload:{msg:'Недостаточно монет'}});
      const target = await getUserById(toUserId);
      if (!target) return send(ws,{type:'error',payload:{msg:'Пользователь не найден'}});
      await dbRun(`UPDATE users SET coins=coins-$1 WHERE id=$2`, [cost, inf.userId]);
      const id = newId();
      await dbRun(`INSERT INTO gifts(id,from_user_id,to_user_id,gift_id,ts) VALUES($1,$2,$3,$4,$5)`, [id, inf.userId, toUserId, giftId, Date.now()]);
      const updatedSender = await getUserById(inf.userId);
      bcastAll({type:'user_updated', payload:{user:safe(updatedSender)}});
      send(ws,{type:'gift_sent',payload:{giftId,toUserId,toName:target.display_name}});
      // notify recipient
      clients.forEach((ci,w)=>{if(ci.userId===toUserId)send(w,{type:'gift_received',payload:{giftId,fromName:sender.display_name,fromId:inf.userId}});});

    } else if (type === 'get_gifts') {
      if (!inf) return;
      const userId = payload.userId || inf.userId;
      const gifts = await dbAll(`SELECT gift_id, COUNT(*) as cnt FROM gifts WHERE to_user_id=$1 GROUP BY gift_id`, [userId]);
      send(ws,{type:'user_gifts',payload:{userId, gifts}});
    }
    } catch(e) { console.error('ws msg error:', e); send(ws,{type:'error',payload:{msg:'Ошибка сервера: '+e.message}}); }
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
}).catch(e => {
  console.error('❌ Не удалось запустить сервер:', e.message);
  process.exit(1);
});
