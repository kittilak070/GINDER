/**
 * Password Validation Test Suite
 * Verifies that new passwords cannot be identical to current passwords.
 */

const http = require('http');
const assert = require('assert');
const crypto = require('crypto');

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
    console.log(`  PASSWORD DUPLICATION VALIDATION TESTS`);
    console.log(`========================================\n`);

    const testUser = `pwd_test_${Date.now()}`;
    const initialPassword = 'OriginalPassword123';

    // 1. Create a user
    let userCookie = null;
    await runTest('Signup new user for password test', async () => {
        const res = await makeRequest('/api/signup', { method: 'POST' }, {
            username: testUser,
            password: initialPassword,
            displayName: 'PwdTester',
            pdpaConsent: true,
            securityQuestion: 'Pet name?',
            securityAnswer: 'fluffy'
        });

        assert.strictEqual(res.statusCode, 200, `Signup failed: ${JSON.stringify(res.data)}`);
        assert.ok(res.headers['set-cookie'], 'Signup should return session cookie');
        userCookie = res.headers['set-cookie'][0];
    });

    // 2. Try changing password to the EXACT SAME password
    await runTest('PUT /api/user/password rejects identical current and new password', async () => {
        const res = await makeRequest('/api/user/password', { method: 'PUT' }, {
            currentPassword: initialPassword,
            newPassword: initialPassword
        }, userCookie);

        assert.strictEqual(res.statusCode, 400, `Expected 400, got ${res.statusCode}`);
        assert.strictEqual(res.data.message, 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
    });

    // 3. Try changing password to a valid DIFFERENT password
    const newPassword = 'BrandNewPassword456';
    await runTest('PUT /api/user/password accepts different new password', async () => {
        const res = await makeRequest('/api/user/password', { method: 'PUT' }, {
            currentPassword: initialPassword,
            newPassword: newPassword
        }, userCookie);

        assert.strictEqual(res.statusCode, 200, `Expected 200, got ${res.statusCode}`);
        assert.strictEqual(res.data.success, true);
        assert.strictEqual(res.data.message, 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว');
    });

    // 4. Try changing again with the new password as current and new
    await runTest('PUT /api/user/password rejects new password matching the updated password', async () => {
        const res = await makeRequest('/api/user/password', { method: 'PUT' }, {
            currentPassword: newPassword,
            newPassword: newPassword
        }, userCookie);

        assert.strictEqual(res.statusCode, 400, `Expected 400, got ${res.statusCode}`);
        assert.strictEqual(res.data.message, 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
    });

    // 5. Test forgot-password question reset rejecting current password
    await runTest('POST /api/auth/forgot/verify-question rejects existing password', async () => {
        const res = await makeRequest('/api/auth/forgot/verify-question', { method: 'POST' }, {
            username: testUser,
            securityAnswer: 'fluffy',
            newPassword: newPassword // Same as current password now
        });

        assert.strictEqual(res.statusCode, 400, `Expected 400, got ${res.statusCode}`);
        assert.strictEqual(res.data.message, 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
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
