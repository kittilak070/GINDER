const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('========================================');
console.log('  CARD SWIPE & VISIBILITY TEST SUITE');
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

// Test 1: Style CSS hides cards behind top card
test('CSS: .swipe-card:not(:last-child) is hidden (opacity: 0, visibility: hidden)', () => {
    assert(cssContent.includes('.swipe-card:not(:last-child)'), 'Missing .swipe-card:not(:last-child) selector');
    assert(cssContent.includes('opacity: 0;'), 'Missing opacity: 0 in non-active cards');
    assert(cssContent.includes('visibility: hidden;'), 'Missing visibility: hidden in non-active cards');
});

// Test 2: Style CSS removed stacked offset transforms
test('CSS: Stacked peek offsets (5px/10px) removed from .swipe-card', () => {
    assert(!cssContent.includes('translate3d(0, 5px, -8px)'), 'Should not contain translate3d(0, 5px, -8px)');
    assert(!cssContent.includes('translate3d(0, 10px, -16px)'), 'Should not contain translate3d(0, 10px, -16px)');
});

// Test 3: App JS locks drag movement strictly to horizontal axis
test('JS: pointermove locks card transform strictly to X axis (Y = 0)', () => {
    assert(jsContent.includes('translate3d(${dX}px, 0, 0)'), 'Pointermove should lock Y displacement to 0');
    assert(!jsContent.includes('translate3d(${dX}px, ${dY}px, 0)'), 'Pointermove should NOT follow dY');
});

// Test 4: App JS locks swipe flyout strictly to horizontal axis
test('JS: executeSwipeAction flyout is strictly horizontal', () => {
    assert(jsContent.includes('translate3d(${flyX}px, 0, 0)'), 'Flyout should lock Y displacement to 0');
    assert(!jsContent.includes('translate3d(${flyX}px, ${dY * 2}px, 0)'), 'Flyout should NOT follow dY * 2');
});

// Test 5: App JS removed nextCard overshoot popup animation
test('JS: cubic-bezier bounce popup on nextCard removed', () => {
    assert(!jsContent.includes('cubic-bezier(0.175, 0.885, 0.32, 1.275)'), 'Overshoot popup animation should be removed');
});

// Test 6: App JS defines resetComboStreak
test('JS: resetComboStreak function exists and resets comboCount to 0', () => {
    assert(jsContent.includes('function resetComboStreak()'), 'Missing resetComboStreak function');
    assert(jsContent.includes('state.comboCount = 0;'), 'resetComboStreak should reset state.comboCount');
});

// Test 7: App JS resets combo when round finishes
test('JS: Combo is reset when round ends (renderResultScreen & deck finished)', () => {
    assert(jsContent.includes('function renderResultScreen'), 'Missing renderResultScreen');
    const resultScreenSnippet = jsContent.substring(
        jsContent.indexOf('function renderResultScreen'),
        jsContent.indexOf('function renderResultScreen') + 300
    );
    assert(resultScreenSnippet.includes('resetComboStreak()'), 'renderResultScreen must call resetComboStreak()');
});

// Test 8: App JS resets combo when starting a new round (renderDeck & startSoloSwipe)
test('JS: Combo is reset when starting a new round (renderDeck & startSoloSwipe)', () => {
    const renderDeckSnippet = jsContent.substring(
        jsContent.indexOf('function renderDeck()'),
        jsContent.indexOf('function renderDeck()') + 300
    );
    assert(renderDeckSnippet.includes('resetComboStreak()'), 'renderDeck must call resetComboStreak()');

    const startSoloSnippet = jsContent.substring(
        jsContent.indexOf('async function startSoloSwipe()'),
        jsContent.indexOf('async function startSoloSwipe()') + 4500
    );
    assert(startSoloSnippet.includes('resetComboStreak()'), 'startSoloSwipe must call resetComboStreak()');
});

// Test 9: HTML: Undo button removed per user request; 3 primary control buttons present
test('UX/UI: Clean 3-button swipe controls layout (dislike, info, like) without undo button', () => {
    const indexPath = path.join(__dirname, '../templates/index.html');
    const indexContent = fs.readFileSync(indexPath, 'utf8');
    assert(!indexContent.includes('id="btn-swipe-undo"'), '#btn-swipe-undo should be removed from HTML per user request');
    assert(indexContent.includes('id="btn-swipe-left"'), 'Missing #btn-swipe-left in HTML');
    assert(indexContent.includes('id="btn-toggle-info"'), 'Missing #btn-toggle-info in HTML');
    assert(indexContent.includes('id="btn-swipe-right"'), 'Missing #btn-swipe-right in HTML');
});

// Test 10: CSS: Skeleton Shimmer wave effect is defined
test('UX/UI: Skeleton Card Shimmer wave animation is defined', () => {
    assert(cssContent.includes('.swipe-card.skeleton-card'), 'Missing skeleton-card class in CSS');
    assert(cssContent.includes('skeleton-shimmer-wave'), 'Missing skeleton-shimmer-wave animation');
});

// Test 11: JS: Undo functionality (undoLastSwipe & updateUndoButtonState) exist
test('UX/UI: undoLastSwipe and updateUndoButtonState manage swipe history', () => {
    assert(jsContent.includes('function undoLastSwipe()'), 'Missing undoLastSwipe function in app.js');
    assert(jsContent.includes('function updateUndoButtonState()'), 'Missing updateUndoButtonState function in app.js');
    assert(jsContent.includes('state.swipeHistory'), 'Missing swipeHistory tracking in app.js');
});

// Test 12: JS: Keyboard shortcuts for desktop ergonomics
test('UX/UI: Keyboard navigation handles ArrowLeft, ArrowRight, ArrowUp, and Undo (Z)', () => {
    assert(jsContent.includes("e.key === 'ArrowLeft'"), 'Missing ArrowLeft keyboard shortcut');
    assert(jsContent.includes("e.key === 'ArrowRight'"), 'Missing ArrowRight keyboard shortcut');
    assert(jsContent.includes("e.key === 'z' || e.key === 'Z'"), 'Missing Z undo keyboard shortcut');
});

// Test 13: JS: renderSkeletonDeck and renderDeck safely preserve and check empty state
test('UX/UI: renderSkeletonDeck and renderDeck handle deck-empty-state safely without throwing', () => {
    assert(jsContent.includes('emptyStateEl ? emptyStateEl.outerHTML :'), 'Missing defensive emptyStateEl check in renderDeck or renderSkeletonDeck');
    assert(!jsContent.includes("deck.querySelector('.deck-empty-state').outerHTML"), 'Unsafe direct .outerHTML access on querySelector found');
});

// Test 14: HTML, CSS & JS: deck-empty-state is hidden while cards exist and shown only after last card
test('UX/UI: deck-empty-state is hidden while cards exist and revealed only after last card is swiped', () => {
    const indexPath = path.join(__dirname, '../templates/index.html');
    const indexContent = fs.readFileSync(indexPath, 'utf8');
    assert(indexContent.includes('deck-empty-state hidden'), 'deck-empty-state should have hidden class in HTML by default');
    assert(cssContent.includes('.deck-empty-state.hidden'), '.deck-empty-state.hidden should be defined in style.css');
    assert(jsContent.includes("emptyEl.classList.remove('hidden')"), 'app.js should reveal emptyEl on last card finished');
    assert(jsContent.includes("emptyEl.classList.add('hidden')"), 'app.js should re-hide emptyEl when undoing or when cards exist');
});

// Test 15: CSS & JS: Card silhouette behind active card shows without image or text
test('UX/UI: .swipe-card:nth-last-child(2) shows clean card silhouette without photo or text', () => {
    assert(cssContent.includes('.swipe-card:nth-last-child(2)'), 'Missing .swipe-card:nth-last-child(2) selector');
    assert(cssContent.includes('.swipe-card:not(:last-child):not(.card-revealed) .card-image-wrapper'), 'Should hide image on waiting card');
    assert(cssContent.includes('.swipe-card:not(:last-child):not(.card-revealed) .card-details'), 'Should hide details on waiting card');
    assert(jsContent.includes("nextCard.classList.add('card-revealed')"), 'app.js should reveal next card on swipe flyout');
});

// Test 16: JS: Card gestures require intentional drag and do not swipe on tap/click
test('UX/UI: setupCardGestures prevents accidental swipe on click/tap', () => {
    const freshJs = fs.readFileSync(jsPath, 'utf8');
    assert(freshJs.includes('let hasMoved = false;'), 'setupCardGestures must track hasMoved state');
    assert(freshJs.includes('currentX = e.clientX;'), 'currentX must be initialized on pointerdown');
    assert(freshJs.includes('hasMoved && e.type !== \'pointercancel\' && dX > threshold'), 'Must require hasMoved for right swipe');
    assert(freshJs.includes('hasMoved && e.type !== \'pointercancel\' && dX < -threshold'), 'Must require hasMoved for left swipe');
});

// Test 17: CSS: Tinder / Omi Story Progress Indicators & Tap Zones
test('Tinder/Omi: CSS defines card story bars, active state, and tap zones', () => {
    const freshCss = fs.readFileSync(cssPath, 'utf8');
    assert(freshCss.includes('.card-story-bars'), 'Missing .card-story-bars selector in CSS');
    assert(freshCss.includes('.story-bar'), 'Missing .story-bar selector in CSS');
    assert(freshCss.includes('.story-bar.active'), 'Missing .story-bar.active selector in CSS');
    assert(freshCss.includes('.card-photo-tap-left'), 'Missing .card-photo-tap-left in CSS');
    assert(freshCss.includes('.card-photo-tap-right'), 'Missing .card-photo-tap-right in CSS');
});

// Test 18: JS: Multi-Photo navigation logic (switchCardPhoto, jumpCardPhoto, tap detection)
test('Tinder/Omi: JS renders story bars and implements switchCardPhoto & jumpCardPhoto', () => {
    const freshJs = fs.readFileSync(jsPath, 'utf8');
    assert(freshJs.includes('function switchCardPhoto(card, direction)'), 'Missing switchCardPhoto function');
    assert(freshJs.includes('window.jumpCardPhoto = function(restaurantId, targetIdx)'), 'Missing window.jumpCardPhoto function');
    assert(freshJs.includes('card-story-bars'), 'renderDeck must render card-story-bars');
    assert(freshJs.includes('switchCardPhoto(card, -1)'), 'Must support previous photo tap (-1)');
    assert(freshJs.includes('switchCardPhoto(card, 1)'), 'Must support next photo tap (1)');
});

// Test 19: Drawer: Multi-Photo Strip in Drawer
test('Tinder/Omi: Drawer includes multi-photo gallery strip and styles', () => {
    const freshCss = fs.readFileSync(cssPath, 'utf8');
    const freshJs = fs.readFileSync(jsPath, 'utf8');
    assert(freshCss.includes('.drawer-photo-gallery'), 'Missing .drawer-photo-gallery in CSS');
    assert(freshCss.includes('.drawer-photo-strip'), 'Missing .drawer-photo-strip in CSS');
    assert(freshCss.includes('.drawer-thumb'), 'Missing .drawer-thumb in CSS');
    assert(freshJs.includes('drawer-photo-gallery'), 'renderDeck drawer must render drawer-photo-gallery');
});

// Test 20: Admin: Multi-Image Manager in Admin Dashboard
test('Admin CMS: Multi-photo inputs, file upload, and thumbnail preview strip are present', () => {
    const adminPath = path.join(__dirname, '../templates/admin.html');
    const adminContent = fs.readFileSync(adminPath, 'utf8');
    assert(adminContent.includes('id="form-image-urls"'), 'Missing #form-image-urls in admin.html');
    assert(adminContent.includes('id="form-image-files"'), 'Missing #form-image-files file upload input in admin.html');
    assert(adminContent.includes('id="admin-image-previews"'), 'Missing #admin-image-previews container in admin.html');
    assert(adminContent.includes('function renderAdminImagePreviews()'), 'Missing renderAdminImagePreviews function in admin.html');
    assert(adminContent.includes('window.removeAdminImage = function'), 'Missing window.removeAdminImage function in admin.html');
});

// Test 21: Multi-photo sliding gesture (เลื่อนรูป) and click discrimination logic
test('Tinder/Omi: Multi-photo slide gesture (เลื่อนรูป) and click discrimination logic', () => {
    const freshJs = fs.readFileSync(jsPath, 'utf8');
    const freshCss = fs.readFileSync(cssPath, 'utf8');
    assert(freshJs.includes('isDownOnPhoto'), 'setupCardGestures must track isDownOnPhoto');
    assert(freshJs.includes('dX < -20'), 'Must support sliding left for next photo');
    assert(freshJs.includes('dX > 20'), 'Must support sliding right for previous photo');
    assert(freshJs.includes('((nextIdx % total) + total) % total'), 'switchCardPhoto must safely normalize index using modulo');
    assert(freshJs.includes('hintLeft.addEventListener'), 'hintLeft must have dedicated event listener');
    assert(freshJs.includes('hintRight.addEventListener'), 'hintRight must have dedicated event listener');
    assert(freshCss.includes('.card-photo-nav-hint:hover'), 'Missing hover style for photo navigation hint');
});

console.log('\n========================================');
console.log(`  TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('========================================\n');

if (failed > 0) {
    process.exit(1);
}

