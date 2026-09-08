// Establish socket.io connection
const socket = io();

// Application State
const state = {
    userId: null,
    roomId: null,
    targetRoomId: null,
    autoJoin: false,
    networkBaseUrl: null,
    isCreator: false,
    users: [],
    restaurants: [],
    currentIndex: 0,
    votes: {},
    preferences: {
        minPrice: 0,
        maxPrice: 99,
        maxDistance: 2.0,
        foodTypes: ['อาหารไทย / อาหารใต้']
    },
    allergies: [],
    name: '',
    timerInterval: null
};

// DOM Cache
const views = {
    auth: document.getElementById('view-auth'),
    landing: document.getElementById('view-landing'),
    preferences: document.getElementById('view-preferences'),
    join: document.getElementById('view-join'),
    lobby: document.getElementById('view-lobby'),
    swipe: document.getElementById('view-swipe'),
    result: document.getElementById('view-result')
};

const badge = {
    room: document.getElementById('room-badge'),
    id: document.getElementById('badge-room-id')
};

// --- ZERO-ASSET WEB AUDIO SOUND SYNTHESIZER ---
const soundFx = (() => {
    let audioCtx = null;
    let isMuted = localStorage.getItem('ginder_sound_muted') === 'true';

    function getContext() {
        try {
            if (!audioCtx) {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (AudioContextClass) {
                    audioCtx = new AudioContextClass();
                }
            }
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
        } catch (e) {
            console.warn('AudioContext initialization deferred:', e);
        }
        return audioCtx;
    }

    // Comprehensive mobile audio unlock for iOS Safari and Android Chrome
    const unlockAudio = () => {
        const ctx = getContext();
        if (ctx) {
            if (ctx.state === 'suspended') {
                ctx.resume();
            }
            // Warm up mobile speaker pipeline with a 1-sample buffer (iOS Safari standard)
            try {
                const buffer = ctx.createBuffer(1, 1, 22050);
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(ctx.destination);
                source.start(0);
            } catch (e) {}
        }
    };

    ['touchstart', 'touchend', 'click', 'pointerdown', 'keydown'].forEach(evt => {
        window.addEventListener(evt, unlockAudio, { passive: true });
    });

    function emitTone(freq, type, duration, gainStart = 0.35, gainEnd = 0.001) {
        if (isMuted) return;
        const ctx = getContext();
        if (!ctx) return;
        try {
            if (ctx.state === 'suspended') ctx.resume();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            gain.gain.setValueAtTime(gainStart, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(Math.max(gainEnd, 0.0001), ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + duration);
        } catch (e) {}
    }

    return {
        get isMuted() {
            return isMuted;
        },
        toggleMute() {
            isMuted = !isMuted;
            localStorage.setItem('ginder_sound_muted', isMuted);
            if (!isMuted) {
                unlockAudio();
                this.playPop();
            }
            return isMuted;
        },
        playPop() {
            if (isMuted) return;
            const ctx = getContext();
            if (!ctx) return;
            try {
                if (ctx.state === 'suspended') ctx.resume();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(560, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(280, ctx.currentTime + 0.09);
                gain.gain.setValueAtTime(0.35, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.09);
            } catch (e) {}
        },
        playLike() {
            if (isMuted) return;
            const ctx = getContext();
            if (!ctx) return;
            try {
                if (ctx.state === 'suspended') ctx.resume();
                // Harmonic two-note chime (C5 & E5) with sparkle
                [523.25, 659.25].forEach((freq, idx) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'triangle';
                    const startTime = ctx.currentTime + (idx * 0.035);
                    osc.frequency.setValueAtTime(freq, startTime);
                    gain.gain.setValueAtTime(0.32, startTime);
                    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.22);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(startTime);
                    osc.stop(startTime + 0.24);
                });
            } catch (e) {}
        },
        playPass() {
            if (isMuted) return;
            const ctx = getContext();
            if (!ctx) return;
            try {
                if (ctx.state === 'suspended') ctx.resume();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(280, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(130, ctx.currentTime + 0.12);
                gain.gain.setValueAtTime(0.30, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.12);
            } catch (e) {}
        },
        playMatch() {
            if (isMuted) return;
            const ctx = getContext();
            if (!ctx) return;
            try {
                if (ctx.state === 'suspended') ctx.resume();
                // Triumphant Fanfare Arpeggio: C5 -> E5 -> G5 -> C6
                const notes = [523.25, 659.25, 783.99, 1046.50];
                notes.forEach((freq, idx) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'triangle';
                    const startTime = ctx.currentTime + (idx * 0.08);
                    const dur = idx === 3 ? 0.45 : 0.18;
                    osc.frequency.setValueAtTime(freq, startTime);
                    gain.gain.setValueAtTime(0.38, startTime);
                    gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(startTime);
                    osc.stop(startTime + dur);
                });
            } catch (e) {}
        },
        playTone(freq, type, duration, gainStart, gainEnd) {
            emitTone(freq, type, duration, gainStart, gainEnd);
        },
        playCopy() {
            emitTone(880, 'sine', 0.08, 0.35, 0.001);
        }
    };
})();

// --- PARTICLE BURST GENERATOR (GENTLE MICRO-INTERACTION) ---
function spawnParticleBurst(x, y, type = 'heart') {
    let container = document.querySelector('.particle-burst-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'particle-burst-container';
        document.body.appendChild(container);
    }

    const icons = type === 'heart' ? ['❤️', '✨'] : ['✨', '⭐'];
    const count = 3; // Reduced from 7 to 3 subtle particles

    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'micro-particle';
        p.innerText = icons[Math.floor(Math.random() * icons.length)];
        p.style.fontSize = `${Math.random() * 4 + 11}px`;
        p.style.left = `${x}px`;
        p.style.top = `${y}px`;

        // Radial dispersion with slight upward bias
        const angle = (Math.PI * 2 * i) / count + (Math.random() * 0.3 - 0.15);
        const distance = Math.random() * 30 + 15;
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance - 20;
        const rot = (Math.random() * 40 - 20) + 'deg';

        p.style.setProperty('--dx', `${dx}px`);
        p.style.setProperty('--dy', `${dy}px`);
        p.style.setProperty('--rot', rot);

        container.appendChild(p);
        setTimeout(() => p.remove(), 500);
    }
}

// --- COUNT-UP NUMBER ANIMATION ---
function animateCountUp(element, start, end, duration = 1200) {
    if (!element) return;
    const startTime = performance.now();
    function update(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(start + (end - start) * easeOut);
        element.innerText = current;
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }
    requestAnimationFrame(update);
}

// --- INITIALIZE & ROUTING ---
window.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    setupProfileAndFeedback();
    setupForgotPasswordModal();
    checkCurrentUser();
    requestUserLocation();

    // Check if Room ID is in the query params (scanned QR code or direct link)
    const urlParams = new URLSearchParams(window.location.search);
    const roomIdParam = urlParams.get('roomId');
    if (roomIdParam) {
        state.targetRoomId = roomIdParam.trim().toUpperCase();
        state.autoJoin = true;
        const joinInput = document.getElementById('join-room-id');
        if (joinInput) joinInput.value = state.targetRoomId;
    }
});

function showView(viewName) {
    if (!state.currentUser && viewName !== 'auth') {
        viewName = 'auth';
    }

    Object.keys(views).forEach(key => {
        if (key === viewName) {
            views[key].classList.add('active');
        } else {
            views[key].classList.remove('active');
        }
    });

    // Handle room badge visibility
    if (state.roomId && ['lobby', 'swipe', 'result'].includes(viewName)) {
        badge.room.classList.remove('hidden');
        badge.id.innerText = state.roomId;
    } else {
        badge.room.classList.add('hidden');
    }
}

function resetApplicationState() {
    // Reset JS state variables
    state.roomId = null;
    state.targetRoomId = null;
    state.isCreator = false;
    state.users = [];
    state.restaurants = [];
    state.currentIndex = 0;
    state.votes = {};

    // Clear HTML fields
    document.getElementById('landing-room-id').value = '';
    document.getElementById('join-room-id').value = '';
    document.getElementById('lobby-room-id').innerText = '----';
    document.getElementById('pref-name').value = '';

    // Clear selected allergy pills for both host and guest selectors
    document.querySelectorAll('.allergy-selector .allergy-pill').forEach(pill => {
        pill.classList.remove('active');
    });

    // Reset selected food type pills to default (only the first one is active)
    document.querySelectorAll('.food-type-selector .type-pill').forEach((pill, idx) => {
        if (idx === 0) {
            pill.classList.add('active');
        } else {
            pill.classList.remove('active');
        }
    });

    // Reset budget pills to default (only the first one is active)
    document.querySelectorAll('.budget-selector .budget-pill').forEach((pill, idx) => {
        if (idx === 0) {
            pill.classList.add('active');
        } else {
            pill.classList.remove('active');
        }
    });

    // Reset distance slider to default (2.0)
    const distSlider = document.getElementById('pref-distance');
    if (distSlider) distSlider.value = 2.0;
    const distVal = document.getElementById('distance-val');
    if (distVal) distVal.innerText = '2.0 กม.';

    // Reset JS state variables
    state.preferences = {
        minPrice: 0,
        maxPrice: 99,
        maxDistance: 2.0,
        foodTypes: ['อาหารไทย / อาหารใต้']
    };

    // Remove query params from address bar
    window.history.pushState({}, document.title, window.location.pathname);
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
    // Sound Effect Toggle
    const soundToggleBtn = document.getElementById('btn-sound-toggle');
    if (soundToggleBtn) {
        const updateSoundBtnUI = (muted) => {
            soundToggleBtn.innerHTML = muted ? '<i class="fa-solid fa-volume-xmark"></i>' : '<i class="fa-solid fa-volume-high"></i>';
            soundToggleBtn.classList.toggle('muted', muted);
            soundToggleBtn.title = muted ? 'เปิดเสียงเอฟเฟกต์' : 'ปิดเสียงเอฟเฟกต์';
        };
        updateSoundBtnUI(soundFx.isMuted);

        soundToggleBtn.addEventListener('click', () => {
            soundToggleBtn.classList.add('btn-clicked');
            setTimeout(() => soundToggleBtn.classList.remove('btn-clicked'), 320);
            const muted = soundFx.toggleMute();
            updateSoundBtnUI(muted);
            if (!muted) soundFx.playPop();
        });
    }

    // Mobile View QR Modal Toggle
    const mobileQrBtn = document.getElementById('btn-desktop-mobile-qr');
    const mobileAppModal = document.getElementById('mobile-app-modal');
    const closeMobileQrBtn = document.getElementById('btn-close-mobile-qr');
    const copyMobileUrlBtn = document.getElementById('btn-copy-mobile-url');
    const mobileUrlInput = document.getElementById('mobile-app-url-input');
    const mobileCopiedMsg = document.getElementById('mobile-url-copied-msg');

    if (mobileQrBtn && mobileAppModal) {
        mobileQrBtn.addEventListener('click', () => {
            soundFx.playPop();
            mobileAppModal.classList.remove('hidden');

            const targetUrl = state.networkBaseUrl || `${window.location.protocol}//10.59.0.72:${window.location.port || 5000}`;
            if (mobileUrlInput) mobileUrlInput.value = targetUrl;

            // Render QR Code on canvas
            const qrCanvas = document.getElementById('mobile-app-qr-canvas');
            if (qrCanvas && typeof QRious === 'function') {
                new QRious({
                    element: qrCanvas,
                    value: targetUrl,
                    size: 180,
                    background: '#ffffff',
                    foreground: '#100923'
                });
            }
        });

        if (closeMobileQrBtn) {
            closeMobileQrBtn.addEventListener('click', () => {
                mobileAppModal.classList.add('hidden');
            });
        }

        mobileAppModal.addEventListener('click', (e) => {
            if (e.target === mobileAppModal) {
                mobileAppModal.classList.add('hidden');
            }
        });

        if (copyMobileUrlBtn && mobileUrlInput) {
            copyMobileUrlBtn.addEventListener('click', () => {
                soundFx.playCopy();
                navigator.clipboard.writeText(mobileUrlInput.value).then(() => {
                    if (mobileCopiedMsg) {
                        mobileCopiedMsg.style.opacity = '1';
                        setTimeout(() => { mobileCopiedMsg.style.opacity = '0'; }, 2000);
                    }
                }).catch(() => {
                    mobileUrlInput.select();
                    document.execCommand('copy');
                });
            });
        }
    }

    // --- LANDING VIEW MICRO-INTERACTIONS ---
    const heroFoodBadge = document.getElementById('hero-food-badge');
    if (heroFoodBadge) {
        const foods = ['🍜', '🍕', '🍔', '🍣', '🌮', '🍲', '🍨', '🍗', '🍛', '🍱', '🥞', '🥐'];
        let foodIdx = 0;
        const handleFoodBadgeClick = () => {
            foodIdx = (foodIdx + 1) % foods.length;
            heroFoodBadge.innerText = foods[foodIdx];
            heroFoodBadge.classList.remove('jelly-pop');
            void heroFoodBadge.offsetWidth;
            heroFoodBadge.classList.add('jelly-pop');
            soundFx.playPop();
            if (navigator.vibrate) navigator.vibrate(15);
            const rect = heroFoodBadge.getBoundingClientRect();
            spawnParticleBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 'heart');
        };
        heroFoodBadge.addEventListener('click', handleFoodBadgeClick);
        heroFoodBadge.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleFoodBadgeClick();
            }
        });
    }

    const btnGotoCreate = document.getElementById('btn-goto-create');
    if (btnGotoCreate) {
        btnGotoCreate.addEventListener('click', () => {
            soundFx.playPop();
            btnGotoCreate.classList.add('btn-clicked');
            setTimeout(() => btnGotoCreate.classList.remove('btn-clicked'), 300);
            showView('preferences');
        });
    }

    const landingRoomInput = document.getElementById('landing-room-id');
    const btnLandingJoin = document.getElementById('btn-landing-join');

    if (landingRoomInput) {
        landingRoomInput.addEventListener('input', () => {
            landingRoomInput.value = landingRoomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
            const len = landingRoomInput.value.length;
            if (len > 0) {
                soundFx.playTone(550 + len * 70, 'sine', 0.03, 0.04);
            }
            if (len === 4) {
                landingRoomInput.classList.add('input-ready');
                if (btnLandingJoin) btnLandingJoin.classList.add('btn-ready');
                soundFx.playTone(880, 'triangle', 0.06, 0.06);
                if (navigator.vibrate) navigator.vibrate(20);
            } else {
                landingRoomInput.classList.remove('input-ready');
                if (btnLandingJoin) btnLandingJoin.classList.remove('btn-ready');
            }
        });
    }

    if (btnLandingJoin) {
        btnLandingJoin.addEventListener('click', () => {
            const roomId = landingRoomInput ? landingRoomInput.value.trim().toUpperCase() : '';
            if (!roomId || roomId.length !== 4) {
                soundFx.playTone(220, 'sawtooth', 0.12, 0.08);
                if (landingRoomInput) {
                    landingRoomInput.classList.remove('input-shake');
                    void landingRoomInput.offsetWidth;
                    landingRoomInput.classList.add('input-shake');
                    landingRoomInput.focus();
                }
                if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
                return;
            }
            soundFx.playPop();
            showView('join');
            const joinRoomIdEl = document.getElementById('join-room-id');
            if (joinRoomIdEl) joinRoomIdEl.value = roomId;
        });
    }

    const btnLandingScanQr = document.getElementById('btn-landing-scan-qr');
    if (btnLandingScanQr) {
        btnLandingScanQr.addEventListener('click', () => {
            soundFx.playPop();
            startQRScanner();
        });
    }

    const btnCloseScanner = document.getElementById('btn-close-scanner');
    if (btnCloseScanner) {
        btnCloseScanner.addEventListener('click', () => {
            stopQRScanner();
        });
    }

    // Leave Room Handler
    const handleLeaveRoom = () => {
        let msg = 'คุณต้องการออกจากกลุ่มใช่หรือไม่?';

        if (views.lobby.classList.contains('active')) {
            if (state.isCreator) {
                msg = 'คุณเป็นหัวหน้าห้อง หากคุณออกจากห้อง ห้องนี้จะถูกปิดและสมาชิกทุกคนจะหลุดออก ยืนยันที่จะออกใช่หรือไม่?';
            } else {
                msg = 'คุณต้องการออกจากห้องกลุ่มใช่หรือไม่?';
            }
        } else if (views.swipe.classList.contains('active')) {
            msg = 'การโหวตกำลังดำเนินอยู่ คุณแน่ใจหรือไม่ว่าจะออกจากห้องโหวต?';
        }

        if (confirm(msg)) {
            socket.disconnect();
            if (state.timerInterval) clearInterval(state.timerInterval);
            resetApplicationState();
            showView('landing');
            socket.connect();
        }
    };

    document.getElementById('btn-leave-lobby').addEventListener('click', handleLeaveRoom);
    document.getElementById('btn-leave-swipe').addEventListener('click', handleLeaveRoom);

    // Copy Room ID to Clipboard with feedback
    document.getElementById('btn-copy-room-id').addEventListener('click', () => {
        if (!state.roomId) return;

        soundFx.playCopy();
        if (navigator.vibrate) navigator.vibrate(12);

        const copyText = state.roomId;
        const btn = document.getElementById('btn-copy-room-id');
        const originalHtml = btn.innerHTML;

        const setCopiedState = () => {
            btn.innerHTML = '<i class="fa-solid fa-check"></i> คัดลอกแล้ว!';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.innerHTML = originalHtml;
                btn.classList.remove('copied');
            }, 2000);
        };

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(copyText).then(setCopiedState).catch(err => {
                console.error('Failed to copy text using Clipboard API:', err);
                fallbackCopy(copyText);
            });
        } else {
            fallbackCopy(copyText);
        }

        function fallbackCopy(text) {
            const tempInput = document.createElement('input');
            tempInput.value = text;
            tempInput.style.position = 'fixed'; // Avoid scrolling to bottom
            tempInput.style.opacity = '0';
            document.body.appendChild(tempInput);
            tempInput.select();
            try {
                document.execCommand('copy');
                setCopiedState();
            } catch (err) {
                console.error('Fallback: Oops, unable to copy', err);
            }
            document.body.removeChild(tempInput);
        }
    });


    // Preferences View Actions
    document.getElementById('btn-back-to-landing').addEventListener('click', () => {
        const activeBudget = document.querySelector('.budget-selector .budget-pill.active');
        const maxPrice = activeBudget ? parseInt(activeBudget.dataset.max) : 99;
        const maxDistance = parseFloat(document.getElementById('pref-distance').value);
        const selectedTypes = [];
        document.querySelectorAll('.food-type-selector .type-pill.active').forEach(pill => {
            selectedTypes.push(pill.dataset.type);
        });

        const hasChanged = maxPrice !== 99 || maxDistance !== 2.0 || selectedTypes.length !== 1;

        if (hasChanged) {
            if (!confirm('คุณต้องการยกเลิกการตั้งค่าและย้อนกลับใช่หรือไม่?')) {
                return;
            }
        }
        showView('landing');
    });

    // Multi-select for Food Types in Preferences
    document.querySelectorAll('.food-type-selector .type-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            soundFx.playPop();
            if (navigator.vibrate) navigator.vibrate(8);
            pill.classList.toggle('active');
            updatePreferencesState();
        });
    });

    // Selectors for Budget in Preferences
    document.querySelectorAll('.budget-selector .budget-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            soundFx.playPop();
            if (navigator.vibrate) navigator.vibrate(8);
            document.querySelectorAll('.budget-selector .budget-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            updatePreferencesState();
        });
    });

    // Distance Slider changes
    const distSlider = document.getElementById('pref-distance');
    const distVal = document.getElementById('distance-val');
    distSlider.addEventListener('input', (e) => {
        distVal.innerText = `${parseFloat(e.target.value).toFixed(1)} กม.`;
        updatePreferencesState();
    });

    // Create Room Request
    document.getElementById('btn-create-room').addEventListener('click', () => {
        let name = document.getElementById('pref-name').value.trim();
        if (!name) {
            alert('กรุณากรอกชื่อของคุณก่อนสร้างห้อง');
            return;
        }

        // Prepend Host label for consistent display
        if (!name.startsWith('👑 ')) {
            name = '👑 ' + name;
        }

        const allergies = [];
        document.querySelectorAll('.host-allergy-selector .allergy-pill.active').forEach(pill => {
            allergies.push(pill.dataset.allergen);
        });

        state.name = name;
        state.isCreator = true;
        state.allergies = allergies;

        // Clear targets from QR before creating new
        state.targetRoomId = null;
        state.autoJoin = false;

        socket.emit('create_room', {
            hostName: name,
            preferences: state.preferences,
            allergies: allergies
        });
    });

    // Join View Actions
    document.getElementById('btn-back-to-landing-join').addEventListener('click', () => {
        const name = document.getElementById('join-name').value.trim();
        const activeAllergies = document.querySelectorAll('.allergy-selector .allergy-pill.active').length;

        const hasInput = name.length > 0 || activeAllergies > 0;

        if (hasInput) {
            if (!confirm('ข้อมูลที่กรอกจะสูญหาย คุณต้องการย้อนกลับใช่หรือไม่?')) {
                return;
            }
        }
        showView('landing');
    });

    // Multi-select for Allergies (Join and Host)
    document.querySelectorAll('.allergy-selector .allergy-pill, .host-allergy-selector .allergy-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            soundFx.playPop();
            if (navigator.vibrate) navigator.vibrate(8);
            pill.classList.toggle('active');
        });
    });

    // Submit Join Request
    document.getElementById('btn-submit-join').addEventListener('click', () => {
        const roomId = document.getElementById('join-room-id').value.trim().toUpperCase();
        const name = document.getElementById('join-name').value.trim();

        if (!roomId || roomId.length !== 4) {
            alert('กรุณากรอกรหัสห้อง 4 หลักให้ถูกต้อง');
            return;
        }
        if (!name) {
            alert('กรุณากรอกชื่อของคุณ');
            return;
        }

        // Get selected allergies
        const allergies = [];
        document.querySelectorAll('.allergy-selector .allergy-pill.active').forEach(pill => {
            allergies.push(pill.dataset.allergen);
        });

        state.name = name;
        state.allergies = allergies;

        socket.emit('join_room', {
            roomId: roomId,
            name: name,
            allergies: allergies
        });
    });

    // Host - Start Game
    document.getElementById('btn-start-game').addEventListener('click', () => {
        if (state.roomId) {
            socket.emit('start_game', {
                roomId: state.roomId,
                coords: state.userLocation ? {
                    latitude: state.userLocation.lat,
                    longitude: state.userLocation.lng
                } : null
            });
        }
    });

    // Swipe Control Button Actions
    document.getElementById('btn-swipe-left').addEventListener('click', () => {
        const btn = document.getElementById('btn-swipe-left');
        btn.classList.add('btn-clicked');
        setTimeout(() => btn.classList.remove('btn-clicked'), 320);
        swipeTopCard('left');
    });

    document.getElementById('btn-swipe-right').addEventListener('click', () => {
        const btn = document.getElementById('btn-swipe-right');
        btn.classList.add('btn-clicked');
        setTimeout(() => btn.classList.remove('btn-clicked'), 320);
        const rect = btn.getBoundingClientRect();
        spawnParticleBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 'heart');
        swipeTopCard('right');
    });

    document.getElementById('btn-toggle-info').addEventListener('click', () => {
        const btn = document.getElementById('btn-toggle-info');
        btn.classList.add('btn-clicked');
        setTimeout(() => btn.classList.remove('btn-clicked'), 320);
        soundFx.playPop();
        toggleTopCardDrawer();
    });

    // Restart Application
    document.getElementById('btn-restart').addEventListener('click', () => {
        socket.disconnect();
        if (state.timerInterval) clearInterval(state.timerInterval);
        resetApplicationState();
        showView('landing');
        socket.connect();
    });

    // Quick Guest / Tester Login
    const btnQuickGuest = document.getElementById('btn-quick-guest-login');
    if (btnQuickGuest) {
        btnQuickGuest.addEventListener('click', () => {
            btnQuickGuest.disabled = true;
            btnQuickGuest.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังเข้าสู่ระบบ...';
            triggerQuickGuestLogin(() => {
                btnQuickGuest.disabled = false;
                btnQuickGuest.innerHTML = '<i class="fa-solid fa-bolt" style="color: #fde047;"></i> เข้าใช้งานทันที (สำหรับทดสอบ / Guest)';
            });
        });
    }

    // Auth View Toggles
    const toggleLoginBtn = document.getElementById('auth-toggle-login');
    const toggleSignupBtn = document.getElementById('auth-toggle-signup');
    const viewLoginForm = document.getElementById('view-login-form');
    const viewSignupForm = document.getElementById('view-signup-form');

    toggleLoginBtn.addEventListener('click', () => {
        toggleLoginBtn.classList.add('active');
        toggleSignupBtn.classList.remove('active');
        viewLoginForm.classList.remove('hidden');
        viewSignupForm.classList.add('hidden');
    });

    toggleSignupBtn.addEventListener('click', () => {
        toggleSignupBtn.classList.add('active');
        toggleLoginBtn.classList.remove('active');
        viewSignupForm.classList.remove('hidden');
        viewLoginForm.classList.add('hidden');
    });

    // View Login Submit
    viewLoginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('view-login-username').value.trim();
        const password = document.getElementById('view-login-password').value;

        fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        })
            .then(res => {
                if (!res.ok) {
                    return res.json().then(data => { throw new Error(data.message || 'รหัสผ่านไม่ถูกต้อง'); });
                }
                return res.json();
            })
            .then(data => {
                state.currentUser = data;
                routeAfterAuth();
                alert('เข้าสู่ระบบสำเร็จ ยินดีต้อนรับ ' + data.displayName);
            })
            .catch(err => {
                alert(err.message || 'ไม่สามารถเข้าสู่ระบบได้');
            });
    });

    // View Signup Submit
    viewSignupForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('view-signup-username').value.trim();
        const password = document.getElementById('view-signup-password').value;
        const confirmPassword = document.getElementById('view-signup-confirm-password').value;
        const email = (document.getElementById('view-signup-email')?.value || '').trim();
        const securityQuestion = (document.getElementById('view-signup-question')?.value || '').trim();
        const securityAnswer = (document.getElementById('view-signup-answer')?.value || '').trim();
        const recoveryPin = (document.getElementById('view-signup-pin')?.value || '').trim();

        if (password !== confirmPassword) {
            alert('รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน');
            return;
        }

        fetch('/api/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                password,
                displayName: username,
                allergies: [],
                email,
                securityQuestion,
                securityAnswer,
                recoveryPin
            })
        })
            .then(res => {
                if (!res.ok) {
                    return res.json().then(data => { throw new Error(data.message || 'สมัครสมาชิกไม่สำเร็จ'); });
                }
                return res.json();
            })
            .then(data => {
                state.currentUser = data;
                routeAfterAuth();
                alert('ลงทะเบียนสำเร็จ! ยินดีต้อนรับ ' + data.displayName);
            })
            .catch(err => {
                alert(err.message || 'ไม่สามารถสมัครสมาชิกได้');
            });
    });
}

function updatePreferencesState() {
    const selectedTypes = [];
    document.querySelectorAll('.food-type-selector .type-pill.active').forEach(pill => {
        selectedTypes.push(pill.dataset.type);
    });

    const activeBudget = document.querySelector('.budget-selector .budget-pill.active');
    const minPrice = activeBudget ? parseInt(activeBudget.dataset.min) : 0;
    const maxPrice = activeBudget ? parseInt(activeBudget.dataset.max) : 9999;
    const maxDistance = parseFloat(document.getElementById('pref-distance').value);

    state.preferences = {
        minPrice: minPrice,
        maxPrice: maxPrice,
        maxDistance: maxDistance,
        foodTypes: selectedTypes
    };
}

// --- SOCKET EVENTS ---
socket.on('room_created', (data) => {
    state.roomId = data.roomId;
    if (data.networkUrl) state.networkBaseUrl = data.networkUrl;
    state.isCreator = true;

    // Host automatically joins their own room immediately
    socket.emit('join_room', {
        roomId: data.roomId,
        name: state.name,
        allergies: state.allergies
    });
});

socket.on('join_success', (data) => {
    state.userId = data.userId;
    state.roomId = data.roomId;
    state.isCreator = (data.creatorId === data.userId);

    showView('lobby');
    document.getElementById('lobby-room-id').innerText = data.roomId;

    // Draw QR Code using LAN IP so mobile cameras connect directly
    let baseUrl = window.location.origin;
    if ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && state.networkBaseUrl) {
        baseUrl = state.networkBaseUrl;
    }
    const joinUrl = `${baseUrl}/?roomId=${data.roomId}&autoJoin=1`;
    new QRious({
        element: document.getElementById('lobby-qr'),
        value: joinUrl,
        size: 200,
        background: '#ffffff',
        foreground: '#100923'
    });

    const qrHelp = document.querySelector('.qr-help');
    if (qrHelp) {
        qrHelp.innerHTML = `<i class="fa-solid fa-camera text-accent"></i> เปิดกล้องมือถือสแกน QR Code เพื่อเข้ากลุ่มได้ทันที!`;
    }
});

socket.on('join_error', (data) => {
    if (data.message && data.message.includes('ชื่อนี้มีผู้ใช้งาน') && state.targetRoomId) {
        // Auto resolve name duplicate by appending suffix
        state.name = `${state.name} (${Math.floor(10 + Math.random() * 90)})`;
        socket.emit('join_room', {
            roomId: state.targetRoomId,
            name: state.name,
            allergies: state.allergies
        });
        return;
    }
    alert(data.message);
    showView('landing');
});

socket.on('kicked', (data) => {
    alert('คุณถูกเตะออกจากห้องกลุ่ม');
    socket.disconnect();
    if (state.timerInterval) clearInterval(state.timerInterval);
    resetApplicationState();
    showView('landing');
    socket.connect();
});

socket.on('room_state', (data) => {
    state.users = data.users;

    // Automatically sync host status if host changed/migrated
    if (data.creatorId) {
        state.isCreator = (data.creatorId === state.userId || (socket && data.creatorId === socket.id));
    }

    // Update Member counts & list
    document.getElementById('member-count').innerText = data.users.length;

    const membersList = document.getElementById('members-list');
    membersList.innerHTML = '';

    data.users.forEach(user => {
        const isUserHost = user.id === data.creatorId;
        const isMe = user.id === state.userId;
        const row = document.createElement('div');
        row.className = 'member-row';

        let rightSideHtml = '';
        if (isUserHost) {
            rightSideHtml = '<span class="member-badge">Host</span>';
        } else {
            // It's a guest user
            if (state.isCreator) {
                // Show kick button for host to kick this guest
                rightSideHtml = `
                    <div class="member-right">
                        <span class="member-status ready"><i class="fa-solid fa-check"></i> พร้อม</span>
                        <button class="btn-kick" data-id="${user.id}" data-name="${user.name}" title="เตะออกจากห้อง">
                            <i class="fa-solid fa-user-minus"></i>
                        </button>
                    </div>
                `;
            } else {
                rightSideHtml = '<span class="member-status ready"><i class="fa-solid fa-check"></i> พร้อม</span>';
            }
        }

        let myNameHtml = user.name;
        if (isMe) {
            myNameHtml = `<span>${user.name} (คุณ)</span> <button class="btn-edit-my-name" style="background: none; border: none; color: var(--accent-orange); cursor: pointer; padding: 0.1rem 0.3rem; font-size: 0.85rem;" title="แก้ไขชื่อเล่นของคุณ"><i class="fa-solid fa-pen-to-square"></i></button>`;
        }

        row.innerHTML = `
            <div class="member-info">
                <div class="member-avatar">${user.name.charAt(0)}</div>
                <div>
                    <div class="member-name" style="display: flex; align-items: center; gap: 0.3rem;">${myNameHtml}</div>
                    ${user.allergies.length ? `<span class="member-status">แพ้: ${user.allergies.join(', ')}</span>` : ''}
                </div>
            </div>
            ${rightSideHtml}
        `;
        membersList.appendChild(row);

        if (isMe) {
            const editBtn = row.querySelector('.btn-edit-my-name');
            if (editBtn) {
                editBtn.addEventListener('click', () => {
                    const newName = prompt('แก้ไขชื่อเล่นที่คุณต้องการให้เพื่อนเห็นในห้อง:', user.name);
                    if (newName && newName.trim() && newName.trim() !== user.name) {
                        state.name = newName.trim();
                        socket.emit('update_member', {
                            roomId: state.roomId,
                            name: state.name
                        });
                    }
                });
            }
        }
    });

    // Attach kick event listeners
    if (state.isCreator) {
        membersList.querySelectorAll('.btn-kick').forEach(btn => {
            btn.addEventListener('click', () => {
                const userId = btn.dataset.id;
                const userName = btn.dataset.name;
                if (confirm(`คุณต้องการเตะคุณ ${userName} ออกจากห้องใช่หรือไม่?`)) {
                    socket.emit('kick_user', { roomId: state.roomId, userId: userId });
                }
            });
        });
    }

    // Control Start Button visibility
    const startBtn = document.getElementById('btn-start-game');
    const waitMsg = document.getElementById('host-wait-msg');

    if (state.isCreator) {
        startBtn.classList.remove('hidden');
        waitMsg.classList.add('hidden');
    } else {
        startBtn.classList.add('hidden');
        waitMsg.classList.remove('hidden');
    }
});

socket.on('game_started', (data) => {
    state.restaurants = data.restaurants;
    state.currentIndex = 0;
    state.votes = {};

    // Reset progress for all users locally
    state.users.forEach(user => {
        user.progress = 0;
    });
    updateGroupProgressWidget();

    showView('swipe');
    renderDeck();
    updateProgressBar();
});

socket.on('timer_update', (data) => {
    updateTimerUI(data.timeLeft);
});

socket.on('user_progress', (data) => {
    // Update progress of user in users state
    const user = state.users.find(u => u.id === data.userId);
    if (user) {
        user.progress = data.progress;
        updateGroupProgressWidget();
    }
});

socket.on('match_found', (data) => {
    const r = data.restaurant;
    const isFallback = data.isFallback;

    // Stop local timer animations
    clearInterval(state.timerInterval);

    // Wait 350ms for the swipe animation to finish before showing the results screen
    setTimeout(() => {
        // Play subtle celebratory confetti burst
        triggerConfettiExplosion();

        // Play celebratory sound & vibrations
        soundFx.playMatch();
        if (navigator.vibrate) navigator.vibrate([40, 60]);

        // Single gentle particle puff at center
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight * 0.35;
        spawnParticleBurst(centerX, centerY, 'heart');

        showView('result');

        const stamp = document.getElementById('result-stamp');
        const subtitle = document.getElementById('result-subtitle');
        const badgeEl = document.getElementById('match-consensus-badge');
        const percentEl = document.getElementById('match-consensus-percent');

        if (isFallback) {
            stamp.innerText = "DECIDED! 🎲";
            stamp.className = "match-stamp fallback animate-bounce";
            subtitle.innerHTML = `<i class="fa-solid fa-clock"></i> ${data.reason}`;
            if (badgeEl) badgeEl.style.display = 'none';
        } else {
            stamp.innerHTML = "<i class='fa-solid fa-heart'></i> MATCHED!";
            stamp.className = "match-stamp animate-bounce";
            subtitle.innerText = "ใจตรงกันเป็นมติเอกฉันท์! ทานให้อร่อยนะครับ";
            if (badgeEl) {
                badgeEl.style.display = 'inline-flex';
                animateCountUp(percentEl, 0, 100, 1200);
            }
        }

        const cardContainer = document.getElementById('matched-restaurant-card');

        if (r) {
            const distNum = (r.distance !== null && r.distance !== undefined) ? parseFloat(r.distance) : NaN;
            const distDisplay = !isNaN(distNum) ? `${distNum.toFixed(1)} กม.` : 'ไม่ระบุระยะทาง';

            cardContainer.innerHTML = `
                <div class="matched-image-wrapper">
                    <img src="${r.image}" alt="${r.name}" class="matched-image">
                </div>
                <div class="matched-details">
                <div class="matched-title-row">
                    <h2 class="matched-name">${r.name}</h2>
                    <div class="card-rating"><i class="fa-solid fa-star"></i> ${r.rating}</div>
                </div>
                <p class="matched-desc">${r.description}</p>
                <div class="matched-pills">
                    <span class="matched-pill"><i class="fa-solid fa-utensils"></i> ${Array.isArray(r.type) ? r.type.join(', ') : r.type}</span>
                    <span class="matched-pill"><i class="fa-solid fa-tag"></i> ~${r.avgPrice}฿ / คน</span>
                    <span class="matched-pill"><i class="fa-solid fa-location-arrow"></i> ${distDisplay}</span>
                </div>
                <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.4rem;">
                    <i class="fa-solid fa-map-marker-alt"></i> ${r.address}
                </p>
            </div>
        `;

        // Update Maps URL
        const mapsBtn = document.getElementById('btn-open-map');
        if (r.address && (r.address.startsWith('http://') || r.address.startsWith('https://'))) {
            mapsBtn.href = r.address;
        } else {
            mapsBtn.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name + ' ' + r.address)}`;
        }
        mapsBtn.classList.remove('hidden');
    } else {
        cardContainer.innerHTML = `
            <div class="matched-details" style="text-align: center; padding: 3rem 1rem;">
                <i class="fa-solid fa-face-frown text-accent" style="font-size: 3rem; margin-bottom: 1rem;"></i>
                <h2>ไม่พบร้านอาหารที่แมตช์</h2>
                <p class="matched-desc">ไม่มีร้านที่ตรงกับความต้องการและข้อจำกัดของทุกคนในกลุ่ม</p>
            </div>
        `;
        document.getElementById('btn-open-map').classList.add('hidden');
    }
    }, 350);
});

// --- RENDER DECK & CARDS ---
function renderDeck() {
    const deck = document.getElementById('swipe-deck');

    // Save empty state element
    const emptyStateHtml = deck.querySelector('.deck-empty-state').outerHTML;
    deck.innerHTML = emptyStateHtml;

    if (state.restaurants.length === 0) {
        return;
    }

    // Render cards backwards so the first restaurant is on top
    for (let i = state.restaurants.length - 1; i >= 0; i--) {
        const r = state.restaurants[i];
        const card = document.createElement('div');
        card.className = 'swipe-card';
        card.dataset.id = r.id;
        card.dataset.index = i;

        const distNum = (r.distance !== null && r.distance !== undefined) ? parseFloat(r.distance) : NaN;
        const distDisplay = !isNaN(distNum) ? `${distNum.toFixed(1)} กม.` : 'ไม่ระบุระยะทาง';

        card.innerHTML = `
            <div class="card-image-wrapper">
                <img src="${r.image}" class="card-image" alt="${r.name}">
                <div class="card-stamp card-stamp-like">อยากกิน</div>
                <div class="card-stamp card-stamp-dislike">ไม่กิน</div>
                <div class="card-info-badge"><i class="fa-solid fa-location-arrow"></i> ${distDisplay}</div>
            </div>
            <div class="card-details">
                <div class="card-title-row">
                    <span class="card-name">${r.name}</span>
                    <span class="card-rating"><i class="fa-solid fa-star"></i> ${r.rating}</span>
                </div>
                <div class="card-meta-row">
                    <span><i class="fa-solid fa-bowl-food"></i> ${Array.isArray(r.type) ? r.type.join(', ') : r.type}</span>
                    <span><i class="fa-solid fa-money-bill-wave"></i> ${r.priceRange} (~${r.avgPrice}฿)</span>
                </div>
                <p class="card-description">${r.description}</p>
            </div>
            
            <!-- Hidden info drawer slide up -->
            <div class="card-drawer">
                <div class="drawer-header">
                    <h3 class="drawer-title">ข้อมูลร้านอาหาร</h3>
                    <button class="btn-close-drawer"><i class="fa-solid fa-times"></i></button>
                </div>
                <div class="drawer-content">
                    <p><strong>ชื่อร้าน:</strong> ${r.name}</p>
                    <p><strong>ประเภท:</strong> ${Array.isArray(r.type) ? r.type.join(', ') : r.type}</p>
                    <p><strong>ราคาเฉลี่ยต่อคน:</strong> ~${r.avgPrice} บาท (${r.priceRange})</p>
                    <p><strong>ระยะทาง:</strong> ห่างออกไป ${r.distance} กิโลเมตร</p>
                    <p><strong>ที่ตั้ง:</strong> ${r.address}</p>
                    ${r.allergens.length ? `
                        <div>
                            <strong>สารก่อภูมิแพ้ในร้าน:</strong>
                            <div class="drawer-allergens">
                                ${r.allergens.map(a => `<span class="allergen-tag">${a}</span>`).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;

        deck.appendChild(card);
        setupCardGestures(card);
    }

    // Add close events for drawers
    deck.querySelectorAll('.btn-close-drawer').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const drawer = btn.closest('.card-drawer');
            drawer.classList.remove('open');
        });
    });
}

function updateProgressBar() {
    const total = state.restaurants.length;
    const remaining = total - state.currentIndex;
    document.getElementById('cards-remaining').innerText = Math.max(remaining, 0);
}

function updateGroupProgressWidget() {
    const widgetList = document.getElementById('group-progress-list');
    widgetList.innerHTML = '';

    const total = state.restaurants.length || 1;

    state.users.forEach(user => {
        const userProgress = user.progress || 0;
        const pct = Math.round((userProgress / total) * 100);
        const isFinished = userProgress >= total;

        let statusClass = '';
        if (isFinished) {
            statusClass = 'finished';
        } else if (userProgress > 0) {
            statusClass = 'active';
        }

        const card = document.createElement('div');
        card.className = 'progress-user-card';
        card.innerHTML = `
            <div class="progress-dot ${statusClass}"></div>
            <span class="progress-user-text">${user.name}</span>
            <span class="progress-user-val">${userProgress}/${total}</span>
        `;
        widgetList.appendChild(card);
    });
}

// --- POINTER SWIPE GESTURES ---
function setupCardGestures(card) {
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;
    let isDragging = false;

    const likeStamp = card.querySelector('.card-stamp-like');
    const dislikeStamp = card.querySelector('.card-stamp-dislike');

    card.addEventListener('pointerdown', (e) => {
        // Prevent action inside buttons or open drawer
        if (e.target.closest('.card-drawer') || e.target.closest('.btn-close-drawer')) {
            return;
        }

        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        card.classList.add('dragging');
        card.style.transition = 'none';
        try {
            card.setPointerCapture(e.pointerId);
        } catch (err) {}
    });

    card.addEventListener('pointermove', (e) => {
        if (!isDragging) return;

        currentX = e.clientX;
        currentY = e.clientY;

        const dX = currentX - startX;
        const dY = currentY - startY;

        // Calculate rotation based on horizontal movement
        const rotate = dX / 15;

        // Apply transform
        card.style.transform = `translate3d(${dX}px, ${dY}px, 0) rotate(${rotate}deg)`;

        // Fade in Stamps
        if (dX > 20) { // dragging right
            likeStamp.style.opacity = Math.min((dX - 20) / 100, 0.9);
            dislikeStamp.style.opacity = 0;
        } else if (dX < -20) { // dragging left
            dislikeStamp.style.opacity = Math.min((-dX - 20) / 100, 0.9);
            likeStamp.style.opacity = 0;
        } else {
            likeStamp.style.opacity = 0;
            dislikeStamp.style.opacity = 0;
        }
    });

    const handlePointerEnd = (e) => {
        if (!isDragging) return;
        isDragging = false;
        card.classList.remove('dragging');

        const dX = currentX - startX;
        const dY = currentY - startY;
        const threshold = 120; // threshold for a swipe

        if (e.type !== 'pointercancel' && dX > threshold) {
            // Swipe right (Like)
            executeSwipeAction(card, 'right', dX, dY);
        } else if (e.type !== 'pointercancel' && dX < -threshold) {
            // Swipe left (Dislike)
            executeSwipeAction(card, 'left', dX, dY);
        } else {
            // Snap back
            card.style.transition = 'transform 0.2s ease-out';
            card.style.transform = '';
            likeStamp.style.opacity = 0;
            dislikeStamp.style.opacity = 0;
        }

        try {
            card.releasePointerCapture(e.pointerId);
        } catch (err) {}
    };

    card.addEventListener('pointerup', handlePointerEnd);
    card.addEventListener('pointercancel', handlePointerEnd);
}

function executeSwipeAction(card, direction, dX = 150, dY = 0) {
    // Prevent double swiping
    if (card.classList.contains('swiped')) {
        return;
    }
    card.classList.add('swiped');

    // Audio & Haptic feedback + Particles
    if (direction === 'right') {
        soundFx.playLike();
        if (navigator.vibrate) navigator.vibrate([15, 30, 20]);
        // Trigger celebratory particles from card position
        const rect = card.getBoundingClientRect();
        const burstX = rect.left + rect.width / 2;
        const burstY = rect.top + rect.height * 0.35;
        spawnParticleBurst(burstX, burstY, 'heart');
    } else {
        soundFx.playPass();
        if (navigator.vibrate) navigator.vibrate(10);
    }

    // Animation out
    const rotate = dX / 15;
    const flyX = direction === 'right' ? window.innerWidth + 200 : -window.innerWidth - 200;

    card.style.transition = 'transform 0.3s ease-in, opacity 0.3s ease-in';
    card.style.transform = `translate3d(${flyX}px, ${dY * 2}px, 0) rotate(${rotate}deg)`;
    card.style.opacity = 0;

    // Smoothly scale up the next card in deck
    const nextCard = card.previousElementSibling;
    if (nextCard && nextCard.classList.contains('swipe-card')) {
        nextCard.style.transition = 'transform 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease';
        nextCard.style.transform = 'translate3d(0, 0, 0) scale(1)';
        nextCard.style.opacity = 1;
    }

    const rId = card.dataset.id;

    // Register vote
    state.votes[rId] = direction;
    state.currentIndex++;

    // Submit swipe to backend server
    socket.emit('submit_swipe', {
        roomId: state.roomId,
        restaurantId: rId,
        direction: direction === 'right' ? 'like' : 'dislike',
        progress: state.currentIndex
    });

    updateProgressBar();

    setTimeout(() => {
        card.remove();
    }, 300);
}

function swipeTopCard(direction) {
    const cards = document.querySelectorAll('.swipe-card:not(.swiped)');
    if (cards.length > 0) {
        const topCard = cards[cards.length - 1];
        executeSwipeAction(topCard, direction, direction === 'right' ? 200 : -200);
    }
}

function toggleTopCardDrawer() {
    const cards = document.querySelectorAll('.swipe-card');
    if (cards.length > 0) {
        const topCard = cards[cards.length - 1];
        const drawer = topCard.querySelector('.card-drawer');
        drawer.classList.toggle('open');
    }
}

// --- TIMER UI ---
function updateTimerUI(timeLeft) {
    const timerText = document.getElementById('timer-text');
    const timerBar = document.getElementById('timer-bar');

    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    timerText.innerText = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    // Calculate progress (Max 180 seconds)
    const progress = (timeLeft / 180) * 283;
    timerBar.style.strokeDashoffset = 283 - progress;

    // Color alert phases
    if (timeLeft <= 10) {
        timerBar.className = 'timer-progress danger';
    } else if (timeLeft <= 30) {
        timerBar.className = 'timer-progress warning';
    } else {
        timerBar.className = 'timer-progress';
    }
}

// --- CELEBRATORY CONFETTI (SUBTLE & REFINED) ---
function triggerConfettiExplosion() {
    if (typeof confetti !== 'function') return;

    // Single graceful, soft burst centered on the result area
    confetti({
        particleCount: 24,
        spread: 55,
        origin: { y: 0.62 },
        colors: ['#FF3377', '#EE7816', '#3284FF', '#00FF26'],
        ticks: 100,
        gravity: 0.95,
        scalar: 0.8,
        shapes: ['circle', 'square'],
        disableForReducedMotion: true
    });
}

// --- QR SCANNER FUNCTIONALITY ---
let html5QrCode = null;

function startQRScanner() {
    const qrModal = document.getElementById('qr-scanner-modal');
    qrModal.classList.remove('hidden');

    html5QrCode = new Html5Qrcode("qr-reader");

    const qrCodeSuccessCallback = (decodedText, decodedResult) => {
        console.log(`QR Code Scanned: ${decodedText}`);
        let roomId = null;
        try {
            const url = new URL(decodedText);
            roomId = url.searchParams.get("roomId");
        } catch (e) {
            // If not a URL, check if raw 4-character alphanumeric code
            if (/^[A-Z0-9]{4}$/i.test(decodedText.trim())) {
                roomId = decodedText.trim().toUpperCase();
            }
        }

        if (roomId) {
            stopQRScanner();
            // Fill Room ID and redirect to join config
            showView('join');
            document.getElementById('join-room-id').value = roomId;
        } else {
            alert("QR Code ไม่ถูกต้อง สำหรับเข้าร่วมห้อง GINDER");
        }
    };

    const config = { fps: 10, qrbox: { width: 220, height: 220 } };

    // Start scanning using the back/environment camera
    html5QrCode.start({ facingMode: "environment" }, config, qrCodeSuccessCallback)
        .catch(err => {
            console.warn("Back camera failed, trying front camera...", err);
            // Fallback to front camera or default camera
            html5QrCode.start({ facingMode: "user" }, config, qrCodeSuccessCallback)
                .catch(err2 => {
                    alert("ไม่สามารถเข้าถึงกล้องถ่ายภาพได้: " + err2);
                    stopQRScanner();
                });
        });
}

function stopQRScanner() {
    const qrModal = document.getElementById('qr-scanner-modal');
    qrModal.classList.add('hidden');

    if (html5QrCode) {
        if (html5QrCode.isScanning) {
            html5QrCode.stop().then(() => {
                html5QrCode.clear();
                html5QrCode = null;
            }).catch(err => {
                console.error("Failed to stop QR scanner camera thread", err);
            });
        } else {
            html5QrCode = null;
        }
    }
}

// --- AUTHENTICATION & PROFILE LOGIC ---
state.currentUser = null;

function routeAfterAuth() {
    updateHeaderUI();
    prefillUserPreferences();
    if (state.targetRoomId) {
        // Scanned QR code with native phone camera -> Auto join group immediately!
        attemptAutoJoinRoom();
    } else if (views.auth.classList.contains('active')) {
        showView('landing');
    }
}

function attemptAutoJoinRoom() {
    if (!state.targetRoomId) return;

    let displayName = (state.currentUser && state.currentUser.displayName) 
        ? state.currentUser.displayName 
        : `เพื่อนนักชิม ${Math.floor(100 + Math.random() * 900)}`;
    const userAllergies = (state.currentUser && state.currentUser.allergies) 
        ? state.currentUser.allergies 
        : [];

    state.name = displayName;
    state.allergies = userAllergies;

    showView('lobby');
    document.getElementById('lobby-room-id').innerText = state.targetRoomId;
    const membersList = document.getElementById('members-list');
    if (membersList) {
        membersList.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 2.5rem 0;"><i class="fa-solid fa-spinner fa-spin text-accent" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block;"></i>กำลังเชื่อมต่อเข้าห้องกลุ่มอัตโนมัติ...</div>';
    }

    const emitJoin = () => {
        socket.emit('join_room', {
            roomId: state.targetRoomId,
            name: state.name,
            allergies: state.allergies
        });
    };

    if (socket.connected) {
        emitJoin();
    } else {
        socket.once('connect', emitJoin);
    }
}

function triggerQuickGuestLogin(callback) {
    fetch('/api/guest-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
        .then(res => res.json())
        .then(data => {
            if (callback) callback();
            if (data.logged_in) {
                state.currentUser = data;
                if (data.networkBaseUrl) state.networkBaseUrl = data.networkBaseUrl;
                routeAfterAuth();
            } else {
                showView('auth');
            }
        })
        .catch(err => {
            if (callback) callback();
            console.error("Guest login failed:", err);
            showView('auth');
        });
}

function checkCurrentUser() {
    fetch('/api/me')
        .then(res => res.json())
        .then(data => {
            if (data.logged_in) {
                state.currentUser = data;
                if (data.networkBaseUrl) state.networkBaseUrl = data.networkBaseUrl;
                routeAfterAuth();
            } else {
                // If user was invited via link/QR with roomId, auto-login immediately
                if (state.targetRoomId) {
                    triggerQuickGuestLogin();
                } else {
                    state.currentUser = null;
                    showView('auth');
                    updateHeaderUI();
                }
            }
        })
        .catch(err => {
            console.error("Error checking auth status:", err);
            triggerQuickGuestLogin();
        });
}

function updateHeaderUI() {
    const profileContainer = document.getElementById('user-header-profile');
    if (!profileContainer) return;

    if (state.currentUser) {
        let adminBtn = '';
        if (state.currentUser.role === 'admin') {
            adminBtn = `<a href="/admin" target="_blank" class="btn btn-primary btn-sm" style="padding: 0.35rem 0.6rem; font-size: 0.75rem; border-radius: var(--border-radius-sm); margin-right: 0.5rem; color: #fff; text-decoration: none;"><i class="fa-solid fa-crown"></i> จัดการระบบ</a>`;
        }

        profileContainer.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                ${adminBtn}
                <div id="btn-header-profile" class="profile-info-badge" style="background: var(--glass-bg); border: 1px solid var(--glass-border); padding: 0.3rem 0.7rem; border-radius: 20px; font-size: 0.8rem; font-weight: 500; display: flex; align-items: center; gap: 0.4rem; cursor: pointer; transition: background 0.2s;" title="คลิกเพื่อจัดการโปรไฟล์">
                    <i class="fa-solid fa-user-circle text-accent"></i>
                    <span>${state.currentUser.displayName}</span>
                    <i class="fa-solid fa-chevron-down" style="font-size: 0.65rem; opacity: 0.6;"></i>
                </div>
                <button id="btn-logout" class="btn btn-secondary btn-sm" style="padding: 0.35rem; font-size: 0.75rem; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.04); border: 1px solid var(--glass-border); color: var(--text-primary); cursor: pointer;" title="ออกจากระบบ">
                    <i class="fa-solid fa-sign-out-alt"></i>
                </button>
            </div>
        `;

        // Bind profile modal trigger
        const profileBtn = document.getElementById('btn-header-profile');
        if (profileBtn) {
            profileBtn.addEventListener('click', () => {
                openProfileModal();
            });
        }

        // Bind logout button
        document.getElementById('btn-logout').addEventListener('click', () => {
            if (confirm('คุณต้องการออกจากระบบใช่หรือไม่?')) {
                fetch('/api/logout', { method: 'POST' })
                    .then(res => res.json())
                    .then(() => {
                        state.currentUser = null;
                        updateHeaderUI();
                        // Clear prefilled fields
                        document.getElementById('pref-name').value = '';
                        document.getElementById('join-name').value = '';
                        document.querySelectorAll('.allergy-selector .allergy-pill').forEach(p => p.classList.remove('active'));
                        alert('ออกจากระบบแล้ว');
                        showView('auth');
                    });
            }
        });
    } else {
        profileContainer.innerHTML = '';
    }
}

// --- PROFILE & FEEDBACK CONTROLS ---
function setupProfileAndFeedback() {
    const profileModal = document.getElementById('modal-profile');
    const closeProfileBtn = document.getElementById('btn-close-profile-modal');
    const tabInfoBtn = document.getElementById('tab-profile-info');
    const tabPasswordBtn = document.getElementById('tab-profile-password');
    const tabHistoryBtn = document.getElementById('tab-profile-history');
    const tabSecurityBtn = document.getElementById('tab-profile-security');
    const paneInfo = document.getElementById('tab-pane-profile-info');
    const panePassword = document.getElementById('tab-pane-profile-password');
    const paneHistory = document.getElementById('tab-pane-profile-history');
    const paneSecurity = document.getElementById('tab-pane-profile-security');

    if (closeProfileBtn && profileModal) {
        closeProfileBtn.addEventListener('click', () => {
            profileModal.classList.remove('active');
        });
        profileModal.addEventListener('click', (e) => {
            if (e.target === profileModal) profileModal.classList.remove('active');
        });
    }

    function activateProfileTab(activeBtn, activePane) {
        [tabInfoBtn, tabPasswordBtn, tabHistoryBtn, tabSecurityBtn].forEach(b => {
            if (b) {
                b.classList.remove('btn-primary', 'active');
                b.classList.add('btn-secondary');
            }
        });
        [paneInfo, panePassword, paneHistory, paneSecurity].forEach(p => {
            if (p) p.classList.add('hidden');
        });

        if (activeBtn) {
            activeBtn.classList.add('btn-primary', 'active');
            activeBtn.classList.remove('btn-secondary');
        }
        if (activePane) activePane.classList.remove('hidden');
    }

    if (tabInfoBtn) tabInfoBtn.addEventListener('click', () => activateProfileTab(tabInfoBtn, paneInfo));
    if (tabPasswordBtn) tabPasswordBtn.addEventListener('click', () => activateProfileTab(tabPasswordBtn, panePassword));
    if (tabHistoryBtn) tabHistoryBtn.addEventListener('click', () => {
        activateProfileTab(tabHistoryBtn, paneHistory);
        loadMatchHistory();
    });
    if (tabSecurityBtn) tabSecurityBtn.addEventListener('click', () => {
        activateProfileTab(tabSecurityBtn, paneSecurity);
        loadUserSecuritySettings();
    });

    function loadUserSecuritySettings() {
        fetch('/api/user/security')
            .then(res => res.json())
            .then(data => {
                const emailInput = document.getElementById('profile-recovery-email');
                const questionSelect = document.getElementById('profile-recovery-question');
                const answerInput = document.getElementById('profile-recovery-answer');
                const pinInput = document.getElementById('profile-recovery-pin');
                if (emailInput) emailInput.value = data.email || '';
                if (questionSelect && data.securityQuestion) questionSelect.value = data.securityQuestion;
                if (answerInput) {
                    answerInput.value = '';
                    answerInput.placeholder = data.hasAnswer ? '●●●●●●●● (ตั้งค่าไว้แล้ว พิมพ์ใหม่เพื่อเปลี่ยน)' : 'พิมพ์คำตอบใหม่ที่จำได้ง่าย';
                }
                if (pinInput) {
                    pinInput.value = '';
                    pinInput.placeholder = data.hasPin ? '•••• (ตั้งค่าไว้แล้ว พิมพ์ใหม่เพื่อเปลี่ยน)' : 'เช่น 1234 หรือ 987654';
                }
            })
            .catch(err => console.error('Failed to load user security:', err));
    }

    // Update Security Form Submit
    const formSecurity = document.getElementById('form-update-security');
    if (formSecurity) {
        formSecurity.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = (document.getElementById('profile-recovery-email')?.value || '').trim();
            const securityQuestion = (document.getElementById('profile-recovery-question')?.value || '').trim();
            const securityAnswer = (document.getElementById('profile-recovery-answer')?.value || '').trim();
            const recoveryPin = (document.getElementById('profile-recovery-pin')?.value || '').trim();

            fetch('/api/user/security', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, securityQuestion, securityAnswer, recoveryPin })
            })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        alert(data.message || 'บันทึกข้อมูลความปลอดภัยเรียบร้อยแล้ว');
                        loadUserSecuritySettings();
                    } else {
                        alert(data.message || 'บันทึกข้อมูลไม่สำเร็จ');
                    }
                })
                .catch(err => alert('เกิดข้อผิดพลาด: ' + err.message));
        });
    }

    // Update Profile Form Submit
    const formProfile = document.getElementById('form-update-profile');
    if (formProfile) {
        formProfile.addEventListener('submit', (e) => {
            e.preventDefault();
            const displayName = document.getElementById('profile-display-name').value.trim();
            if (!displayName) return;

            fetch('/api/user/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayName })
            })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        state.currentUser.displayName = data.displayName;
                        updateHeaderUI();
                        prefillUserPreferences();
                        alert('บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว');
                        if (profileModal) profileModal.classList.remove('active');
                    } else {
                        alert(data.message || 'บันทึกข้อมูลไม่สำเร็จ');
                    }
                })
                .catch(err => alert('เกิดข้อผิดพลาด: ' + err.message));
        });
    }

    // Update Password Form Submit
    const formPassword = document.getElementById('form-update-password');
    if (formPassword) {
        formPassword.addEventListener('submit', (e) => {
            e.preventDefault();
            const currentPassword = document.getElementById('profile-current-password').value;
            const newPassword = document.getElementById('profile-new-password').value;
            const confirmPassword = document.getElementById('profile-confirm-password').value;

            if (newPassword !== confirmPassword) {
                alert('รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน');
                return;
            }

            fetch('/api/user/password', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newPassword })
            })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        alert('เปลี่ยนรหัสผ่านสำเร็จเรียบร้อย');
                        formPassword.reset();
                        if (profileModal) profileModal.classList.remove('active');
                    } else {
                        alert(data.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ');
                    }
                })
                .catch(err => alert('เกิดข้อผิดพลาด: ' + err.message));
        });
    }

    // Feedback Modal
    const feedbackModal = document.getElementById('modal-feedback');
    const openFeedbackBtn = document.getElementById('btn-open-feedback');
    const closeFeedbackBtn = document.getElementById('btn-close-feedback-modal');
    const formFeedback = document.getElementById('form-feedback');

    if (openFeedbackBtn && feedbackModal) {
        openFeedbackBtn.addEventListener('click', () => {
            feedbackModal.classList.add('active');
        });
    }

    if (closeFeedbackBtn && feedbackModal) {
        closeFeedbackBtn.addEventListener('click', () => {
            feedbackModal.classList.remove('active');
        });
        feedbackModal.addEventListener('click', (e) => {
            if (e.target === feedbackModal) feedbackModal.classList.remove('active');
        });
    }

    if (formFeedback) {
        formFeedback.addEventListener('submit', (e) => {
            e.preventDefault();
            const type = document.getElementById('feedback-type').value;
            const title = document.getElementById('feedback-title').value.trim();
            const description = document.getElementById('feedback-desc').value.trim();
            const contactInfo = document.getElementById('feedback-contact').value.trim();

            fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, title, description, contactInfo })
            })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        alert(data.message);
                        formFeedback.reset();
                        if (feedbackModal) feedbackModal.classList.remove('active');
                    } else {
                        alert(data.message || 'ส่งข้อความไม่สำเร็จ');
                    }
                })
                .catch(err => alert('เกิดข้อผิดพลาด: ' + err.message));
        });
    }
}

function openProfileModal() {
    if (!state.currentUser) return;
    const modal = document.getElementById('modal-profile');
    if (!modal) return;
    document.getElementById('profile-username').value = state.currentUser.username || '';
    document.getElementById('profile-display-name').value = state.currentUser.displayName || '';

    // Switch to info tab by default
    const tabInfo = document.getElementById('tab-profile-info');
    if (tabInfo) tabInfo.click();
    modal.classList.add('active');
}

function loadMatchHistory() {
    const listContainer = document.getElementById('profile-history-list');
    if (!listContainer) return;
    listContainer.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 1.5rem 0;"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลดประวัติ...</div>';

    fetch('/api/user/history')
        .then(res => res.json())
        .then(list => {
            if (!list || list.length === 0) {
                listContainer.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 2rem 0;">ยังไม่มีประวัติการแมตช์ร้านอาหาร</div>';
                return;
            }

            listContainer.innerHTML = '';
            list.forEach(item => {
                const r = item.restaurant || {};
                const dateStr = item.matchedAt ? new Date(item.matchedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '';
                const card = document.createElement('div');
                card.style.cssText = 'background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); border-radius: 12px; padding: 0.8rem; display: flex; gap: 0.8rem; align-items: center;';
                card.innerHTML = `
                    <img src="${r.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100'}" style="width: 55px; height: 55px; object-fit: cover; border-radius: 8px; flex-shrink: 0;" onerror="this.src='https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100'">
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 600; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${r.name || 'ไม่ระบุชื่อร้าน'}</div>
                        <div style="font-size: 0.75rem; color: var(--text-secondary); margin: 0.15rem 0;">
                            <span class="text-accent"><i class="fa-solid fa-star"></i> ${r.rating || '-'}</span> • <span>~${r.avgPrice || '-'}฿/คน</span> • <span>ห้อง: ${item.roomId || '-'}</span>
                        </div>
                        <div style="font-size: 0.7rem; color: var(--text-muted);">${dateStr}</div>
                    </div>
                `;
                listContainer.appendChild(card);
            });
        })
        .catch(err => {
            listContainer.innerHTML = '<div style="text-align: center; color: var(--accent-red); padding: 1rem 0;">ไม่สามารถโหลดประวัติได้</div>';
        });
}

function prefillUserPreferences() {
    if (!state.currentUser) return;

    // Fill host config name
    const prefNameInput = document.getElementById('pref-name');
    if (prefNameInput) prefNameInput.value = state.currentUser.displayName;

    // Fill guest join config name
    const joinNameInput = document.getElementById('join-name');
    if (joinNameInput) joinNameInput.value = state.currentUser.displayName;

    // Fill allergy selections
    const userAllergies = state.currentUser.allergies || [];

    // Prefill both host & join allergy selectors
    const selectors = ['.host-allergy-selector', '#view-join .allergy-selector'];
    selectors.forEach(selectorPath => {
        const selector = document.querySelector(selectorPath);
        if (selector) {
            selector.querySelectorAll('.allergy-pill').forEach(pill => {
                const allergen = pill.dataset.allergen;
                if (userAllergies.includes(allergen)) {
                    pill.classList.add('active');
                } else {
                    pill.classList.remove('active');
                }
            });
        }
    });
}

// Modal actions
const authModal = document.getElementById('auth-modal');
const btnCloseAuth = document.getElementById('btn-close-auth');
const tabLogin = document.getElementById('tab-login');
const tabSignup = document.getElementById('tab-signup');
const loginForm = document.getElementById('auth-login-form');
const signupForm = document.getElementById('auth-signup-form');
const modalTitleText = document.querySelector('#auth-modal-title span');

function openAuthModal() {
    authModal.classList.remove('hidden');
    switchAuthTab('login');
}

function closeAuthModal() {
    authModal.classList.add('hidden');
    loginForm.reset();
    signupForm.reset();
    document.querySelectorAll('.signup-allergy-selector .allergy-pill').forEach(p => p.classList.remove('active'));
}

function switchAuthTab(tab) {
    if (tab === 'login') {
        tabLogin.classList.add('active');
        tabLogin.style.color = 'var(--text-primary)';
        tabSignup.classList.remove('active');
        tabSignup.style.color = 'var(--text-muted)';
        loginForm.classList.remove('hidden');
        signupForm.classList.add('hidden');
        modalTitleText.innerText = 'เข้าสู่ระบบ';
    } else {
        tabSignup.classList.add('active');
        tabSignup.style.color = 'var(--text-primary)';
        tabLogin.classList.remove('active');
        tabLogin.style.color = 'var(--text-muted)';
        signupForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
        modalTitleText.innerText = 'สมัครสมาชิกใหม่';
    }
}

// Bind auth modal triggers
if (btnCloseAuth) btnCloseAuth.addEventListener('click', closeAuthModal);
if (tabLogin) tabLogin.addEventListener('click', () => switchAuthTab('login'));
if (tabSignup) tabSignup.addEventListener('click', () => switchAuthTab('signup'));

// Handle allergy selector inside signup form
document.querySelectorAll('.signup-allergy-selector .allergy-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        pill.classList.toggle('active');
    });
});

// Login Form Submit
if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;

        fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        })
            .then(res => {
                if (!res.ok) {
                    return res.json().then(data => { throw new Error(data.message || 'รหัสผ่านไม่ถูกต้อง'); });
                }
                return res.json();
            })
            .then(data => {
                state.currentUser = data;
                updateHeaderUI();
                prefillUserPreferences();
                closeAuthModal();
                alert('เข้าสู่ระบบสำเร็จ ยินดีต้อนรับ ' + data.displayName);
            })
            .catch(err => {
                alert(err.message || 'ไม่สามารถเข้าสู่ระบบได้');
            });
    });
}

// Signup Form Submit
if (signupForm) {
    signupForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('signup-username').value.trim();
        const password = document.getElementById('signup-password').value;
        const displayName = username;
        const email = (document.getElementById('signup-email')?.value || '').trim();
        const securityQuestion = (document.getElementById('signup-question')?.value || '').trim();
        const securityAnswer = (document.getElementById('signup-answer')?.value || '').trim();
        const recoveryPin = (document.getElementById('signup-pin')?.value || '').trim();

        // Get allergy tags selected in signup form
        const checkedAllergens = [];
        document.querySelectorAll('.signup-allergy-selector .allergy-pill.active').forEach(pill => {
            checkedAllergens.push(pill.dataset.allergen);
        });

        fetch('/api/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                password,
                displayName,
                allergies: checkedAllergens,
                email,
                securityQuestion,
                securityAnswer,
                recoveryPin
            })
        })
            .then(res => {
                if (!res.ok) {
                    return res.json().then(data => { throw new Error(data.message || 'สมัครสมาชิกไม่สำเร็จ'); });
                }
                return res.json();
            })
            .then(data => {
                state.currentUser = data;
                updateHeaderUI();
                prefillUserPreferences();
                closeAuthModal();
                alert('ลงทะเบียนสำเร็จ! ยินดีต้อนรับ ' + data.displayName);
            })
            .catch(err => {
                alert(err.message || 'ไม่สามารถสมัครสมาชิกได้');
            });
    });
};


function requestUserLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                state.userLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                console.log("User location acquired:", state.userLocation);
            },
            (error) => {
                console.warn("User location retrieval failed:", error);
            },
            { timeout: 8000 }
        );
    }
}

function calculateHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the Earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c;
}

// --- FORGOT PASSWORD MODAL CONTROLS (METHODS 2 & 3) ---
function setupForgotPasswordModal() {
    const forgotModal = document.getElementById('modal-forgot-password');
    const closeForgotBtn = document.getElementById('btn-close-forgot-modal');
    const tabQuestionBtn = document.getElementById('tab-forgot-question');
    const tabEmailBtn = document.getElementById('tab-forgot-email');
    const paneQuestion = document.getElementById('pane-forgot-question');
    const paneEmail = document.getElementById('pane-forgot-email');

    // Step containers
    const qStep1 = document.getElementById('forgot-q-step-1');
    const qStep2 = document.getElementById('forgot-q-step-2');
    const eStep1 = document.getElementById('forgot-e-step-1');
    const eStep2 = document.getElementById('forgot-e-step-2');

    let currentForgotUsername = '';

    function openForgotModal() {
        if (!forgotModal) return;
        // Prefill username from active login inputs if available
        const currentLoginUser = document.getElementById('view-login-username')?.value.trim() ||
            document.getElementById('login-username')?.value.trim() || '';

        const qUserInput = document.getElementById('forgot-q-username');
        const eUserInput = document.getElementById('forgot-e-input');
        if (qUserInput) qUserInput.value = currentLoginUser;
        if (eUserInput) eUserInput.value = currentLoginUser;

        // Reset steps
        if (qStep1) qStep1.classList.remove('hidden');
        if (qStep2) qStep2.classList.add('hidden');
        if (eStep1) eStep1.classList.remove('hidden');
        if (eStep2) eStep2.classList.add('hidden');

        // Clear input fields
        ['forgot-q-answer', 'forgot-q-pin', 'forgot-q-new-password', 'forgot-q-confirm-password',
         'forgot-e-otp', 'forgot-e-new-password', 'forgot-e-confirm-password'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        // Switch to question tab by default
        switchForgotTab('question');

        forgotModal.classList.add('active');
    }

    function closeForgotModal() {
        if (forgotModal) forgotModal.classList.remove('active');
    }

    function switchForgotTab(tab) {
        if (tab === 'question') {
            if (tabQuestionBtn) {
                tabQuestionBtn.classList.add('active', 'btn-primary');
                tabQuestionBtn.classList.remove('btn-secondary');
            }
            if (tabEmailBtn) {
                tabEmailBtn.classList.remove('active', 'btn-primary');
                tabEmailBtn.classList.add('btn-secondary');
            }
            if (paneQuestion) paneQuestion.classList.remove('hidden');
            if (paneEmail) paneEmail.classList.add('hidden');
        } else {
            if (tabEmailBtn) {
                tabEmailBtn.classList.add('active', 'btn-primary');
                tabEmailBtn.classList.remove('btn-secondary');
            }
            if (tabQuestionBtn) {
                tabQuestionBtn.classList.remove('active', 'btn-primary');
                tabQuestionBtn.classList.add('btn-secondary');
            }
            if (paneEmail) paneEmail.classList.remove('hidden');
            if (paneQuestion) paneQuestion.classList.add('hidden');
        }
    }

    // Attach click triggers to all "ลืมรหัสผ่าน?" buttons
    document.querySelectorAll('.btn-trigger-forgot-pwd').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (typeof authModal !== 'undefined' && authModal && !authModal.classList.contains('hidden')) {
                authModal.classList.add('hidden');
            }
            openForgotModal();
        });
    });

    if (closeForgotBtn && forgotModal) {
        closeForgotBtn.addEventListener('click', closeForgotModal);
        forgotModal.addEventListener('click', (e) => {
            if (e.target === forgotModal) closeForgotModal();
        });
    }

    if (tabQuestionBtn) tabQuestionBtn.addEventListener('click', () => switchForgotTab('question'));
    if (tabEmailBtn) tabEmailBtn.addEventListener('click', () => switchForgotTab('email'));

    // TAB 1: Method 3 - Step 1 Check User
    const btnQCheck = document.getElementById('btn-forgot-q-check');
    if (btnQCheck) {
        btnQCheck.addEventListener('click', () => {
            const username = (document.getElementById('forgot-q-username')?.value || '').trim();
            if (!username) {
                alert('กรุณากรอกชื่อผู้ใช้');
                return;
            }

            btnQCheck.disabled = true;
            btnQCheck.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังตรวจสอบ...';

            fetch('/api/auth/forgot/check-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            })
                .then(res => res.json())
                .then(data => {
                    btnQCheck.disabled = false;
                    btnQCheck.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> ค้นหาบัญชี';

                    if (!data.success) {
                        alert(data.message || 'ไม่พบบัญชีผู้ใช้นี้');
                        return;
                    }

                    if (!data.hasSecurityQuestion && !data.hasPin) {
                        alert('บัญชีนี้ยังไม่ได้ตั้งคำถามลับหรือ PIN กู้คืนไว้\nระบบแนะนำให้ใช้แท็บ "รหัส OTP อีเมล" ในการกู้คืนแทน');
                        switchForgotTab('email');
                        const eInput = document.getElementById('forgot-e-input');
                        if (eInput) eInput.value = username;
                        return;
                    }

                    currentForgotUsername = data.username;
                    document.getElementById('forgot-q-user-display').innerText = `${data.displayName || data.username} (@${data.username})`;

                    const qWrapper = document.getElementById('forgot-q-question-wrapper');
                    const qText = document.getElementById('forgot-q-question-text');
                    const qAnsGroup = document.getElementById('group-forgot-q-answer');
                    const qPinGroup = document.getElementById('group-forgot-q-pin');

                    if (data.hasSecurityQuestion && data.securityQuestion) {
                        qText.innerText = data.securityQuestion;
                        if (qWrapper) qWrapper.style.display = 'block';
                        if (qAnsGroup) qAnsGroup.style.display = 'block';
                    } else {
                        if (qWrapper) qWrapper.style.display = 'none';
                        if (qAnsGroup) qAnsGroup.style.display = 'none';
                    }

                    if (data.hasPin) {
                        if (qPinGroup) qPinGroup.style.display = 'block';
                    } else {
                        if (qPinGroup) qPinGroup.style.display = 'none';
                    }

                    if (qStep1) qStep1.classList.add('hidden');
                    if (qStep2) qStep2.classList.remove('hidden');
                })
                .catch(err => {
                    btnQCheck.disabled = false;
                    btnQCheck.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> ค้นหาบัญชี';
                    alert('เกิดข้อผิดพลาด: ' + err.message);
                });
        });
    }

    // Step 2 Back
    const btnQBack = document.getElementById('btn-forgot-q-back');
    if (btnQBack) {
        btnQBack.addEventListener('click', () => {
            if (qStep2) qStep2.classList.add('hidden');
            if (qStep1) qStep1.classList.remove('hidden');
        });
    }

    // TAB 1: Method 3 - Step 2 Submit
    const btnQSubmit = document.getElementById('btn-forgot-q-submit');
    if (btnQSubmit) {
        btnQSubmit.addEventListener('click', () => {
            const securityAnswer = (document.getElementById('forgot-q-answer')?.value || '').trim();
            const recoveryPin = (document.getElementById('forgot-q-pin')?.value || '').trim();
            const newPassword = document.getElementById('forgot-q-new-password')?.value || '';
            const confirmPassword = document.getElementById('forgot-q-confirm-password')?.value || '';

            if (!securityAnswer && !recoveryPin) {
                alert('กรุณาตอบคำถามความปลอดภัย หรือกรอก Recovery PIN อย่างใดอย่างหนึ่ง');
                return;
            }

            if (!newPassword || newPassword.length < 4) {
                alert('รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 4 ตัวอักษร');
                return;
            }

            if (newPassword !== confirmPassword) {
                alert('รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน');
                return;
            }

            btnQSubmit.disabled = true;
            btnQSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังตรวจสอบและบันทึก...';

            fetch('/api/auth/forgot/verify-question', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: currentForgotUsername,
                    securityAnswer,
                    recoveryPin,
                    newPassword
                })
            })
                .then(res => res.json())
                .then(data => {
                    btnQSubmit.disabled = false;
                    btnQSubmit.innerHTML = '<i class="fa-solid fa-check"></i> บันทึกรหัสผ่านใหม่';

                    if (data.success) {
                        alert(data.message || 'ตั้งรหัสผ่านใหม่สำเร็จแล้ว สามารถเข้าสู่ระบบได้ทันที');
                        closeForgotModal();

                        // Prefill login input
                        const viewLogin = document.getElementById('view-login-username');
                        const modalLogin = document.getElementById('login-username');
                        if (viewLogin) viewLogin.value = currentForgotUsername;
                        if (modalLogin) modalLogin.value = currentForgotUsername;
                    } else {
                        alert(data.message || 'การยืนยันไม่ถูกต้อง');
                    }
                })
                .catch(err => {
                    btnQSubmit.disabled = false;
                    btnQSubmit.innerHTML = '<i class="fa-solid fa-check"></i> บันทึกรหัสผ่านใหม่';
                    alert('เกิดข้อผิดพลาด: ' + err.message);
                });
        });
    }

    // TAB 2: Method 2 - Step 1 Send Email OTP
    const btnESendOtp = document.getElementById('btn-forgot-e-send-otp');
    if (btnESendOtp) {
        btnESendOtp.addEventListener('click', () => {
            const inputVal = (document.getElementById('forgot-e-input')?.value || '').trim();
            if (!inputVal) {
                alert('กรุณากรอกชื่อผู้ใช้ หรืออีเมล');
                return;
            }

            btnESendOtp.disabled = true;
            btnESendOtp.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังส่งรหัส OTP...';

            fetch('/api/auth/forgot/send-email-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: inputVal })
            })
                .then(res => res.json())
                .then(data => {
                    btnESendOtp.disabled = false;
                    btnESendOtp.innerHTML = '<i class="fa-solid fa-paper-plane"></i> ส่งรหัส OTP ไปที่อีเมล';

                    if (data.success) {
                        currentForgotUsername = inputVal;
                        document.getElementById('forgot-e-masked-email').innerText = data.maskedEmail || inputVal;

                        if (eStep1) eStep1.classList.add('hidden');
                        if (eStep2) eStep2.classList.remove('hidden');

                        if (data.devMode && data.devOtp) {
                            alert(`${data.message}\n\n[Dev Mode] รหัส OTP สำหรับทดสอบคือ: ${data.devOtp}`);
                            const otpInput = document.getElementById('forgot-e-otp');
                            if (otpInput) otpInput.value = data.devOtp;
                        } else {
                            alert(data.message);
                        }
                    } else {
                        alert(data.message || 'ส่งรหัส OTP ไม่สำเร็จ');
                    }
                })
                .catch(err => {
                    btnESendOtp.disabled = false;
                    btnESendOtp.innerHTML = '<i class="fa-solid fa-paper-plane"></i> ส่งรหัส OTP ไปที่อีเมล';
                    alert('เกิดข้อผิดพลาด: ' + err.message);
                });
        });
    }

    // Step 2 Back (Email OTP)
    const btnEBack = document.getElementById('btn-forgot-e-back');
    if (btnEBack) {
        btnEBack.addEventListener('click', () => {
            if (eStep2) eStep2.classList.add('hidden');
            if (eStep1) eStep1.classList.remove('hidden');
        });
    }

    // TAB 2: Method 2 - Step 2 Verify OTP & Reset Password
    const btnESubmit = document.getElementById('btn-forgot-e-submit');
    if (btnESubmit) {
        btnESubmit.addEventListener('click', () => {
            const otp = (document.getElementById('forgot-e-otp')?.value || '').trim();
            const newPassword = document.getElementById('forgot-e-new-password')?.value || '';
            const confirmPassword = document.getElementById('forgot-e-confirm-password')?.value || '';

            if (!otp || otp.length !== 6) {
                alert('กรุณากรอกรหัส OTP 6 หลัก');
                return;
            }

            if (!newPassword || newPassword.length < 4) {
                alert('รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 4 ตัวอักษร');
                return;
            }

            if (newPassword !== confirmPassword) {
                alert('รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน');
                return;
            }

            btnESubmit.disabled = true;
            btnESubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังตรวจสอบรหัส OTP...';

            fetch('/api/auth/forgot/verify-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: currentForgotUsername,
                    otp,
                    newPassword
                })
            })
                .then(res => res.json())
                .then(data => {
                    btnESubmit.disabled = false;
                    btnESubmit.innerHTML = '<i class="fa-solid fa-check"></i> ยืนยันรหัสผ่านใหม่';

                    if (data.success) {
                        alert(data.message || 'ตั้งรหัสผ่านใหม่สำเร็จแล้ว สามารถเข้าสู่ระบบได้ทันที');
                        closeForgotModal();

                        const viewLogin = document.getElementById('view-login-username');
                        const modalLogin = document.getElementById('login-username');
                        if (viewLogin) viewLogin.value = currentForgotUsername;
                        if (modalLogin) modalLogin.value = currentForgotUsername;
                    } else {
                        alert(data.message || 'รหัส OTP ไม่ถูกต้อง');
                    }
                })
                .catch(err => {
                    btnESubmit.disabled = false;
                    btnESubmit.innerHTML = '<i class="fa-solid fa-check"></i> ยืนยันรหัสผ่านใหม่';
                    alert('เกิดข้อผิดพลาด: ' + err.message);
                });
        });
    }
}



