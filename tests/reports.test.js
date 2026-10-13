/**
 * GINDER Match History & Admin Reports Test Suite
 * Validates recording and reporting of solo and group matches
 */

const assert = require('assert');
const http = require('http');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';

let serverInstance = null;

async function ensureServerRunning() {
    try {
        await makeRequest('/api/health');
        return;
    } catch (e) {
        const s = require('../server.js');
        serverInstance = s.server;
        const port = new URL(BASE_URL).port || 5000;
        await new Promise((resolve) => {
            serverInstance.listen(port, '0.0.0.0', resolve);
        });
    }
}

function makeRequest(urlPath, options = {}, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlPath, BASE_URL);
        const reqOptions = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        };

        if (body && !reqOptions.headers['Content-Type']) {
            reqOptions.headers['Content-Type'] = 'application/json';
        }

        const req = http.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    parsed = data;
                }
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    data: parsed,
                    raw: data
                });
            });
        });

        req.on('error', reject);

        if (body) {
            req.write(typeof body === 'string' ? body : JSON.stringify(body));
        }
        req.end();
    });
}

async function runReportsTests() {
    await ensureServerRunning();

    console.log('\n========================================');
    console.log('  MATCH HISTORY & REPORTS TEST SUITE');
    console.log('========================================\n');

    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
        try {
            await fn();
            console.log(`• [TEST] ${name} ... PASS`);
            passed++;
        } catch (err) {
            console.error(`• [TEST] ${name} ... FAILED`);
            console.error(`  Error: ${err.message}`);
            failed++;
        }
    }

    // 1. Test POST /api/solo/record-match
    await test('POST /api/solo/record-match saves solo match successfully', async () => {
        const sampleRestaurant = {
            id: 'test_rest_solo_999',
            name: 'ร้านข้าวมันไก่โกฮง (ทดสอบระบบ)',
            image: '/static/uploads/restaurants/test.jpg',
            rating: 4.8,
            avgPrice: 60,
            type: ['อาหารจานเดียว'],
            address: 'ถนนสายหลัก อำเภอเมือง'
        };

        const res = await makeRequest('/api/solo/record-match', { method: 'POST' }, {
            restaurant: sampleRestaurant,
            isLuckyPick: false,
            notes: 'คัดสรรจาก 3 ร้านที่ปัดถูกใจ',
            userName: 'ทดสอบนักชิมเดี่ยว'
        });

        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.data.success, true);
        assert(res.data.historyItem, 'historyItem should be returned');
        assert.strictEqual(res.data.historyItem.restaurant.name, 'ร้านข้าวมันไก่โกฮง (ทดสอบระบบ)');
        assert.strictEqual(res.data.historyItem.roomId, 'SOLO');
        assert.strictEqual(res.data.historyItem.isFallback, false);
        assert.strictEqual(res.data.historyItem.fallbackReason, 'คัดสรรจาก 3 ร้านที่ปัดถูกใจ');
        assert.deepStrictEqual(res.data.historyItem.participants, ['ทดสอบนักชิมเดี่ยว']);
    });

    // 2. Test POST /api/solo/record-match with lucky pick fallback
    await test('POST /api/solo/record-match supports lucky pick fallback notes', async () => {
        const sampleRestaurant = {
            id: 'test_rest_solo_fallback',
            name: 'ร้านส้มตำแซ่บเวอร์ (ทดสอบสุ่ม)',
            rating: 4.5,
            avgPrice: 80,
            type: ['อาหารอีสาน']
        };

        const res = await makeRequest('/api/solo/record-match', { method: 'POST' }, {
            restaurant: sampleRestaurant,
            isLuckyPick: true,
            notes: 'สุ่มร้านเด็ดจากสำรับทั้งหมด (ไม่พบร้านที่กดถูกใจ)',
            userName: 'สายกินตัวยง'
        });

        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.data.success, true);
        assert.strictEqual(res.data.historyItem.isFallback, true);
        assert.strictEqual(res.data.historyItem.fallbackReason, 'สุ่มร้านเด็ดจากสำรับทั้งหมด (ไม่พบร้านที่กดถูกใจ)');
    });

    // 3. Test GET /api/admin/reports/summary requires admin or returns 403 for unauthorized
    await test('GET /api/admin/reports/summary protects access with role check', async () => {
        const res = await makeRequest('/api/admin/reports/summary');
        // Unauthenticated session without admin role receives 403
        assert.strictEqual(res.statusCode, 403);
    });

    console.log(`\n========================================`);
    console.log(`  TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);

    if (failed > 0) process.exit(1);
    process.exit(0);
}

runReportsTests().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
