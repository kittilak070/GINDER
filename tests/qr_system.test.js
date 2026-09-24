const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('========================================');
console.log('  QR CODE & FAST SCANNER TEST SUITE');
console.log('========================================\n');

let passed = 0;
let failed = 0;

function test(description, fn) {
    try {
        fn();
        console.log(`• [TEST] ${description} ... PASS`);
        passed++;
    } catch (err) {
        console.error(`• [TEST] ${description} ... FAIL`);
        console.error(`  Error: ${err.message}\n`);
        failed++;
    }
}

const indexPath = path.join(__dirname, '..', 'templates', 'index.html');
const appJsPath = path.join(__dirname, '..', 'static', 'app.js');
const styleCssPath = path.join(__dirname, '..', 'static', 'style.css');
const qriousLocalPath = path.join(__dirname, '..', 'static', 'qrious.min.js');

const indexHtml = fs.readFileSync(indexPath, 'utf8');
const appJs = fs.readFileSync(appJsPath, 'utf8');
const styleCss = fs.readFileSync(styleCssPath, 'utf8');

// 1. Dependency tests
test('Templates: index.html imports qrious.min.js with CDN fallback', () => {
    assert(indexHtml.includes('/static/qrious.min.js'), 'Must load local /static/qrious.min.js');
    assert(indexHtml.includes('qrious.min.js'), 'Must reference qrious library');
    assert(fs.existsSync(qriousLocalPath), 'static/qrious.min.js file must exist');
    const stats = fs.statSync(qriousLocalPath);
    assert(stats.size > 5000, 'static/qrious.min.js must not be empty');
});

test('Templates: index.html contains lobby-qr canvas, container and fast scanner HUD', () => {
    assert(indexHtml.includes('id="lobby-qr"'), 'Must contain canvas with id lobby-qr');
    assert(indexHtml.includes('id="lobby-qr-container"'), 'Must contain container with id lobby-qr-container');
    assert(indexHtml.includes('id="qr-scanner-modal"'), 'Must contain qr-scanner-modal');
    assert(indexHtml.includes('id="qr-scanner-hud"'), 'Must contain qr-scanner-hud');
    assert(indexHtml.includes('class="qr-hud-laser"'), 'Must contain qr-hud-laser for visual scanning beam');
    assert(indexHtml.includes('id="btn-switch-camera"'), 'Must contain camera switch button');
});

// 2. CSS tests
test('CSS: style.css defines .qr-container, .qr-scanner-hud and laser animation', () => {
    assert(styleCss.includes('.qr-container'), 'Must define .qr-container');
    assert(styleCss.includes('.qr-scanner-hud'), 'Must define .qr-scanner-hud');
    assert(styleCss.includes('.qr-hud-laser'), 'Must define .qr-hud-laser');
    assert(styleCss.includes('@keyframes qr-laser-scan'), 'Must define @keyframes qr-laser-scan');
    assert(styleCss.includes('.qr-scan-success-flash'), 'Must define .qr-scan-success-flash');
});

// 3. JS Architecture & Implementation tests
test('JS: app.js defines renderLobbyQRCode with QRious and safe image fallback', () => {
    assert(appJs.includes('function renderLobbyQRCode('), 'Must define renderLobbyQRCode function');
    assert(appJs.includes('new QRious({'), 'Must use QRious for drawing QR code');
    assert(appJs.includes('lobby-qr'), 'Must target lobby-qr canvas');
    assert(appJs.includes('renderLobbyQRCode(joinUrl);'), 'socket.on(join_success) must invoke renderLobbyQRCode');
});

test('JS: app.js enables Hardware Acceleration (BarcodeDetector) and fast 25 FPS in scanner', () => {
    assert(appJs.includes('useBarCodeDetectorIfSupported: true'), 'Must enable Native BarcodeDetector');
    assert(appJs.includes('fps: 25'), 'Must run scanner at 25 FPS for rapid detection');
    assert(appJs.includes('extractRoomIdFromScannedText'), 'Must define extractRoomIdFromScannedText');
    assert(appJs.includes('qr-scan-success-flash'), 'Must trigger visual flash on success');
});

test('JS: extractRoomIdFromScannedText accurately extracts Room IDs from diverse inputs', () => {
    const funcMatch = appJs.match(/function extractRoomIdFromScannedText\s*\([\s\S]*?\n\}/);
    assert(funcMatch, 'Function extractRoomIdFromScannedText must be found in app.js');

    const fn = new Function(`${funcMatch[0]}; return extractRoomIdFromScannedText;`)();

    // Test vectors
    assert.strictEqual(fn('https://ginder.onrender.com/?roomId=ABCD&autoJoin=1'), 'ABCD');
    assert.strictEqual(fn('https://ginder.onrender.com/?roomid=xyz1&autoJoin=1'), 'XYZ1');
    assert.strictEqual(fn('ginder.onrender.com/?roomId=k8m2'), 'K8M2');
    assert.strictEqual(fn('http://192.168.1.55:3000/?roomId=99AB&autoJoin=1'), '99AB');
    assert.strictEqual(fn('https://ginder.onrender.com/room/W3X4'), 'W3X4');
    assert.strictEqual(fn('https://ginder.onrender.com/join/T7Y8'), 'T7Y8');
    assert.strictEqual(fn('WXYZ'), 'WXYZ');
    assert.strictEqual(fn('1234'), '1234');
    assert.strictEqual(fn('hello world'), null);
    assert.strictEqual(fn('https://google.com/search?q=food'), null);
    assert.strictEqual(fn(''), null);
    assert.strictEqual(fn(null), null);
});

test('JS: app.js reads roomId and autoJoin at top of DOMContentLoaded to prevent modal blocking', () => {
    const domLoadedIdx = appJs.indexOf("window.addEventListener('DOMContentLoaded'");
    assert(domLoadedIdx !== -1, 'DOMContentLoaded listener must exist');
    const snippet = appJs.slice(domLoadedIdx, domLoadedIdx + 450);
    assert(snippet.includes("urlParams.get('roomId')"), 'Must extract roomId in early snippet');
    assert(snippet.includes('state.targetRoomId ='), 'Must assign state.targetRoomId immediately');
});

test('JS: attemptAutoJoinRoom and scan success trigger seamless room entry', () => {
    assert(appJs.includes('attemptAutoJoinRoom()'), 'Must call attemptAutoJoinRoom');
    assert(appJs.includes("socket.emit('join_room'"), 'Must emit join_room to socket');
});

test('UX & Compatibility: scanQRFromImageFile and playsinline video enforcement exist', () => {
    assert(appJs.includes('scanQRFromImageFile('), 'Must define scanQRFromImageFile');
    assert(appJs.includes('enforceVideoPlaysInline()'), 'Must define enforceVideoPlaysInline for iOS WebKit');
    assert(indexHtml.includes('id="btn-scan-qr-file"'), 'Must contain btn-scan-qr-file button');
    assert(indexHtml.includes('id="qr-file-input"'), 'Must contain qr-file-input input');
});

console.log('\n========================================');
console.log(`  TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('========================================\n');

if (failed > 0) {
    process.exit(1);
}
