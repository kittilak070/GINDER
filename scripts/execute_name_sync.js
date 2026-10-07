const fs = require('fs');
const path = require('path');

const mockPath = path.join(__dirname, '..', 'data', 'mock_restaurants.json');
const mock = JSON.parse(fs.readFileSync(mockPath, 'utf8'));
const audit = JSON.parse(fs.readFileSync(path.join(__dirname, 'place_audit.json'), 'utf8'));

// Map audit items by restaurant ID
const auditMap = {};
audit.forEach(a => { auditMap[a.id] = a; });

// Curated Thai names for English Google Map tags to provide natural readability
const curatedThaiTitles = {
    'ChIJiT9fDxozTTAR7gz2BXWDFFM': 'เกียดฟั่ง ข้าวสตูสงขลา (Kiat Fang Restaurant)',
    'ChIJQ8N4CBozTTAR7331kUl1Gxo': 'แต้เฮี้ยงอิ้ว (Tae Hieng Lew)',
    'ChIJN3kQ3BozTTARD1D0k-8f2eI': 'ไอติมโอ่ง (Ice cream jar)',
    'ChIJD8n_mRczTTARKR22y40V33o': 'ก๋วยเตี๋ยวหางหมูป้าเนี้ยว (Pork Tail Noodle)',
    'ChIJb8u74hczTTAR70q_D-cM5Rk': 'นายหวาน ข้าวหมูแดง-หมูกรอบ (Nai Wan Restaurant)',
    'ChIJz_8r9x4zTTAR9kCj22mJ1Q4': 'เจ๊นิ ก๋วยเตี๋ยวต้มยำปลากะพง (Jeni)',
    'ChIJb8g97CEzTTAR0gT31qRkm18': 'Heart Made Roastery (Heartmade Craft Coffee Roaster)',
    'ChIJ48uO_SEzTTAR2p6aZk5R2sI': 'Songkhla Station Cafe (สถานีรถไฟสงขลา คาเฟ่)',
    'ChIJR8n74SszTTAR3mK4K61m1hI': 'ลินส์ คาเฟ่ (Lyn\'s The Shanghai Cafe\')',
    'ChIJ08g7_iAzTTAR4mR_Y47M6sI': 'สตูดิโอ 55 สงขลา (Studio 55 Songkhla)',
    'ChIJ4709_CEzTTAR_kK7qR1M3eI': 'คาเฟ่ เดอ ซี (Cafe\' Der See Nakornnok)',
    'ChIJd2P38fIzTTARq7wI4GqL248': 'น้ำเคียงดิน เกาะยอ (Nam Kieng Din Restaurant)',
    'ChIJd8X5P_IzTTAR2f_g1v4eY0s': 'คุณจิตซีวิว เกาะยอ (Khunjit Sea View Koh Yo)',
    'ChIJv_wP9_IzTTAR1k_5r2Q6m1o': 'ชมจันทร์ซีฟู้ด เกาะยอ (Chomchan Seafood)',
    'ChIJe8X26_IzTTAR3t7f9kLm3uY': 'ทะเลทองซีฟู้ด เกาะยอ (Talaythong Seafood Koh yor)',
    'ChIJZ2e16fIzTTAR_kK2R4vM1wI': 'มหัศจรรย์เกาะยอ ซีฟู้ด (Mahadsajan Ko Yo Seafood)',
    'ChIJ_6U1WfEzTTARy0aK26tQ3b8': 'บันดาหยาซีฟู้ด หาดชลาทัศน์ (BUNDAYA SEAFOOD)',
    'ChIJ1y0eQvQzTTAR0V7q12xK4oM': 'ลุงจิ๋วซีฟู้ด เกาะยอ (Loong Jew Sea Food)',
    'ChIJn0e12_AzTTAR5f5g12zQ6t8': 'บังเซ็มซีฟู้ด หาดทรายแก้ว (Bang Sem Seafood)',
    'ChIJe-UeX_IzTTAR4k7q9wLm1u8': 'ร้านน้าขำ ซีฟู้ด แหลมสนอ่อน (Raan Na Kham Restaurant)',
    'ChIJY_b8z_AzTTAR_k2m1qL45uI': 'ครัวเจ้าเรือ (Krua jao reua)'
};

// Places that matched outside Mueang Songkhla or non-food: revert their Google Place to standard Songkhla coordinates search
const outOfDistrictOrNonFood = new Set([
    'r_songkhla_11', // Hat Yai
    'r_songkhla_12', // Phetchaburi
    'r_songkhla_28', // Satun (Cave)
    'r_songkhla_36', // Phuket
    'r_songkhla_37', // Rattaphum
    'r_songkhla_40', // Community center
    'r_songkhla_43', // Bangkok
    'r_songkhla_45', // Chumphon
    'r_songkhla_48', // Hat Yai
    'r_songkhla_56', // Hat Yai
    'r_songkhla_77'  // Singhanakhon
]);

// Track used names and place IDs to avoid duplicates
const seenNames = new Set();
const seenPlaceIds = new Set();

let updatedCount = 0;

mock.forEach(r => {
    const a = auditMap[r.id];

    // If it was one of the out-of-district or non-food matches, restore its local Mueang Songkhla identity
    if (outOfDistrictOrNonFood.has(r.id)) {
        delete r.googlePlaceId;
        // Keep in Songkhla
        r.address = (r.address || '').includes('สงขลา') ? r.address : 'ตำบลบ่อยาง อำเภอเมืองสงขลา สงขลา 90000';
        r.googleMapsUri = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name + ' เมืองสงขลา')}`;
        return;
    }

    if (!a || !r.googlePlaceId) return;

    // Check if this Place ID has already been assigned to an earlier restaurant
    if (seenPlaceIds.has(r.googlePlaceId)) {
        // This is a duplicate assignment! Leave as distinct restaurant and unlink duplicate Google Place ID
        delete r.googlePlaceId;
        r.googleMapsUri = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name + ' เมืองสงขลา')}`;
        return;
    }
    seenPlaceIds.add(r.googlePlaceId);

    let finalName = '';
    const gName = a.googleName.trim();
    const cleanOld = r.name.replace(/\(.*?\)/g, '').trim();

    if (curatedThaiTitles[r.googlePlaceId]) {
        finalName = curatedThaiTitles[r.googlePlaceId];
    } else {
        const cleanG = gName.replace(/[^a-zA-Zก-๙]/g, '');
        const engLetters = (cleanG.match(/[a-zA-Z]/g) || []).length;
        const thaiLetters = (cleanG.match(/[ก-๙]/g) || []).length;
        const isMostlyEng = engLetters > thaiLetters;

        if (isMostlyEng) {
            finalName = `${cleanOld} (${gName})`;
        } else {
            finalName = gName.replace(/\s+/g, ' ').trim();
        }
    }

    // Ensure name uniqueness
    if (seenNames.has(finalName)) {
        finalName = `${finalName} (สาขาเมืองสงขลา)`;
    }
    seenNames.add(finalName);

    if (r.name !== finalName) {
        r.name = finalName;
        updatedCount++;
    }
});

console.log('Total restaurants updated to match Google Maps (Plan A):', updatedCount);
fs.writeFileSync(mockPath, JSON.stringify(mock, null, 2), 'utf8');
console.log('Saved to data/mock_restaurants.json successfully!');
