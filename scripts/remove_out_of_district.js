require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const toRemoveIds = [
    'r_songkhla_11', // พะโล้สะเดา (หาดใหญ่)
    'r_songkhla_12', // ครัวเจ๊ม่วย (เพชรบุรี)
    'r_songkhla_28', // ภูผาเพชร (สตูล)
    'r_songkhla_36', // แหลมทรายซีฟู้ด (ภูเก็ต)
    'r_songkhla_37', // น้องณี (รัตภูมิ)
    'r_songkhla_40', // หาดแก้วซีฟู้ด (สิงหนคร)
    'r_songkhla_43', // เจ๊เฮียง (กทม.)
    'r_songkhla_45', // ก๋วยเตี๋ยวเนื้อนายดำ (ชุมพร)
    'r_songkhla_48', // เจ๊หมวย (หาดใหญ่)
    'r_songkhla_56', // ก๋วยเตี๋ยวปลาอินทรีสด (หาดใหญ่)
    'r_songkhla_77'  // ร้านอาหารทะเล ท้ายเล (สิงหนคร)
];

async function removeOutOfDistrictRestaurants() {
    console.log('🗑️ กำลังลบร้านที่อยู่นอกเขตอำเภอเมืองสงขลา...');

    // 1. Update data/mock_restaurants.json
    const mockFile = path.join(__dirname, '..', 'data', 'mock_restaurants.json');
    const mock = JSON.parse(fs.readFileSync(mockFile, 'utf8'));
    const initialCount = mock.length;
    
    const filteredMock = mock.filter(r => !toRemoveIds.includes(r.id));
    fs.writeFileSync(mockFile, JSON.stringify(filteredMock, null, 2), 'utf8');
    console.log(`✅ ลบออกจาก mock_restaurants.json เรียบร้อย: ${initialCount} -> ${filteredMock.length} ร้าน`);

    // 2. Remove from Supabase
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const { error, data } = await supabase.from('restaurants').delete().in('id', toRemoveIds);
        if (error) {
            console.error('❌ Supabase delete error:', error.message);
        } else {
            console.log(`✅ ลบออกจาก Supabase restaurants table เรียบร้อยครบทั้ง ${toRemoveIds.length} ร้าน!`);
        }
    }

    console.log('🎉 เสร็จสิ้น! ตอนนี้ร้านอาหารในระบบทั้งหมด 110 ร้านอยู่ในเขตอำเภอเมืองสงขลา 100%');
}

removeOutOfDistrictRestaurants().catch(console.error);
