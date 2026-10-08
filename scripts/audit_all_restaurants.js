require('dotenv').config();
const fs = require('fs');
const path = require('path');

const key = process.env.GOOGLE_MAPS_API_KEY;
if (!key) {
    console.error('Missing GOOGLE_MAPS_API_KEY');
    process.exit(1);
}

const mockPath = path.join(__dirname, '..', 'data', 'mock_restaurants.json');
const restaurants = JSON.parse(fs.readFileSync(mockPath, 'utf8'));

const sleep = ms => new Promise(res => setTimeout(res, ms));

async function audit() {
    console.log(`🔍 เริ่มตรวจสอบความตรงกันของชื่อร้านอาหารทั้ง ${restaurants.length} ร้านกับ Google Maps...`);
    const results = [];
    let exactMatches = 0;
    let bilingualMatches = 0;
    let partialMatches = 0;
    let mismatches = 0;
    let quotaHit = false;

    for (let i = 0; i < restaurants.length; i++) {
        const r = restaurants[i];
        if (!r.googlePlaceId) {
            results.push({
                id: r.id,
                ginderName: r.name,
                googleName: '(ไม่มี googlePlaceId)',
                status: 'NO_PLACE_ID',
                googleMapsUri: r.googleMapsUri
            });
            continue;
        }

        try {
            const url = `https://places.googleapis.com/v1/places/${r.googlePlaceId}`;
            const res = await fetch(url, {
                headers: {
                    'X-Goog-Api-Key': key,
                    'X-Goog-FieldMask': 'id,displayName,formattedAddress,googleMapsUri',
                    'X-Goog-LanguageCode': 'th'
                }
            });

            if (!res.ok) {
                if (res.status === 429) {
                    console.log(`⚠️ ติดโควตาคำขอรายวันของ Google Maps API (429) ที่ร้านที่ ${i + 1}/${restaurants.length}`);
                    quotaHit = true;
                    break;
                }
                const errText = await res.text();
                results.push({
                    id: r.id,
                    ginderName: r.name,
                    googleName: `(API Error ${res.status})`,
                    status: 'API_ERROR',
                    detail: errText,
                    googleMapsUri: r.googleMapsUri
                });
                continue;
            }

            const data = await res.json();
            const googleName = data.displayName?.text || '';
            const ginderName = r.name || '';

            // Match Analysis
            const normGinder = ginderName.toLowerCase().replace(/[\s\(\)\-\_]/g, '');
            const normGoogle = googleName.toLowerCase().replace(/[\s\(\)\-\_]/g, '');

            let matchStatus = 'MISMATCH';
            let note = '';

            if (ginderName.trim() === googleName.trim()) {
                matchStatus = 'EXACT';
                exactMatches++;
            } else if (normGinder === normGoogle) {
                matchStatus = 'EXACT_NORMALIZED';
                exactMatches++;
                note = 'ตรงกัน (ต่างเพียงเว้นวรรคหรือเครื่องหมาย)';
            } else if (ginderName.includes(googleName) || googleName.includes(ginderName)) {
                matchStatus = 'PARTIAL_CONTAINED';
                bilingualMatches++;
                note = 'ชื่อครอบคลุมกัน (เช่น มีชื่อไทยกำกับหรือชื่ออังกฤษในวงเล็บ)';
            } else {
                // Check token overlap
                const ginderTokens = ginderName.split(/[\s\(\)]+/).filter(Boolean);
                const googleTokens = googleName.split(/[\s\(\)]+/).filter(Boolean);
                const overlap = ginderTokens.filter(t => googleName.includes(t) || googleTokens.some(gt => gt.includes(t)));
                if (overlap.length > 0) {
                    matchStatus = 'PARTIAL_OVERLAP';
                    partialMatches++;
                    note = `มีคำตรงกันบางส่วน: ${overlap.join(', ')}`;
                } else {
                    matchStatus = 'MISMATCH';
                    mismatches++;
                    note = 'ชื่อไม่ตรงกัน';
                }
            }

            results.push({
                index: i + 1,
                id: r.id,
                ginderName: ginderName,
                googleName: googleName,
                matchStatus: matchStatus,
                note: note,
                googleMapsUri: data.googleMapsUri || r.googleMapsUri,
                address: data.formattedAddress || r.address
            });

            if ((i + 1) % 15 === 0 || i === restaurants.length - 1) {
                console.log(`  ⏳ ตรวจสอบแล้ว ${i + 1}/${restaurants.length} ร้าน... (ตรง 100%: ${exactMatches}, มีชื่อไทย/อังกฤษเสริม: ${bilingualMatches}, คล้ายคลึง: ${partialMatches}, ไม่ตรง: ${mismatches})`);
            }

            await sleep(150);
        } catch (err) {
            console.error(`Error on ${r.id}:`, err.message);
            break;
        }
    }

    const auditSummary = {
        totalRestaurants: restaurants.length,
        checkedCount: results.length,
        exactMatches,
        bilingualMatches,
        partialMatches,
        mismatches,
        quotaHit,
        results
    };

    const outPath = path.join(__dirname, 'place_audit_detailed.json');
    fs.writeFileSync(outPath, JSON.stringify(auditSummary, null, 2), 'utf8');
    console.log(`\n✅ บันทึกผลการตรวจสอบอย่างละเอียดลงที่: ${outPath}`);
    console.log(`📊 สรุปผล: ตรวจสอบ ${results.length}/${restaurants.length} ร้าน`);
    console.log(`   - ตรงกันแบบ 100% (Exact): ${exactMatches}`);
    console.log(`   - ตรงกันแบบมีชื่อไทย/อังกฤษเสริม (Bilingual/Contained): ${bilingualMatches}`);
    console.log(`   - ตรงกันบางคำ (Partial): ${partialMatches}`);
    console.log(`   - ไม่ตรงกัน (Mismatch): ${mismatches}`);
}

audit();
