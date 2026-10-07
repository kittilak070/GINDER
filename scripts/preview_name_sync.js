const fs = require('fs');
const path = require('path');

const audit = JSON.parse(fs.readFileSync(path.join(__dirname, 'place_audit.json'), 'utf8'));

// Known local Thai names for English-tagged places in Songkhla to ensure high natural readability
const thaiNameFixes = {
    'ChIJiT9fDxozTTAR7gz2BXWDFFM': 'เกียดฟั่ง ข้าวสตูสงขลา (Kiat Fang Restaurant)',
    'ChIJQ8N4CBozTTAR7331kUl1Gxo': 'แต้เฮี้ยงอิ้ว (Tae Hieng Lew)',
    'ChIJN3kQ3BozTTARD1D0k-8f2eI': 'ไอติมโอ่ง (Ice cream jar)',
    'ChIJD8n_mRczTTARKR22y40V33o': 'ก๋วยเตี๋ยวหางหมูป้าเนี้ยว (Pork Tail Noodle)',
    'ChIJb8u74hczTTAR70q_D-cM5Rk': 'นายหวาน ข้าวหมูแดง-หมูกรอบ (Nai Wan Restaurant)',
    'ChIJz_8r9x4zTTAR9kCj22mJ1Q4': 'เจ๊นิ ก๋วยเตี๋ยวต้มยำปลากะพง (Jeni)',
    'ChIJb8g97CEzTTAR0gT31qRkm18': 'Heart Made Roastery (Heartmade Craft Coffee Roaster)',
    'ChIJ48uO_SEzTTAR2p6aZk5R2sI': 'Songkhla Station (Songkhla Railway Station)',
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

const output = [];

audit.forEach((a, i) => {
    let finalName = '';
    const gName = a.googleName.trim();
    const cleanOld = a.ginderName.replace(/\(.*?\)/g, '').trim();

    if (thaiNameFixes[a.id]) {
        finalName = thaiNameFixes[a.id];
    } else {
        const cleanG = gName.replace(/[^a-zA-Zก-๙]/g, '');
        const engLetters = (cleanG.match(/[a-zA-Z]/g) || []).length;
        const thaiLetters = (cleanG.match(/[ก-๙]/g) || []).length;
        const isMostlyEng = engLetters > thaiLetters;

        if (isMostlyEng) {
            finalName = `${cleanOld} (${gName})`;
        } else {
            // For Thai names, clean up multiple spaces
            finalName = gName.replace(/\s+/g, ' ').trim();
        }
    }

    output.push({
        id: a.id,
        oldName: a.ginderName,
        finalName: finalName,
        googleName: a.googleName,
        address: a.address
    });
});

console.log('Sample 30 mappings:');
output.slice(0, 30).forEach((o, i) => {
    console.log(`${i+1}. [${o.id}]`);
    console.log(`   เดิม: ${o.oldName}`);
    console.log(`   ใหม่: ${o.finalName}`);
    console.log(`   Maps: ${o.googleName}`);
});

fs.writeFileSync(path.join(__dirname, 'name_mapping_preview.json'), JSON.stringify(output, null, 2), 'utf8');
console.log('\nSaved full preview to scripts/name_mapping_preview.json');
