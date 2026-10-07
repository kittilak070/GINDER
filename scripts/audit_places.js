require('dotenv').config();
const key = process.env.GOOGLE_MAPS_API_KEY;
const fs = require('fs');
const path = require('path');

const mockPath = path.join(__dirname, '..', 'data', 'mock_restaurants.json');
const mock = JSON.parse(fs.readFileSync(mockPath, 'utf8'));
const enriched = mock.filter(r => r.googlePlaceId);

async function checkAllEnriched() {
    console.log('Auditing ' + enriched.length + ' restaurants with Google Maps Place Details...');
    const results = [];
    let success = 0;
    let failed = 0;

    for (let i = 0; i < enriched.length; i++) {
        const r = enriched[i];
        try {
            const res = await fetch('https://places.googleapis.com/v1/places/' + r.googlePlaceId, {
                headers: {
                    'X-Goog-Api-Key': key,
                    'X-Goog-FieldMask': 'displayName,formattedAddress',
                    'X-Goog-LanguageCode': 'th'
                }
            });
            const d = await res.json();
            if (d.error) {
                failed++;
                console.log('API Error on place ' + r.id + ':', d.error.status, d.error.message);
                break;
            }
            success++;
            const googleName = d.displayName?.text || '';
            const addr = d.formattedAddress || '';
            results.push({
                id: r.id,
                ginderName: r.name,
                googleName: googleName,
                address: addr
            });
            if ((i + 1) % 20 === 0 || i === enriched.length - 1) {
                console.log('Checked ' + (i + 1) + '/' + enriched.length + '...');
            }
        } catch (e) {
            console.error('Fetch error:', e.message);
            break;
        }
    }

    console.log('Total checked: ' + success + ', Failed: ' + failed);
    fs.writeFileSync(path.join(__dirname, 'place_audit.json'), JSON.stringify(results, null, 2), 'utf8');
}

checkAllEnriched();
