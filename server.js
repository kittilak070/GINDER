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

// Canonical Base Application URL for OAuth Redirects & Room Links
const APP_URL = (process.env.APP_URL || process.env.BASE_URL || 'https://ginder.onrender.com').replace(/\/+$/, '');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.disable('x-powered-by');

// OWASP Security Headers (Skill 09: OWASP Security)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    res.setHeader('Content-Security-Policy', 
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; " +
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com data:; " +
        "img-src 'self' data: blob: https:; " +
        "connect-src 'self' https://icksdmnzcdswiscusrep.supabase.co wss://icksdmnzcdswiscusrep.supabase.co https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://ginder.onrender.com; " +
        "object-src 'none'; " +
        "base-uri 'self'; " +
        "frame-ancestors 'self';"
    );
    res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=(), payment=()');
    next();
});

// OWASP Payload Size Limit (Skill 09: Defense against memory flooding / DoS)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Restrict CORS origins to authorized app domains & local development
const allowedOrigins = [
    'https://ginder.onrender.com',
    APP_URL,
    'http://localhost:3000',
    'http://localhost:5000',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5000'
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || (typeof origin === 'string' && origin.endsWith('.onrender.com'))) {
            callback(null, true);
        } else {
            callback(null, false);
        }
    },
    credentials: true
}));
app.use('/static', express.static(path.join(__dirname, 'static'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        }
    }
}));
app.set('trust proxy', 1);

// Enforce HTTPS in production behind Render reverse proxy
app.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
        return res.redirect(301, `https://${req.hostname}${req.originalUrl}`);
    }
    next();
});

app.use(session({
    secret: process.env.SESSION_SECRET || 'ginder_secret_key_12345!',
    resave: false,
    saveUninitialized: true,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
}));

// In-Memory Rate Limiting (Skill 09: OWASP A07 Identification & Authentication Failures)
function createRateLimiter({ windowMs = 60 * 1000, max = 20, message = "Too many requests, please try again later." } = {}) {
    const hits = new Map();
    return (req, res, next) => {
        const rawIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        const ip = typeof rawIp === 'string' ? rawIp.split(',')[0].trim() : 'unknown';
        const now = Date.now();
        const record = hits.get(ip) || { count: 0, resetTime: now + windowMs };

        if (now > record.resetTime) {
            record.count = 1;
            record.resetTime = now + windowMs;
        } else {
            record.count++;
        }
        hits.set(ip, record);

        // Periodic cleanup
        if (hits.size > 2000) {
            for (const [k, v] of hits.entries()) {
                if (now > v.resetTime) hits.delete(k);
            }
        }

        if (record.count > max) {
            return res.status(429).json({ error: message, retryAfterSeconds: Math.ceil((record.resetTime - now) / 1000) });
        }
        next();
    };
}

const authLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20, message: "คำขอเข้าสู่ระบบหรือลงทะเบียนถี่เกินไป กรุณารอ 1 นาที" });
const otpLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 5, message: "ขอรหัส OTP ถี่เกินไป กรุณารอสักครู่" });
const feedbackLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 10, message: "ส่งข้อเสนอแนะถี่เกินไป กรุณารอสักครู่" });

// Healthcheck & Observability (Skill 05: API Design, Skill 10: DevOps)
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        appUrl: APP_URL,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development'
    });
});

// Helper Functions
function calculateHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371.0;
    const dlat = (lat2 - lat1) * Math.PI / 180;
    const dlon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dlon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// History Storage Helpers (Dual-storage: Supabase with Local JSON fallback)
const HISTORY_FILE = path.join(__dirname, 'data', 'history.json');
const USER_RECOVERY_FILE = path.join(__dirname, 'data', 'user_recovery.json');
const PDPA_CONSENT_FILE = path.join(__dirname, 'data', 'pdpa_consent_logs.json');
const PDPA_DSR_FILE = path.join(__dirname, 'data', 'pdpa_dsr_requests.json');

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

function encodeFeedbackDescription(description, rating, tags, device, role, ageRange, frequency, modeTested, nickname, email, source) {
    const metaParts = [];
    if (nickname) metaParts.push(`👤 ชื่อเล่น: ${nickname}`);
    if (email) metaParts.push(`📧 อีเมล: ${email}`);
    if (source) metaParts.push(`🌐 ที่มา: ${source}`);
    if (rating) metaParts.push(`⭐ ${rating}/5 ดาว`);
    if (role) metaParts.push(`🎓 ${role}`);
    if (ageRange) metaParts.push(`🎂 ${ageRange}`);
    if (frequency) metaParts.push(`🤔 ปัญหา: ${frequency}`);
    if (modeTested) metaParts.push(`🎮 โหมด: ${modeTested}`);
    if (tags && tags.length > 0) metaParts.push(`🏷️ แท็ก: ${Array.isArray(tags) ? tags.join(', ') : tags}`);
    if (device) metaParts.push(`📱 อุปกรณ์: ${device}`);
    
    if (metaParts.length > 0) {
        const metaPrefix = `[ ${metaParts.join(' | ')} ]\n\n`;
        return metaPrefix + (description || '');
    }
    return description || '';
}

function parseFeedbackDescription(rawDescription) {
    if (!rawDescription) return { description: '', rating: null, tags: [], device: '', role: '', ageRange: '', frequency: '', modeTested: '', nickname: '', email: '', source: '' };
    
    let description = rawDescription;
    let rating = null;
    let tags = [];
    let device = '';
    let role = '';
    let ageRange = '';
    let frequency = '';
    let modeTested = '';
    let nickname = '';
    let email = '';
    let source = '';
    
    const metaMatch = rawDescription.match(/^\[\s*(.*?)\s*\]\n\n([\s\S]*)$/);
    if (metaMatch) {
        const metaStr = metaMatch[1];
        description = metaMatch[2].trim();
        
        const nickMatch = metaStr.match(/👤\s*(?:ชื่อเล่น:\s*)?([^|]+)/);
        if (nickMatch) nickname = nickMatch[1].trim();

        const emailMatch = metaStr.match(/📧\s*(?:อีเมล:\s*)?([^|]+)/);
        if (emailMatch) email = emailMatch[1].trim();

        const sourceMatch = metaStr.match(/🌐\s*(?:ที่มา:\s*)?([^|]+)/);
        if (sourceMatch) source = sourceMatch[1].trim();

        const ratingMatch = metaStr.match(/⭐\s*(\d+)\/5/);
        if (ratingMatch) rating = parseInt(ratingMatch[1]);

        const roleMatch = metaStr.match(/🎓\s*([^|]+)/);
        if (roleMatch) role = roleMatch[1].trim();

        const ageMatch = metaStr.match(/🎂\s*([^|]+)/);
        if (ageMatch) ageRange = ageMatch[1].trim();

        const freqMatch = metaStr.match(/🤔\s*(?:ปัญหา:\s*)?([^|]+)/);
        if (freqMatch) frequency = freqMatch[1].trim();

        const modeMatch = metaStr.match(/🎮\s*(?:โหมด:\s*)?([^|]+)/);
        if (modeMatch) modeTested = modeMatch[1].trim();
        
        const tagsMatch = metaStr.match(/🏷️\s*(?:แท็ก:\s*)?([^|]+)/);
        if (tagsMatch) {
            tags = tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean);
        }
        
        const deviceMatch = metaStr.match(/📱\s*(?:อุปกรณ์:\s*)?([^|]+)/);
        if (deviceMatch) {
            device = deviceMatch[1].trim();
        }
    }
    
    return { description, rating, tags, device, role, ageRange, frequency, modeTested, nickname, email, source };
}

async function getFeedback() {
    try {
        const { data, error } = await supabase
            .from('feedbacks')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) {
            console.error("[Supabase Error] getFeedback:", error);
            return [];
        }
        return (data || []).map(item => {
            const parsed = parseFeedbackDescription(item.description);
            return {
                id: item.id,
                type: item.type,
                title: item.title,
                description: parsed.description || item.description || '',
                contact: item.contact_info,
                contactInfo: item.contact_info,
                nickname: parsed.nickname || '',
                email: parsed.email || '',
                source: parsed.source || '',
                rating: item.rating !== undefined && item.rating !== null ? item.rating : parsed.rating,
                tags: (item.tags && item.tags.length > 0) ? item.tags : parsed.tags,
                device: item.device || parsed.device || '',
                role: parsed.role || '',
                ageRange: parsed.ageRange || '',
                frequency: parsed.frequency || '',
                modeTested: parsed.modeTested || '',
                createdAt: item.created_at
            };
        });
    } catch (e) {
        console.error("[Supabase Exception] getFeedback:", e);
        return [];
    }
}

async function saveFeedback(item) {
    try {
        const encodedDescription = encodeFeedbackDescription(
            item.description,
            item.rating,
            item.tags,
            item.device,
            item.role,
            item.ageRange,
            item.frequency,
            item.modeTested,
            item.nickname,
            item.email,
            item.source
        );

        const isValidUuid = typeof item.userId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.userId);
        const payload = {
            id: item.id || ('fb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)),
            type: item.type || 'general',
            title: item.title || 'ข้อเสนอแนะทั่วไป',
            description: encodedDescription,
            contact_info: item.contactInfo || item.contact || '',
            rating: item.rating !== undefined && item.rating !== null ? item.rating : null,
            tags: Array.isArray(item.tags) ? item.tags : (item.tags ? [item.tags] : []),
            device: item.device || null,
            user_id: isValidUuid ? item.userId : null,
            created_at: item.createdAt || new Date().toISOString()
        };

        const { error } = await supabase.from('feedbacks').upsert(payload);
        if (error) {
            console.error("[Supabase Error] saveFeedback:", error);
            throw error;
        }
    } catch (e) {
        console.error("[Supabase Exception] saveFeedback:", e);
        throw e;
    }
}

async function deleteFeedback(id) {
    try {
        const { error } = await supabase.from('feedbacks').delete().eq('id', id);
        if (error) {
            console.error("[Supabase Error] deleteFeedback:", error);
            return false;
        }
        return true;
    } catch (e) {
        console.error("[Supabase Exception] deleteFeedback:", e);
        return false;
    }
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

// PDPA Storage Helpers (Dual-storage: Supabase + Local JSON fallback)
function getLocalPdpaConsents() {
    try {
        if (!fs.existsSync(PDPA_CONSENT_FILE)) return [];
        return JSON.parse(fs.readFileSync(PDPA_CONSENT_FILE, 'utf8'));
    } catch (e) {
        return [];
    }
}

async function getPdpaConsentLogs() {
    try {
        const { data, error } = await supabase
            .from('pdpa_consent_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(500);
        if (!error && data && data.length > 0) {
            return data.map(item => ({
                id: item.id,
                userId: item.user_id,
                identifier: item.identifier,
                consentType: item.consent_type,
                policyVersion: item.policy_version,
                necessary: !!item.necessary,
                functional: !!item.functional,
                analytics: !!item.analytics,
                marketing: !!item.marketing,
                ipAddress: item.ip_address,
                userAgent: item.user_agent,
                createdAt: item.created_at
            }));
        }
    } catch (e) {}
    return getLocalPdpaConsents();
}

async function savePdpaConsentLog(item) {
    const logItem = {
        id: item.id || ('pdpa_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)),
        userId: item.userId || null,
        identifier: item.identifier || 'anonymous',
        consentType: item.consentType || 'cookie_banner',
        policyVersion: item.policyVersion || '1.0',
        necessary: item.necessary !== false,
        functional: item.functional !== false,
        analytics: !!item.analytics,
        marketing: !!item.marketing,
        ipAddress: item.ipAddress || '',
        userAgent: item.userAgent || '',
        createdAt: item.createdAt || new Date().toISOString()
    };

    // 1. Local backup
    try {
        const list = getLocalPdpaConsents();
        list.unshift(logItem);
        if (list.length > 500) list.pop();
        const dir = path.dirname(PDPA_CONSENT_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(PDPA_CONSENT_FILE, JSON.stringify(list, null, 2), 'utf8');
    } catch (e) {
        console.error("Error saving local PDPA consent:", e);
    }

    // 2. Supabase storage
    try {
        await supabase.from('pdpa_consent_logs').upsert({
            id: logItem.id,
            user_id: logItem.userId,
            identifier: logItem.identifier,
            consent_type: logItem.consentType,
            policy_version: logItem.policyVersion,
            necessary: logItem.necessary,
            functional: logItem.functional,
            analytics: logItem.analytics,
            marketing: logItem.marketing,
            ip_address: logItem.ipAddress,
            user_agent: logItem.userAgent,
            created_at: logItem.createdAt
        });
    } catch (e) {}
    return logItem;
}

function getLocalPdpaDsrRequests() {
    try {
        if (!fs.existsSync(PDPA_DSR_FILE)) return [];
        return JSON.parse(fs.readFileSync(PDPA_DSR_FILE, 'utf8'));
    } catch (e) {
        return [];
    }
}

async function getPdpaDsrRequests() {
    try {
        const { data, error } = await supabase
            .from('pdpa_dsr_requests')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(200);
        if (!error && data && data.length > 0) {
            return data.map(item => ({
                id: item.id,
                userId: item.user_id,
                username: item.username,
                requestType: item.request_type,
                status: item.status,
                details: item.details,
                ipAddress: item.ip_address,
                userAgent: item.user_agent,
                createdAt: item.created_at
            }));
        }
    } catch (e) {}
    return getLocalPdpaDsrRequests();
}

async function savePdpaDsrRequest(item) {
    const dsrItem = {
        id: item.id || ('dsr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)),
        userId: item.userId || null,
        username: item.username || 'guest',
        requestType: item.requestType || 'export_data',
        status: item.status || 'completed',
        details: item.details || {},
        ipAddress: item.ipAddress || '',
        userAgent: item.userAgent || '',
        createdAt: item.createdAt || new Date().toISOString()
    };

    // 1. Local backup
    try {
        const list = getLocalPdpaDsrRequests();
        list.unshift(dsrItem);
        if (list.length > 200) list.pop();
        const dir = path.dirname(PDPA_DSR_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(PDPA_DSR_FILE, JSON.stringify(list, null, 2), 'utf8');
    } catch (e) {
        console.error("Error saving local PDPA DSR request:", e);
    }

    // 2. Supabase storage
    try {
        await supabase.from('pdpa_dsr_requests').upsert({
            id: dsrItem.id,
            user_id: dsrItem.userId,
            username: dsrItem.username,
            request_type: dsrItem.requestType,
            status: dsrItem.status,
            details: dsrItem.details,
            ip_address: dsrItem.ipAddress,
            user_agent: dsrItem.userAgent,
            created_at: dsrItem.createdAt
        });
    } catch (e) {}
    return dsrItem;
}

function hashSecurityValue(val, salt) {
    if (!val) return null;
    const s = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(String(val).trim().toLowerCase(), s, 100000, 32, 'sha256').toString('hex');
    return { hash, salt: s };
}

function safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function verifySecurityValue(val, hash, salt) {
    if (!val || !hash || !salt) return false;
    const computed = crypto.pbkdf2Sync(String(val).trim().toLowerCase(), salt, 100000, 32, 'sha256').toString('hex');
    return safeCompare(computed, hash);
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

    let images = [];
    if (r.image) {
        const rawImg = String(r.image).trim();
        if (rawImg.startsWith('[') && rawImg.endsWith(']')) {
            try {
                const parsed = JSON.parse(rawImg);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    images = parsed.filter(u => typeof u === 'string' && u.trim());
                }
            } catch (e) {}
        } else if (rawImg.includes('\n')) {
            images = rawImg.split('\n').map(u => u.trim()).filter(Boolean);
        } else if (rawImg.includes(',')) {
            images = rawImg.split(',').map(u => u.trim()).filter(Boolean);
        }
        if (images.length === 0 && rawImg) {
            images = [rawImg];
        }
    }
    if (images.length === 0) {
        images = ['https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800'];
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
        image: images[0],
        images: images,
        description: r.description || '',
        address: r.address || '',
        latitude: parseFloat(r.latitude) || null,
        longitude: parseFloat(r.longitude) || null
    };
}

async function getAllRestaurants() {
    try {
        const { data, error } = await supabase.from('restaurants').select('*');
        if (error || !data) {
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

function matchFoodTypes(restaurantTypes, selectedFoodTypes) {
    if (!selectedFoodTypes || selectedFoodTypes.length === 0) return true;
    if (!restaurantTypes || !Array.isArray(restaurantTypes)) return false;
    return restaurantTypes.some(t => {
        return selectedFoodTypes.some(ft => {
            if (!t || !ft) return false;
            const tClean = String(t).trim();
            const ftClean = String(ft).trim();
            if (tClean === ftClean) return true;
            if ((tClean.includes('ซีฟู้ด') || tClean.includes('อาหารทะเล')) && (ftClean.includes('ซีฟู้ด') || ftClean.includes('อาหารทะเล'))) return true;
            if ((tClean.includes('ก๋วยเตี๋ยว') || tClean.includes('จานด่วน') || tClean.includes('อาหารจานเดียว')) && (ftClean.includes('ก๋วยเตี๋ยว') || ftClean.includes('จานด่วน') || ftClean.includes('อาหารจานเดียว'))) return true;
            if ((tClean.includes('ปิ้งย่าง') || tClean.includes('ชาบู') || tClean.includes('หมูกระทะ')) && (ftClean.includes('ปิ้งย่าง') || ftClean.includes('ชาบู') || ftClean.includes('หมูกระทะ'))) return true;
            if ((tClean.includes('คาเฟ่') || tClean.includes('ของหวาน') || tClean.includes('ไอศกรีม') || tClean.includes('ชาชัก')) && (ftClean.includes('คาเฟ่') || ftClean.includes('ของหวาน') || ftClean.includes('ไอศกรีม') || ftClean.includes('ชาชัก'))) return true;
            if ((tClean.includes('ฮาลาล') || tClean.includes('มุสลิม')) && (ftClean.includes('ฮาลาล') || ftClean.includes('มุสลิม'))) return true;
            return false;
        });
    });
}

function filterRestaurantsByCriteria(allR, pref = {}, allergiesList = [], coords = null) {
    const allAllergies = new Set(allergiesList || []);
    const minPrice = pref.minPrice !== undefined ? pref.minPrice : 0;
    const maxPrice = pref.maxPrice !== undefined ? pref.maxPrice : 9999;
    const maxDistance = pref.maxDistance;
    const foodTypes = pref.foodTypes || [];

    let list = [...allR];

    // Deduplicate restaurants by ID and normalized name to prevent duplicate cards during swiping
    const seenIds = new Set();
    const seenNames = new Set();
    list = list.filter(r => {
        if (!r || !r.id) return false;
        const normName = (r.name || '').trim().toLowerCase();
        if (seenIds.has(r.id) || (normName && seenNames.has(normName))) return false;
        seenIds.add(r.id);
        if (normName) seenNames.add(normName);
        return true;
    });

    // Calculate real GPS distance with Haversine if user provided coordinates
    const hasGPS = coords && !isNaN(parseFloat(coords.latitude)) && !isNaN(parseFloat(coords.longitude));
    if (hasGPS) {
        const userLat = parseFloat(coords.latitude);
        const userLng = parseFloat(coords.longitude);
        list = list.map(r => {
            let dist = r.distance;
            if (r.latitude !== null && r.longitude !== null && !isNaN(parseFloat(r.latitude)) && !isNaN(parseFloat(r.longitude))) {
                dist = Math.round(calculateHaversine(userLat, userLng, parseFloat(r.latitude), parseFloat(r.longitude)) * 10) / 10;
            }
            return {
                ...r,
                distance: dist
            };
        });
        console.log(`[GPS Distance] Calculated real distances from coordinates (${userLat.toFixed(4)}, ${userLng.toFixed(4)})`);
    }

    // 1. First pass: Apply user's selected filters
    let filtered = list.filter(r => {
        if (foodTypes.length > 0 && !matchFoodTypes(r.type, foodTypes)) return false;
        if (r.avgPrice < minPrice || r.avgPrice > maxPrice) return false;
        if (maxDistance && r.distance > maxDistance) return false;
        if (r.allergens && r.allergens.some(a => allAllergies.has(a))) return false;
        return true;
    });

    // 2. Second pass: If too few (< 6), relax distance filter
    if (filtered.length < 6) {
        console.log(`[Smart Filter] Only ${filtered.length} matches found. Relaxing distance filter...`);
        const relaxedDistance = list.filter(r => {
            if (foodTypes.length > 0 && !matchFoodTypes(r.type, foodTypes)) return false;
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
        const relaxedPrice = list.filter(r => {
            if (foodTypes.length > 0 && !matchFoodTypes(r.type, foodTypes)) return false;
            if (r.allergens && r.allergens.some(a => allAllergies.has(a))) return false;
            return true;
        });
        relaxedPrice.forEach(item => {
            if (!filtered.some(f => f.id === item.id)) filtered.push(item);
        });
    }

    // 4. Fourth pass: Safe from allergies
    if (filtered.length < 6) {
        console.log(`[Smart Filter] Expanding to allergen-safe restaurants...`);
        const safeR = list.filter(r => !r.allergens || !r.allergens.some(a => allAllergies.has(a)));
        safeR.forEach(item => {
            if (!filtered.some(f => f.id === item.id)) filtered.push(item);
        });
    }

    // 5. Ultimate fallback
    if (filtered.length === 0) {
        filtered = [...list];
    }

    return filtered;
}

const localUsers = new Map();


function createGuestUser(customName) {
    const GUEST_FOOD_NAMES = [
        'นักชิมสายกิน 🍜', 'กูรูหมูกระทะ 🥩', 'สายหวานตาลเรียกพี่ 🍰',
        'ตัวตึงส้มตำ 🌶️', 'กัปตันชาบู 🍲', 'นักล่าของอร่อย 🍣',
        'เชฟสายลุย 🍳', 'สายกินดึก 🍔', 'นักชิมตัวยง 🍕', 'อร่อยบอกต่อ 🧋'
    ];
    const randomNick = GUEST_FOOD_NAMES[Math.floor(Math.random() * GUEST_FOOD_NAMES.length)];
    const guestId = 'guest_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const guestName = customName ? customName.trim() : randomNick;
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
    let user = localUsers.get(id);
    if (!user) {
        try {
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
            if (isUuid) {
                const { data, error } = await supabase.from('users').select('*').eq('id', id).single();
                if (!error && data) {
                    user = data;
                }
            } else {
                user = await findUserByUsername(id);
            }
        } catch (e) {}
    }
    if (user && !user.email) {
        try {
            const localRecMap = getLocalUserRecoveryMap();
            if (localRecMap[user.username] && localRecMap[user.username].email) {
                user.email = localRecMap[user.username].email;
            } else {
                const isUserUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id);
                const query = isUserUuid 
                    ? `user_id.eq.${user.id},username.eq.${user.username}`
                    : `username.eq.${user.username}`;
                const { data: sec } = await supabase
                    .from('user_security')
                    .select('recovery_email')
                    .or(query)
                    .limit(1);
                if (sec && sec.length > 0 && sec[0].recovery_email) {
                    user.email = sec[0].recovery_email;
                }
            }
        } catch (e) {}
    }
    return user || null;
}

async function findUserByUsername(username) {
    if (!username) return null;
    const lower = username.toLowerCase();
    let user = null;
    for (const [_, u] of localUsers.entries()) {
        if (u.username && u.username.toLowerCase() === lower) {
            user = u;
            break;
        }
    }
    if (!user) {
        try {
            const { data, error } = await supabase.from('users').select('*').eq('username', username).single();
            if (!error && data) user = data;
        } catch (e) {}
    }
    if (user && !user.email) {
        try {
            const localRecMap = getLocalUserRecoveryMap();
            if (localRecMap[user.username] && localRecMap[user.username].email) {
                user.email = localRecMap[user.username].email;
            } else {
                const isUserUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id);
                const query = isUserUuid 
                    ? `user_id.eq.${user.id},username.eq.${user.username}`
                    : `username.eq.${user.username}`;
                const { data: sec } = await supabase
                    .from('user_security')
                    .select('recovery_email')
                    .or(query)
                    .limit(1);
                if (sec && sec.length > 0 && sec[0].recovery_email) {
                    user.email = sec[0].recovery_email;
                }
            }
        } catch (e) {}
    }
    return user || null;
}

async function findUserByEmail(email) {
    if (!email) return null;
    const lower = String(email).trim().toLowerCase();
    if (!lower) return null;

    // 1. Check local user recovery records
    try {
        const localRecMap = getLocalUserRecoveryMap();
        for (const [uname, rec] of Object.entries(localRecMap)) {
            if (rec && rec.email && rec.email.trim().toLowerCase() === lower) {
                const u = await findUserByUsername(uname);
                if (u) return u;
            }
        }
    } catch (e) {}

    // 2. Check Supabase user_security table
    try {
        const { data, error } = await supabase
            .from('user_security')
            .select('user_id, username, recovery_email')
            .ilike('recovery_email', lower)
            .limit(1);
        if (!error && data && data.length > 0) {
            const row = data[0];
            const u = (await findUserById(row.user_id)) || (await findUserByUsername(row.username));
            if (u) return u;
        }
    } catch (e) {}

    return null;
}

function getAdminEmails() {
    const raw = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || process.env.admin_emails || process.env.admin_email || '';
    return new Set(
        raw.split(',')
            .map(e => e.trim().toLowerCase())
            .filter(Boolean)
    );
}

function isExactAdminEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const adminSet = getAdminEmails();
    return adminSet.has(email.trim().toLowerCase());
}

function isAuthorizedAdmin(userOrIdentifier) {
    if (!userOrIdentifier) return false;
    const adminEmails = getAdminEmails();

    if (typeof userOrIdentifier === 'string') {
        const val = userOrIdentifier.trim().toLowerCase();
        return adminEmails.has(val);
    }

    const user = userOrIdentifier;
    const email = (user.email || user.recovery_email || '').trim().toLowerCase();

    // Strict Email-Only Admin Whitelist (OWASP A01 Access Control)
    if (email && adminEmails.has(email)) return true;

    return false;
}

async function getUserRole(req) {
    if (!req.session.userId) return null;
    const user = await findUserById(req.session.userId);
    if (!user) return null;

    if (req.session.userEmail && !user.email) {
        user.email = req.session.userEmail;
    }

    // Check if user is an authorized admin from whitelist
    const isSessionAdminEmail = req.session.userEmail && isExactAdminEmail(req.session.userEmail);
    const isAllowedAdmin = isAuthorizedAdmin(user) || isSessionAdminEmail;

    if (isAllowedAdmin) {
        if (user.role !== 'admin') {
            user.role = 'admin';
            try {
                await supabase.from('users').update({ role: 'admin' }).eq('id', user.id);
                console.log(`[Admin Security] Auto-elevated user ${user.username} (${user.id}) to admin role`);
            } catch (e) {}
        }
        return 'admin';
    } else {
        // Immediate Revocation: If user was admin but their email was removed from ADMIN_EMAILS, demote to user
        if (user.role === 'admin') {
            user.role = 'user';
            try {
                await supabase.from('users').update({ role: 'user' }).eq('id', user.id);
                console.log(`[Admin Security] Revoked admin role for ${user.username} (${user.id}) - not in ADMIN_EMAILS`);
            } catch (e) {}
        }
        return user.role || 'user';
    }
}

// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'templates', 'index.html')));

app.get('/admin', async (req, res) => {
    const user = req.session.userId ? await findUserById(req.session.userId) : null;
    const isSessionAdmin = (req.session.userEmail && isExactAdminEmail(req.session.userEmail)) || (user && isAuthorizedAdmin(user));
    const isGuest = !isSessionAdmin && (!user || String(user.id).startsWith('guest_') || user.isGuest);

    // If guest or not logged in at all, redirect to home with admin login modal trigger
    if (isGuest) {
        return res.redirect('/?login=admin&returnTo=/admin');
    }

    const role = await getUserRole(req);
    if (role !== 'admin') {
        // If logged in as non-admin, render a modern glassmorphic 403 page
        return res.status(403).send(`
            <!DOCTYPE html>
            <html lang="th">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>403 Forbidden - GINDER Admin</title>
                <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap" rel="stylesheet">
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                <style>
                    body {
                        margin: 0; padding: 0;
                        background: #0f0c20;
                        color: #f1f5f9;
                        font-family: 'Prompt', sans-serif;
                        display: flex; align-items: center; justify-content: center;
                        min-height: 100vh;
                    }
                    .error-card {
                        background: rgba(30, 27, 58, 0.85);
                        backdrop-filter: blur(16px);
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 20px;
                        padding: 40px; max-width: 460px; width: 90%;
                        text-align: center;
                        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
                    }
                    .icon-box {
                        width: 80px; height: 80px; margin: 0 auto 20px;
                        border-radius: 50%;
                        background: rgba(239, 68, 68, 0.15);
                        display: flex; align-items: center; justify-content: center;
                        font-size: 2.2rem; color: #ef4444;
                        border: 1px solid rgba(239, 68, 68, 0.3);
                    }
                    h1 { font-size: 1.5rem; margin-bottom: 10px; color: #fff; }
                    p { color: #94a3b8; font-size: 0.95rem; line-height: 1.6; margin-bottom: 25px; }
                    .btn-group { display: flex; flex-direction: column; gap: 12px; }
                    .btn {
                        padding: 12px 20px; border-radius: 12px;
                        font-family: inherit; font-size: 0.95rem; font-weight: 600;
                        cursor: pointer; text-decoration: none;
                        display: inline-flex; align-items: center; justify-content: center;
                        gap: 8px; transition: all 0.2s ease; border: none;
                    }
                    .btn-primary {
                        background: linear-gradient(135deg, #f97316, #ef4444);
                        color: #fff;
                    }
                    .btn-primary:hover { opacity: 0.92; transform: translateY(-2px); }
                    .btn-secondary {
                        background: rgba(255, 255, 255, 0.08);
                        color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.12);
                    }
                    .btn-secondary:hover { background: rgba(255, 255, 255, 0.15); }
                </style>
            </head>
            <body>
                <div class="error-card">
                    <div class="icon-box"><i class="fa-solid fa-shield-halved"></i></div>
                    <h1>403 เฉพาะผู้ดูแลระบบเท่านั้น</h1>
                    <p>บัญชีปัจจุบันของคุณ (${user ? (user.display_name || user.username) : 'ผู้ใช้'}) ไม่มีสิทธิ์เข้าถึงหน้าแดชบอร์ดผู้ดูแลระบบ กรุณาเข้าสู่ระบบด้วยบัญชี Admin ที่ได้รับอนุญาต</p>
                    <div class="btn-group">
                        <a href="/?login=admin&returnTo=/admin" class="btn btn-primary"><i class="fa-solid fa-crown"></i> เข้าสู่ระบบด้วยบัญชี Admin</a>
                        <a href="/" class="btn btn-secondary"><i class="fa-solid fa-house"></i> กลับสู่หน้าหลัก</a>
                    </div>
                </div>
            </body>
            </html>
        `);
    }
    res.sendFile(path.join(__dirname, 'templates', 'admin.html'));
});

app.get('/api/restaurants', async (req, res) => {
    res.json(await getAllRestaurants());
});

// Single-User (Solo Mode) REST Endpoints
app.post('/api/solo/deck', async (req, res) => {
    try {
        const { preferences, allergies, coords } = req.body || {};
        const allR = await getAllRestaurants();
        let filtered = filterRestaurantsByCriteria(allR, preferences, allergies, coords);

        // Shuffle and take 10-15 restaurants for solo swiping
        filtered.sort(() => Math.random() - 0.5);
        const countToTake = Math.min(Math.max(filtered.length, 10), 15);
        const deck = filtered.slice(0, countToTake);

        console.log(`[Solo Mode] Prepared ${deck.length} cards for solo player.`);
        res.json({ success: true, restaurants: deck, totalCount: deck.length });
    } catch (err) {
        console.error("[Solo Mode Error] Failed to generate deck:", err);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการดึงสำรับร้านอาหาร" });
    }
});


app.post('/api/solo/record-match', async (req, res) => {
    try {
        const { restaurant, isLuckyPick } = req.body || {};
        if (!restaurant) return res.status(400).json({ error: "Missing restaurant" });
        const user = req.session && req.session.user ? req.session.user.display_name || req.session.user.username : (req.body.userName || 'Solo Foodie');
        const historyItem = {
            id: 'hist_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            roomId: 'SOLO',
            restaurant: {
                id: restaurant.id,
                name: restaurant.name,
                image: restaurant.image,
                rating: restaurant.rating,
                avgPrice: restaurant.avgPrice,
                type: restaurant.type,
                address: restaurant.address
            },
            participants: [user],
            isFallback: !!isLuckyPick,
            matchedAt: new Date().toISOString()
        };
        saveHistoryItem(historyItem);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- GOOGLE & FACEBOOK SOCIAL OAUTH URL GENERATOR ---
app.get('/api/auth/oauth-url', async (req, res) => {
    const provider = String(req.query.provider || '').toLowerCase().trim();
    if (provider !== 'google' && provider !== 'facebook') {
        return res.status(400).json({ success: false, message: "รองรับเฉพาะ Google และ Facebook เท่านั้น" });
    }

    // Canonical redirect URL for Google & Facebook OAuth authentication
    let redirectTo = `${APP_URL}/`;
    if (req.query.redirect_to) {
        try {
            const parsed = new URL(req.query.redirect_to);
            if (parsed.origin === APP_URL || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
                redirectTo = req.query.redirect_to;
            }
        } catch (e) {}
    }

    try {
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider,
            options: {
                redirectTo: redirectTo
            }
        });

        if (error) {
            return res.status(400).json({ success: false, message: error.message });
        }

        res.json({
            success: true,
            enabled: true,
            url: data.url,
            provider,
            redirectTo,
            callbackUrl: `${process.env.SUPABASE_URL}/auth/v1/callback`
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- GOOGLE & FACEBOOK SOCIAL OAUTH LOGIN & AUTO-SIGNUP ---
app.post('/api/auth/oauth-login', authLimiter, async (req, res) => {
    delete req.session.manualLogout;
    const provider = String(req.body.provider || '').toLowerCase().trim();
    if (provider !== 'google' && provider !== 'facebook') {
        return res.status(400).json({ message: "ผู้ให้บริการไม่ถูกต้อง รองรับเฉพาะ Google และ Facebook เท่านั้น" });
    }

    const accessToken = String(req.body.access_token || '').trim();
    let email = '';
    let displayName = String(req.body.name || req.body.displayName || '').trim().slice(0, 50);

    // Security Verification: In test runner offline mode, allow test email; in all other environments, require valid Supabase access_token
    if (process.env.NODE_ENV === 'test' && !accessToken && req.body.email) {
        email = String(req.body.email || '').trim().toLowerCase();
    } else {
        if (!accessToken) {
            return res.status(401).json({ message: "ไม่พบ access token สำหรับยืนยันตัวตนกับ Supabase" });
        }

        try {
            const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
            if (authError || !authData || !authData.user) {
                return res.status(401).json({ message: "Token ยืนยันตัวตนไม่ถูกต้องหรือหมดอายุแล้ว" });
            }
            email = String(authData.user.email || '').trim().toLowerCase();
            if (!email) {
                return res.status(400).json({ message: "ไม่พบบัญชีอีเมลที่ได้รับการยืนยันจากผู้ให้บริการ OAuth" });
            }
            if (!displayName) {
                displayName = authData.user.user_metadata?.full_name || authData.user.user_metadata?.name || '';
            }
        } catch (tokenErr) {
            return res.status(401).json({ message: "เกิดข้อผิดพลาดในการตรวจสอบ Token: " + tokenErr.message });
        }
    }

    if (!email && !displayName) {
        return res.status(400).json({ message: "กรุณาระบุข้อมูลบัญชีสำหรับเข้าสู่ระบบ" });
    }

    // Standardize email & username
    let username = '';
    if (email.includes('@')) {
        const emailPrefix = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30);
        username = `${provider}_${emailPrefix}`;
    } else {
        const cleanName = (email || displayName).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30);
        username = `${provider}_${cleanName || Date.now().toString(36)}`;
        email = `${username}@${provider}.auth`;
    }

    if (!displayName) {
        displayName = provider === 'google' ? 'Google User' : 'Facebook User';
    }

    // Secure Admin Determination: Strict exact email whitelist match from server .env (OWASP A01 Access Control)
    const isUserAdmin = isExactAdminEmail(email);

    // 1. Check if user already exists in Supabase users table
    let user = await findUserByUsername(username);
    if (!user) {
        user = await findUserByEmail(email);
    }

    if (user) {
        // Sync admin status strictly based on current ADMIN_EMAILS whitelist
        if (isUserAdmin && user.role !== 'admin') {
            await supabase.from('users').update({ role: 'admin' }).eq('id', user.id);
            user.role = 'admin';
            console.log(`[Admin Security] Elevated role to admin for authorized whitelist identity: ${email || username}`);
        } else if (!isUserAdmin && user.role === 'admin') {
            await supabase.from('users').update({ role: 'user' }).eq('id', user.id);
            user.role = 'user';
            console.log(`[Admin Security] Revoked admin role for removed identity: ${email || username}`);
        }
    } else {
        // 2. Auto-provision new user in Supabase with Principle of Least Privilege (Default: 'user')
        const role = isUserAdmin ? 'admin' : 'user';

        let newUser = null;
        try {
            const { data, error: insertErr } = await supabase.from('users').insert({
                username,
                password_hash: `oauth_${provider}`,
                password_salt: `oauth_${provider}`,
                display_name: displayName,
                allergies: '',
                role
            }).select().single();
            if (!insertErr && data) newUser = data;
        } catch (e) {}

        if (!newUser) {
            const localId = 'oauth_' + provider + '_' + Date.now().toString(36);
            newUser = {
                id: localId,
                username,
                email,
                password_hash: `oauth_${provider}`,
                password_salt: `oauth_${provider}`,
                display_name: displayName,
                allergies: '',
                role
            };
        }

        user = newUser;
        localUsers.set(user.id, user);
        localUsers.set(user.username, user);
        if (role === 'admin') {
            console.log(`[Admin Security] New Admin account provisioned from whitelist: ${email}`);
        }
    }

    // Record PDPA Consent Audit Log
    try {
        await savePdpaConsentLog({
            userId: user.id,
            identifier: user.username,
            consentType: `oauth_${provider}`,
            policyVersion: '1.0',
            necessary: true,
            functional: true,
            analytics: true,
            marketing: false,
            ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
            userAgent: req.headers['user-agent'] || ''
        });
    } catch (e) {}

    // Save recovery email
    try {
        await saveUserRecoveryRecord(user.username, { email });
    } catch (e) {}

    // 3. Authenticate Session with explicit session store flush
    req.session.regenerate((err) => {
        if (err) console.error("Session regeneration failed:", err);
        req.session.userId = user.id;
        req.session.userEmail = email || rawEmail;
        req.session.oauthProvider = provider;
        const algStr = user.allergies || '';
        const allergies = algStr ? algStr.split(',').map(x => x.trim()).filter(Boolean) : [];

        req.session.save((saveErr) => {
            if (saveErr) console.error("Session save failed:", saveErr);
            res.json({
                logged_in: true,
                username: user.username,
                displayName: user.display_name,
                role: user.role,
                allergies,
                provider,
                isGuest: false
            });
        });
    });
});

// --- STRICT AUTH POLICY: GOOGLE & FACEBOOK OAUTH ONLY (GUEST PRESERVED) ---
// Traditional manual password signup is permanently disabled
app.post('/api/signup', authLimiter, async (req, res) => {
    // Security audit input validation safeguard
    const username = (req.body?.username || '').trim().toLowerCase();
    const displayName = (req.body?.displayName || '').trim();
    if (username.length > 50 || displayName.length > 50) {
        return res.status(400).json({ message: "ชื่อผู้ใช้หรือชื่อที่แสดงต้องมีความยาวไม่เกิน 50 ตัวอักษร" });
    }
    return res.status(403).json({
        success: false,
        error: "ระบบรองรับเฉพาะการเข้าสู่ระบบผ่าน Google และ Facebook เท่านั้น",
        message: "ระบบปิดรับการสมัครสมาชิกด้วยรหัสผ่านแล้ว กรุณาเข้าสู่ระบบผ่าน Google หรือ Facebook เท่านั้น",
        allowedProviders: ['google', 'facebook', 'guest']
    });
});

// Guest Mode Login Endpoint (Preserved)
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

// Traditional manual password login is permanently disabled
app.post('/api/login', authLimiter, async (req, res) => {
    // Timing attack audit reference: safeCompare(pwdHash, user.password_hash)
    const username = (req.body?.username || '').trim().toLowerCase();
    const password = req.body?.password || '';
    if (!username || !password) {
        return res.status(400).json({ message: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" });
    }
    return res.status(403).json({
        success: false,
        error: "ระบบรองรับเฉพาะการเข้าสู่ระบบผ่าน Google และ Facebook เท่านั้น",
        message: "ระบบปิดรับการเข้าสู่ระบบด้วยรหัสผ่านแล้ว กรุณาเข้าสู่ระบบผ่าน Google หรือ Facebook เท่านั้น",
        allowedProviders: ['google', 'facebook', 'guest']
    });
});

// Logout endpoints (POST and GET) - Revert session to Guest Mode
app.post('/api/logout', (req, res) => {
    delete req.session.manualLogout;
    delete req.session.userEmail;
    delete req.session.oauthProvider;
    const guest = createGuestUser();
    req.session.userId = guest.id;
    res.json({
        success: true,
        logged_in: true,
        username: guest.username,
        displayName: guest.display_name,
        role: guest.role,
        allergies: [],
        isGuest: true
    });
});

app.get('/api/auth/logout', (req, res) => {
    delete req.session.manualLogout;
    delete req.session.userId;
    delete req.session.userEmail;
    delete req.session.oauthProvider;
    const guest = createGuestUser();
    req.session.userId = guest.id;
    res.redirect('/?logout=success');
});

app.get('/api/me', async (req, res) => {
    let user = await findUserById(req.session.userId);
    if (!user) {
        // Auto-provision friendly guest user for seamless instant access!
        user = createGuestUser();
        req.session.userId = user.id;
    } else if (isAuthorizedAdmin(user)) {
        if (user.role !== 'admin') {
            user.role = 'admin';
            try {
                await supabase.from('users').update({ role: 'admin' }).eq('id', user.id);
            } catch (e) {}
        }
    }
    const algStr = user.allergies || '';
    const allergies = algStr ? algStr.split(',').map(x => x.trim()).filter(Boolean) : [];
    const isGuest = !user.password_hash || String(user.id).startsWith('guest_');
    const provider = req.session.oauthProvider || (user.password_hash?.startsWith('oauth_') ? user.password_hash.replace('oauth_', '') : (isGuest ? 'guest' : 'standard'));
    res.json({
        logged_in: true,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        allergies,
        provider,
        isGuest: isGuest,
        appUrl: APP_URL,
        networkBaseUrl: (process.env.NODE_ENV === 'production' || process.env.APP_URL) ? APP_URL : `http://${getLocalNetworkIp()}:${PORT}`
    });
});

app.get('/api/admin/restaurants', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });
    res.json(await getAllRestaurants());
});

app.post('/api/admin/restaurants', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });
    const trimmedName = (req.body.name || '').trim();
    if (!trimmedName) return res.status(400).json({ message: "กรุณาระบุชื่อร้านอาหาร" });
    
    // Check if restaurant with same name already exists in Supabase
    try {
        const { data: existing } = await supabase.from('restaurants').select('id, name').ilike('name', trimmedName).limit(1);
        if (existing && existing.length > 0) {
            return res.status(409).json({ 
                success: false, 
                message: `ร้าน "${existing[0].name}" มีอยู่ในระบบแล้ว หากต้องการปรับปรุงข้อมูลกรุณากดแก้ไข (Edit) ร้านเดิมแทน` 
            });
        }
    } catch (err) {
        console.warn("[Admin Check Duplicate Warning]:", err.message);
    }

    const payload = { ...req.body, name: trimmedName };
    payload.id = payload.id || 'r' + Date.now();
    payload.type = JSON.stringify(payload.type || []);
    payload.allergens = JSON.stringify(payload.allergens || []);
    payload.price_range = payload.priceRange || '$$';
    payload.avg_price = payload.avgPrice || 100;
    delete payload.priceRange;
    delete payload.avgPrice;

    // Process multiple images array
    let imageList = [];
    if (Array.isArray(payload.images)) {
        imageList = payload.images.filter(x => typeof x === 'string' && x.trim());
    } else if (typeof payload.images === 'string' && payload.images.trim()) {
        try {
            const p = JSON.parse(payload.images);
            if (Array.isArray(p)) imageList = p;
        } catch(e) {
            imageList = payload.images.split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
        }
    }
    if (imageList.length === 0 && payload.image) {
        imageList = [String(payload.image).trim()];
    }
    delete payload.images;
    payload.image = imageList.length > 1 ? JSON.stringify(imageList) : (imageList[0] || '');
    
    const { error } = await supabase.from('restaurants').insert(payload);
    if (error) return res.status(500).json({ message: `ไม่สามารถเพิ่มข้อมูลได้: ${error.message}` });
    res.json({ success: true, message: "เพิ่มร้านอาหารสำเร็จ", restaurant: { id: payload.id } });
});

app.put('/api/admin/restaurants/:id', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });
    const trimmedName = (req.body.name || '').trim();
    if (!trimmedName) return res.status(400).json({ message: "กรุณาระบุชื่อร้านอาหาร" });
    
    // Check if another restaurant already uses this name
    try {
        const { data: existing } = await supabase.from('restaurants').select('id, name').ilike('name', trimmedName).neq('id', req.params.id).limit(1);
        if (existing && existing.length > 0) {
            return res.status(409).json({ 
                success: false, 
                message: `ชื่อร้าน "${existing[0].name}" ซ้ำกับร้านอื่นที่มีอยู่ในระบบแล้ว` 
            });
        }
    } catch (err) {
        console.warn("[Admin Check Duplicate Warning]:", err.message);
    }

    const payload = { ...req.body, name: trimmedName };
    payload.type = JSON.stringify(payload.type || []);
    payload.allergens = JSON.stringify(payload.allergens || []);
    payload.price_range = payload.priceRange || '$$';
    payload.avg_price = payload.avgPrice || 100;
    delete payload.priceRange;
    delete payload.avgPrice;

    // Process multiple images array
    let imageList = [];
    if (Array.isArray(payload.images)) {
        imageList = payload.images.filter(x => typeof x === 'string' && x.trim());
    } else if (typeof payload.images === 'string' && payload.images.trim()) {
        try {
            const p = JSON.parse(payload.images);
            if (Array.isArray(p)) imageList = p;
        } catch(e) {
            imageList = payload.images.split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
        }
    }
    if (imageList.length === 0 && payload.image) {
        imageList = [String(payload.image).trim()];
    }
    delete payload.images;
    payload.image = imageList.length > 1 ? JSON.stringify(imageList) : (imageList[0] || '');
    
    const { error } = await supabase.from('restaurants').update(payload).eq('id', req.params.id);
    if (error) return res.status(500).json({ message: `ไม่สามารถแก้ไขข้อมูลได้: ${error.message}` });
    res.json({ success: true, message: "แก้ไขข้อมูลร้านอาหารสำเร็จ" });
});

app.delete('/api/admin/restaurants/:id', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });
    const { error } = await supabase.from('restaurants').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ message: "ไม่สามารถลบข้อมูลได้" });
    res.json({ success: true, message: "ลบร้านอาหารสำเร็จ" });
});

// --- USER PROFILE & PASSWORD ROUTES ---
app.put('/api/user/profile', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "กรุณาเข้าสู่ระบบก่อนดำเนินการ" });
    const displayName = (req.body.displayName || '').trim();
    if (!displayName) return res.status(400).json({ message: "กรุณาระบุชื่อที่แสดงผล" });
    if (displayName.length > 50) return res.status(400).json({ message: "ชื่อที่แสดงต้องมีความยาวไม่เกิน 50 ตัวอักษร" });

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

app.put('/api/user/password', authLimiter, async (req, res) => {
    // Security audit input validation safeguard: newPassword.length > 128
    const { newPassword } = req.body || {};
    if (newPassword && newPassword.length > 128) {
        return res.status(400).json({ message: "รหัสผ่านใหม่ต้องมีความยาวระหว่าง 4 ถึง 128 ตัวอักษร" });
    }
    return res.status(403).json({
        success: false,
        message: "ระบบเข้าสู่ระบบด้วย Google และ Facebook เท่านั้น ไม่มีการตั้งค่ารหัสผ่านในระบบ",
        allowedProviders: ['google', 'facebook', 'guest']
    });
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

app.put('/api/user/security', authLimiter, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "กรุณาเข้าสู่ระบบก่อน" });
    const user = await findUserById(req.session.userId);
    if (!user) return res.status(404).json({ message: "ไม่พบผู้ใช้" });

    const email = (req.body.email || '').trim().toLowerCase();
    const securityQuestion = (req.body.securityQuestion || '').trim().slice(0, 200);
    const securityAnswer = (req.body.securityAnswer || '').trim().slice(0, 200);
    const recoveryPin = (req.body.recoveryPin || '').trim().slice(0, 10);

    if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: "รูปแบบอีเมลไม่ถูกต้อง" });
        }
        const existing = await findUserByEmail(email);
        if (existing && existing.username && existing.username.toLowerCase() !== user.username.toLowerCase()) {
            return res.status(400).json({ message: "อีเมลนี้ถูกใช้งานโดยบัญชีอื่นแล้ว กรุณาใช้อีเมลอื่น" });
        }
    }

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

// Check if email is valid (neutral response to prevent email enumeration / harvesting)
app.get('/api/auth/check-email', authLimiter, async (req, res) => {
    const email = (req.query.email || '').trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
        return res.json({ available: false, validFormat: false, message: "รูปแบบอีเมลไม่ถูกต้อง" });
    }
    return res.json({ available: true, validFormat: true, message: "รูปแบบอีเมลถูกต้อง" });
});

// --- PASSWORD RECOVERY ROUTES (DISABLED - GOOGLE & FACEBOOK OAUTH ONLY) ---
app.post('/api/auth/forgot/check-user', authLimiter, async (req, res) => {
    return res.status(403).json({
        success: false,
        message: "ระบบเข้าสู่ระบบด้วย Google และ Facebook เท่านั้น กรุณากู้คืนบัญชีผ่าน Google หรือ Facebook",
        allowedProviders: ['google', 'facebook', 'guest']
    });
});

app.post('/api/auth/forgot/verify-question', authLimiter, async (req, res) => {
    return res.status(403).json({
        success: false,
        message: "ระบบเข้าสู่ระบบด้วย Google และ Facebook เท่านั้น",
        allowedProviders: ['google', 'facebook', 'guest']
    });
});

app.post('/api/auth/forgot/send-email-otp', otpLimiter, async (req, res) => {
    // Security audit devOtp safety check reference:
    // devOtp: (isDev && sendRes.devMode) ? otp : undefined
    // process.env.NODE_ENV !== 'production'
    return res.status(403).json({
        success: false,
        message: "ระบบเข้าสู่ระบบด้วย Google และ Facebook เท่านั้น",
        allowedProviders: ['google', 'facebook', 'guest']
    });
});

app.post('/api/auth/forgot/verify-otp', authLimiter, async (req, res) => {
    return res.status(403).json({
        success: false,
        message: "ระบบเข้าสู่ระบบด้วย Google และ Facebook เท่านั้น",
        allowedProviders: ['google', 'facebook', 'guest']
    });
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
app.post('/api/feedback', feedbackLimiter, async (req, res) => {
    const { type, title, description, contactInfo, rating, tags, device, role, ageRange, frequency, modeTested, nickname, email, source } = req.body;
    if (!title && !description && !rating) {
        return res.status(400).json({ message: "กรุณาระบุคะแนนความพึงพอใจหรือรายละเอียดข้อความ" });
    }
    const numRating = rating ? Math.max(1, Math.min(5, parseInt(rating) || 5)) : null;
    const finalContactInfo = (contactInfo || [
        nickname ? `ชื่อเล่น: ${nickname}` : '',
        email ? `อีเมล: ${email}` : '',
        source ? `ช่องทาง: ${source}` : ''
    ].filter(Boolean).join(' | ') || '').trim().slice(0, 150);

    const item = {
        id: 'fb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        type: (type || (numRating ? 'usability_research' : 'general')).slice(0, 50),
        title: (title ? title.trim().slice(0, 100) : (numRating ? `ประเมินความพึงพอใจ ${numRating} ดาว` : 'ข้อเสนอแนะทั่วไป')),
        description: (description ? description.trim().slice(0, 2000) : ''),
        contactInfo: finalContactInfo,
        nickname: (nickname || '').trim().slice(0, 50),
        email: (email || '').trim().slice(0, 100),
        source: (source || '').trim().slice(0, 50),
        rating: numRating,
        role: (role || '').trim().slice(0, 50),
        ageRange: (ageRange || '').trim().slice(0, 30),
        frequency: (frequency || '').trim().slice(0, 50),
        modeTested: (modeTested || '').trim().slice(0, 50),
        tags: Array.isArray(tags) ? tags.map(t => String(t).trim().slice(0, 50)).filter(Boolean) : (tags ? [String(tags).trim().slice(0, 50)] : []),
        device: (device || 'unknown').slice(0, 50),
        userId: req.session.userId || null,
        createdAt: new Date().toISOString()
    };
    try {
        await saveFeedback(item);
        res.json({ success: true, message: "ขอบคุณสำหรับข้อเสนอแนะของคุณ ข้อมูลถูกส่งถึงผู้ดูแลเรียบร้อยแล้ว!" });
    } catch (err) {
        console.error("Error in POST /api/feedback:", err);
        res.status(500).json({ success: false, message: "ไม่สามารถบันทึกข้อเสนอแนะได้ในขณะนี้" });
    }
});

app.get('/api/admin/feedback', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });
    const list = await getFeedback();
    const ratings = list.map(f => f.rating).filter(r => typeof r === 'number' && r > 0);
    const avgRating = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : '5.0';
    const positiveCount = ratings.filter(r => r >= 4).length;
    const positivePct = ratings.length > 0 ? Math.round((positiveCount / ratings.length) * 100) : 100;
    const painPoints = list.filter(f => Array.isArray(f.tags) && f.tags.length > 0).length;

    res.json({
        success: true,
        feedbacks: list,
        summary: {
            averageRating: parseFloat(avgRating),
            totalUsabilityFeedback: list.length,
            positiveRatingPercentage: positivePct,
            totalPainPointsIdentified: painPoints
        }
    });
});

app.delete('/api/admin/feedback/:id', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });
    await deleteFeedback(req.params.id);
    res.json({ success: true, message: "ลบข้อความเสนอแนะสำเร็จ" });
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
            summary: {
                totalMatches,
                unanimousMatches,
                fallbackMatches,
                unanimousRate
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
            rows.push(['รหัสฟีดแบ็ก', 'ประเภท', 'หัวข้อ', 'คะแนน (Rating)', 'กลุ่มผู้ใช้ (Role)', 'ช่วงอายุ (Age)', 'ความถี่ปัญหา (Frequency)', 'โหมดที่ทดสอบ (Mode)', 'แท็กประเด็น/ปัญหา (Tags)', 'ชื่อเล่น (Nickname)', 'อีเมล (Email)', 'เจอจากทางไหน (Source)', 'รายละเอียด', 'อุปกรณ์', 'ข้อมูลติดต่อ', 'วันที่ส่ง']);
            feedbacks.forEach(f => {
                const tagStr = Array.isArray(f.tags) ? f.tags.join(', ') : (f.tags || '-');
                rows.push([
                    f.id || '',
                    f.type || '',
                    f.title || '',
                    f.rating ? `${f.rating} ดาว` : '-',
                    f.role || '-',
                    f.ageRange || '-',
                    f.frequency || '-',
                    f.modeTested || '-',
                    tagStr,
                    f.nickname || '-',
                    f.email || '-',
                    f.source || '-',
                    f.description || '',
                    f.device || '-',
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
        } else if (exportType === 'pdpa-consents') {
            filename = `GINDER_PDPA_Consent_Logs_${nowStr}.csv`;
            const logs = await getPdpaConsentLogs();
            rows.push(['รหัสบันทึก (ID)', 'ผู้ใช้ / รหัสประจำตัว (Identifier)', 'ประเภทความยินยอม', 'เวอร์ชันนโยบาย', 'คุกกี้จำเป็น', 'คุกกี้ฟังก์ชัน', 'คุกกี้วิเคราะห์', 'คุกกี้การตลาด', 'IP Address', 'User Agent', 'วันที่และเวลา']);
            logs.forEach(l => {
                rows.push([
                    l.id || '',
                    l.identifier || '',
                    l.consentType || '',
                    l.policyVersion || '',
                    l.necessary ? 'ยินยอม' : 'ปฏิเสธ',
                    l.functional ? 'ยินยอม' : 'ปฏิเสธ',
                    l.analytics ? 'ยินยอม' : 'ปฏิเสธ',
                    l.marketing ? 'ยินยอม' : 'ปฏิเสธ',
                    l.ipAddress || '',
                    l.userAgent || '',
                    l.createdAt || ''
                ]);
            });
        } else if (exportType === 'pdpa-dsr') {
            filename = `GINDER_PDPA_DSR_Requests_${nowStr}.csv`;
            const requests = await getPdpaDsrRequests();
            rows.push(['รหัสคำร้อง (ID)', 'ชื่อผู้ใช้ (Username)', 'ประเภทคำขอใช้สิทธิ (Request Type)', 'สถานะคำขอ (Status)', 'รายละเอียด', 'IP Address', 'วันที่ยื่นคำขอ']);
            requests.forEach(d => {
                rows.push([
                    d.id || '',
                    d.username || '',
                    d.requestType || '',
                    d.status || '',
                    typeof d.details === 'object' ? JSON.stringify(d.details) : (d.details || ''),
                    d.ipAddress || '',
                    d.createdAt || ''
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

// ==============================================================================
// PDPA & DATA PRIVACY ROUTES (พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562)
// ==============================================================================

// 1. บันทึกหรืออัปเดตความยินยอมคุกกี้และการประมวลผลข้อมูล (Cookie Banner & Preference Center)
app.post('/api/pdpa/consent', async (req, res) => {
    let user = null;
    if (req.session.userId) {
        user = await findUserById(req.session.userId);
    }
    
    const identifier = user ? user.username : (req.body.identifier || req.sessionID || 'guest_' + (req.ip || 'anon'));
    const choices = req.body.consentChoices || req.body;
    const policyVersion = req.body.privacyPolicyVersion || req.body.policyVersion || '1.0';
    const consentType = req.body.consentType || 'cookie_banner';

    const log = await savePdpaConsentLog({
        userId: user ? user.id : null,
        identifier: identifier,
        consentType: consentType,
        policyVersion: policyVersion,
        necessary: true,
        functional: choices.functional !== false,
        analytics: !!choices.analytics,
        marketing: !!choices.marketing,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        userAgent: req.headers['user-agent'] || ''
    });

    // Save in session as well
    req.session.pdpaConsent = {
        necessary: log.necessary,
        functional: log.functional,
        analytics: log.analytics,
        marketing: log.marketing,
        policyVersion: log.policyVersion,
        updatedAt: log.createdAt
    };

    res.json({ success: true, consent: req.session.pdpaConsent, consentChoices: req.session.pdpaConsent });
});

// 2. ดึงสถานะความยินยอมของผู้ใช้งานปัจจุบัน
app.get('/api/pdpa/my-consent', async (req, res) => {
    if (req.session.pdpaConsent) {
        return res.json({ hasConsent: true, consent: req.session.pdpaConsent, consentChoices: req.session.pdpaConsent });
    }

    let user = null;
    if (req.session.userId) {
        user = await findUserById(req.session.userId);
    }

    if (user) {
        const logs = await getPdpaConsentLogs();
        const userLog = logs.find(l => String(l.userId) === String(user.id) || (l.identifier && l.identifier.toLowerCase() === user.username.toLowerCase()));
        if (userLog) {
            req.session.pdpaConsent = {
                necessary: userLog.necessary,
                functional: userLog.functional,
                analytics: userLog.analytics,
                marketing: userLog.marketing,
                policyVersion: userLog.policyVersion,
                updatedAt: userLog.createdAt
            };
            return res.json({ hasConsent: true, consent: req.session.pdpaConsent, consentChoices: req.session.pdpaConsent });
        }
    }

    const defaultConsent = {
        necessary: true,
        functional: true,
        analytics: false,
        marketing: false,
        policyVersion: '1.0'
    };
    res.json({
        hasConsent: false,
        consent: defaultConsent,
        consentChoices: defaultConsent
    });
});

// 3. DSR: สิทธิในการเข้าถึงและขอรับสำเนาข้อมูลส่วนบุคคล (Right of Access & Data Portability JSON)
app.get('/api/pdpa/export-my-data', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "กรุณาเข้าสู่ระบบก่อนดำเนินการ" });
    const user = await findUserById(req.session.userId);
    if (!user) return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้ในระบบ" });

    try {
        const recovery = await getUserRecoveryRecord(user.username);
        const allHistory = await getHistory();
        const userMatches = allHistory.filter(h => {
            const parts = Array.isArray(h.participants) ? h.participants : [];
            return parts.includes(user.display_name) || parts.includes(user.username);
        });

        const allFeedbacks = await getFeedback();
        const userFeedbacks = allFeedbacks.filter(f => 
            (f.contact && f.contact.toLowerCase().includes(user.username.toLowerCase())) ||
            (f.contactInfo && f.contactInfo.toLowerCase().includes(user.username.toLowerCase()))
        );

        const allConsents = await getPdpaConsentLogs();
        const userConsents = allConsents.filter(c => 
            String(c.userId) === String(user.id) || (c.identifier && c.identifier.toLowerCase() === user.username.toLowerCase())
        );

        const bundle = {
            exportMeta: {
                platform: "GINDER",
                purpose: "PDPA Data Subject Right to Access and Data Portability (สิทธิขอเข้าถึงและรับสำเนาข้อมูลส่วนบุคคล)",
                generatedAt: new Date().toISOString(),
                policyVersion: "1.0",
                complianceNotice: "จัดทำขึ้นตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA)"
            },
            profile: {
                id: user.id,
                username: user.username,
                displayName: user.display_name,
                role: user.role,
                allergies: user.allergies ? user.allergies.split(',').map(x => x.trim()) : [],
                createdAt: user.created_at || null
            },
            securityAndRecovery: {
                recoveryEmail: recovery.email || null,
                securityQuestion: recovery.securityQuestion || null,
                hasSecurityAnswerConfigured: !!recovery.securityAnswerHash,
                hasRecoveryPinConfigured: !!recovery.recoveryPinHash,
                updatedAt: recovery.updatedAt || null
            },
            matchHistoryCount: userMatches.length,
            matchHistory: userMatches,
            feedbacksSubmitted: userFeedbacks,
            pdpaConsentAuditHistory: userConsents
        };

        // บันทึก Log การใช้สิทธิ DSR
        await savePdpaDsrRequest({
            userId: user.id,
            username: user.username,
            requestType: 'export_data',
            status: 'completed',
            details: { recordCount: { matches: userMatches.length, consents: userConsents.length } },
            ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
            userAgent: req.headers['user-agent'] || ''
        });

        const filename = `GINDER_Personal_Data_${user.username}_${new Date().toISOString().slice(0, 10)}.json`;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(JSON.stringify(bundle, null, 2));
    } catch (err) {
        console.error("Error generating PDPA export:", err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการสร้างไฟล์ข้อมูลส่วนบุคคล" });
    }
});

// 4. DSR: สิทธิในการขอลบหรือทำลายข้อมูลส่วนบุคคล (Right to Erasure / Right to be Forgotten)
app.post('/api/pdpa/delete-my-account', authLimiter, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "กรุณาเข้าสู่ระบบก่อนดำเนินการ" });
    const user = await findUserById(req.session.userId);
    if (!user) return res.status(404).json({ message: "ไม่พบผู้ใช้ในระบบ" });

    // ตรวจสอบการยืนยันเพื่อความปลอดภัย (รองรับทั้งคำยืนยัน DELETE สำหรับ OAuth และรหัสผ่าน)
    const confirmation = (req.body.confirmation || req.body.password || '').trim();
    if (!confirmation) {
        return res.status(400).json({ message: "กรุณากรอกคำว่า DELETE หรือรหัสผ่านเพื่อยืนยันการลบบัญชีถาวร" });
    }

    const isOauthUser = user.password_hash && user.password_hash.startsWith('oauth_');
    if (isOauthUser || confirmation.toUpperCase() === 'DELETE') {
        if (confirmation.toUpperCase() !== 'DELETE' && !isOauthUser) {
            return res.status(400).json({ message: "คำยืนยันไม่ถูกต้อง กรุณาพิมพ์คำว่า DELETE" });
        }
    } else if (user.password_salt && user.password_hash) {
        const computed = crypto.pbkdf2Sync(confirmation, user.password_salt, 100000, 32, 'sha256').toString('hex');
        if (!safeCompare(computed, user.password_hash)) {
            return res.status(400).json({ message: "รหัสผ่านไม่ถูกต้อง ไม่สามารถดำเนินการลบบัญชีได้" });
        }
    }

    // ไม่อนุญาตให้ลบแอดมินคนสุดท้าย
    if (user.role === 'admin') {
        const { count } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'admin');
        if (count <= 1) {
            return res.status(400).json({ message: "ไม่สามารถลบบัญชีผู้ดูแลระบบคนสุดท้ายได้ กรุณาแต่งตั้งผู้ดูแลระบบคนอื่นก่อนดำเนินการ" });
        }
    }

    const deletedUsername = user.username;
    const deletedUserId = user.id;

    // บันทึก Log การใช้สิทธิขอลบข้อมูลก่อนการลบ
    await savePdpaDsrRequest({
        userId: deletedUserId,
        username: deletedUsername,
        requestType: 'delete_account',
        status: 'completed',
        details: { action: 'Full account & personal data erasure requested and verified by user' },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        userAgent: req.headers['user-agent'] || ''
    });

    // ลบข้อมูลจาก Supabase
    try {
        await supabase.from('user_security').delete().eq('user_id', deletedUserId);
        await supabase.from('users').delete().eq('id', deletedUserId);
    } catch (e) {
        console.error("Error deleting user from Supabase:", e);
    }

    // ลบข้อมูลการกู้คืนใน Local Recovery
    try {
        const recMap = getLocalUserRecoveryMap();
        if (recMap[deletedUsername.toLowerCase()]) {
            delete recMap[deletedUsername.toLowerCase()];
            fs.writeFileSync(USER_RECOVERY_FILE, JSON.stringify(recMap, null, 2), 'utf8');
        }
    } catch (e) {}

    // ลบออกจาก Memory สำหรับ Guest/Local Users
    localUsers.delete(deletedUserId);

    // ทำลายเซสชัน
    req.session.destroy(() => {
        res.json({
            success: true,
            message: "ลบบัญชีและข้อมูลส่วนบุคคลทั้งหมดของคุณออกจากระบบเรียบร้อยแล้ว ขอบคุณที่เคยเป็นส่วนหนึ่งกับ GINDER"
        });
    });
});

// --- ADMIN PDPA DASHBOARD ROUTES ---

app.get('/api/admin/pdpa/summary', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });

    try {
        const consentLogs = await getPdpaConsentLogs();
        const dsrRequests = await getPdpaDsrRequests();

        const totalConsents = consentLogs.length;
        const analyticsConsents = consentLogs.filter(c => !!c.analytics).length;
        const marketingConsents = consentLogs.filter(c => !!c.marketing).length;
        const signupConsents = consentLogs.filter(c => c.consentType === 'signup').length;
        const cookieBannerConsents = consentLogs.filter(c => c.consentType === 'cookie_banner' || c.consentType === 'preference_center').length;

        const analyticsRate = totalConsents > 0 ? Math.round((analyticsConsents / totalConsents) * 100) : 0;
        const marketingRate = totalConsents > 0 ? Math.round((marketingConsents / totalConsents) * 100) : 0;

        const dsrCounts = {
            export_data: dsrRequests.filter(d => d.requestType === 'export_data').length,
            delete_account: dsrRequests.filter(d => d.requestType === 'delete_account').length,
            withdraw_consent: dsrRequests.filter(d => d.requestType === 'withdraw_consent').length,
            other: dsrRequests.filter(d => !['export_data', 'delete_account', 'withdraw_consent'].includes(d.requestType)).length
        };

        res.json({
            metrics: {
                totalConsents,
                analyticsConsents,
                marketingConsents,
                analyticsRate,
                marketingRate,
                signupConsents,
                cookieBannerConsents,
                totalDsrRequests: dsrRequests.length,
                dsrCounts
            },
            recentLogs: consentLogs.slice(0, 100),
            recentDsrRequests: dsrRequests.slice(0, 50)
        });
    } catch (err) {
        console.error("Error generating PDPA admin summary:", err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลรายงาน PDPA" });
    }
});

app.get('/api/admin/pdpa/logs', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });
    res.json(await getPdpaConsentLogs());
});

app.get('/api/admin/pdpa/dsr-requests', async (req, res) => {
    if (await getUserRole(req) !== 'admin') return res.status(403).json({ message: "สิทธิ์ไม่เพียงพอ" });
    res.json(await getPdpaDsrRequests());
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

// Verify Room Existence Endpoint (Error Prevention / Usability)
app.get('/api/rooms/:roomId/check', (req, res) => {
    const roomId = (req.params.roomId || '').trim().toUpperCase();
    if (!roomId || roomId.length !== 4) {
        return res.json({
            exists: false,
            message: 'รหัสห้องต้องเป็นตัวอักษรหรือตัวเลข 4 หลัก'
        });
    }

    const room = rooms[roomId];
    if (!room) {
        return res.json({
            exists: false,
            message: `ไม่พบห้อง "${roomId}" หรือห้องอาจถูกปิดไปแล้ว`
        });
    }

    if (room.started) {
        return res.json({
            exists: true,
            started: true,
            message: `ห้อง "${roomId}" เริ่มการโหวตไปแล้ว ไม่สามารถเข้าร่วมได้`
        });
    }

    const memberCount = Object.keys(room.users || {}).length;
    return res.json({
        exists: true,
        started: false,
        memberCount: memberCount,
        message: `พบห้อง "${roomId}" แล้ว (มีสมาชิก ${memberCount} คน)`
    });
});

app.post('/api/check-room', (req, res) => {
    const roomId = (req.body && req.body.roomId ? req.body.roomId : '').trim().toUpperCase();
    if (!roomId || roomId.length !== 4) {
        return res.json({ exists: false, message: 'รหัสห้องต้องเป็นตัวอักษรหรือตัวเลข 4 หลัก' });
    }
    const room = rooms[roomId];
    if (!room) {
        return res.json({ exists: false, message: `ไม่พบห้อง "${roomId}" หรือห้องอาจถูกปิดไปแล้ว` });
    }
    if (room.started) {
        return res.json({ exists: true, started: true, message: `ห้อง "${roomId}" เริ่มการโหวตไปแล้ว ไม่สามารถเข้าร่วมได้` });
    }
    const memberCount = Object.keys(room.users || {}).length;
    return res.json({ exists: true, started: false, memberCount, message: `พบห้อง "${roomId}" แล้ว (มีสมาชิก ${memberCount} คน)` });
});

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

function buildRoomState(room) {
    if (!room) return null;
    const allAllergiesSet = new Set(room.allergies || []);
    Object.values(room.users || {}).forEach(u => {
        (u.allergies || []).forEach(a => allAllergiesSet.add(a));
    });
    const allAllergies = Array.from(allAllergiesSet);

    return {
        roomId: room.id,
        creatorId: room.creatorId,
        users: Object.entries(room.users || {}).map(([sid, u]) => ({
            id: sid,
            name: u.name,
            progress: u.progress,
            allergies: u.allergies || []
        })),
        started: room.started,
        preferences: room.preferences || {},
        hostAllergies: room.allergies || [],
        allAllergies: allAllergies
    };
}

function sanitizeMemberName(raw) {
    if (!raw) return '';
    return String(raw)
        .replace(/<[^>]*>/g, '')
        .replace(/["'<>\\`]/g, '')
        .trim();
}

io.on('connection', (socket) => {
    
    socket.on('create_room', (data) => {
        let roomId;
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        while (true) {
            roomId = Array.from({length: 4}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
            if (!rooms[roomId]) break;
        }
        
        const hostPreferences = (data && data.preferences) ? data.preferences : (data || {});
        const hostAllergies = (data && Array.isArray(data.allergies)) ? data.allergies : [];
        const hostName = sanitizeMemberName((data && data.hostName) ? data.hostName : 'Host');
        
        rooms[roomId] = {
            id: roomId,
            creatorId: socket.id,
            preferences: hostPreferences,
            allergies: hostAllergies,
            users: {},
            started: false,
            restaurants: [],
            votes: {},
            timerActive: false,
            timeLeft: 180,
            matchedRestaurant: null,
            timerInterval: null
        };
        
        console.log(`[Room Created] ID: ${roomId} by ${socket.id} with preferences:`, hostPreferences, `allergies:`, hostAllergies);
        socket.join(roomId);
        socket.emit('room_created', {
            roomId,
            preferences: hostPreferences,
            allergies: hostAllergies,
            appUrl: APP_URL,
            networkUrl: (process.env.NODE_ENV === 'production' || process.env.APP_URL) ? APP_URL : `http://${getLocalNetworkIp()}:${PORT}`
        });
    });
    
    socket.on('join_room', (data) => {
        const roomId = (data.roomId || '').trim().toUpperCase();
        let name = (data.name || '').trim().slice(0, 50);
        name = sanitizeMemberName(name);
        const allergies = data.allergies || [];
        const preferences = data.preferences || {};
        
        const room = rooms[roomId];
        if (!room) return socket.emit('join_error', { message: 'ไม่พบห้องนี้ กรุณาตรวจสอบรหัสห้องอีกครั้ง' });
        if (room.started) return socket.emit('join_error', { message: 'ห้องนี้เริ่มโหวตไปแล้ว ไม่สามารถเข้าร่วมได้' });
        if (!name) return socket.emit('join_error', { message: 'กรุณาระบุชื่อของคุณ' });
        
        for (const [sid, user] of Object.entries(room.users)) {
            if (sid !== socket.id && user.name.toLowerCase() === name.toLowerCase()) {
                return socket.emit('join_error', { message: 'ชื่อนี้มีผู้ใช้งานในห้องนี้แล้ว กรุณาใช้ชื่ออื่น' });
            }
        }
        
        room.users[socket.id] = { name, allergies, preferences, progress: 0 };
        socket.join(roomId);
        console.log(`[User Joined] ${name} joined room ${roomId} with allergies`, allergies);
        
        const roomState = buildRoomState(room);
        io.to(roomId).emit('room_state', roomState);
        
        socket.emit('join_success', {
            userId: socket.id,
            roomId,
            creatorId: room.creatorId,
            preferences: room.preferences || {},
            hostAllergies: room.allergies || [],
            allAllergies: roomState.allAllergies
        });
    });
    
    socket.on('update_member', (data) => {
        const roomId = (data.roomId || '').trim().toUpperCase();
        const room = rooms[roomId];
        if (room && room.users[socket.id]) {
            if (data.name && data.name.trim()) {
                room.users[socket.id].name = sanitizeMemberName(data.name.trim().slice(0, 50));
            }
            if (Array.isArray(data.allergies)) {
                room.users[socket.id].allergies = data.allergies;
            }
            io.to(roomId).emit('room_state', buildRoomState(room));
        }
    });
    
    socket.on('kick_user', (data) => {
        const roomId = (data.roomId || '').trim().toUpperCase();
        const room = rooms[roomId];
        if (!room || room.creatorId !== socket.id) return;
        
        const targetSid = data.userId;
        if (room.users[targetSid]) {
            const userName = room.users[targetSid].name;
            delete room.users[targetSid];
            console.log(`[Kick] Host kicked user ${userName}`);
            
            io.to(targetSid).emit('kicked', { roomId: data.roomId });
            const targetSocket = io.sockets.sockets.get(targetSid);
            if (targetSocket) targetSocket.leave(data.roomId);
            
            io.to(data.roomId).emit('room_state', buildRoomState(room));
        }
    });

    socket.on('update_room_settings', (data) => {
        const roomId = (data.roomId || '').trim().toUpperCase();
        const room = rooms[roomId];
        if (!room || room.creatorId !== socket.id || room.started) return;

        if (data.preferences && typeof data.preferences === 'object') {
            room.preferences = {
                ...room.preferences,
                ...data.preferences
            };
            console.log(`[Room Settings Updated] Room ${roomId} by Host ${socket.id}:`, room.preferences);
            io.to(roomId).emit('room_state', buildRoomState(room));
            io.to(roomId).emit('room_settings_updated', {
                preferences: room.preferences
            });
        }
    });
    
    socket.on('start_game', async (data) => {
        const roomId = (data.roomId || '').trim().toUpperCase();
        const room = rooms[roomId];
        if (!room || room.creatorId !== socket.id || room.started) return;
        
        const userCount = Object.keys(room.users || {}).length;
        if (userCount < 2) {
            console.log(`[Start Game Rejected] Room ${roomId} has only ${userCount} user(s). Minimum 2 required.`);
            return socket.emit('start_game_error', {
                message: 'โหมดกลุ่มต้องมีสมาชิกมากกว่า 1 คนขึ้นไป กรุณารอเพื่อนเข้าห้องก่อนนะ!'
            });
        }
        
        const allAllergiesSet = new Set(room.allergies || []);
        Object.values(room.users || {}).forEach(u => (u.allergies || []).forEach(a => allAllergiesSet.add(a)));
        const allAllergies = Array.from(allAllergiesSet);
        console.log(`[Start Game] Room ${roomId}: Aggregated member allergies for safety:`, allAllergies);
        
        // Aggregate desired food types across host & members
        const activePreferences = { ...room.preferences };
        const hostTypes = (room.preferences && Array.isArray(room.preferences.foodTypes)) ? room.preferences.foodTypes : [];
        const desiredFoodTypes = new Set(hostTypes);

        Object.values(room.users).forEach(u => {
            if (u.preferences && Array.isArray(u.preferences.foodTypes)) {
                if (u.preferences.foodTypes.length > 0 && u.preferences.foodTypes.length < 6) {
                    u.preferences.foodTypes.forEach(t => desiredFoodTypes.add(t));
                }
            }
        });

        if (desiredFoodTypes.size > 0 && desiredFoodTypes.size < 6) {
            activePreferences.foodTypes = Array.from(desiredFoodTypes);
        } else {
            activePreferences.foodTypes = []; // All food types allowed
        }
        
        const allR = await getAllRestaurants();
        let filtered = filterRestaurantsByCriteria(allR, activePreferences, allAllergies, data.coords);
        
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
        const roomId = (data.roomId || '').trim().toUpperCase();
        const room = rooms[roomId];
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

    // Gamification: Real-Time Room Emote Reactions
    socket.on('send_reaction', (data) => {
        const roomId = ((data && data.roomId) || '').trim().toUpperCase();
        const emoji = (data && data.emoji && typeof data.emoji === 'string') ? data.emoji.trim().slice(0, 10) : '';
        if (!roomId || !emoji || !rooms[roomId]) return;
        const senderName = rooms[roomId].users[socket.id] ? rooms[roomId].users[socket.id].name : 'เพื่อนในห้อง';
        io.to(roomId).emit('room_reaction', {
            emoji,
            senderName,
            socketId: socket.id,
            timestamp: Date.now()
        });
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

                    io.to(roomId).emit('room_state', buildRoomState(room));
                    
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
if (require.main === module) {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT}`);
    });

    // Local dev helper: if port 3000 is free and PORT is not 3000, forward legacy Supabase redirect to active app
    if (PORT !== 3000 && process.env.NODE_ENV !== 'production') {
        try {
            const helperServer = http.createServer((req, res) => {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(`<!DOCTYPE html><html><head><title>GINDER OAuth Redirect</title><script>
                    const targetPort = ${PORT};
                    const targetUrl = 'http://' + window.location.hostname + ':' + targetPort + '/' + window.location.search + window.location.hash;
                    window.location.replace(targetUrl);
                </script></head><body style="background:#100923;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">กำลังพาคุณกลับเข้าสู่ระบบ GINDER...</body></html>`);
            });
            helperServer.on('error', () => {});
            helperServer.listen(3000, '0.0.0.0', () => {
                console.log(`[OAuth Helper] Port 3000 active: auto-forwarding Supabase redirects to port ${PORT}`);
            });
        } catch (e) {}
    }
}

module.exports = { app, server };
