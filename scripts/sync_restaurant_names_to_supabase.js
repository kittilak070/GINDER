require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

async function main() {
    console.log('🚀 กำลังซิงค์ชื่อร้านจริงและที่อยู่ขึ้น Supabase...');

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error('❌ ขาด SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY ใน .env');
        process.exit(1);
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const mockFile = path.join(__dirname, '..', 'data', 'mock_restaurants.json');
    const restaurants = JSON.parse(fs.readFileSync(mockFile, 'utf8'));

    let updated = 0;
    for (const r of restaurants) {
        const link = r.googleMapsUri || (r.latitude && r.longitude ? `https://www.google.com/maps/search/?api=1&query=${r.latitude},${r.longitude}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name + ' ' + (r.address || ''))}`);
        
        const payload = {
            name: r.name,
            address: r.address || '',
            maps_url: link,
            latitude: r.latitude || null,
            longitude: r.longitude || null
        };
        if (r.rating) payload.rating = r.rating;

        const { error } = await supabase.from('restaurants').update(payload).eq('id', r.id);
        if (!error) updated++;
        else console.warn(`Update error on ${r.id}:`, error.message);
    }

    console.log(`🎉 ซิงค์ชื่อร้านจริงและที่อยู่ขึ้น Supabase สำเร็จครบทั้ง ${updated}/${restaurants.length} ร้านเรียบร้อยแล้ว!`);
}

main().catch(console.error);
