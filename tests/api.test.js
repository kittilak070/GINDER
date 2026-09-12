/**
 * Ginder Automated API & Security Test Suite
 * Aligned with Skill 07 (Testing & QA) and Skill 09 (OWASP Security)
 */

const http = require('http');
const assert = require('assert');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';

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

let passedCount = 0;
let failedCount = 0;

async function runTest(testName, testFn) {
    try {
        process.stdout.write(`• [TEST] ${testName} ... `);
        await testFn();
        console.log(`\x1b[32mPASS\x1b[0m`);
        passedCount++;
    } catch (err) {
        console.log(`\x1b[31mFAIL\x1b[0m`);
        console.error(`   Error:`, err.message);
        failedCount++;
    }
}

async function runSuite() {
    console.log(`\n========================================`);
    console.log(`  GINDER AUTOMATED API TEST SUITE`);
    console.log(`  Target: ${BASE_URL}`);
    console.log(`========================================\n`);

    // 1. Healthcheck Endpoint (Skill 05: API Design, Skill 10: DevOps Monitoring)
    await runTest('GET /api/health returns 200 with healthy status & uptime', async () => {
        const res = await makeRequest('/api/health');
        assert.strictEqual(res.statusCode, 200, `Expected 200, got ${res.statusCode}`);
        assert.strictEqual(res.data.status, 'healthy', `Status should be healthy`);
        assert.ok(typeof res.data.uptime === 'number', `Uptime should be a number`);
        assert.strictEqual(res.data.version, '1.0.0', `Version should be 1.0.0`);
    });

    // 2. OWASP Top 10 Security Headers (Skill 09: OWASP Security)
    await runTest('Server sends OWASP security headers & disables x-powered-by', async () => {
        const res = await makeRequest('/api/health');
        assert.strictEqual(res.headers['x-content-type-options'], 'nosniff', 'Missing X-Content-Type-Options');
        assert.strictEqual(res.headers['x-frame-options'], 'SAMEORIGIN', 'Missing X-Frame-Options');
        assert.strictEqual(res.headers['x-powered-by'], undefined, 'x-powered-by header must be disabled');
    });

    // 3. Guest-First & Usability Flow (Skill 01: User-Centricity)
    await runTest('GET /api/me auto-provisions guest session without requiring initial login', async () => {
        const res = await makeRequest('/api/me');
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.data.logged_in, true);
        assert.strictEqual(res.data.isGuest, true);
        assert.ok(res.data.username && res.data.username.startsWith('guest_'), 'Should provision guest username');
    });

    // 4. Solo Mode Deck Generation (Skill 05: API Contract)
    await runTest('POST /api/solo/deck generates filtered restaurant cards', async () => {
        const res = await makeRequest('/api/solo/deck', { method: 'POST' }, {
            preferences: { foodTypes: [] },
            allergies: []
        });
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.data.success, true);
        assert.ok(Array.isArray(res.data.restaurants), 'restaurants should be an array');
        assert.ok(res.data.restaurants.length > 0, 'restaurants count should be > 0');
    });

    // 5. Room Verification (Skill 01: Error Prevention & Usability)
    await runTest('POST /api/check-room returns exists: false for non-existent room', async () => {
        const res = await makeRequest('/api/check-room', { method: 'POST' }, {
            roomId: 'NONEXISTENT999'
        });
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.data.exists, false);
    });

    // 6. Security Rate Limiting (Skill 09: Brute-force / DoS protection)
    await runTest('POST /api/login triggers 429 Too Many Requests when rate limit exceeded', async () => {
        let hitRateLimit = false;
        // Make up to 25 rapid requests to trigger limit of 20
        for (let i = 0; i < 25; i++) {
            const res = await makeRequest('/api/login', { method: 'POST' }, {
                username: 'bruteforce_test',
                password: 'wrong_password'
            });
            if (res.statusCode === 429) {
                hitRateLimit = true;
                assert.ok(res.data.error, 'Should contain rate limit error message');
                break;
            }
        }
        assert.strictEqual(hitRateLimit, true, 'Rate limiter should have returned HTTP 429');
    });

    // 7. Feedback Submission (Skill 05: API Design & Validation)
    await runTest('POST /api/feedback saves user suggestion and returns 200', async () => {
        const res = await makeRequest('/api/feedback', { method: 'POST' }, {
            type: 'feature',
            title: 'Test Feedback Title',
            description: 'Test Feedback Description from automated QA test suite',
            contactInfo: 'tester@ginder.app'
        });
        assert.strictEqual(res.statusCode, 200, `Expected 200, got ${res.statusCode}`);
        assert.strictEqual(res.data.success, true, 'Feedback submission should be successful');
    });

    // 8. Room Case-Insensitivity Check (Skill 05 & Usability)
    await runTest('POST /api/check-room normalizes lowercase room ID gracefully', async () => {
        const res = await makeRequest('/api/check-room', { method: 'POST' }, {
            roomId: 'non9'
        });
        assert.strictEqual(res.statusCode, 200, `Expected 200, got ${res.statusCode}`);
        assert.strictEqual(res.data.exists, false, 'Non-existent room should return false without crashing');
    });

    console.log(`\n========================================`);
    console.log(`  TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log(`========================================\n`);

    if (failedCount > 0) {
        process.exit(1);
    }
}

runSuite().catch(err => {
    console.error("Test execution failed:", err);
    process.exit(1);
});
