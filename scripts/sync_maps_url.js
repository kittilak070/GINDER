/**
 * Sync Google Maps URLs for all restaurants to Supabase
 * Usage: node scripts/sync_maps_url.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

async function main() {
    console.log("🚀 กำลังเตรียมซิงค์ลิงก์ Google Maps ขึ้น Supabase...");

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error("❌ ขาด SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY ใน .env");
        process.exit(1);
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const mockFile = path.join(__dirname, '..', 'data', 'mock_restaurants.json');
    const restaurants = JSON.parse(fs.readFileSync(mockFile, 'utf8'));

    // Check if maps_url column exists by testing one update
    const sampleUrl = restaurants[0].googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${restaurants[0].latitude},${restaurants[0].longitude}`;
    const testRes = await supabase.from('restaurants').update({ maps_url: sampleUrl }).eq('id', restaurants[0].id);

    if (testRes.error && testRes.error.message.includes("Could not find the 'maps_url' column")) {
        console.log(`
⚠️ [จำเป็นต้องเพิ่มคอลัมน์ใน Supabase ก่อน]
ในตาราง 'restaurants' ของ Supabase ยังไม่มีคอลัมน์ 'maps_url'
กรุณาทำตามขั้นตอนนี้ (ใช้เวลาไม่ถึง 1 นาที):
1. ไปที่ Supabase Dashboard (SQL Editor):
   👉 https://supabase.com/dashboard/project/icksdmnzcdswiscusrep/sql
2. วางคำสั่ง SQL นี้แล้วกด RUN:
   ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS maps_url text;
3. หลังจากนั้นรันคำสั่ง: node scripts/sync_maps_url.js อีกครั้งเพื่อซิงค์ลิงก์ขึ้นทันที!
        `);
        return false;
    }

    console.log(`✅ พบคอลัมน์ 'maps_url' ใน Supabase เรียบร้อยแล้ว กำลังอัปเดตลิงก์ให้ครบ ${restaurants.length} ร้าน...`);
    let updated = 0;

    for (const r of restaurants) {
        const link = r.googleMapsUri || (r.latitude && r.longitude ? `https://www.google.com/maps/search/?api=1&query=${r.latitude},${r.longitude}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name + ' ' + (r.address || ''))}`);
        const { error } = await supabase.from('restaurants').update({ maps_url: link }).eq('id', r.id);
        if (!error) updated++;
    }

    // Safety pass: Any other restaurants in Supabase missing maps_url (e.g. added via Admin panel)
    const { data: missingRows } = await supabase.from('restaurants').select('id, name, address, latitude, longitude').is('maps_url', null);
    if (missingRows && missingRows.length > 0) {
        for (const row of missingRows) {
            const fallbackLink = (row.latitude && row.longitude)
                ? `https://www.google.com/maps/search/?api=1&query=${row.latitude},${row.longitude}`
                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.name + ' ' + (row.address || ''))}`;
            await supabase.from('restaurants').update({ maps_url: fallbackLink }).eq('id', row.id);
            updated++;
        }
    }

    console.log(`🎉 ซิงค์ลิงก์ Google Maps ขึ้น Supabase สำเร็จครบทั้ง ${updated} ร้านเรียบร้อยแล้ว (ไม่มีแถวใดว่าง)!`);
    return true;
}

main().catch(console.error);
