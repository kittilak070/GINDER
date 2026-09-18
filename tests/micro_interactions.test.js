const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('========================================');
console.log('  MICRO-INTERACTION VERIFICATION SUITE  ');
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

const cssPath = path.join(__dirname, '../static/style.css');
const jsPath = path.join(__dirname, '../static/app.js');

const cssContent = fs.readFileSync(cssPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');

// Test 1: Glassmorphic Ripple CSS & JS
test('CSS & JS: Global Glassmorphic Ripple effect defined and initialized', () => {
    assert(cssContent.includes('.glass-ripple'), 'Missing .glass-ripple class in style.css');
    assert(cssContent.includes('@keyframes ripple-glow-anim'), 'Missing ripple-glow-anim keyframe');
    assert(jsContent.includes('function setupGlobalRipples()'), 'Missing setupGlobalRipples function in app.js');
    assert(jsContent.includes('setupGlobalRipples();'), 'setupGlobalRipples should be called on DOMContentLoaded');
});

// Test 2: Swipe Controls Micro-Reactions (Heartbeat, Tilt Shake, 360 Spin)
test('CSS & JS: Like, Dislike, and Info button micro-reactions defined and triggered', () => {
    assert(cssContent.includes('@keyframes heart-beat-spring'), 'Missing heart-beat-spring keyframe in style.css');
    assert(cssContent.includes('@keyframes tilt-shake'), 'Missing tilt-shake keyframe in style.css');
    assert(cssContent.includes('@keyframes spin-360'), 'Missing spin-360 keyframe in style.css');
    assert(cssContent.includes('.ring-glow-green'), 'Missing .ring-glow-green class in style.css');
    assert(cssContent.includes('.ring-glow-pink'), 'Missing .ring-glow-pink class in style.css');
    assert(jsContent.includes('function triggerControlBtnReaction('), 'Missing triggerControlBtnReaction in app.js');
    assert(jsContent.includes("triggerControlBtnReaction('like')"), 'Missing like reaction trigger');
    assert(jsContent.includes("triggerControlBtnReaction('dislike')"), 'Missing dislike reaction trigger');
    assert(jsContent.includes("triggerControlBtnReaction('info')"), 'Missing info reaction trigger');
});

// Test 3: Swipe Affordance Nudge & Hint
test('CSS & JS: First-time swipe affordance nudge and hint defined and managed', () => {
    assert(cssContent.includes('@keyframes card-idle-nudge'), 'Missing card-idle-nudge keyframe in style.css');
    assert(cssContent.includes('.swipe-affordance-hint'), 'Missing .swipe-affordance-hint in style.css');
    assert(jsContent.includes('function setupSwipeAffordance()'), 'Missing setupSwipeAffordance in app.js');
    assert(jsContent.includes('function clearSwipeAffordance()'), 'Missing clearSwipeAffordance in app.js');
});

// Test 4: Filter Chips Elastic Pop & Reset 360 Spin
test('CSS & JS: Filter chips pop and reset 360 reverse spin animation defined', () => {
    assert(cssContent.includes('@keyframes pill-elastic-pop'), 'Missing pill-elastic-pop keyframe in style.css');
    assert(cssContent.includes('@keyframes chip-icon-spin'), 'Missing chip-icon-spin keyframe in style.css');
    assert(cssContent.includes('@keyframes spin-reverse-360'), 'Missing spin-reverse-360 keyframe in style.css');
    assert(cssContent.includes('.reset-feedback-badge'), 'Missing .reset-feedback-badge in style.css');
    assert(jsContent.includes('just-selected'), 'app.js should toggle just-selected class on chip selection');
    assert(jsContent.includes('animate-spin-reverse'), 'app.js should trigger animate-spin-reverse on reset click');
});

// Test 5: Room Code Interactive Feedback & Error Shake
test('CSS & JS: Room code character pop and error shake feedback defined', () => {
    assert(cssContent.includes('.input-char-pop'), 'Missing .input-char-pop class in style.css');
    assert(cssContent.includes('.input-code-ready'), 'Missing .input-code-ready in style.css');
    assert(cssContent.includes('.input-shake'), 'Missing .input-shake in style.css');
    assert(jsContent.includes('input-char-pop'), 'app.js should handle input-char-pop on room ID input');
    assert(jsContent.includes('input-code-ready'), 'app.js should set input-code-ready on 4-char room ID');
});

// Test 6: Copy Button Emerald Glow & Checkmark Morph
test('CSS & JS: Copy button emerald glow and checkmark morph defined', () => {
    assert(cssContent.includes('.btn.copied-emerald'), 'Missing .btn.copied-emerald in style.css');
    assert(cssContent.includes('@keyframes checkmark-morph'), 'Missing checkmark-morph keyframe in style.css');
    assert(jsContent.includes('copied-emerald'), 'app.js should add copied-emerald on room ID copy');
});

// Test 7: Emoji Reactions Cartoon Physics (Squash & Stretch, Floating Wave)
test('CSS & JS: Room emoji reactions squash-stretch and floating motion defined', () => {
    assert(cssContent.includes('@keyframes squash-stretch-anim'), 'Missing squash-stretch-anim in style.css');
    assert(cssContent.includes('.floating-room-emoji'), 'Missing .floating-room-emoji in style.css');
    assert(cssContent.includes('@keyframes float-rise-sway'), 'Missing float-rise-sway keyframe in style.css');
    assert(jsContent.includes('spawnFloatingEmojiPhysics('), 'Missing spawnFloatingEmojiPhysics in app.js');
});

// Test 8: Result Screen Winner Star Pop & Dice Roll Spin
test('CSS & JS: Winner rating star pop and dice roll spin defined', () => {
    assert(cssContent.includes('@keyframes star-pop-kf'), 'Missing star-pop-kf keyframe in style.css');
    assert(cssContent.includes('@keyframes dice-roll-spin'), 'Missing dice-roll-spin keyframe in style.css');
    assert(jsContent.includes('animateWinnerStars('), 'Missing animateWinnerStars in app.js');
    assert(jsContent.includes('animate-dice-roll'), 'Missing animate-dice-roll trigger in app.js');
});

// Test 9: Async Button Loading State with Dual-Ring Spinner
test('CSS: Async button loading state with dual-ring spinner defined', () => {
    assert(cssContent.includes('.btn.btn-loading'), 'Missing .btn.btn-loading in style.css');
    assert(cssContent.includes('@keyframes btn-spin-kf'), 'Missing btn-spin-kf keyframe in style.css');
});

console.log('\n========================================');
console.log(`  TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('========================================\n');

if (failed > 0) {
    process.exit(1);
}
