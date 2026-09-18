const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('========================================');
console.log('  SECURITY HARDENING & AUDIT TEST SUITE');
console.log('========================================\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`• [TEST] ${name} ... PASS`);
        passed++;
    } catch (err) {
        console.error(`• [TEST] ${name} ... FAIL`);
        console.error('  Error:', err.message);
        failed++;
    }
}

const serverPath = path.join(__dirname, '../server.js');
const appPath = path.join(__dirname, '../static/app.js');

const serverContent = fs.readFileSync(serverPath, 'utf8');
const appContent = fs.readFileSync(appPath, 'utf8');

// Test 1: DOM XSS prevention - escapeHtml function
test('Frontend: escapeHtml sanitizes script tags and special chars', () => {
    assert(appContent.includes('function escapeHtml(str)'), 'Missing escapeHtml function');
    assert(appContent.includes("replace(/&/g, '&amp;')"), 'Missing & escape');
    assert(appContent.includes("replace(/</g, '&lt;')"), 'Missing < escape');
    assert(appContent.includes("replace(/>/g, '&gt;')"), 'Missing > escape');
});

// Test 2: Room Member & Reaction sanitization
test('Frontend: Usernames & reactions are sanitized with escapeHtml', () => {
    assert(appContent.includes('escapeHtml(user.name)'), 'Room member name must be escaped');
    assert(appContent.includes('escapeHtml(senderName)'), 'Reaction sender name must be escaped');
    assert(appContent.includes('escapeHtml(emoji)'), 'Reaction emoji must be escaped');
});

// Test 3: Timing Attack Safe Compare on server
test('Backend: safeCompare uses crypto.timingSafeEqual for hash verification', () => {
    assert(serverContent.includes('function safeCompare(a, b)'), 'Missing safeCompare function');
    assert(serverContent.includes('crypto.timingSafeEqual'), 'safeCompare must use timingSafeEqual');
    assert(serverContent.includes('safeCompare(pwdHash, user.password_hash)'), 'Login must use safeCompare');
});

// Test 4: Session Fixation Prevention on login
test('Backend: Login invokes req.session.regenerate()', () => {
    assert(serverContent.includes('req.session.regenerate'), 'Login must regenerate session ID to prevent fixation');
});

// Test 5: devOtp Information Disclosure Prevention
test('Backend: devOtp is protected behind NODE_ENV !== production', () => {
    assert(serverContent.includes("process.env.NODE_ENV !== 'production'"), 'devOtp must check NODE_ENV');
    assert(serverContent.includes('devOtp: (isDev && sendRes.devMode) ? otp : undefined'), 'devOtp must not leak in prod');
});

// Test 6: Username & DisplayName length limits
test('Backend: Signup enforces username and displayName max length <= 50', () => {
    assert(serverContent.includes('username.length > 50'), 'Must enforce username max length');
    assert(serverContent.includes('displayName.length > 50'), 'Must enforce displayName max length');
});

// Test 7: Rate limiter IP spoofing / proxy chain protection
test('Backend: createRateLimiter parses raw IP and handles proxy chains', () => {
    assert(serverContent.includes("split(',')[0].trim()"), 'Rate limiter must extract first IP in x-forwarded-for chain');
});

// Test 8: Reverse Tabnabbing Protection (OWASP HTML link safety)
test('Frontend: External maps link enforces rel="noopener noreferrer"', () => {
    const indexPath = path.join(__dirname, '../templates/index.html');
    const indexContent = fs.readFileSync(indexPath, 'utf8');
    assert(indexContent.includes('rel="noopener noreferrer"'), 'External link must have rel="noopener noreferrer"');
});

// Test 9: Rate limiting on sensitive endpoints (Feedback, Recovery, Password, PDPA)
test('Backend: authLimiter & feedbackLimiter protect sensitive endpoints', () => {
    assert(serverContent.includes("app.post('/api/feedback', feedbackLimiter"), 'Feedback must have rate limiter');
    assert(serverContent.includes("app.put('/api/user/password', authLimiter"), 'Password update must have rate limiter');
    assert(serverContent.includes("app.post('/api/auth/forgot/verify-otp', authLimiter"), 'Verify OTP must have rate limiter');
    assert(serverContent.includes("app.post('/api/pdpa/delete-my-account', authLimiter"), 'Account deletion must have rate limiter');
});

// Test 10: Password and Feedback maximum input bounds
test('Backend: Password maximum length capped at 128 chars & feedback bounded', () => {
    assert(serverContent.includes('newPassword.length > 128'), 'Password must have upper bound of 128 chars');
    assert(serverContent.includes('title.trim().slice(0, 100)'), 'Feedback title must be bounded');
    assert(serverContent.includes('description.trim().slice(0, 2000)'), 'Feedback description must be bounded');
});

// Test 11: Socket.io member name and emoji bounds
test('Backend: Socket.io bounds member names (50 chars) and reactions (10 chars)', () => {
    assert(serverContent.includes("name = (data.name || '').trim().slice(0, 50)"), 'Socket join_room name must be bounded');
    assert(serverContent.includes("emoji.trim().slice(0, 10)"), 'Socket reaction emoji must be bounded');
});

console.log('\n========================================');
console.log(`  TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('========================================\n');

if (failed > 0) {
    process.exit(1);
}
