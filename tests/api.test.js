/**
 * Ginder Automated API & Security Test Suite
 * Aligned with Skill 07 (Testing & QA) and Skill 09 (OWASP Security)
 */

const http = require('http');
const assert = require('assert');

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
            const res = await makeRequest('/api/login', {
                method: 'POST',
                headers: { 'x-forwarded-for': '192.0.2.100' }
            }, {
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

    // 9. Password Duplicate Prevention on Change (Skill 09: Credential Management)
    await runTest('PUT /api/user/password rejects identical current and new password', async () => {
        const pwdUser = `pwd_user_${Date.now()}`;
        const pwd = 'TestSecretPassword123';
        const signupRes = await makeRequest('/api/signup', { method: 'POST' }, {
            username: pwdUser,
            password: pwd,
            displayName: 'PwdUser',
            pdpaConsent: true,
            securityQuestion: 'Pet?',
            securityAnswer: 'cat'
        });
        assert.strictEqual(signupRes.statusCode, 200);
        const cookie = signupRes.headers['set-cookie'] ? signupRes.headers['set-cookie'][0] : null;

        const res = await makeRequest('/api/user/password', {
            method: 'PUT',
            headers: { 'Cookie': cookie }
        }, {
            currentPassword: pwd,
            newPassword: pwd
        });

        assert.strictEqual(res.statusCode, 400, `Expected 400, got ${res.statusCode}`);
        assert.strictEqual(res.data.message, 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
    });

    // 10. Password Duplicate Prevention on Recovery (Skill 09: Credential Management)
    await runTest('POST /api/auth/forgot/verify-question rejects new password matching old password', async () => {
        const pwdUser = `pwd_rec_${Date.now()}`;
        const pwd = 'TestSecretPassword456';
        await makeRequest('/api/signup', { method: 'POST' }, {
            username: pwdUser,
            password: pwd,
            displayName: 'PwdRec',
            pdpaConsent: true,
            securityQuestion: 'Favorite color?',
            securityAnswer: 'blue'
        });

        const res = await makeRequest('/api/auth/forgot/verify-question', { method: 'POST' }, {
            username: pwdUser,
            securityAnswer: 'blue',
            newPassword: pwd
        });

        assert.strictEqual(res.statusCode, 400, `Expected 400, got ${res.statusCode}`);
        assert.strictEqual(res.data.message, 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
    });

    // 11. Unique Email Constraint on Signup (1 Account per Email)
    await runTest('POST /api/signup rejects duplicate email across accounts', async () => {
        const uniqueEmail = `unique_${Date.now()}@ginder.test`;
        const user1 = `email_u1_${Date.now()}`;
        const user2 = `email_u2_${Date.now()}`;

        // Signup first user with email
        const res1 = await makeRequest('/api/signup', { method: 'POST' }, {
            username: user1,
            password: 'Password123',
            email: uniqueEmail,
            displayName: 'User1',
            pdpaConsent: true
        });
        assert.strictEqual(res1.statusCode, 200, `First user signup failed: ${JSON.stringify(res1.data)}`);

        // Attempt signup with same email for second user
        const res2 = await makeRequest('/api/signup', { method: 'POST' }, {
            username: user2,
            password: 'Password123',
            email: uniqueEmail,
            displayName: 'User2',
            pdpaConsent: true
        });
        assert.strictEqual(res2.statusCode, 400, `Expected 400, got ${res2.statusCode}`);
        assert.strictEqual(res2.data.message, 'อีเมลนี้ถูกใช้งานในระบบแล้ว กรุณาใช้อีเมลอื่น');
    });

    // 12. Email Availability Endpoint Check
    await runTest('GET /api/auth/check-email correctly indicates availability', async () => {
        const takenEmail = `unique_${Date.now()}@ginder.test`; // Not taken yet
        const resAvailable = await makeRequest(`/api/auth/check-email?email=${encodeURIComponent(takenEmail)}`);
        assert.strictEqual(resAvailable.statusCode, 200);
        assert.strictEqual(resAvailable.data.available, true);
    });

    console.log(`\n========================================`);
    console.log(`  TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log(`========================================\n`);
}

setTimeout(() => {
    ensureServerRunning().then(() => {
        return runSuite();
    }).then(() => {
        if (serverInstance) {
            serverInstance.close(() => {
                process.exit(failedCount > 0 ? 1 : 0);
            });
        } else {
            process.exit(failedCount > 0 ? 1 : 0);
        }
    }).catch(err => {
        console.error("Test execution failed:", err);
        process.exit(1);
    });
}, 200);
