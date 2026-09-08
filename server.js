require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const nodemailer = require('nodemailer');
const os = require('os');

function getLocalNetworkIp() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254')) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(express.json());
app.use(cors());
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use(session({
    secret: process.env.SESSION_SECRET || 'ginder_secret_key_12345!',
    resave: false,
    saveUninitialized: true
}));

// Helper Functions
function calculateHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371.0;
    const dlat = (lat2 - lat1) * Math.PI / 180;
    const dlon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dlon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// History & Feedback Storage Helpers (Dual-storage: Supabase with Local JSON fallback)
const HISTORY_FILE = path.join(__dirname, 'data', 'history.json');
const FEEDBACK_FILE = path.join(__dirname, 'data', 'feedback.json');
const USER_RECOVERY_FILE = path.join(__dirname, 'data', 'user_recovery.json');

function getLocalHistory() {
    try {
        if (!fs.existsSync(HISTORY_FILE)) return [];
        return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    } catch (e) {
        return [];
    }
}

async function getHistory() {
    try {
        const { data, error } = await supabase
            .from('match_history')
            .select('*')
            .order('matched_at', { ascending: false })
            .limit(200);
        if (!error && data && data.length > 0) {
            return data.map(item => ({
                id: item.id,
                roomId: item.room_id,
                restaurant: item.restaurant,
                participants: item.participants,
                isFallback: !!item.is_fallback,
                fallbackReason: item.fallback_reason,
                matchedAt: item.matched_at
            }));
        }
    } catch (e) {}
    return getLocalHistory();
}

async function saveHistoryItem(item) {
    // 1. Local backup
    try {
        const list = getLocalHistory();
        list.unshift(item);
        if (list.length > 200) list.pop();
        const dir = path.dirname(HISTORY_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(list, null, 2), 'utf8');
    } catch (e) {
        console.error("Error saving local history:", e);
    }

    // 2. Supabase storage
    try {
        await supabase.from('match_history').upsert({
            id: item.id || ('hist_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)),
            room_id: item.roomId || null,
            restaurant_id: item.restaurant ? item.restaurant.id : null,
            restaurant: item.restaurant || {},
            participants: item.participants || [],
            is_fallback: !!item.isFallback,
            fallback_reason: item.fallbackReason || null,
            matched_at: item.matchedAt || new Date().toISOString()
        });
    } catch (e) {}
}

function getLocalFeedback() {
    try {
        if (!fs.existsSync(FEEDBACK_FILE)) return [];
        return JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8'));
    } catch (e) {
        return [];
    }
}

async function getFeedback() {
    try {
        const { data, error } = await supabase
            .from('feedbacks')
            .select('*')
            .order('created_at', { ascending: false });
        if (!error && data && data.length > 0) {
            return data.map(item => ({
                id: item.id,
                type: item.type,
                title: item.title,
                description: item.description,
                contact: item.contact_info,
                contactInfo: item.contact_info,
                createdAt: item.created_at
            }));
        }
    } catch (e) {}
    return getLocalFeedback();
}

async function saveFeedback(item) {
    // 1. Local backup
    try {
        const list = getLocalFeedback();
        list.unshift(item);
        const dir = path.dirname(FEEDBACK_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(list, null, 2), 'utf8');
    } catch (e) {
        console.error("Error saving local feedback:", e);
    }

    // 2. Supabase storage
    try {
        await supabase.from('feedbacks').upsert({
            id: item.id || ('fb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)),
            type: item.type || 'general',
            title: item.title || 'ข้อเสนอแนะทั่วไป',
            description: item.description || '',
            contact_info: item.contactInfo || item.contact || '',
            created_at: item.createdAt || new Date().toISOString()
        });
    } catch (e) {}
}

async function deleteFeedback(id) {
    // 1. Local deletion
    try {
        let list = getLocalFeedback();
        list = list.filter(x => String(x.id) !== String(id));
        fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(list, null, 2), 'utf8');
    } catch (e) {}

    // 2. Supabase deletion
    try {
        await supabase.from('feedbacks').delete().eq('id', id);
    } catch (e) {}
    return true;
}

// User Security & Recovery Storage Helpers (Supabase + Local Fallback)
function getLocalUserRecoveryMap() {
    try {
        if (!fs.existsSync(USER_RECOVERY_FILE)) return {};
        return JSON.parse(fs.readFileSync(USER_RECOVERY_FILE, 'utf8'));
    } catch (e) {
        return {};
    }
}

async function getUserRecoveryRecord(username) {
    const key = (username || '').toLowerCase().trim();
    if (!key) return {};

    // 1. Try Supabase
    try {
        const { data, error } = await supabase
            .from('user_security')
            .select('*')
            .ilike('username', key)
            .maybeSingle();
        if (!error && data) {
            return {
                email: data.recovery_email,
                securityQuestion: data.security_question,
                securityAnswerHash: data.security_answer_hash,
                securityAnswerSalt: data.security_answer_salt,
                recoveryPinHash: data.recovery_pin_hash,
                recoveryPinSalt: data.recovery_pin_salt,
                updatedAt: data.updated_at
            };
        }
    } catch (e) {}

    // 2. Fallback to local
    const map = getLocalUserRecoveryMap();
    return map[key] || {};
}

async function saveUserRecoveryRecord(username, record) {
    const key = (username || '').toLowerCase().trim();
    if (!key) return;

    // 1. Local backup
    try {
        const map = getLocalUserRecoveryMap();
        map[key] = { ...(map[key] || {}), ...record, updatedAt: new Date().toISOString() };
        const dir = path.dirname(USER_RECOVERY_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(USER_RECOVERY_FILE, JSON.stringify(map, null, 2), 'utf8');
    } catch (e) {
        console.error("Error saving local user recovery:", e);
    }

    // 2. Supabase storage
    try {
        const { data: user } = await supabase
            .from('users')
            .select('id, username')
            .ilike('username', key)
            .maybeSingle();

        if (user) {
            const payload = {
                user_id: user.id,
                username: user.username,
                updated_at: new Date().toISOString()
            };
            if (record.email !== undefined) payload.recovery_email = record.email;
            if (record.securityQuestion !== undefined) payload.security_question = record.securityQuestion;
            if (record.securityAnswerHash !== undefined) payload.security_answer_hash = record.securityAnswerHash;
            if (record.securityAnswerSalt !== undefined) payload.security_answer_salt = record.securityAnswerSalt;
            if (record.recoveryPinHash !== undefined) payload.recovery_pin_hash = record.recoveryPinHash;
            if (record.recoveryPinSalt !== undefined) payload.recovery_pin_salt = record.recoveryPinSalt;

            await supabase.from('user_security').upsert(payload);
        }
    } catch (e) {}
}

function hashSecurityValue(val, salt) {
    if (!val) return null;
    const s = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(String(val).trim().toLowerCase(), s, 100000, 32, 'sha256').toString('hex');
    return { hash, salt: s };
}

function verifySecurityValue(val, hash, salt) {
    if (!val || !hash || !salt) return false;
    const computed = crypto.pbkdf2Sync(String(val).trim().toLowerCase(), salt, 100000, 32, 'sha256').toString('hex');
    return computed === hash;
}

function maskEmail(email) {
    if (!email || !email.includes('@')) return '';
    const [user, domain] = email.split('@');
    if (user.length <= 2) return `${user[0]}*@${domain}`;
    return `${user.slice(0, 2)}${'*'.repeat(Math.min(user.length - 2, 5))}@${domain}`;
}

// Nodemailer Setup
let mailTransporter = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    mailTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
}

// In-Memory OTP Store: key = username.toLowerCase() -> { otp, email, expiresAt, attempts }
const activeOtps = new Map();

async function sendRecoveryEmail(toEmail, username, otp) {
    if (mailTransporter && toEmail) {
        try {
            await mailTransporter.sendMail({
                from: `"GINDER Support" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
                to: toEmail,
                subject: "รหัส OTP สำหรับกู้คืนรหัสผ่าน GINDER",
                html: `
                    <div style="font-family: 'Mitr', sans-serif, Arial; max-width: 500px; margin: 0 auto; padding: 24px; background: #170e33; color: #ffffff; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);">
                        <div style="text-align: center; margin-bottom: 20px;">
                            <h2 style="color: #FF3377; margin: 0; font-size: 26px;">GINDER</h2>
                            <p style="color: #b6afcc; margin-top: 4px; font-size: 13px;">ระบบกู้คืนรหัสผ่าน</p>
                        </div>
                        <p style="font-size: 15px;">สวัสดีคุณ <strong>${username}</strong>,</p>
                        <p style="color: #b6afcc; line-height: 1.6; font-size: 14px;">
                            คุณได้ทำการส่งคำขอกู้คืนรหัสผ่าน กรุณาใช้รหัส OTP ด้านล่างนี้เพื่อยืนยันตัวตนของคุณ:
                        </p>
                        <div style="text-align: center; margin: 25px 0;">
                            <span style="display: inline-block; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #EE7816; background: rgba(255, 119, 51, 0.15); padding: 12px 28px; border-radius: 12px; border: 1px solid rgba(255, 119, 51, 0.3);">${otp}</span>
                        </div>
                        <p style="color: #FF3232; font-size: 13px; text-align: center;">* รหัส OTP นี้จะหมดอายุภายใน 15 นาที</p>
                        <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 20px 0;">
                        <p style="color: #616161; font-size: 12px; text-align: center;">หากคุณไม่ได้เป็นผู้ส่งคำขอ โปรดละเว้นอีเมลนี้ บัญชีของคุณยังคงปลอดภัย</p>
                    </div>
                `
            });
            return { sent: true };
        } catch (err) {
            console.error("[EMAIL ERROR] Could not send via SMTP:", err.message);
        }
    }

    // Dev Simulation Fallback
    console.log(`\n======================================================`);
    console.log(`[EMAIL DEV MODE] Target: ${toEmail} | User: ${username}`);
    console.log(`[EMAIL DEV MODE] >>> OTP IS: [ ${otp} ] (Valid for 15 mins) <<<`);
    console.log(`======================================================\n`);
    return { sent: false, devMode: true };
}

function formatRestaurant(r) {
    let allergens = r.allergens || [];
    if (typeof allergens === 'string') {
        try {
            allergens = JSON.parse(allergens);
        } catch (e) {
            allergens = allergens.replace(/[\[\]"]/g, '').split(',').map(x => x.trim()).filter(x => x);
        }
    }
    
    let typeVal = r.type || ['อาหารไทย / อาหารใต้'];
    if (typeof typeVal === 'string') {
        try {
            typeVal = JSON.parse(typeVal);
        } catch (e) {
            typeVal = typeVal.includes(',') ? typeVal.split(',').map(x => x.trim()).filter(x => x) : [typeVal.trim()];
        }
    }

    return {
        id: String(r.id || ''),
        name: r.name || '',
        rating: parseFloat(r.rating) || 4.0,
        priceRange: r.price_range || r.priceRange || '$$',
        avgPrice: parseInt(r.avg_price || r.avgPrice) || 100,
        distance: parseFloat(r.distance) || 1.0,
        type: Array.isArray(typeVal) ? typeVal : [String(typeVal)],
        allergens: Array.isArray(allergens) ? allergens : [],
        image: r.image || '',
        description: r.description || '',
        address: r.address || '',
        latitude: parseFloat(r.latitude) || null,
        longitude: parseFloat(r.longitude) || null
    };
}

async function getAllRestaurants() {
    try {
        const { data, error } = await supabase.from('restaurants').select('*');
        if (error || !data || data.length === 0) {
            if (error) console.error("[Supabase Error] get restaurants:", error);
            const localPath = path.join(__dirname, 'data', 'mock_restaurants.json');
            if (fs.existsSync(localPath)) {
                const localData = JSON.parse(fs.readFileSync(localPath, 'utf8'));
                return localData.map(formatRestaurant);
            }
            return [];
        }
        return (data || []).map(formatRestaurant);
    } catch (e) {
        console.error("Failed to get restaurants:", e);
        const localPath = path.join(__dirname, 'data', 'mock_restaurants.json');
        if (fs.existsSync(localPath)) {
            const localData = JSON.parse(fs.readFileSync(localPath, 'utf8'));
            return localData.map(formatRestaurant);
        }
        return [];
    }
}

const localUsers = new Map();

function createGuestUser(customName) {
    const randomNum = Math.floor(100 + Math.random() * 900);
    const guestId = 'guest_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const guestName = customName ? customName.trim() : `เพื่อนนักชิม ${randomNum}`;
    const guestUser = {
        id: guestId,
        username: guestId,
        display_name: guestName,
        role: 'user',
        allergies: ''
    };
    localUsers.set(guestId, guestUser);
    return guestUser;
}

async function findUserById(id) {
    if (!id) return null;
    if (localUsers.has(id)) return localUsers.get(id);
    try {
        const { data, error } = await supabase.from('users').select('*').eq('id', id).single();
        if (error) return null;
        return data;
    } catch (e) {
        return null;
    }
}

async function findUserByUsername(username) {
    if (!username) return null;
    const lower = username.toLowerCase();
    for (const [_, u] of localUsers.entries()) {
        if (u.username && u.username.toLowerCase() === lower) return u;
    }
    try {
        const { data, error } = await supabase.from('users').select('*').eq('username', username).single();
        if (error) return null;
        return data;
    } catch (e) {
        return null;
    }
}

async function getUserRole(req) {
    if (!req.session.userId) return null;
    const user = await findUserById(req.session.userId);
    return user ? user.role : null;
}

// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'templates', 'index.html')));

app.get('/admin', async (req, res) => {
    const role = await getUserRole(req);
    if (role !== 'admin') {
        return res.status(403).send("403 Forbidden - เฉพาะผู้ดูแลระบบเท่านั้น");
    }
    res.sendFile(path.join(__dirname, 'templates', 'admin.html'));
});

app.get('/api/restaurants', async (req, res) => {
    res.json(await getAllRestaurants());
});

app.post('/api/signup', async (req, res) => {
    const username = (req.body.username || '').trim().toLowerCase();
    const password = req.body.password || '';
    let displayName = (req.body.displayName || '').trim() || username;
    const allergies = req.body.allergies || [];
    
    if (!username || !password) return res.status(400).json({ message: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" });
    
    if (await findUserByUsername(username)) {
        return res.status(400).json({ message: "ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว" });
    }
    
    const salt = crypto.randomBytes(16).toString('hex');
    const pwdHash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
    
    const { count } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const role = (count === 0) ? 'admin' : 'user';
    
    const { data, error } = await supabase.from('users').insert({
        username,
        password_hash: pwdHash,
        password_salt: salt,
        display_name: displayName,
        allergies: Array.isArray(allergies) ? allergies.join(',') : allergies,
        role
    }).select().single();
    
    if (error || !data) return res.status(500).json({ message: "เกิดข้อผิดพลาดในการสร้างบัญชี" });

    // Save recovery credentials if provided
    if (req.body.email || req.body.securityQuestion || req.body.securityAnswer || req.body.recoveryPin) {
        const recoveryData = {
            email: (req.body.email || '').trim().toLowerCase(),
            securityQuestion: (req.body.securityQuestion || '').trim()
        };
        if (req.body.securityAnswer) {
            const h = hashSecurityValue(req.body.securityAnswer);
            recoveryData.securityAnswerHash = h.hash;
            recoveryData.securityAnswerSalt = h.salt;
        }
        if (req.body.recoveryPin) {
            const h = hashSecurityValue(req.body.recoveryPin);
            recoveryData.recoveryPinHash = h.hash;
            recoveryData.recoveryPinSalt = h.salt;
        }
        await saveUserRecoveryRecord(username, recoveryData);
    }
    
    req.session.userId = data.id;
    res.json({ logged_in: true, username, displayName, role, allergies });
});

app.post('/api/guest-login', (req, res) => {
    delete req.session.manualLogout;
    const displayName = (req.body && req.body.displayName) ? req.body.displayName.trim() : null;
    const guest = createGuestUser(displayName);
    req.session.userId = guest.id;
    res.json({
        logged_in: true,
        username: guest.username,
        displayName: guest.display_name,
        role: guest.role,
        allergies: [],
        isGuest: true
    });
});

app.post('/api/login', async (req, res) => {
    delete req.session.manualLogout;
    const username = (req.body.username || '').trim().toLowerCase();
    const password = req.body.password || '';
    
    if (!username || !password) return res.status(400).json({ message: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" });
    
    const user = await findUserByUsername(username);
    if (!user || !user.password_salt || !user.password_hash) {
        return res.status(400).json({ message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
    }
    
    const pwdHash = crypto.pbkdf2Sync(password, user.password_salt, 100000, 32, 'sha256').toString('hex');
    if (pwdHash !== user.password_hash) {
        return res.status(400).json({ message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
    }
    
    req.session.userId = user.id;
    const algStr = user.allergies || '';
    const allergies = algStr ? algStr.split(',').map(x => x.trim()).filter(Boolean) : [];
    
    res.json({ logged_in: true, username: user.username, displayName: user.display_name, role: user.role, allergies });
});

app.post('/api/logout', (req, res) => {
    req.session.manualLogout = true;
    req.session.userId = null;
    res.json({ success: true });
});

app.get('/api/me', async (req, res) => {
    // If user explicitly clicked logout, respect it unless auto is forced or roomId is targeted
    if (req.session.manualLogout && req.query.auto !== 'true') {
        return res.json({ logged_in: false });
    }

    let user = await findUserById(req.session.userId);
    if (!user) {
        // Auto-provision test guest user for seamless instant access!
        user = createGuestUser();
        req.session.userId = user.id;
    }
    const algStr = user.allergies || '';
    const allergies = algStr ? algStr.split(',').map(x => x.trim()).filter(Boolean) : [];
    res.json({
        logged_in: true,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        allergies,
        isGuest: !!String(user.id).startsWith('guest_'),
        networkBaseUrl: `http://${getLocalNetworkIp()}:${PORT}`
    });
});

app.get('/api/admin/restaurants', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });
    res.json(await getAllRestaurants());
});

app.post('/api/admin/restaurants', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });
    if (!req.body.name) return res.status(400).json({ message: "กรุณาระบุชื่อร้านอาหาร" });
    
    const payload = { ...req.body };
    payload.id = payload.id || 'r' + Date.now();
    payload.type = JSON.stringify(payload.type || []);
    payload.allergens = JSON.stringify(payload.allergens || []);
    payload.price_range = payload.priceRange || '$$';
    payload.avg_price = payload.avgPrice || 100;
    delete payload.priceRange;
    delete payload.avgPrice;
    
    const { error } = await supabase.from('restaurants').insert(payload);
    if (error) return res.status(500).json({ message: `ไม่สามารถเพิ่มข้อมูลได้: ${error.message}` });
    res.json({ success: true });
});

app.put('/api/admin/restaurants/:id', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });
    if (!req.body.name) return res.status(400).json({ message: "กรุณาระบุชื่อร้านอาหาร" });
    
    const payload = { ...req.body };
    payload.type = JSON.stringify(payload.type || []);
    payload.allergens = JSON.stringify(payload.allergens || []);
    payload.price_range = payload.priceRange || '$$';
    payload.avg_price = payload.avgPrice || 100;
    delete payload.priceRange;
    delete payload.avgPrice;
    
    const { error } = await supabase.from('restaurants').update(payload).eq('id', req.params.id);
    if (error) return res.status(500).json({ message: `ไม่สามารถแก้ไขข้อมูลได้: ${error.message}` });
    res.json({ success: true });
});

app.delete('/api/admin/restaurants/:id', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });
    const { error } = await supabase.from('restaurants').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ message: "ไม่สามารถลบข้อมูลได้" });
    res.json({ success: true });
});

// --- USER PROFILE & PASSWORD ROUTES ---
app.put('/api/user/profile', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "กรุณาเข้าสู่ระบบก่อนดำเนินการ" });
    const displayName = (req.body.displayName || '').trim();
    if (!displayName) return res.status(400).json({ message: "กรุณาระบุชื่อที่แสดงผล" });

    const allergies = req.body.allergies || [];
    const allergiesStr = Array.isArray(allergies) ? allergies.join(',') : String(allergies);

    // Support guest user updating profile in memory
    if (localUsers.has(req.session.userId)) {
        const u = localUsers.get(req.session.userId);
        u.display_name = displayName;
        u.allergies = allergiesStr;
        return res.json({ success: true, displayName: u.display_name, allergies });
    }

    const { data, error } = await supabase
        .from('users')
        .update({ display_name: displayName, allergies: allergiesStr })
        .eq('id', req.session.userId)
        .select()
        .single();

    if (error) {
        console.error("Error updating profile:", error);
        return res.status(500).json({ message: "ไม่สามารถบันทึกข้อมูลได้" });
    }

    res.json({ success: true, displayName: data.display_name, allergies });
});

app.put('/api/user/password', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "กรุณาเข้าสู่ระบบก่อนดำเนินการ" });
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "กรุณากรอกรหัสผ่านปัจจุบันและรหัสผ่านใหม่" });
    }
    if (newPassword.length < 4) {
        return res.status(400).json({ message: "รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 4 ตัวอักษร" });
    }

    const user = await findUserById(req.session.userId);
    if (!user || !user.password_salt || !user.password_hash) {
        return res.status(400).json({ message: "ไม่พบบัญชีผู้ใช้" });
    }

    const currentHash = crypto.pbkdf2Sync(currentPassword, user.password_salt, 100000, 32, 'sha256').toString('hex');
    if (currentHash !== user.password_hash) {
        return res.status(400).json({ message: "รหัสผ่านปัจจุบันไม่ถูกต้อง" });
    }

    const newSalt = crypto.randomBytes(16).toString('hex');
    const newHash = crypto.pbkdf2Sync(newPassword, newSalt, 100000, 32, 'sha256').toString('hex');

    const { error } = await supabase
        .from('users')
        .update({ password_hash: newHash, password_salt: newSalt })
        .eq('id', req.session.userId);

    if (error) {
        console.error("Error updating password:", error);
        return res.status(500).json({ message: "ไม่สามารถเปลี่ยนรหัสผ่านได้" });
    }

    res.json({ success: true, message: "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว" });
});

// --- USER SECURITY & RECOVERY SETTINGS ---
app.get('/api/user/security', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "กรุณาเข้าสู่ระบบก่อน" });
    const user = await findUserById(req.session.userId);
    if (!user) return res.status(404).json({ message: "ไม่พบผู้ใช้" });

    const rec = await getUserRecoveryRecord(user.username);

    res.json({
        email: rec.email || '',
        securityQuestion: rec.securityQuestion || '',
        hasAnswer: !!rec.securityAnswerHash,
        hasPin: !!rec.recoveryPinHash
    });
});

app.put('/api/user/security', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "กรุณาเข้าสู่ระบบก่อน" });
    const user = await findUserById(req.session.userId);
    if (!user) return res.status(404).json({ message: "ไม่พบผู้ใช้" });

    const email = (req.body.email || '').trim().toLowerCase();
    const securityQuestion = (req.body.securityQuestion || '').trim();
    const securityAnswer = (req.body.securityAnswer || '').trim();
    const recoveryPin = (req.body.recoveryPin || '').trim();

    const updateData = {};
    if (email !== undefined) updateData.email = email;
    if (securityQuestion) updateData.securityQuestion = securityQuestion;

    if (securityAnswer) {
        const hashedAns = hashSecurityValue(securityAnswer);
        updateData.securityAnswerHash = hashedAns.hash;
        updateData.securityAnswerSalt = hashedAns.salt;
    }

    if (recoveryPin) {
        const hashedPin = hashSecurityValue(recoveryPin);
        updateData.recoveryPinHash = hashedPin.hash;
        updateData.recoveryPinSalt = hashedPin.salt;
    }

    await saveUserRecoveryRecord(user.username, updateData);
    res.json({ success: true, message: "บันทึกข้อมูลความปลอดภัยเรียบร้อยแล้ว" });
});

// --- PASSWORD RECOVERY ROUTES (METHODS 2 & 3) ---

// 1. Check user existence and return recovery options
app.post('/api/auth/forgot/check-user', async (req, res) => {
    const username = (req.body.username || '').trim().toLowerCase();
    if (!username) return res.status(400).json({ message: "กรุณาระบุชื่อผู้ใช้" });

    const user = await findUserByUsername(username);
    if (!user) {
        return res.status(404).json({ message: "ไม่พบชื่อผู้ใช้นี้ในระบบ" });
    }

    const rec = await getUserRecoveryRecord(user.username);

    res.json({
        success: true,
        username: user.username,
        displayName: user.display_name,
        hasSecurityQuestion: !!rec.securityQuestion && !!rec.securityAnswerHash,
        securityQuestion: rec.securityQuestion || null,
        hasPin: !!rec.recoveryPinHash,
        hasEmail: !!rec.email,
        maskedEmail: rec.email ? maskEmail(rec.email) : null
    });
});

// 2. Method 3: Verify Security Question or Recovery PIN and reset password
app.post('/api/auth/forgot/verify-question', async (req, res) => {
    const username = (req.body.username || '').trim().toLowerCase();
    const securityAnswer = (req.body.securityAnswer || '').trim();
    const recoveryPin = (req.body.recoveryPin || '').trim();
    const newPassword = req.body.newPassword || '';

    if (!username) return res.status(400).json({ message: "กรุณาระบุชื่อผู้ใช้" });
    if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ message: "รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 4 ตัวอักษร" });
    }

    const user = await findUserByUsername(username);
    if (!user) return res.status(404).json({ message: "ไม่พบผู้ใช้นี้ในระบบ" });

    const rec = await getUserRecoveryRecord(user.username);
    if (!rec || (!rec.securityAnswerHash && !rec.recoveryPinHash)) {
        return res.status(400).json({ message: "บัญชีนี้ยังไม่ได้ตั้งค่าคำถามลับหรือ PIN กู้คืน กรุณาใช้วิธีอื่นหรือติดต่อแอดมิน" });
    }

    let verified = false;

    // Check Security Question Answer
    if (securityAnswer && rec.securityAnswerHash && rec.securityAnswerSalt) {
        if (verifySecurityValue(securityAnswer, rec.securityAnswerHash, rec.securityAnswerSalt)) {
            verified = true;
        }
    }

    // Check Recovery PIN
    if (!verified && recoveryPin && rec.recoveryPinHash && rec.recoveryPinSalt) {
        if (verifySecurityValue(recoveryPin, rec.recoveryPinHash, rec.recoveryPinSalt)) {
            verified = true;
        }
    }

    if (!verified) {
        return res.status(400).json({ message: "คำตอบคำถามความปลอดภัยหรือ PIN ไม่ถูกต้อง" });
    }

    // Hash and update new password
    const newSalt = crypto.randomBytes(16).toString('hex');
    const newHash = crypto.pbkdf2Sync(newPassword, newSalt, 100000, 32, 'sha256').toString('hex');

    const { error } = await supabase
        .from('users')
        .update({ password_hash: newHash, password_salt: newSalt })
        .eq('id', user.id);

    if (error) {
        console.error("Error updating password:", error);
        return res.status(500).json({ message: "เกิดข้อผิดพลาดในการบันทึกรหัสผ่านใหม่" });
    }

    res.json({ success: true, message: "ตั้งรหัสผ่านใหม่สำเร็จแล้ว สามารถเข้าสู่ระบบได้ทันที" });
});

// 3. Method 2: Send Email OTP
app.post('/api/auth/forgot/send-email-otp', async (req, res) => {
    const input = (req.body.username || req.body.email || '').trim().toLowerCase();
    if (!input) return res.status(400).json({ message: "กรุณาระบุชื่อผู้ใช้หรืออีเมล" });

    // Look up user by username or recovery email
    let user = await findUserByUsername(input);
    let rec = null;
    if (user) {
        rec = await getUserRecoveryRecord(user.username);
    } else {
        // Try looking up by email in Supabase user_security
        try {
            const { data } = await supabase
                .from('user_security')
                .select('*')
                .ilike('recovery_email', input)
                .maybeSingle();
            if (data) {
                user = await findUserByUsername(data.username);
                rec = {
                    email: data.recovery_email,
                    securityQuestion: data.security_question,
                    securityAnswerHash: data.security_answer_hash,
                    securityAnswerSalt: data.security_answer_salt,
                    recoveryPinHash: data.recovery_pin_hash,
                    recoveryPinSalt: data.recovery_pin_salt,
                    updatedAt: data.updated_at
                };
            }
        } catch (e) {}

        if (!rec) {
            const recoveryMap = getLocalUserRecoveryMap();
            const found = Object.entries(recoveryMap).find(([_, r]) => r.email && r.email.toLowerCase() === input);
            if (found) {
                rec = found[1];
                user = await findUserByUsername(found[0]);
            }
        }
    }

    if (!user || !rec || !rec.email) {
        return res.status(404).json({ message: "ไม่พบบัญชีผู้ใช้ที่ผูกกับอีเมลนี้ กรุณาใช้วิธีคำถามลับ/PIN หรือติดต่อแอดมิน" });
    }

    // Generate 6 digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 mins

    activeOtps.set(user.username.toLowerCase(), {
        otp,
        email: rec.email,
        expiresAt,
        attempts: 0
    });

    const sendRes = await sendRecoveryEmail(rec.email, user.display_name || user.username, otp);

    res.json({
        success: true,
        message: `ส่งรหัส OTP 6 หลักไปยัง ${maskEmail(rec.email)} เรียบร้อยแล้ว (รหัสมีอายุ 15 นาที)`,
        maskedEmail: maskEmail(rec.email),
        devMode: !!sendRes.devMode,
        devOtp: sendRes.devMode ? otp : undefined
    });
});

// 4. Method 2: Verify OTP and reset password
app.post('/api/auth/forgot/verify-otp', async (req, res) => {
    const username = (req.body.username || '').trim().toLowerCase();
    const otp = (req.body.otp || '').trim();
    const newPassword = req.body.newPassword || '';

    if (!username || !otp) return res.status(400).json({ message: "กรุณากรอกชื่อผู้ใช้และรหัส OTP" });
    if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ message: "รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 4 ตัวอักษร" });
    }

    const user = await findUserByUsername(username);
    if (!user) return res.status(404).json({ message: "ไม่พบบัญชีผู้ใช้นี้" });

    const record = activeOtps.get(username);
    if (!record) {
        return res.status(400).json({ message: "ยังไม่มีการขอรหัส OTP หรือรหัสหมดอายุแล้ว กรุณากดขอรหัสใหม่" });
    }

    if (Date.now() > record.expiresAt) {
        activeOtps.delete(username);
        return res.status(400).json({ message: "รหัส OTP หมดอายุแล้ว กรุณากดขอรหัสใหม่" });
    }

    record.attempts += 1;
    if (record.attempts > 5) {
        activeOtps.delete(username);
        return res.status(400).json({ message: "ป้อนรหัสผิดเกิน 5 ครั้ง รหัส OTP ถูกยกเลิก กรุณาขอรหัสใหม่" });
    }

    if (record.otp !== otp) {
        return res.status(400).json({ message: "รหัส OTP ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง" });
    }

    // OTP is valid! Reset password
    const newSalt = crypto.randomBytes(16).toString('hex');
    const newHash = crypto.pbkdf2Sync(newPassword, newSalt, 100000, 32, 'sha256').toString('hex');

    const { error } = await supabase
        .from('users')
        .update({ password_hash: newHash, password_salt: newSalt })
        .eq('id', user.id);

    if (error) {
        console.error("Error resetting password via OTP:", error);
        return res.status(500).json({ message: "เกิดข้อผิดพลาดในการบันทึกรหัสผ่านใหม่" });
    }

    activeOtps.delete(username);
    res.json({ success: true, message: "ตั้งรหัสผ่านใหม่สำเร็จแล้ว สามารถเข้าสู่ระบบได้ทันที" });
});

app.get('/api/user/history', async (req, res) => {
    const history = await getHistory();
    res.json(history.slice(0, 50));
});

// --- ADMIN USER MANAGEMENT ROUTES ---
app.get('/api/admin/users', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });
    const { data, error } = await supabase
        .from('users')
        .select('id, username, display_name, role, created_at')
        .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ message: "ไม่สามารถดึงข้อมูลผู้ใช้ได้" });
    res.json(data || []);
});

app.put('/api/admin/users/:id/role', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });
    const targetId = req.params.id;
    const newRole = req.body.role === 'admin' ? 'admin' : 'user';

    if (targetId === req.session.userId && newRole !== 'admin') {
        return res.status(400).json({ message: "คุณไม่สามารถลดสิทธิ์บัญชีของตนเองได้" });
    }

    const { error } = await supabase
        .from('users')
        .update({ role: newRole })
        .eq('id', targetId);

    if (error) return res.status(500).json({ message: "ไม่สามารถอัปเดตสิทธิ์ได้" });
    res.json({ success: true, role: newRole });
});

app.delete('/api/admin/users/:id', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });
    const targetId = req.params.id;

    if (targetId === req.session.userId) {
        return res.status(400).json({ message: "คุณไม่สามารถลบบัญชีของตนเองได้" });
    }

    const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', targetId);

    if (error) return res.status(500).json({ message: "ไม่สามารถลบบัญชีผู้ใช้ได้" });
    res.json({ success: true });
});

// --- ADMIN ANALYTICS ROUTE ---
app.get('/api/admin/analytics', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });

    const allRestaurants = await getAllRestaurants();
    const { data: users } = await supabase.from('users').select('id, role');
    const history = await getHistory();
    const feedbacks = await getFeedback();

    const totalUsers = users ? users.length : 0;
    const adminCount = users ? users.filter(u => u.role === 'admin').length : 0;
    const userCount = totalUsers - adminCount;

    // Category breakdown
    const categoryCounts = {};
    allRestaurants.forEach(r => {
        (Array.isArray(r.type) ? r.type : [r.type]).forEach(t => {
            if (t) categoryCounts[t] = (categoryCounts[t] || 0) + 1;
        });
    });

    // Top matched restaurants
    const matchCounts = {};
    history.forEach(h => {
        if (h.restaurant && h.restaurant.name) {
            matchCounts[h.restaurant.name] = (matchCounts[h.restaurant.name] || 0) + 1;
        }
    });
    const topMatched = Object.entries(matchCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);

    // Calculate average price
    let totalPrice = 0;
    allRestaurants.forEach(r => totalPrice += (r.avgPrice || 0));
    const avgPriceAll = allRestaurants.length ? Math.round(totalPrice / allRestaurants.length) : 0;

    res.json({
        totalRestaurants: allRestaurants.length,
        totalUsers,
        adminCount,
        userCount,
        avgPrice: avgPriceAll,
        avgPriceAll,
        totalMatches: history.length,
        totalFeedback: feedbacks.length,
        categories: categoryCounts,
        categoryCounts,
        topMatched,
        topMatchedRestaurants: topMatched
    });
});

// --- FEEDBACK & SUGGESTIONS ROUTES ---
app.post('/api/feedback', async (req, res) => {
    const { type, title, description, contactInfo } = req.body;
    if (!title || !description) {
        return res.status(400).json({ message: "กรุณากรอกหัวข้อและรายละเอียดข้อความ" });
    }
    const item = {
        id: 'fb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        type: type || 'general',
        title: title.trim(),
        description: description.trim(),
        contactInfo: (contactInfo || '').trim(),
        createdAt: new Date().toISOString()
    };
    await saveFeedback(item);
    res.json({ success: true, message: "ขอบคุณสำหรับข้อเสนอแนะของคุณ ข้อมูลถูกส่งถึงผู้ดูแลเรียบร้อยแล้ว!" });
});

app.get('/api/admin/feedback', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });
    res.json(await getFeedback());
});

app.delete('/api/admin/feedback/:id', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });
    await deleteFeedback(req.params.id);
    res.json({ success: true });
});

// --- ADMIN REPORTING & DATA EXPORT ROUTES ---
function csvEscape(val) {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
}

app.get('/api/admin/reports/summary', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });

    try {
        const history = await getHistory();
        const feedbacks = await getFeedback();
        const restaurants = await getAllRestaurants();
        const { data: users } = await supabase.from('users').select('id, username, display_name, allergies, role, created_at');

        const totalMatches = history.length;
        const unanimousMatches = history.filter(h => !h.isFallback).length;
        const fallbackMatches = history.filter(h => !!h.isFallback).length;
        const unanimousRate = totalMatches > 0 ? Math.round((unanimousMatches / totalMatches) * 100) : 0;

        // User allergies aggregation
        const allergyCounts = {};
        (users || []).forEach(u => {
            let list = u.allergies || [];
            if (typeof list === 'string') {
                list = list.split(',').map(x => x.trim()).filter(x => x);
            }
            if (Array.isArray(list)) {
                list.forEach(a => {
                    if (a) allergyCounts[a] = (allergyCounts[a] || 0) + 1;
                });
            }
        });

        const topAllergies = Object.entries(allergyCounts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);

        // Feedback type breakdown
        const feedbackTypeCounts = {};
        feedbacks.forEach(f => {
            const t = f.type || 'general';
            feedbackTypeCounts[t] = (feedbackTypeCounts[t] || 0) + 1;
        });

        res.json({
            metrics: {
                totalMatches,
                unanimousMatches,
                fallbackMatches,
                unanimousRate,
                totalRestaurants: restaurants.length,
                totalUsers: (users || []).length,
                totalFeedbacks: feedbacks.length
            },
            recentMatches: history.slice(0, 100),
            topAllergies,
            feedbackTypeCounts
        });
    } catch (err) {
        console.error("Error generating reports summary:", err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลรายงาน" });
    }
});

app.get('/api/admin/reports/export/:type', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });

    const exportType = req.params.type;
    const nowStr = new Date().toISOString().slice(0, 10);
    let filename = `GINDER_Report_${nowStr}.csv`;
    let rows = [];

    try {
        if (exportType === 'matches') {
            filename = `GINDER_Match_History_${nowStr}.csv`;
            const history = await getHistory();
            rows.push(['รหัสประวัติ', 'รหัสห้อง', 'ชื่อร้านอาหาร', 'คะแนนรีวิว', 'ราคาเฉลี่ยต่อคน', 'หมวดหมู่อาหาร', 'ที่อยู่ร้าน', 'รายชื่อผู้ร่วมโต๊ะ', 'ประเภทผลลัพธ์', 'เหตุผลประกอบ', 'วันที่-เวลาที่แมตช์']);
            history.forEach(h => {
                const rest = h.restaurant || {};
                const typeStr = Array.isArray(rest.type) ? rest.type.join(', ') : (rest.type || '');
                const membersStr = Array.isArray(h.participants) ? h.participants.join(', ') : '';
                const matchType = h.isFallback ? 'ตัวสำรอง (Fallback)' : 'มติเอกฉันท์ 100%';
                rows.push([
                    h.id || '',
                    h.roomId || '',
                    rest.name || '',
                    rest.rating || '',
                    rest.avgPrice || '',
                    typeStr,
                    rest.address || '',
                    membersStr,
                    matchType,
                    h.fallbackReason || '',
                    h.matchedAt || ''
                ]);
            });
        } else if (exportType === 'restaurants') {
            filename = `GINDER_Restaurants_${nowStr}.csv`;
            const restaurants = await getAllRestaurants();
            rows.push(['รหัสร้าน', 'ชื่อร้านอาหาร', 'คะแนนรีวิว', 'ระดับราคา', 'ราคาเฉลี่ย (บาท)', 'ระยะทาง (กม.)', 'หมวดหมู่อาหาร', 'สารก่อภูมิแพ้', 'ที่อยู่', 'ละติจูด', 'ลองจิจูด']);
            restaurants.forEach(r => {
                const typeStr = Array.isArray(r.type) ? r.type.join(', ') : (r.type || '');
                const allergenStr = Array.isArray(r.allergens) ? r.allergens.join(', ') : (r.allergens || '');
                rows.push([
                    r.id || '',
                    r.name || '',
                    r.rating || '',
                    r.priceRange || '',
                    r.avgPrice || '',
                    r.distance || '',
                    typeStr,
                    allergenStr,
                    r.address || '',
                    r.latitude || '',
                    r.longitude || ''
                ]);
            });
        } else if (exportType === 'feedbacks') {
            filename = `GINDER_Feedbacks_${nowStr}.csv`;
            const feedbacks = await getFeedback();
            rows.push(['รหัสฟีดแบ็ก', 'ประเภท', 'หัวข้อ', 'รายละเอียด', 'ข้อมูลติดต่อ', 'วันที่ส่ง']);
            feedbacks.forEach(f => {
                rows.push([
                    f.id || '',
                    f.type || '',
                    f.title || '',
                    f.description || '',
                    f.contact || f.contactInfo || '',
                    f.createdAt || ''
                ]);
            });
        } else if (exportType === 'users') {
            filename = `GINDER_Users_${nowStr}.csv`;
            const { data: users } = await supabase.from('users').select('id, username, display_name, role, allergies, created_at');
            rows.push(['รหัสผู้ใช้ (UUID)', 'ชื่อผู้ใช้ (Username)', 'ชื่อแสดงผล', 'สิทธิ์ (Role)', 'สารก่อภูมิแพ้', 'วันที่สมัคร']);
            (users || []).forEach(u => {
                const allergyStr = Array.isArray(u.allergies) ? u.allergies.join(', ') : (u.allergies || '');
                rows.push([
                    u.id || '',
                    u.username || '',
                    u.display_name || '',
                    u.role || '',
                    allergyStr,
                    u.created_at || ''
                ]);
            });
        } else {
            return res.status(400).json({ message: "ประเภทรายงานไม่ถูกต้อง" });
        }

        // Build CSV string with UTF-8 BOM so Excel on Windows renders Thai correctly
        const csvContent = '\uFEFF' + rows.map(r => r.map(csvEscape).join(',')).join('\r\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csvContent);
    } catch (err) {
        console.error("Error exporting report CSV:", err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการสร้างไฟล์รายงาน" });
    }
});

function recordMatchHistory(room, restaurant, isFallback) {
    if (!room || !restaurant) return;
    const historyItem = {
        id: 'hist_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        roomId: room.id,
        restaurant: {
            id: restaurant.id,
            name: restaurant.name,
            image: restaurant.image,
            rating: restaurant.rating,
            avgPrice: restaurant.avgPrice,
            type: restaurant.type,
            address: restaurant.address
        },
        participants: Object.values(room.users || {}).map(u => u.name),
        isFallback: !!isFallback,
        matchedAt: new Date().toISOString()
    };
    saveHistoryItem(historyItem);
}


// Socket.IO Room Management
const rooms = {};

function triggerFallback(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    room.timerActive = false;
    
    const votes = room.votes;
    const restaurants = room.restaurants;
    const scoreBoard = [];
    
    restaurants.forEach(r => {
        const rVotes = votes[r.id] || {};
        const likeCount = Object.values(rVotes).filter(v => v === 'like').length;
        const dislikeCount = Object.values(rVotes).filter(v => v === 'dislike').length;
        scoreBoard.push({ restaurant: r, likes: likeCount, dislikes: dislikeCount });
    });
    
    scoreBoard.sort((a, b) => {
        if (b.likes !== a.likes) return b.likes - a.likes;
        return a.dislikes - b.dislikes; // Ascending dislikes
    });
    
    let winner = null;
    if (scoreBoard.length > 0) {
        const highestLikes = scoreBoard[0].likes;
        const candidates = scoreBoard.filter(item => item.likes === highestLikes).map(item => item.restaurant);
        winner = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
        if (restaurants.length > 0) {
            winner = restaurants[Math.floor(Math.random() * restaurants.length)];
        }
    }
    
    // As a fallback to the fallback, if somehow restaurants was empty but there's an active DB
    if (!winner) {
        getAllRestaurants().then(allR => {
            if (allR.length > 0) {
                winner = allR[Math.floor(Math.random() * allR.length)];
            }
            emitMatchFallback(roomId, winner);
        });
    } else {
        emitMatchFallback(roomId, winner);
    }
}

function emitMatchFallback(roomId, winner) {
    const room = rooms[roomId];
    if (room) room.matchedRestaurant = winner;
    const winnerName = (winner && typeof winner === 'object') ? winner.name || 'None' : 'None';
    console.log(`[Fallback] Room ${roomId} matched fallback: ${winnerName}`);
    if (winner && room) recordMatchHistory(room, winner, true);
    io.to(roomId).emit('match_found', {
        restaurant: winner,
        isFallback: true,
        reason: winner ? 'หมดเวลา! ระบบสุ่มจากร้านที่คนชอบมากที่สุดให้คุณ' : 'ไม่พบร้านที่ตรงเงื่อนไข'
    });
}

io.on('connection', (socket) => {
    
    socket.on('create_room', (preferences) => {
        let roomId;
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        while (true) {
            roomId = Array.from({length: 4}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
            if (!rooms[roomId]) break;
        }
        
        rooms[roomId] = {
            id: roomId,
            creatorId: socket.id,
            preferences: preferences || {},
            users: {},
            started: false,
            restaurants: [],
            votes: {},
            timerActive: false,
            timeLeft: 180,
            matchedRestaurant: null,
            timerInterval: null
        };
        
        console.log(`[Room Created] ID: ${roomId} by ${socket.id} with preferences`, preferences);
        socket.join(roomId);
        socket.emit('room_created', {
            roomId,
            networkUrl: `http://${getLocalNetworkIp()}:${PORT}`
        });
    });
    
    socket.on('join_room', (data) => {
        const roomId = data.roomId;
        const name = (data.name || '').trim();
        const allergies = data.allergies || [];
        
        const room = rooms[roomId];
        if (!room) return socket.emit('join_error', { message: 'ไม่พบห้องนี้ กรุณาตรวจสอบรหัสห้องอีกครั้ง' });
        if (room.started) return socket.emit('join_error', { message: 'ห้องนี้เริ่มโหวตไปแล้ว ไม่สามารถเข้าร่วมได้' });
        if (!name) return socket.emit('join_error', { message: 'กรุณาระบุชื่อของคุณ' });
        
        for (const [sid, user] of Object.entries(room.users)) {
            if (sid !== socket.id && user.name.toLowerCase() === name.toLowerCase()) {
                return socket.emit('join_error', { message: 'ชื่อนี้มีผู้ใช้งานในห้องนี้แล้ว กรุณาใช้ชื่ออื่น' });
            }
        }
        
        room.users[socket.id] = { name, allergies, progress: 0 };
        socket.join(roomId);
        console.log(`[User Joined] ${name} joined room ${roomId}`);
        
        io.to(roomId).emit('room_state', {
            roomId,
            creatorId: room.creatorId,
            users: Object.entries(room.users).map(([sid, u]) => ({ id: sid, name: u.name, progress: u.progress, allergies: u.allergies })),
            started: room.started
        });
        
        socket.emit('join_success', { userId: socket.id, roomId, creatorId: room.creatorId });
    });
    
    socket.on('update_member', (data) => {
        const roomId = data.roomId;
        const room = rooms[roomId];
        if (room && room.users[socket.id]) {
            if (data.name && data.name.trim()) {
                room.users[socket.id].name = data.name.trim();
            }
            if (Array.isArray(data.allergies)) {
                room.users[socket.id].allergies = data.allergies;
            }
            io.to(roomId).emit('room_state', {
                roomId,
                creatorId: room.creatorId,
                users: Object.entries(room.users).map(([sid, u]) => ({ id: sid, name: u.name, progress: u.progress, allergies: u.allergies })),
                started: room.started
            });
        }
    });
    
    socket.on('kick_user', (data) => {
        const room = rooms[data.roomId];
        if (!room || room.creatorId !== socket.id) return;
        
        const targetSid = data.userId;
        if (room.users[targetSid]) {
            const userName = room.users[targetSid].name;
            delete room.users[targetSid];
            console.log(`[Kick] Host kicked user ${userName}`);
            
            io.to(targetSid).emit('kicked', { roomId: data.roomId });
            const targetSocket = io.sockets.sockets.get(targetSid);
            if (targetSocket) targetSocket.leave(data.roomId);
            
            io.to(data.roomId).emit('room_state', {
                roomId: data.roomId,
                creatorId: room.creatorId,
                users: Object.entries(room.users).map(([sid, u]) => ({ id: sid, name: u.name, progress: u.progress, allergies: u.allergies })),
                started: room.started
            });
        }
    });
    
    socket.on('start_game', async (data) => {
        const roomId = data.roomId;
        const room = rooms[roomId];
        if (!room || room.creatorId !== socket.id || room.started) return;
        
        const allAllergies = new Set();
        Object.values(room.users).forEach(u => u.allergies.forEach(a => allAllergies.add(a)));
        
        const pref = room.preferences;
        const minPrice = pref.minPrice || 0;
        const maxPrice = pref.maxPrice || 9999;
        const maxDistance = pref.maxDistance;
        const foodTypes = pref.foodTypes || [];
        const coords = data.coords || {};
        
        let allR = await getAllRestaurants();
        
        // Calculate real GPS distance with Haversine if user provided coordinates
        const hasGPS = coords && !isNaN(parseFloat(coords.latitude)) && !isNaN(parseFloat(coords.longitude));
        if (hasGPS) {
            const userLat = parseFloat(coords.latitude);
            const userLng = parseFloat(coords.longitude);
            allR = allR.map(r => {
                let dist = r.distance;
                if (r.latitude !== null && r.longitude !== null && !isNaN(parseFloat(r.latitude)) && !isNaN(parseFloat(r.longitude))) {
                    dist = Math.round(calculateHaversine(userLat, userLng, parseFloat(r.latitude), parseFloat(r.longitude)) * 10) / 10;
                }
                return {
                    ...r,
                    distance: dist
                };
            });
            console.log(`[GPS Distance] Calculated real distances from host coordinates (${userLat.toFixed(4)}, ${userLng.toFixed(4)})`);
        }

        // 1. First pass: Apply user's selected filters
        let filtered = allR.filter(r => {
            if (foodTypes.length > 0) {
                if (!r.type.some(t => foodTypes.includes(t))) return false;
            }
            if (r.avgPrice < minPrice || r.avgPrice > maxPrice) return false;
            
            if (maxDistance) {
                if (r.distance > maxDistance) return false;
            }
            if (r.allergens && r.allergens.some(a => allAllergies.has(a))) return false;
            return true;
        });

        // 2. Second pass: If too few (< 6), relax distance filter
        if (filtered.length < 6) {
            console.log(`[Smart Filter] Only ${filtered.length} matches found. Relaxing distance filter...`);
            const relaxedDistance = allR.filter(r => {
                if (foodTypes.length > 0 && !r.type.some(t => foodTypes.includes(t))) return false;
                if (r.avgPrice < minPrice || r.avgPrice > maxPrice) return false;
                if (r.allergens && r.allergens.some(a => allAllergies.has(a))) return false;
                return true;
            });
            relaxedDistance.forEach(item => {
                if (!filtered.some(f => f.id === item.id)) filtered.push(item);
            });
        }

        // 3. Third pass: If still too few (< 6), relax price range slightly
        if (filtered.length < 6) {
            console.log(`[Smart Filter] Still ${filtered.length} matches found. Relaxing price filter...`);
            const relaxedPrice = allR.filter(r => {
                if (foodTypes.length > 0 && !r.type.some(t => foodTypes.includes(t))) return false;
                if (r.allergens && r.allergens.some(a => allAllergies.has(a))) return false;
                return true;
            });
            relaxedPrice.forEach(item => {
                if (!filtered.some(f => f.id === item.id)) filtered.push(item);
            });
        }

        // 4. Fourth pass: If still too few (< 6), fallback to allergen-safe restaurants
        if (filtered.length < 6) {
            console.log(`[Smart Filter] Expanding to allergen-safe restaurants...`);
            const safeR = allR.filter(r => !r.allergens || !r.allergens.some(a => allAllergies.has(a)));
            safeR.forEach(item => {
                if (!filtered.some(f => f.id === item.id)) filtered.push(item);
            });
        }

        // 5. Ultimate safety: Ensure deck is NEVER empty
        if (filtered.length === 0) {
            filtered = [...allR];
        }
        
        // Shuffle and take 10-15 restaurants
        filtered.sort(() => Math.random() - 0.5);
        const countToTake = Math.min(Math.max(filtered.length, 10), 15);
        filtered = filtered.slice(0, countToTake);
        
        console.log(`[Game Started] Room ${roomId}: Prepared ${filtered.length} cards for players.`);
        
        room.restaurants = filtered;
        room.started = true;
        room.timerActive = true;
        room.timeLeft = 180;
        Object.values(room.users).forEach(u => u.progress = 0);
        
        io.to(roomId).emit('game_started', { restaurants: filtered, totalCount: filtered.length });
        
        // Start Timer
        room.timerInterval = setInterval(() => {
            if (!rooms[roomId] || !room.timerActive || room.matchedRestaurant) {
                clearInterval(room.timerInterval);
                return;
            }
            room.timeLeft--;
            io.to(roomId).emit('timer_update', { timeLeft: room.timeLeft });
            if (room.timeLeft <= 0) {
                clearInterval(room.timerInterval);
                triggerFallback(roomId);
            }
        }, 1000);
    });
    
    socket.on('submit_swipe', (data) => {
        const room = rooms[data.roomId];
        if (!room || !room.started || room.matchedRestaurant) return;
        
        const rId = data.restaurantId;
        if (!room.votes[rId]) room.votes[rId] = {};
        room.votes[rId][socket.id] = data.direction;
        
        if (room.users[socket.id]) room.users[socket.id].progress = data.progress || 0;
        
        io.to(data.roomId).emit('user_progress', { userId: socket.id, progress: data.progress || 0 });
        
        const numUsers = Object.keys(room.users).length;
        const likeCount = Object.values(room.votes[rId]).filter(v => v === 'like').length;
        
        // Instant match only when 2 or more users agree on the same restaurant!
        // For solo player testing/demo (numUsers === 1), let them swipe all cards until finished
        if (numUsers > 1 && likeCount === numUsers) {
            const matched = room.restaurants.find(r => String(r.id) === String(rId));
            if (matched) {
                room.matchedRestaurant = matched;
                room.timerActive = false;
                console.log(`[Match Found] Room ${data.roomId} matched ${matched.name}!`);
                recordMatchHistory(room, matched, false);
                io.to(data.roomId).emit('match_found', { restaurant: matched, isFallback: false });
                return;
            }
        }
        
        const totalRestaurants = room.restaurants.length;
        let allFinished = true;
        for (const sid of Object.keys(room.users)) {
            const userVotesCount = Object.values(room.votes).filter(rv => rv[sid]).length;
            if (userVotesCount < totalRestaurants) {
                allFinished = false;
                break;
            }
        }
        
        if (allFinished && totalRestaurants > 0) {
            triggerFallback(data.roomId);
        }
    });
    
    socket.on('disconnect', () => {
        let roomsToDelete = [];
        for (const [roomId, room] of Object.entries(rooms)) {
            if (room.users[socket.id]) {
                delete room.users[socket.id];
                
                if (Object.keys(room.users).length === 0) {
                    if (room.timerInterval) clearInterval(room.timerInterval);
                    roomsToDelete.push(roomId);
                } else {
                    // Transfer host ownership if creator left
                    if (room.creatorId === socket.id) {
                        const remainingSids = Object.keys(room.users);
                        if (remainingSids.length > 0) {
                            room.creatorId = remainingSids[0];
                            console.log(`[Host Transfer] Room ${roomId}: Host migrated from ${socket.id} to ${room.creatorId}`);
                        }
                    }

                    io.to(roomId).emit('room_state', {
                        roomId,
                        creatorId: room.creatorId,
                        users: Object.entries(room.users).map(([sid, u]) => ({ id: sid, name: u.name, progress: u.progress, allergies: u.allergies })),
                        started: room.started
                    });
                    
                    if (room.started && !room.matchedRestaurant) {
                        const activeUserIds = Object.keys(room.users);
                        const numUsers = activeUserIds.length;
                        let foundMatch = false;

                        for (const [rId, rVotes] of Object.entries(room.votes)) {
                            const activeLikes = Object.entries(rVotes).filter(([sid, v]) => room.users[sid] && v === 'like').length;
                            if (activeLikes === numUsers && numUsers > 0) {
                                const matched = room.restaurants.find(r => String(r.id) === String(rId));
                                if (matched) {
                                    room.matchedRestaurant = matched;
                                    room.timerActive = false;
                                    recordMatchHistory(room, matched, false);
                                    io.to(roomId).emit('match_found', { restaurant: matched, isFallback: false });
                                    foundMatch = true;
                                    break;
                                }
                            }
                        }

                        // If no unanimous match and all remaining active players have finished swiping, trigger fallback
                        if (!foundMatch && numUsers > 0) {
                            const totalRestaurants = room.restaurants ? room.restaurants.length : 0;
                            if (totalRestaurants > 0) {
                                let allRemainingFinished = true;
                                for (const sid of activeUserIds) {
                                    const userVotesCount = Object.keys(room.votes).filter(rId => room.votes[rId][sid] !== undefined).length;
                                    if (userVotesCount < totalRestaurants) {
                                        allRemainingFinished = false;
                                        break;
                                    }
                                }
                                if (allRemainingFinished) {
                                    console.log(`[Disconnect Fallback] Room ${roomId}: All remaining players completed voting. Triggering fallback.`);
                                    triggerFallback(roomId);
                                }
                            }
                        }
                    }
                }
                break;
            }
        }
        roomsToDelete.forEach(id => delete rooms[id]);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
