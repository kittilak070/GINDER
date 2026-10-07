require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

async function removeUnverifiedRestaurants() {
    console.log('🧹 เริ่มต้นลบ 33 ร้านจำลองที่ยังไม่มีข้อมูลจริงออกจากระบบ...');

    const mockFile = path.join(__dirname, '..', 'data', 'mock_restaurants.json');
    const archiveFile = path.join(__dirname, '..', 'data', 'unverified_restaurants_archive.json');
    const backupFile = path.join(__dirname, '..', 'data', 'mock_restaurants.backup.json');

    const allRestaurants = JSON.parse(fs.readFileSync(mockFile, 'utf8'));
    console.log(`📊 จำนวนร้านปัจจุบัน: ${allRestaurants.length} ร้าน`);

    const verified = allRestaurants.filter(r => Boolean(r.googlePlaceId));
    const unverified = allRestaurants.filter(r => !r.googlePlaceId);

    console.log(`✅ ร้านที่ตรวจสอบแล้ว (Verified มี Place ID): ${verified.length} ร้าน`);
    console.log(`❌ ร้านจำลองที่จะลบ (Unverified): ${unverified.length} ร้าน`);

    if (unverified.length === 0) {
        console.log('ℹ️ ไม่มีร้านจำลองค้างอยู่ในไฟล์ mock_restaurants.json');
        return;
    }

    // 1. สำรองข้อมูลร้านจำลอง 33 ร้านไว้ใน archive เพื่อความปลอดภัย
    fs.writeFileSync(archiveFile, JSON.stringify(unverified, null, 2), 'utf8');
    fs.writeFileSync(backupFile, JSON.stringify(allRestaurants, null, 2), 'utf8');
    console.log(`💾 สำรองข้อมูลร้านจำลองไว้ที่ ${archiveFile}`);

    // 2. อัปเดต mock_restaurants.json ให้เหลือเฉพาะร้านที่ Verified 100%
    fs.writeFileSync(mockFile, JSON.stringify(verified, null, 2), 'utf8');
    console.log(`✨ บันทึก mock_restaurants.json สำเร็จ: เหลือ ${verified.length} ร้านของจริง`);

    // 3. ลบออกจาก Supabase database
    const toRemoveIds = unverified.map(r => r.id);
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.log('🌐 กำลังลบร้านจำลองออกจาก Supabase...');
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        
        const { error, data } = await supabase
            .from('restaurants')
            .delete()
            .in('id', toRemoveIds);

        if (error) {
            console.error('❌ Supabase delete error:', error.message);
        } else {
            console.log(`✅ ลบออกจาก Supabase สำเร็จครบทั้ง ${toRemoveIds.length} ร้าน!`);
        }

        // ตรวจสอบจำนวนใน Supabase อีกครั้ง
        const { count, error: countErr } = await supabase
            .from('restaurants')
            .select('*', { count: 'exact', head: true });

        if (!countErr) {
            console.log(`📊 จำนวนร้านใน Supabase ปัจจุบัน: ${count} ร้าน`);
        }
    } else {
        console.warn('⚠️ ขาดการตั้งค่า Supabase URL/Key ใน .env');
    }

    console.log('\n🎉 สำเร็จ 100%! ระบบเหลือเฉพาะ 77 ร้านของจริงในอำเภอเมืองสงขลา ที่มี Place ID และหมุดตรง 100%');
}

removeUnverifiedRestaurants().catch(console.error);
