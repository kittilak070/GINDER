/**
 * Password Validation Test Suite
 * Verifies that new passwords cannot be identical to current passwords.
 */

const http = require('http');
const assert = require('assert');
const crypto = require('crypto');

let serverInstance = null;
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';

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

    // 1. Password Signup Rejection
    await runTest('POST /api/signup rejects manual password signup with HTTP 403', async () => {
        const res = await makeRequest('/api/signup', { method: 'POST' }, {
            username: testUser,
            password: initialPassword,
            displayName: 'PwdTester',
            pdpaConsent: true
        });

        assert.strictEqual(res.statusCode, 403, `Expected 403, got ${res.statusCode}`);
        assert.strictEqual(res.data.success, false);
        assert.ok(res.data.allowedProviders && res.data.allowedProviders.includes('google'));
    });

    // 2. Password Login Rejection
    await runTest('POST /api/login rejects manual password login with HTTP 403', async () => {
        const res = await makeRequest('/api/login', { method: 'POST' }, {
            username: testUser,
            password: initialPassword
        });

        assert.strictEqual(res.statusCode, 403, `Expected 403, got ${res.statusCode}`);
        assert.strictEqual(res.data.success, false);
        assert.ok(res.data.allowedProviders && res.data.allowedProviders.includes('facebook'));
    });

    // 3. Password Modification Rejection
    await runTest('PUT /api/user/password rejects password change requests with HTTP 403', async () => {
        const res = await makeRequest('/api/user/password', { method: 'PUT' }, {
            currentPassword: initialPassword,
            newPassword: 'BrandNewPassword456'
        });

        assert.strictEqual(res.statusCode, 403, `Expected 403, got ${res.statusCode}`);
        assert.strictEqual(res.data.success, false);
    });

    // 4. Forgot Password Verify Question Rejection
    await runTest('POST /api/auth/forgot/verify-question is disabled and returns HTTP 403', async () => {
        const res = await makeRequest('/api/auth/forgot/verify-question', { method: 'POST' }, {
            username: testUser,
            securityAnswer: 'fluffy',
            newPassword: 'BrandNewPassword456'
        });

        assert.strictEqual(res.statusCode, 403, `Expected 403, got ${res.statusCode}`);
        assert.strictEqual(res.data.success, false);
    });

    // 5. Forgot Password Send Email OTP Rejection
    await runTest('POST /api/auth/forgot/send-email-otp is disabled and returns HTTP 403', async () => {
        const res = await makeRequest('/api/auth/forgot/send-email-otp', { method: 'POST' }, {
            email: 'test@example.com'
        });

        assert.strictEqual(res.statusCode, 403, `Expected 403, got ${res.statusCode}`);
        assert.strictEqual(res.data.success, false);
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

ensureServerRunning().then(() => {
    runSuite().catch(err => {
        console.error("Test execution error:", err);
        process.exit(1);
    });
});
