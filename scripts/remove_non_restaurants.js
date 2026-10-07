require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const toRemove = [
    { id: 'r_songkhla_19', name: 'เครื่องแกงแม่สมจิตรนครศรีฯ', reason: 'ร้านขายเครื่องแกง (ไม่ใช่ร้านอาหาร/เครื่องดื่ม)' },
    { id: 'r_songkhla_20', name: 'ชุมชนย่านเมืองเก่าสงขลา', reason: 'แหล่งท่องเที่ยว/ชุมชน (ไม่ใช่ร้านอาหาร)' },
    { id: 'r_songkhla_24', name: 'ทิวทัศน์ เกาะยอ (Ko Yo Viewpoint)', reason: 'จุดชมวิวเกาะยอ (สถานที่ท่องเที่ยว)' },
    { id: 'r_songkhla_29', name: 'น้าชม ทะเลสาบสงขลา (Laem Son On)', reason: 'แหลมสนอ่อน (สวนสาธารณะ/จุดชมวิว)' },
    { id: 'r_songkhla_31', name: 'ครัวสวนสองทะเล (Song Tha Le Park)', reason: 'สวนสองทะเล (สวนสาธารณะ)' },
    { id: 'r_songkhla_101', name: 'Songkhla Station (Songkhla Railway Station)', reason: 'สถานีรถไฟสงขลา (โบราณสถาน/แหล่งท่องเที่ยว)' }
];

const toRemoveIds = toRemove.map(r => r.id);

async function removeNonRestaurants() {
    console.log('🧹 กำลังลบ 6 สถานที่ที่ไม่ใช่ร้านอาหารออกจากระบบ...');
    toRemove.forEach(r => console.log(`  - [${r.id}] ${r.name} (${r.reason})`));

    const mockFile = path.join(__dirname, '..', 'data', 'mock_restaurants.json');
    const archiveFile = path.join(__dirname, '..', 'data', 'non_restaurants_archive.json');

    const all = JSON.parse(fs.readFileSync(mockFile, 'utf8'));
    console.log(`\n📊 จำนวนสถานที่ก่อนลบ: ${all.length} รายการ`);

    const filtered = all.filter(r => !toRemoveIds.includes(r.id));
    console.log(`📊 จำนวนร้านอาหารหลังลบ: ${filtered.length} ร้าน`);

    // 1. สำรองข้อมูลไว้ที่ archive
    fs.writeFileSync(archiveFile, JSON.stringify(toRemove, null, 2), 'utf8');
    console.log(`💾 บันทึกประวัติรายการที่ลบไว้ที่ ${archiveFile}`);

    // 2. อัปเดต mock_restaurants.json
    fs.writeFileSync(mockFile, JSON.stringify(filtered, null, 2), 'utf8');
    console.log(`✨ บันทึก mock_restaurants.json เรียบร้อย: เหลือ ${filtered.length} ร้านอาหารของจริง`);

    // 3. ลบออกจาก Supabase
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.log('🌐 กำลังลบออกจาก Supabase...');
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const { error } = await supabase.from('restaurants').delete().in('id', toRemoveIds);

        if (error) {
            console.error('❌ Supabase delete error:', error.message);
        } else {
            console.log(`✅ ลบออกจาก Supabase สำเร็จครบทั้ง ${toRemoveIds.length} รายการ!`);
        }

        const { count, error: countErr } = await supabase
            .from('restaurants')
            .select('*', { count: 'exact', head: true });

        if (!countErr) {
            console.log(`📊 จำนวนร้านใน Supabase ปัจจุบัน: ${count} ร้าน`);
        }
    }

    console.log('\n🎉 สำเร็จ 100%! ตอนนี้ระบบเหลือเฉพาะร้านอาหารและคาเฟ่ที่รับประทานได้จริง 71 ร้านใน อ.เมืองสงขลา!');
}

removeNonRestaurants().catch(console.error);
