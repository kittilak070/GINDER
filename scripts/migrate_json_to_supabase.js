/**
 * GINDER - Data Migration Script
 * โอนย้ายข้อมูลจาก Local JSON (data/*.json) เข้าสู่ Supabase Database
 *
 * วิธีใช้งาน:
 * 1. ตรวจสอบว่าได้รัน SQL ใน supabase_migrations/01_create_missing_tables.sql แล้ว
 * 2. รันคำสั่ง: node scripts/migrate_json_to_supabase.js
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('[!] Error: กรุณากำหนด SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ใน .env ก่อน');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const DATA_DIR = path.join(__dirname, '..', 'data');
const USER_RECOVERY_FILE = path.join(DATA_DIR, 'user_recovery.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.json');

async function checkTableExists(tableName) {
    const { error } = await supabase.from(tableName).select().limit(1);
    return !error;
}

async function migrateUserRecovery() {
    console.log('\n--- 1. Migrating User Recovery Data ---');
    if (!fs.existsSync(USER_RECOVERY_FILE)) {
        console.log('(-) ไม่พบไฟล์ user_recovery.json ข้ามขั้นตอนนี้');
        return;
    }

    let recoveryMap = {};
    try {
        recoveryMap = JSON.parse(fs.readFileSync(USER_RECOVERY_FILE, 'utf8'));
    } catch (e) {
        console.error('(!) ไม่สามารถอ่านไฟล์ user_recovery.json ได้:', e.message);
        return;
    }

    const usernames = Object.keys(recoveryMap);
    console.log(`พบข้อมูลกู้คืนบัญชีทั้งหมด ${usernames.length} รายการ`);

    let migrated = 0;
    for (const username of usernames) {
        const rec = recoveryMap[username];
        // หา User ID จากฐานข้อมูล Supabase
        const { data: user, error: uErr } = await supabase
            .from('users')
            .select('id, username')
            .ilike('username', username)
            .maybeSingle();

        if (uErr || !user) {
            console.warn(`[!] ข้าม ${username}: ไม่พบบัญชีผู้ใช้นี้ในตาราง users บน Supabase`);
            continue;
        }

        const payload = {
            user_id: user.id,
            username: user.username,
            recovery_email: rec.email || null,
            security_question: rec.securityQuestion || null,
            security_answer_hash: rec.securityAnswerHash || null,
            security_answer_salt: rec.securityAnswerSalt || null,
            recovery_pin_hash: rec.recoveryPinHash || null,
            recovery_pin_salt: rec.recoveryPinSalt || null,
            updated_at: rec.updatedAt || new Date().toISOString()
        };

        const { error: insErr } = await supabase.from('user_security').upsert(payload);
        if (insErr) {
            console.error(`(!) Error saving user_security for ${username}:`, insErr.message);
        } else {
            migrated++;
        }
    }
    console.log(`(+) ย้ายข้อมูล user_security สำเร็จ: ${migrated}/${usernames.length} รายการ`);
}

async function migrateHistory() {
    console.log('\n--- 2. Migrating Match History Data ---');
    if (!fs.existsSync(HISTORY_FILE)) {
        console.log('(-) ไม่พบไฟล์ history.json ข้ามขั้นตอนนี้');
        return;
    }

    let historyList = [];
    try {
        historyList = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    } catch (e) {
        console.error('(!) ไม่สามารถอ่านไฟล์ history.json ได้:', e.message);
        return;
    }

    console.log(`พบประวัติการแมตช์ทั้งหมด ${historyList.length} รายการ`);
    let migrated = 0;

    for (const item of historyList) {
        const payload = {
            id: item.id || 'hist_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            room_id: item.roomId || null,
            restaurant_id: item.restaurant ? item.restaurant.id : null,
            restaurant: item.restaurant || {},
            participants: item.participants || [],
            is_fallback: !!item.isFallback,
            fallback_reason: item.fallbackReason || null,
            matched_at: item.matchedAt || new Date().toISOString()
        };

        const { error: insErr } = await supabase.from('match_history').upsert(payload);
        if (insErr) {
            console.error(`(!) Error saving match_history item ${payload.id}:`, insErr.message);
        } else {
            migrated++;
        }
    }
    console.log(`(+) ย้ายข้อมูล match_history สำเร็จ: ${migrated}/${historyList.length} รายการ`);
}

async function migrateFeedback() {
    console.log('\n--- 3. Migrating Feedback Data ---');
    if (!fs.existsSync(FEEDBACK_FILE)) {
        console.log('(-) ไม่พบไฟล์ feedback.json ข้ามขั้นตอนนี้');
        return;
    }

    let feedbackList = [];
    try {
        feedbackList = JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8'));
    } catch (e) {
        console.error('(!) ไม่สามารถอ่านไฟล์ feedback.json ได้:', e.message);
        return;
    }

    console.log(`พบรายการฟีดแบ็กทั้งหมด ${feedbackList.length} รายการ`);
    let migrated = 0;

    for (const item of feedbackList) {
        const payload = {
            id: item.id || 'fb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            type: item.type || 'general',
            title: item.title || 'ข้อเสนอแนะทั่วไป',
            description: item.description || item.message || '',
            contact_info: item.contactInfo || item.contact || item.email || null,
            created_at: item.createdAt || new Date().toISOString()
        };

        const { error: insErr } = await supabase.from('feedbacks').upsert(payload);
        if (insErr) {
            console.error(`(!) Error saving feedback item ${payload.id}:`, insErr.message);
        } else {
            migrated++;
        }
    }
    console.log(`(+) ย้ายข้อมูล feedbacks สำเร็จ: ${migrated}/${feedbackList.length} รายการ`);
}

async function main() {
    console.log('======================================================');
    console.log(' GINDER DATA MIGRATION: JSON -> SUPABASE');
    console.log(' Target URL:', supabaseUrl);
    console.log('======================================================');

    console.log('กำลังตรวจสอบความพร้อมของตารางบน Supabase...');
    const hasSec = await checkTableExists('user_security');
    const hasHist = await checkTableExists('match_history');
    const hasFb = await checkTableExists('feedbacks');

    if (!hasSec || !hasHist || !hasFb) {
        console.error('\n[!] ตารางยังไม่ครบถ้วนบน Supabase:');
        console.error(`    - user_security : ${hasSec ? 'OK' : 'MISSING'}`);
        console.error(`    - match_history : ${hasHist ? 'OK' : 'MISSING'}`);
        console.error(`    - feedbacks     : ${hasFb ? 'OK' : 'MISSING'}`);
        console.error('\nกรุณาเปิดหน้า Supabase Dashboard -> SQL Editor');
        console.error('แล้วนำคำสั่งในไฟล์: supabase_migrations/01_create_missing_tables.sql ไปกด Run ก่อนครับ\n');
        return;
    }

    console.log('ตารางทั้งหมดพร้อมแล้ว เริ่มการโอนย้ายข้อมูล...');
    await migrateUserRecovery();
    await migrateHistory();
    await migrateFeedback();

    console.log('\n======================================================');
    console.log(' [COMPLETED] การโอนย้ายข้อมูลเสร็จสมบูรณ์!');
    console.log('======================================================\n');
}

main().catch(err => {
    console.error('Migration failed with exception:', err);
});
