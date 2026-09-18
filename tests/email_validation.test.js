/**
 * Email Uniqueness & Validation Test Suite
 * Verifies that each email address can only be registered once.
 */

const http = require('http');
const assert = require('assert');

// Require server directly to ensure it is listening
const { app, server } = require('../server.js');

const port = server.address() ? server.address().port : 5000;
const BASE_URL = `http://localhost:${port}`;

function makeRequest(urlPath, options = {}, body = null, cookie = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlPath, BASE_URL);
        const reqOptions = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        };

        if (cookie) {
            reqOptions.headers['Cookie'] = cookie;
        }

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
    console.log(`  UNIQUE EMAIL CONSTRAINT TESTS`);
    console.log(`========================================\n`);

    const timestamp = Date.now();
    const emailA = `foodie_${timestamp}@testginder.com`;
    const userA = `user_a_${timestamp}`;
    const userB = `user_b_${timestamp}`;

    // 1. Check unused email is available
    await runTest('GET /api/auth/check-email returns available: true for unused email', async () => {
        const res = await makeRequest(`/api/auth/check-email?email=${encodeURIComponent(emailA)}`);
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.data.available, true);
        assert.strictEqual(res.data.validFormat, true);
    });

    // 2. Register User A with emailA
    await runTest('POST /api/signup successfully registers User A with emailA', async () => {
        const res = await makeRequest('/api/signup', { method: 'POST' }, {
            username: userA,
            password: 'PasswordA123',
            email: emailA,
            displayName: 'UserA',
            pdpaConsent: true
        });

        assert.strictEqual(res.statusCode, 200, `Signup failed: ${JSON.stringify(res.data)}`);
        assert.strictEqual(res.data.username, userA);
    });

    // 3. Check that emailA is now reported as unavailable
    await runTest('GET /api/auth/check-email returns available: false for registered email', async () => {
        const res = await makeRequest(`/api/auth/check-email?email=${encodeURIComponent(emailA.toUpperCase())}`);
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.data.available, false);
        assert.strictEqual(res.data.message, 'อีเมลนี้ถูกใช้งานในระบบแล้ว');
    });

    // 4. Attempt to register User B with the SAME email (case-insensitive check)
    await runTest('POST /api/signup REJECTS duplicate email for User B with 400', async () => {
        const res = await makeRequest('/api/signup', { method: 'POST' }, {
            username: userB,
            password: 'PasswordB123',
            email: emailA.toUpperCase(), // Same email in uppercase
            displayName: 'UserB',
            pdpaConsent: true
        });

        assert.strictEqual(res.statusCode, 400, `Expected 400, got ${res.statusCode}: ${JSON.stringify(res.data)}`);
        assert.strictEqual(res.data.message, 'อีเมลนี้ถูกใช้งานในระบบแล้ว กรุณาใช้อีเมลอื่น');
    });

    // 5. Register User B with a DIFFERENT, unique email
    const emailB = `foodie_b_${timestamp}@testginder.com`;
    let userBCookie = null;
    await runTest('POST /api/signup succeeds for User B with a unique email', async () => {
        const res = await makeRequest('/api/signup', { method: 'POST' }, {
            username: userB,
            password: 'PasswordB123',
            email: emailB,
            displayName: 'UserB',
            pdpaConsent: true
        });

        assert.strictEqual(res.statusCode, 200, `Signup failed: ${JSON.stringify(res.data)}`);
        userBCookie = res.headers['set-cookie'] ? res.headers['set-cookie'][0] : null;
        assert.ok(userBCookie, 'Should return session cookie');
    });

    // 6. User B attempts to update their recovery email to User A's email
    await runTest('PUT /api/user/security REJECTS stealing existing email from another user', async () => {
        const res = await makeRequest('/api/user/security', { method: 'PUT' }, {
            email: emailA
        }, userBCookie);

        assert.strictEqual(res.statusCode, 400, `Expected 400, got ${res.statusCode}: ${JSON.stringify(res.data)}`);
        assert.strictEqual(res.data.message, 'อีเมลนี้ถูกใช้งานโดยบัญชีอื่นแล้ว กรุณาใช้อีเมลอื่น');
    });

    // 7. Invalid email syntax rejected
    await runTest('POST /api/signup rejects malformed email syntax', async () => {
        const res = await makeRequest('/api/signup', { method: 'POST' }, {
            username: `malformed_${timestamp}`,
            password: 'Password123',
            email: 'not-an-email',
            displayName: 'MalformedTester',
            pdpaConsent: true
        });

        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(res.data.message, 'รูปแบบอีเมลไม่ถูกต้อง');
    });

    console.log(`\n========================================`);
    console.log(`  TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log(`========================================\n`);

    if (failedCount > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

// Allow server to finish listening before running
setTimeout(() => {
    runSuite().catch(err => {
        console.error("Test execution error:", err);
        process.exit(1);
    });
}, 500);
