/**
 * Ginder - Google Maps Places API (New) Data & Photo Fetcher for Mueang Songkhla
 * Optimized for Google Maps Demo Key & Standard API Keys
 *
 * ดึงข้อมูลจริงจาก Google Places API (New) ทั้งภาพถ่ายจริงจากร้าน, พิกัด GPS, เรตติ้ง,
 * เวลาทำการ, และที่อยู่ เพื่อใช้อัปเดตร้านอาหารในเขตอำเภอเมืองสงขลา 100%
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Configuration & Constants
const SOLUTION_ID = 'gmp_git_agentskills_v1';
const PLACES_API_BASE = 'https://places.googleapis.com/v1';

// Mueang Songkhla Coordinates
const SONGKHLA_CENTER = {
    latitude: 7.1895,
    longitude: 100.5954
};
const SONGKHLA_SEARCH_RADIUS_METERS = 15000.0;

// Directories
const DATA_DIR = path.join(__dirname, '..', 'data');
const RESTAURANTS_FILE = path.join(DATA_DIR, 'mock_restaurants.json');
const BACKUP_FILE = path.join(DATA_DIR, 'mock_restaurants.backup.json');
const UPLOADS_DIR = path.join(__dirname, '..', 'static', 'uploads', 'restaurants');

// Parse CLI Arguments
const args = process.argv.slice(2);
function getArg(key, defaultVal = null) {
    const match = args.find(a => a.startsWith(`--${key}=`));
    if (match) return match.split('=')[1].replace(/^["']|["']$/g, '');
    if (args.includes(`--${key}`)) return true;
    return defaultVal;
}

const API_KEY = getArg('key', process.env.GOOGLE_MAPS_API_KEY || '');
const MODE = (getArg('mode', 'all')).toLowerCase();
const LIMIT = parseInt(getArg('limit', '0'), 10) || 0;
const NO_DOWNLOAD = args.includes('--no-download');
const NO_SYNC = args.includes('--no-sync');
const DRY_RUN = args.includes('--dry-run');

// Sleep helper to maintain polite rate limits on Demo Key
const sleep = ms => new Promise(res => setTimeout(res, ms));

// Ensure required upload directory exists
if (!fs.existsSync(UPLOADS_DIR) && !NO_DOWNLOAD) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Supabase client (optional sync)
let supabase = null;
if (!NO_SYNC && process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)) {
    supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
    );
}

// -------------------------------------------------------------
// Google Places API (New) Core Functions
// -------------------------------------------------------------

async function searchPlacesText(query, options = {}) {
    if (!API_KEY) throw new Error("GOOGLE_MAPS_API_KEY is not defined.");

    const url = `${PLACES_API_BASE}/places:searchText`;
    const payload = {
        textQuery: query,
        languageCode: 'th',
        regionCode: 'th',
        locationBias: {
            circle: {
                center: {
                    latitude: options.latitude || SONGKHLA_CENTER.latitude,
                    longitude: options.longitude || SONGKHLA_CENTER.longitude
                },
                radius: options.radius || SONGKHLA_SEARCH_RADIUS_METERS
            }
        }
    };

    const fieldMask = [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.location',
        'places.rating',
        'places.userRatingCount',
        'places.priceLevel',
        'places.types',
        'places.primaryTypeDisplayName',
        'places.photos',
        'places.regularOpeningHours',
        'places.nationalPhoneNumber',
        'places.websiteUri',
        'places.googleMapsUri',
        'places.editorialSummary'
    ].join(',');

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': API_KEY,
            'X-Goog-FieldMask': fieldMask,
            'X-Goog-Maps-Solution-ID': SOLUTION_ID
        },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const errText = await res.text();
        if (res.status === 429) {
            const quotaErr = new Error("DAILY_QUOTA_EXCEEDED");
            quotaErr.isQuota = true;
            throw quotaErr;
        }
        throw new Error(`Google Places API Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data.places || [];
}

async function downloadPlacePhoto(photoResourceName, targetFilepath, maxWidth = 1000) {
    if (!API_KEY) return null;
    if (fs.existsSync(targetFilepath)) {
        return targetFilepath; // Cached
    }

    const photoUrl = `${PLACES_API_BASE}/${photoResourceName}/media?maxWidthPx=${maxWidth}&maxHeightPx=${maxWidth}&key=${API_KEY}&solution_id=${SOLUTION_ID}`;

    try {
        const res = await fetch(photoUrl, {
            redirect: 'follow',
            headers: { 'User-Agent': 'Ginder-Bot/1.0' }
        });

        if (!res.ok) {
            console.warn(`    ⚠️ Photo download failed (${res.status}): ${photoResourceName}`);
            return null;
        }

        const buffer = await res.arrayBuffer();
        if (buffer.byteLength < 1000) {
            console.warn(`    ⚠️ Photo too small (${buffer.byteLength} bytes), skipping.`);
            return null;
        }

        fs.writeFileSync(targetFilepath, Buffer.from(buffer));
        return targetFilepath;
    } catch (e) {
        console.warn(`    ⚠️ Error downloading photo:`, e.message);
        return null;
    }
}

async function getPhotoCdnUri(photoResourceName, maxWidth = 1000) {
    if (!API_KEY) return null;
    const url = `${PLACES_API_BASE}/${photoResourceName}/media?maxWidthPx=${maxWidth}&maxHeightPx=${maxWidth}&key=${API_KEY}&solution_id=${SOLUTION_ID}&skipHttpRedirect=true`;
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        return data.photoUri || null;
    } catch (e) {
        return null;
    }
}

// -------------------------------------------------------------
// Mapping & Classification Helpers
// -------------------------------------------------------------

function mapPriceLevel(priceLevel) {
    switch (priceLevel) {
        case 'PRICE_LEVEL_INEXPENSIVE':
            return { range: '$', avg: 70 };
        case 'PRICE_LEVEL_MODERATE':
            return { range: '$$', avg: 180 };
        case 'PRICE_LEVEL_EXPENSIVE':
            return { range: '$$$', avg: 450 };
        case 'PRICE_LEVEL_VERY_EXPENSIVE':
            return { range: '$$$$', avg: 850 };
        default:
            return { range: '$$', avg: 120 };
    }
}

function detectFoodTypes(place) {
    const types = new Set();
    const textCorpus = [
        place.displayName?.text || '',
        place.editorialSummary?.text || '',
        place.primaryTypeDisplayName?.text || '',
        (place.types || []).join(' ')
    ].join(' ').toLowerCase();

    if (textCorpus.includes('ปักษ์ใต้') || textCorpus.includes('อาหารใต้') || textCorpus.includes('แกงส้ม') || textCorpus.includes('คั่วกลิ้ง') || textCorpus.includes('ข้าวแกง')) {
        types.add('อาหารไทย / อาหารใต้');
    }
    if (textCorpus.includes('จีน') || textCorpus.includes('สตู') || textCorpus.includes('แต้จิ๋ว') || textCorpus.includes('ติ่มซำ') || textCorpus.includes('บะกุ๊ดเต๋') || textCorpus.includes('ซาลาเปา') || textCorpus.includes('โบราณ')) {
        types.add('อาหารจีนโบราณ');
    }
    if (textCorpus.includes('ซีฟู้ด') || textCorpus.includes('seafood') || textCorpus.includes('ทะเล') || textCorpus.includes('ปลากะพง') || textCorpus.includes('กุ้ง') || textCorpus.includes('ปูม้า')) {
        types.add('ซีฟู้ด / อาหารทะเล');
    }
    if (textCorpus.includes('ก๋วยเตี๋ยว') || textCorpus.includes('noodle') || textCorpus.includes('ข้าวมันไก่') || textCorpus.includes('ข้าวหมูแดง') || textCorpus.includes('จานด่วน') || textCorpus.includes('ตามสั่ง')) {
        types.add('จานด่วน / ก๋วยเตี๋ยว');
    }
    if (textCorpus.includes('cafe') || textCorpus.includes('คาเฟ่') || textCorpus.includes('coffee') || textCorpus.includes('กาแฟ') || textCorpus.includes('ขนม') || textCorpus.includes('เบเกอรี่') || textCorpus.includes('ไอศกรีม') || textCorpus.includes('ชาชัก') || textCorpus.includes('โรตี')) {
        types.add('คาเฟ่ / ของหวาน');
    }
    if (textCorpus.includes('ชาบู') || textCorpus.includes('หมูกระทะ') || textCorpus.includes('ปิ้งย่าง') || textCorpus.includes('buffet') || textCorpus.includes('บุฟเฟต์')) {
        types.add('ปิ้งย่าง / ชาบู');
    }
    if (textCorpus.includes('ฮาลาล') || textCorpus.includes('halal') || textCorpus.includes('มุสลิม') || textCorpus.includes('อิสลาม')) {
        types.add('ฮาลาล / มุสลิม');
    }

    if (types.size === 0) {
        types.add('อาหารไทย / อาหารใต้');
    }

    return Array.from(types);
}

function detectAllergens(types, place) {
    const allergens = new Set();
    const typesStr = types.join(' ');
    const textCorpus = [
        place.displayName?.text || '',
        place.editorialSummary?.text || ''
    ].join(' ').toLowerCase();

    if (typesStr.includes('ซีฟู้ด') || typesStr.includes('ทะเล') || textCorpus.includes('กุ้ง') || textCorpus.includes('ปลา') || textCorpus.includes('ปู')) {
        allergens.add('อาหารทะเล');
    }
    if (typesStr.includes('จีน') || typesStr.includes('ก๋วยเตี๋ยว') || typesStr.includes('เบเกอรี่') || textCorpus.includes('ซาลาเปา') || textCorpus.includes('แป้ง')) {
        allergens.add('แป้งสาลี/กลูเตน');
    }
    if (typesStr.includes('คาเฟ่') || textCorpus.includes('นม') || textCorpus.includes('เนย') || textCorpus.includes('ชีส')) {
        allergens.add('นม/ผลิตภัณฑ์จากนม');
    }
    if (textCorpus.includes('ถั่ว') || textCorpus.includes('ส้มตำ') || textCorpus.includes('เต้าคั่ว')) {
        allergens.add('ถั่วลิสง');
    }
    if (textCorpus.includes('ไข่') || textCorpus.includes('สตู') || textCorpus.includes('ข้าวมันไก่')) {
        allergens.add('ไข่');
    }

    return Array.from(allergens);
}

// -------------------------------------------------------------
// Core Enrichment & Crawling Logic
// -------------------------------------------------------------

async function enrichExistingRestaurants(restaurants) {
    console.log(`\n======================================================`);
    console.log(`🔄 [Phase 1] อัปเดตข้อมูลและภาพจริงให้ 121 ร้านเดิมในระบบ`);
    console.log(`======================================================`);

    const countToProcess = LIMIT > 0 ? Math.min(LIMIT, restaurants.length) : restaurants.length;
    let enrichedCount = 0;
    let photosDownloadedCount = 0;

    const usedPlaceIds = new Set(restaurants.filter(x => x.googlePlaceId).map(x => x.googlePlaceId));

    for (let i = 0; i < countToProcess; i++) {
        const r = restaurants[i];

        // Skip restaurants that already have real Google Maps data to preserve daily quota
        if (r.googlePlaceId) {
            console.log(`[${i + 1}/${countToProcess}] ⏩ "${r.name}" (มีข้อมูลจริงแล้ว ข้ามเพื่อประหยัดโควตา)`);
            enrichedCount++;
            continue;
        }

        const cleanName = r.name.replace(/\(.*?\)/g, '').trim();
        const searchQuery = `${cleanName} เมืองสงขลา`;

        process.stdout.write(`[${i + 1}/${countToProcess}] ค้นหา: "${cleanName}" ... `);

        try {
            const places = await searchPlacesText(searchQuery, {
                latitude: r.latitude || SONGKHLA_CENTER.latitude,
                longitude: r.longitude || SONGKHLA_CENTER.longitude,
                radius: 5000.0
            });

            if (!places || places.length === 0) {
                console.log(`❌ ไม่พบใน Google Maps`);
                continue;
            }

            // Filter candidates: strict Mueang Songkhla location and avoid duplicate place IDs
            const validCandidates = places.filter(p => {
                if (!p.id || usedPlaceIds.has(p.id)) return false;
                const addr = (p.formattedAddress || '').toLowerCase();
                if (addr.includes('hat yai') || addr.includes('หาดใหญ่') || addr.includes('singhanakhon') || addr.includes('สิงหนคร') || addr.includes('satun') || addr.includes('สตูล') || addr.includes('phetchaburi') || addr.includes('เพชรบุรี') || addr.includes('chumphon') || addr.includes('ชุมพร') || addr.includes('phuket') || addr.includes('ภูเก็ต') || addr.includes('bangkok') || addr.includes('กรุงเทพ') || addr.includes('rattaphum') || addr.includes('รัตภูมิ')) {
                    return false;
                }
                if (p.location) {
                    const lat = p.location.latitude;
                    const lng = p.location.longitude;
                    if (lat < 7.10 || lat > 7.25 || lng < 100.50 || lng > 100.65) return false;
                }
                return true;
            });

            if (validCandidates.length === 0) {
                console.log(`❌ ไม่พบร้านในเขตอำเภอเมืองสงขลา หรือเป็นหมุดซ้ำ`);
                continue;
            }

            const bestMatch = validCandidates[0];
            usedPlaceIds.add(bestMatch.id);
            const placeName = bestMatch.displayName?.text || cleanName;

            // Apply Plan A name formatting (Thai title + English Google Map title if English)
            const cleanG = placeName.replace(/[^a-zA-Zก-๙]/g, '');
            const engLetters = (cleanG.match(/[a-zA-Z]/g) || []).length;
            const thaiLetters = (cleanG.match(/[ก-๙]/g) || []).length;
            if (engLetters > thaiLetters) {
                r.name = `${cleanName} (${placeName})`;
            } else {
                r.name = placeName.replace(/\s+/g, ' ').trim();
            }

            console.log(`✅ พบ: "${r.name}" (Rating: ${bestMatch.rating || 'N/A'})`);

            if (bestMatch.location) {
                r.latitude = Number(bestMatch.location.latitude.toFixed(6));
                r.longitude = Number(bestMatch.location.longitude.toFixed(6));
            }
            if (bestMatch.formattedAddress) {
                r.address = bestMatch.formattedAddress.replace(/, Thailand$/, '').trim();
            }
            if (bestMatch.rating) {
                r.rating = parseFloat(bestMatch.rating);
            }
            if (bestMatch.userRatingCount) {
                r.userRatingCount = bestMatch.userRatingCount;
            }
            if (bestMatch.googleMapsUri) {
                r.googleMapsUri = bestMatch.googleMapsUri;
            }
            if (bestMatch.id) {
                r.googlePlaceId = bestMatch.id;
            }
            if (bestMatch.editorialSummary?.text && (!r.description || r.description.length < 30)) {
                r.description = bestMatch.editorialSummary.text;
            }

            // Real Photos Fetching
            const photos = bestMatch.photos || [];
            if (photos.length > 0) {
                console.log(`    📸 พบรูปถ่ายจริง ${photos.length} รูป (ดึงสูงสุด 3 รูป)`);
                const realImages = [];
                const photosToFetch = photos.slice(0, 3);

                for (let pIdx = 0; pIdx < photosToFetch.length; pIdx++) {
                    const photoObj = photosToFetch[pIdx];
                    if (NO_DOWNLOAD) {
                        const cdnUri = await getPhotoCdnUri(photoObj.name, 1000);
                        if (cdnUri) realImages.push(cdnUri);
                    } else {
                        const filename = `${r.id}_${pIdx}.jpg`;
                        const targetPath = path.join(UPLOADS_DIR, filename);
                        const localUrl = `/static/uploads/restaurants/${filename}`;

                        if (DRY_RUN) {
                            realImages.push(localUrl);
                        } else {
                            const downloaded = await downloadPlacePhoto(photoObj.name, targetPath, 1000);
                            if (downloaded) {
                                realImages.push(localUrl);
                                photosDownloadedCount++;
                            }
                        }
                    }
                    await sleep(250);
                }

                if (realImages.length > 0) {
                    r.image = realImages[0];
                    r.images = realImages;
                    console.log(`    ✨ อัปเดตรูปถ่ายจริงสำเร็จ: ${realImages.length} รูป`);
                }
            }

            enrichedCount++;
            await sleep(400); // Polite delay for Demo Key
        } catch (e) {
            if (e.isQuota) {
                console.log(`\n🛑 โควตาประจำวันของ Demo Key เต็มแล้ว (100 คำขอ/วัน) สคริปต์จะหยุดและบันทึกข้อมูลส่วนที่ดึงสำเร็จแล้วทันที`);
                break;
            }
            console.log(`    ⚠️ ข้อผิดพลาด:`, e.message);
        }
    }

    console.log(`\n🎉 สรุปผล Phase 1: อัปเดตข้อมูลสำเร็จ ${enrichedCount} ร้าน, ดาวน์โหลดรูปถ่ายจริง ${photosDownloadedCount} รูป`);
    return restaurants;
}

async function crawlNewSongkhlaPlaces(existingRestaurants) {
    console.log(`\n======================================================`);
    console.log(`🚀 [Phase 2] ค้นหาและดึงร้านอาหารจริงเพิ่มเติมในเขตเมืองสงขลา`);
    console.log(`======================================================`);

    const knownPlaceIds = new Set(existingRestaurants.map(r => r.googlePlaceId).filter(Boolean));
    const knownNames = new Set(existingRestaurants.map(r => r.name.toLowerCase().replace(/[\s\(\)]/g, '')));

    const targetQueries = [
        { q: 'ร้านอาหาร ถนนนางงาม สงขลา', zone: 'เมืองเก่า' },
        { q: 'ร้านอาหาร บ่อยาง สงขลา', zone: 'บ่อยาง' },
        { q: 'ร้านอาหาร หาดสมิหลา ชลาทัศน์ สงขลา', zone: 'สมิหลา' },
        { q: 'ร้านอาหาร ถนนวชิรา สงขลา', zone: 'วชิรา' },
        { q: 'ร้านอาหาร มหาวิทยาลัยราชภัฏสงขลา เขารูปช้าง', zone: 'เขารูปช้าง' },
        { q: 'ร้านอาหาร มหาวิทยาลัยทักษิณ สงขลา', zone: 'ม.ทักษิณ' },
        { q: 'ร้านอาหารซีฟู้ด เก้าเส้ง สงขลา', zone: 'ซีฟู้ด' },
        { q: 'คาเฟ่ กาแฟ เมืองสงขลา', zone: 'คาเฟ่' },
        { q: 'ร้านอาหารฮาลาล เมืองสงขลา', zone: 'ฮาลาล' },
        { q: 'ร้านส้มตำ ไก่ย่าง เมืองสงขลา', zone: 'ส้มตำ/อีสาน' },
        { q: 'ร้านก๋วยเตี๋ยว เมืองสงขลา', zone: 'ก๋วยเตี๋ยว' },
        { q: 'ร้านติ่มซำ อาหารเช้า บ่อยาง สงขลา', zone: 'ติ่มซำ/อาหารเช้า' },
        { q: 'ร้านชาบู หมูกระทะ ปิ้งย่าง เมืองสงขลา', zone: 'ชาบู/หมูกระทะ' },
        { q: 'ร้านอาหาร ถนนไทรบุรี สงขลา', zone: 'ไทรบุรี' }
    ];

    const newlyAdded = [];
    const maxExistingSeq = existingRestaurants.reduce((max, r) => {
        const m = String(r.id || '').match(/\d+/);
        return m ? Math.max(max, parseInt(m[0], 10)) : max;
    }, 0);
    let nextSeq = maxExistingSeq + 1;
    const maxPhotosPerPlace = parseInt(getArg('photos', '1'), 10) || 1;

    for (const target of targetQueries) {
        console.log(`\n📍 กำลังสแกนโซน: [${target.zone}] คำค้น: "${target.q}"`);

        try {
            const places = await searchPlacesText(target.q, {
                latitude: SONGKHLA_CENTER.latitude,
                longitude: SONGKHLA_CENTER.longitude,
                radius: 12000.0
            });

            console.log(`  🔎 พบทั้งหมด ${places.length} แห่ง`);

            for (const place of places) {
                const placeId = place.id;
                const displayName = place.displayName?.text || '';
                const normName = displayName.toLowerCase().replace(/[\s\(\)]/g, '');

                if (!displayName || knownPlaceIds.has(placeId) || knownNames.has(normName)) {
                    continue;
                }

                const lat = place.location?.latitude;
                const lng = place.location?.longitude;
                if (!lat || !lng || lat < 7.05 || lat > 7.30 || lng < 100.45 || lng > 100.75) {
                    continue;
                }

                const rId = `r_songkhla_${String(nextSeq++).padStart(3, '0')}`;
                knownPlaceIds.add(placeId);
                knownNames.add(normName);

                const priceInfo = mapPriceLevel(place.priceLevel);
                const foodTypes = detectFoodTypes(place);
                const allergens = detectAllergens(foodTypes, place);

                const photos = place.photos || [];
                const realImages = [];

                if (photos.length > 0) {
                    const photosToFetch = photos.slice(0, maxPhotosPerPlace);
                    for (let pIdx = 0; pIdx < photosToFetch.length; pIdx++) {
                        const photoObj = photosToFetch[pIdx];
                        if (NO_DOWNLOAD) {
                            const cdnUri = await getPhotoCdnUri(photoObj.name, 1000);
                            if (cdnUri) realImages.push(cdnUri);
                        } else {
                            const filename = `${rId}_${pIdx}.jpg`;
                            const targetPath = path.join(UPLOADS_DIR, filename);
                            const localUrl = `/static/uploads/restaurants/${filename}`;

                            if (DRY_RUN) {
                                realImages.push(localUrl);
                            } else {
                                const downloaded = await downloadPlacePhoto(photoObj.name, targetPath, 1000);
                                if (downloaded) realImages.push(localUrl);
                            }
                        }
                        await sleep(250);
                    }
                }

                const primaryImage = realImages.length > 0
                    ? realImages[0]
                    : 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800';

                const newRestaurant = {
                    id: rId,
                    name: displayName,
                    rating: parseFloat(place.rating || 4.2),
                    priceRange: priceInfo.range,
                    avgPrice: priceInfo.avg,
                    distance: 1.0,
                    type: foodTypes,
                    allergens: allergens,
                    image: primaryImage,
                    images: realImages.length > 0 ? realImages : [primaryImage],
                    description: place.editorialSummary?.text || `ร้าน${displayName} อาหารอร่อยในเมืองสงขลา บรรยากาศเป็นกันเอง`,
                    address: (place.formattedAddress || 'อำเภอเมืองสงขลา จังหวัดสงขลา').replace(/, Thailand$/, '').trim(),
                    latitude: Number(lat.toFixed(6)),
                    longitude: Number(lng.toFixed(6)),
                    googlePlaceId: placeId,
                    googleMapsUri: place.googleMapsUri || null,
                    userRatingCount: place.userRatingCount || null
                };

                newlyAdded.push(newRestaurant);
                console.log(`  ➕ [${rId}] เพิ่มร้านใหม่: "${displayName}" (รูปจริง: ${realImages.length} รูป, ดาว: ${newRestaurant.rating})`);

                if (LIMIT > 0 && newlyAdded.length >= LIMIT) {
                    console.log(`🛑 ถึงขีดจำกัดเพิ่มร้านใหม่ --limit=${LIMIT} แล้ว (${newlyAdded.length} ร้าน)`);
                    return newlyAdded;
                }

                await sleep(300);
            }
        } catch (e) {
            if (e.isQuota) {
                console.log(`\n🛑 โควตาประจำวันของ Demo Key เต็มแล้ว (100 คำขอ/วัน) สคริปต์จะหยุดและบันทึกข้อมูลส่วนที่ดึงสำเร็จแล้วทันที`);
                break;
            }
            console.warn(`  ⚠️ เกิดข้อผิดพลาดในการสแกนคำค้น "${target.q}":`, e.message);
        }
    }

    console.log(`\n🎉 สรุปผล Phase 2: ค้นพบและเพิ่มร้านใหม่สำเร็จ ${newlyAdded.length} ร้าน`);
    return newlyAdded;
}

// -------------------------------------------------------------
// Main Orchestration
// -------------------------------------------------------------

async function main() {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║   🌊 Ginder - Songkhla Places API (New) Real Data Crawler     ║
║   ดึงข้อมูลจริง & ภาพถ่ายจริงจาก Google Maps สำหรับเมืองสงขลา  ║
╚═══════════════════════════════════════════════════════════════╝
    `);

    if (!API_KEY) {
        console.error(`
❌ [ERROR] ยังไม่มี GOOGLE_MAPS_API_KEY !
กรุณาทำตามขั้นตอนต่อไปนี้:
1. เข้าไปที่: https://mapsplatform.google.com/maps-demo-key
2. ล็อกอินด้วยบัญชี Google แล้วกดรับ Demo Key (ฟรี ไม่ต้องใช้บัตร)
3. ใส่ในไฟล์ .env: GOOGLE_MAPS_API_KEY="AIzaSy..."
4. หรือรันคำสั่งโดยระบุคีย์: node scripts/fetch_songkhla_places.js --key="AIzaSy..."
        `);
        process.exit(1);
    }

    console.log(`🔑 Google Maps API Key: ${API_KEY.slice(0, 8)}...${API_KEY.slice(-4)}`);
    console.log(`⚙️ โหมด: ${MODE.toUpperCase()} | ดาวน์โหลดภาพ: ${!NO_DOWNLOAD ? 'YES' : 'NO'}`);
    console.log(`🗄️ บันทึกขึ้น Supabase: ${supabase && !NO_SYNC ? 'YES' : 'NO'}`);
    if (DRY_RUN) console.log(`⚠️ DRY RUN MODE: ไม่บันทึกไฟล์หรืออัปเดตฐานข้อมูลจริง`);

    if (!fs.existsSync(RESTAURANTS_FILE)) {
        console.error(`❌ ไม่พบไฟล์ ${RESTAURANTS_FILE}`);
        process.exit(1);
    }

    const existingData = JSON.parse(fs.readFileSync(RESTAURANTS_FILE, 'utf8'));
    console.log(`📂 โหลดร้านอาหารเดิมในระบบ: ${existingData.length} ร้าน`);

    if (!DRY_RUN) {
        fs.writeFileSync(BACKUP_FILE, JSON.stringify(existingData, null, 2), 'utf8');
        console.log(`💾 สำรองข้อมูลเดิมไว้ที่: ${path.basename(BACKUP_FILE)}`);
    }

    let updatedList = [...existingData];

    if (MODE === 'enrich' || MODE === 'all') {
        updatedList = await enrichExistingRestaurants(updatedList);
    }

    if (MODE === 'crawl' || MODE === 'all') {
        const newlyAdded = await crawlNewSongkhlaPlaces(updatedList);
        updatedList = updatedList.concat(newlyAdded);
    }

    console.log(`\n======================================================`);
    console.log(`📊 รวมจำนวนร้านอาหารทั้งหมด: ${updatedList.length} ร้าน (เดิม ${existingData.length} ร้าน)`);
    console.log(`======================================================`);

    if (DRY_RUN) {
        console.log(`\n⚠️ [DRY RUN] เสร็จสิ้นการจำลอง ไม่มีการบันทึกไฟล์จริง`);
        return;
    }

    fs.writeFileSync(RESTAURANTS_FILE, JSON.stringify(updatedList, null, 2), 'utf8');
    console.log(`✅ บันทึกไฟล์ ${RESTAURANTS_FILE} เรียบร้อยแล้ว`);

    if (supabase && !NO_SYNC) {
        console.log(`\n🚀 กำลังซิงค์ข้อมูลร้านอาหารขึ้น Supabase Table ('restaurants')...`);
        let syncedCount = 0;
        const BATCH_SIZE = 25;

        for (let i = 0; i < updatedList.length; i += BATCH_SIZE) {
            const batch = updatedList.slice(i, i + BATCH_SIZE).map(r => ({
                id: r.id,
                name: r.name,
                image: JSON.stringify(r.images || [r.image]),
                rating: parseFloat(r.rating) || 4.0,
                price_range: r.priceRange || '$$',
                avg_price: parseInt(r.avgPrice, 10) || 100,
                distance: parseFloat(r.distance) || 1.0,
                type: Array.isArray(r.type) ? r.type : [String(r.type)],
                allergens: Array.isArray(r.allergens) ? r.allergens : [],
                description: r.description || '',
                address: r.address || '',
                latitude: r.latitude || null,
                longitude: r.longitude || null
            }));

            const { error } = await supabase.from('restaurants').upsert(batch, { onConflict: 'id' });
            if (error) {
                console.error(`  ❌ Supabase Upsert Error (Batch ${i}-${i + BATCH_SIZE}):`, error.message);
            } else {
                syncedCount += batch.length;
                process.stdout.write(`  ⬆️ ซิงค์แล้ว ${syncedCount}/${updatedList.length} ร้าน...\r`);
            }
        }
        console.log(`\n✨ ซิงค์ขึ้น Supabase เรียบร้อยแล้วทั้งสิ้น ${syncedCount} ร้าน!`);
    }

    console.log(`\n🎯 ภารกิจเสร็จสมบูรณ์ 100%! ระบบ Ginder พร้อมแสดงภาพถ่ายและข้อมูลร้านจริงจาก Google Maps แล้วครับ!`);
}

main().catch(err => {
    console.error(`\n💥 Fatal Error:`, err);
    process.exit(1);
});
