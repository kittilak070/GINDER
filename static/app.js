// Establish socket.io connection
const socket = io();

// Supabase Client for Real Google & Facebook OAuth
const supabaseClient = (typeof window.supabase !== 'undefined' && window.SUPABASE_URL && window.SUPABASE_ANON_KEY)
    ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
    : null;

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
    timerInterval: null,
    isSolo: false,
    soloLiked: [],
    comboCount: 0,
    comboTimer: null,
    swipeHistory: []
};

// --- SECURITY & SANITIZATION HELPERS (OWASP A03 Injection Prevention) ---
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// --- NON-BLOCKING TOAST NOTIFICATIONS (ERROR PREVENTION & USABILITY) ---
function showToast(message, type = 'info', duration = 3200) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let iconHtml = '<i class="fa-solid fa-circle-info toast-icon"></i>';
    if (type === 'success') iconHtml = '<i class="fa-solid fa-circle-check toast-icon"></i>';
    else if (type === 'error') iconHtml = '<i class="fa-solid fa-circle-exclamation toast-icon"></i>';
    else if (type === 'warning') iconHtml = '<i class="fa-solid fa-triangle-exclamation toast-icon"></i>';

    toast.innerHTML = `
        ${iconHtml}
        <span class="toast-msg">${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-hide');
        setTimeout(() => toast.remove(), 260);
    }, duration);
}

// Upgrade browser alert() to elegant non-blocking toasts across the app
window.alert = function(message) {
    let type = 'info';
    if (/ผิดพลาด|ไม่สำเร็จ|ไม่ถูกต้อง|ล้มเหลว|error|fail/i.test(message)) type = 'error';
    else if (/สำเร็จ|เรียบร้อย|success/i.test(message)) type = 'success';
    else if (/ระวัง|เตือน|กรุณา|โปรด/i.test(message)) type = 'warning';
    showToast(message, type);
};

// Upgrade browser confirm() to non-blocking toast
window.confirm = function(message) {
    showToast(message, 'info');
    return true;
};

// Upgrade browser prompt() to non-blocking toast
window.prompt = function(message, defaultVal) {
    showToast(message, 'info');
    return defaultVal || null;
};

// Custom non-blocking confirmation modal
function showCustomConfirm({
    title = 'ยืนยันการทำรายการ',
    message = 'คุณแน่ใจหรือไม่ที่จะดำเนินการต่อ?',
    confirmText = 'ยืนยัน',
    cancelText = 'ยกเลิก',
    type = 'danger', // 'danger' | 'warning' | 'info'
    icon = 'fa-triangle-exclamation',
    onConfirm,
    onCancel
} = {}) {
    return new Promise((resolve) => {
        let overlay = document.getElementById('custom-confirm-modal');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'custom-confirm-modal';
            overlay.className = 'modal-backdrop';
            overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.68); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: none; align-items: center; justify-content: center; z-index: 100000; opacity: 0; transition: opacity 0.25s ease;';
            overlay.innerHTML = `
                <div class="custom-confirm-card" style="background: var(--bg-card, #1e2029); border: 1px solid var(--border-glass, rgba(255,255,255,0.12)); border-radius: 22px; padding: 2rem; width: 90%; max-width: 420px; box-shadow: 0 25px 60px rgba(0,0,0,0.6); transform: scale(0.92); transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); text-align: center; color: #fff;">
                    <div id="custom-confirm-icon-box" style="width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.6rem; margin: 0 auto 1.2rem auto;">
                        <i id="custom-confirm-icon" class="fa-solid fa-triangle-exclamation"></i>
                    </div>
                    <h3 id="custom-confirm-title" style="margin: 0 0 0.6rem 0; font-size: 1.25rem; font-weight: 700; color: #fff;"></h3>
                    <p id="custom-confirm-message" style="color: var(--text-secondary, #94a3b8); font-size: 0.95rem; line-height: 1.55; margin: 0 0 1.6rem 0;"></p>
                    <div style="display: flex; gap: 0.8rem; justify-content: center;">
                        <button id="custom-confirm-cancel" class="btn btn-secondary" style="padding: 0.7rem 1.4rem; border-radius: 12px; cursor: pointer; flex: 1; font-weight: 600;">ยกเลิก</button>
                        <button id="custom-confirm-ok" class="btn" style="padding: 0.7rem 1.5rem; border-radius: 12px; cursor: pointer; flex: 1; font-weight: 600;">ยืนยัน</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
        }

        const iconBox = overlay.querySelector('#custom-confirm-icon-box');
        const iconEl = overlay.querySelector('#custom-confirm-icon');
        const titleEl = overlay.querySelector('#custom-confirm-title');
        const msgEl = overlay.querySelector('#custom-confirm-message');
        const btnCancel = overlay.querySelector('#custom-confirm-cancel');
        const btnOk = overlay.querySelector('#custom-confirm-ok');

        titleEl.textContent = title;
        msgEl.textContent = message;
        btnCancel.textContent = cancelText;
        btnOk.textContent = confirmText;

        // Theme icon and confirm button based on type
        iconEl.className = `fa-solid ${icon}`;
        if (type === 'danger') {
            iconBox.style.background = 'rgba(239, 68, 68, 0.16)';
            iconBox.style.color = '#ef4444';
            btnOk.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
            btnOk.style.color = '#fff';
            btnOk.style.border = 'none';
            btnOk.style.boxShadow = '0 4px 15px rgba(239, 68, 68, 0.35)';
        } else if (type === 'warning') {
            iconBox.style.background = 'rgba(245, 158, 11, 0.16)';
            iconBox.style.color = '#f59e0b';
            btnOk.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
            btnOk.style.color = '#fff';
            btnOk.style.border = 'none';
            btnOk.style.boxShadow = '0 4px 15px rgba(245, 158, 11, 0.35)';
        } else {
            iconBox.style.background = 'rgba(59, 130, 246, 0.16)';
            iconBox.style.color = '#3b82f6';
            btnOk.style.background = 'linear-gradient(135deg, #3b82f6, #2563eb)';
            btnOk.style.color = '#fff';
            btnOk.style.border = 'none';
            btnOk.style.boxShadow = '0 4px 15px rgba(59, 130, 246, 0.35)';
        }

        let isClosed = false;
        const cleanupAndClose = (result) => {
            if (isClosed) return;
            isClosed = true;
            document.removeEventListener('keydown', keyHandler);
            overlay.style.opacity = '0';
            overlay.firstElementChild.style.transform = 'scale(0.92)';
            setTimeout(() => {
                overlay.style.display = 'none';
            }, 250);
            if (result) {
                if (typeof onConfirm === 'function') onConfirm();
                resolve(true);
            } else {
                if (typeof onCancel === 'function') onCancel();
                resolve(false);
            }
        };

        const keyHandler = (e) => {
            if (e.key === 'Escape') {
                cleanupAndClose(false);
            } else if (e.key === 'Enter') {
                cleanupAndClose(true);
            }
        };
        document.addEventListener('keydown', keyHandler);

        btnCancel.onclick = () => cleanupAndClose(false);
        btnOk.onclick = () => cleanupAndClose(true);
        overlay.onclick = (e) => {
            if (e.target === overlay) cleanupAndClose(false);
        };

        overlay.style.display = 'flex';
        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            overlay.firstElementChild.style.transform = 'scale(1)';
            btnCancel.focus();
        });
    });
}
window.showCustomConfirm = showCustomConfirm;

// Custom non-blocking prompt modal
function showCustomPrompt(title, defaultValue = '', onConfirm) {
    let overlay = document.getElementById('custom-prompt-modal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'custom-prompt-modal';
        overlay.className = 'modal-backdrop';
        overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.65); backdrop-filter: blur(8px); display: none; align-items: center; justify-content: center; z-index: 100000; opacity: 0; transition: opacity 0.25s ease;';
        overlay.innerHTML = `
            <div style="background: var(--bg-card, #1e2029); border: 1px solid var(--border-glass, rgba(255,255,255,0.12)); border-radius: 20px; padding: 1.8rem; width: 90%; max-width: 400px; box-shadow: 0 20px 50px rgba(0,0,0,0.5); transform: scale(0.92); transition: transform 0.25s ease; color: #fff;">
                <h4 id="custom-prompt-title" style="margin: 0 0 1rem 0; font-size: 1.1rem; font-weight: 600; color: #fff;"></h4>
                <input type="text" id="custom-prompt-input" style="width: 100%; padding: 0.8rem 1rem; border-radius: 12px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.15); color: #fff; font-size: 1rem; outline: none; margin-bottom: 1.2rem; box-sizing: border-box;" />
                <div style="display: flex; gap: 0.8rem; justify-content: flex-end;">
                    <button id="custom-prompt-cancel" class="btn btn-secondary" style="padding: 0.6rem 1.2rem; border-radius: 10px; cursor: pointer;">ยกเลิก</button>
                    <button id="custom-prompt-ok" class="btn btn-primary" style="padding: 0.6rem 1.4rem; border-radius: 10px; cursor: pointer;">ตกลง</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    const titleEl = overlay.querySelector('#custom-prompt-title');
    const inputEl = overlay.querySelector('#custom-prompt-input');
    const btnCancel = overlay.querySelector('#custom-prompt-cancel');
    const btnOk = overlay.querySelector('#custom-prompt-ok');

    titleEl.textContent = title;
    inputEl.value = defaultValue || '';

    const close = () => {
        overlay.style.opacity = '0';
        overlay.firstElementChild.style.transform = 'scale(0.92)';
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 250);
    };

    const submit = () => {
        const val = inputEl.value;
        close();
        if (typeof onConfirm === 'function') onConfirm(val);
    };

    btnCancel.onclick = close;
    btnOk.onclick = submit;
    inputEl.onkeydown = (e) => {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') close();
    };

    overlay.style.display = 'flex';
    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        overlay.firstElementChild.style.transform = 'scale(1)';
        inputEl.focus();
        inputEl.select();
    });
}

// --- AUTO NICKNAME GENERATOR (ZERO-FRICTION ONBOARDING) ---
const FOOD_NICKNAMES = [
    'นักชิมสายกิน 🍜', 'กูรูหมูกระทะ 🥩', 'สายหวานตาลเรียกพี่ 🍰',
    'ตัวตึงส้มตำ 🌶️', 'กัปตันชาบู 🍲', 'นักล่าของอร่อย 🍣',
    'เชฟสายลุย 🍳', 'สายกินดึก 🍔', 'นักชิมตัวยง 🍕', 'อร่อยบอกต่อ 🧋',
    'สายบุฟเฟต์ฟินๆ 🍱', 'ตัวมัมยำแซ่บ 🥗', 'นักซดต้มยำ 🍲', 'สายแซลมอน 🍣',
    'เจ้าสำนักชาบู 🥢', 'นักรีวิวปากหวาน 🧇', 'เด็กอ้วนชวนหิว 🍩', 'นักหม่ำตัวท็อป 🥟'
];

function getRandomFoodNickname() {
    return FOOD_NICKNAMES[Math.floor(Math.random() * FOOD_NICKNAMES.length)];
}

// --- ROOM EXISTENCE VERIFIER (ERROR PREVENTION & USABILITY) ---
async function verifyRoomExists(roomId) {
    if (!roomId || roomId.length !== 4) {
        return { exists: false, message: 'กรุณากรอกรหัสห้อง 4 หลัก' };
    }
    try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/check`);
        const data = await res.json();
        return data;
    } catch (err) {
        console.error('Error verifying room existence:', err);
        return { exists: false, message: 'เกิดข้อผิดพลาดในการตรวจสอบห้อง' };
    }
}


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
        playGameStart() {
            if (isMuted) return;
            const ctx = getContext();
            if (!ctx) return;
            try {
                if (ctx.state === 'suspended') ctx.resume();
                // Energetic ascending game start chime: E5 -> G5 -> B5 -> E6
                const notes = [659.25, 783.99, 987.77, 1318.51];
                notes.forEach((freq, idx) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'triangle';
                    const startTime = ctx.currentTime + (idx * 0.065);
                    const dur = idx === 3 ? 0.4 : 0.16;
                    osc.frequency.setValueAtTime(freq, startTime);
                    gain.gain.setValueAtTime(0.35, startTime);
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
        },
        playTick() {
            if (isMuted) return;
            const ctx = getContext();
            if (!ctx) return;
            try {
                if (ctx.state === 'suspended') ctx.resume();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(850, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + 0.03);
                gain.gain.setValueAtTime(0.22, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.03);
            } catch (e) {}
        },
        playFanfare() {
            if (isMuted) return;
            const ctx = getContext();
            if (!ctx) return;
            try {
                if (ctx.state === 'suspended') ctx.resume();
                const chords = [
                    { f: 523.25, t: 0, d: 0.15 },
                    { f: 659.25, t: 0.12, d: 0.15 },
                    { f: 783.99, t: 0.24, d: 0.18 },
                    { f: 1046.50, t: 0.40, d: 0.45 }
                ];
                chords.forEach(c => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'triangle';
                    const st = ctx.currentTime + c.t;
                    osc.frequency.setValueAtTime(c.f, st);
                    gain.gain.setValueAtTime(0.35, st);
                    gain.gain.exponentialRampToValueAtTime(0.001, st + c.d);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(st);
                    osc.stop(st + c.d);
                });
            } catch (e) {}
        },

        playCombo(streak) {
            if (isMuted) return;
            const ctx = getContext();
            if (!ctx) return;
            try {
                if (ctx.state === 'suspended') ctx.resume();
                const baseF = Math.min(440 + (streak * 60), 920);
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(baseF, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(baseF * 1.3, ctx.currentTime + 0.12);
                gain.gain.setValueAtTime(0.32, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.15);
            } catch (e) {}
        }
    };
})();

// --- PARTICLE BURST GENERATOR (LIGHTWEIGHT & 60FPS OPTIMIZED) ---
function spawnParticleBurst(x, y, type = 'heart') {
    let container = document.querySelector('.particle-burst-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'particle-burst-container';
        document.body.appendChild(container);
    }

    // Cap active DOM particles to prevent micro-stutter on mobile WebKit
    if (container.children.length >= 6) {
        return;
    }

    // Subtle, elegant particles (2 hearts max, 3 sparkles max)
    const icons = type === 'heart' ? ['❤️', '✨'] : ['✨', '⭐'];
    const count = type === 'heart' ? 2 : 3;

    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'micro-particle';
        p.innerText = icons[i % icons.length];
        p.style.fontSize = `${Math.random() * 4 + 13}px`;
        p.style.left = `${x}px`;
        p.style.top = `${y}px`;

        // Gentle, compact dispersion
        const angle = (Math.PI * 2 * i) / count + (Math.random() * 0.3 - 0.15);
        const distance = Math.random() * 25 + 15;
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance - 20;
        const rot = (Math.random() * 40 - 20) + 'deg';

        p.style.setProperty('--dx', `${dx}px`);
        p.style.setProperty('--dy', `${dy}px`);
        p.style.setProperty('--rot', rot);

        container.appendChild(p);
        setTimeout(() => {
            if (p.parentNode) p.parentNode.removeChild(p);
        }, 450);
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

// ==========================================================================
// MICRO-INTERACTION HELPERS & HAPTIC SYSTEM
// ==========================================================================

// Global Tactile Ripple for all buttons, chips, interactive elements
function setupGlobalRipples() {
    document.addEventListener('pointerdown', (e) => {
        const target = e.target.closest('.btn, .control-btn, .btn-icon-glass, .toggle-btn, .solo-chip, .btn-reaction, .solo-dist-pill, .solo-budget-pill, .btn-info-pill, .legal-link, .btn-header-login-highlight');
        if (!target) return;

        const rect = target.getBoundingClientRect();
        const ripple = document.createElement('span');
        ripple.className = 'glass-ripple';

        const size = Math.max(rect.width, rect.height);
        ripple.style.width = ripple.style.height = `${size}px`;

        const x = e.clientX - rect.left - size / 2;
        const y = e.clientY - rect.top - size / 2;

        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;

        target.appendChild(ripple);

        // Tactile micro-spring bounce
        target.classList.add('btn-spring-bounce');
        setTimeout(() => target.classList.remove('btn-spring-bounce'), 350);

        setTimeout(() => {
            if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
        }, 600);
    }, { passive: true });
}

// Swipe Gesture Affordance & Idle Nudge
let swipeAffordanceTimer = null;
let swipeAffordanceDismissed = false;

function setupSwipeAffordance() {
    if (swipeAffordanceDismissed) return;
    clearSwipeAffordance();

    const deck = document.getElementById('swipe-deck');
    if (!deck) return;

    swipeAffordanceTimer = setTimeout(() => {
        const topCard = deck.querySelector('.swipe-card:last-child');
        if (!topCard || topCard.classList.contains('skeleton-card')) return;

        // Apply gentle idle nudge animation
        topCard.classList.remove('idle-nudge');
        void topCard.offsetWidth;
        topCard.classList.add('idle-nudge');

        // Show floating affordance hint
        let hint = document.getElementById('swipe-affordance-hint');
        if (!hint) {
            hint = document.createElement('div');
            hint.id = 'swipe-affordance-hint';
            hint.className = 'swipe-affordance-hint';
            hint.innerHTML = '<i class="fa-solid fa-hand-pointer text-accent"></i> <span>ลองปัดซ้าย-ขวา หรือกดปุ่มด้านล่าง 👆</span>';
            const deckContainer = document.querySelector('.deck-container');
            if (deckContainer) deckContainer.appendChild(hint);
        }
        if (hint) hint.classList.add('visible');
    }, 3500);
}

function clearSwipeAffordance() {
    if (swipeAffordanceTimer) {
        clearTimeout(swipeAffordanceTimer);
        swipeAffordanceTimer = null;
    }
    swipeAffordanceDismissed = true;
    const hint = document.getElementById('swipe-affordance-hint');
    if (hint) {
        hint.classList.remove('visible');
        setTimeout(() => {
            if (hint.parentNode) hint.parentNode.removeChild(hint);
        }, 360);
    }
    const deck = document.getElementById('swipe-deck');
    if (deck) {
        const topCard = deck.querySelector('.swipe-card:last-child');
        if (topCard) topCard.classList.remove('idle-nudge');
    }
}

// Control Buttons Specific Micro-Reactions
function triggerControlBtnReaction(type) {
    clearSwipeAffordance();
    if (type === 'like') {
        const btn = document.getElementById('btn-swipe-right');
        if (btn) {
            btn.classList.add('ring-glow-green');
            const icon = btn.querySelector('i');
            if (icon) {
                icon.classList.remove('animate-heart-beat');
                void icon.offsetWidth;
                icon.classList.add('animate-heart-beat');
            }
            const rect = btn.getBoundingClientRect();
            spawnParticleBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 'heart');
            setTimeout(() => {
                btn.classList.remove('ring-glow-green');
                if (icon) icon.classList.remove('animate-heart-beat');
            }, 500);
        }
    } else if (type === 'dislike') {
        const btn = document.getElementById('btn-swipe-left');
        if (btn) {
            btn.classList.add('ring-glow-pink');
            const icon = btn.querySelector('i');
            if (icon) {
                icon.classList.remove('animate-tilt-shake');
                void icon.offsetWidth;
                icon.classList.add('animate-tilt-shake');
            }
            setTimeout(() => {
                btn.classList.remove('ring-glow-pink');
                if (icon) icon.classList.remove('animate-tilt-shake');
            }, 480);
        }
    } else if (type === 'info') {
        const btn = document.getElementById('btn-toggle-info');
        if (btn) {
            const icon = btn.querySelector('i');
            if (icon) {
                icon.classList.remove('animate-spin-360');
                void icon.offsetWidth;
                icon.classList.add('animate-spin-360');
                setTimeout(() => icon.classList.remove('animate-spin-360'), 500);
            }
        }
    }
}

// Emoji Reaction Float with Physics Sway
function spawnFloatingEmojiPhysics(btn, emoji) {
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const floating = document.createElement('div');
    floating.className = 'floating-room-emoji';
    floating.innerText = emoji;
    floating.style.fontSize = `${Math.random() * 8 + 26}px`;
    floating.style.left = `${rect.left + rect.width / 2 - 14}px`;
    floating.style.top = `${rect.top}px`;

    // Randomize sine-wave sway parameters
    const swayX1 = (Math.random() * 40 - 20) + 'px';
    const swayX2 = (Math.random() * 50 - 25) + 'px';
    const swayX3 = (Math.random() * 60 - 30) + 'px';
    const rot1 = (Math.random() * 30 - 15) + 'deg';
    const rot2 = (Math.random() * 30 - 15) + 'deg';
    const rot3 = (Math.random() * 40 - 20) + 'deg';

    floating.style.setProperty('--sway-x1', swayX1);
    floating.style.setProperty('--sway-x2', swayX2);
    floating.style.setProperty('--sway-x3', swayX3);
    floating.style.setProperty('--sway-rot1', rot1);
    floating.style.setProperty('--sway-rot2', rot2);
    floating.style.setProperty('--sway-rot3', rot3);

    document.body.appendChild(floating);
    setTimeout(() => {
        if (floating.parentNode) floating.parentNode.removeChild(floating);
    }, 2100);
}

// Staggered Rating Stars Pop for Result Screen
function animateWinnerStars(container) {
    if (!container) return;
    const ratingEl = container.querySelector('.card-rating');
    if (!ratingEl) return;
    const starIcon = ratingEl.querySelector('i');
    if (starIcon) {
        starIcon.classList.remove('winner-star-pop');
        void starIcon.offsetWidth;
        starIcon.classList.add('winner-star-pop');
    }
}

// --- SUPABASE OAUTH CALLBACK HANDLER ---
async function handleOAuthCallback() {
    const hash = window.location.hash ? window.location.hash.substring(1) : '';
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(hash);

    const errorDesc = hashParams.get('error_description') || searchParams.get('error_description');
    if (errorDesc) {
        showToast(`เข้าสู่ระบบไม่สำเร็จ: ${decodeURIComponent(errorDesc)}`, 'error', 5000);
        window.history.replaceState(null, '', window.location.pathname);
        return false;
    }

    const accessToken = hashParams.get('access_token');
    const providerFromHash = hashParams.get('provider') || 'google';
    const code = searchParams.get('code');

    // 1. Handle PKCE Code exchange if code is in URL query parameters
    if (code && supabaseClient) {
        try {
            showToast('กำลังยืนยันตัวตนกับ Google/Supabase...', 'info', 2000);
            const { data, error } = await supabaseClient.auth.exchangeCodeForSession(code);
            if (data && data.user && !error) {
                const user = data.user;
                const email = user.email || '';
                const name = user.user_metadata?.full_name || user.user_metadata?.name || email.split('@')[0];
                const provider = user.app_metadata?.provider || 'google';

                const res = await fetch('/api/auth/oauth-login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ provider, email, name })
                });

                if (res.ok) {
                    const authData = await res.json();
                    state.currentUser = authData;
                    updateHeaderUI();
                    prefillUserPreferences();
                    window.history.replaceState(null, '', window.location.pathname);
                    showToast(`ยินดีต้อนรับ ${authData.displayName} เข้าสู่ระบบด้วย ${provider === 'google' ? 'Google' : 'Facebook'} สำเร็จ 🎉`, 'success', 3500);
                    routeAfterAuth();
                    return true;
                }
            }
        } catch (e) {
            console.warn("PKCE code exchange error:", e);
        }
    }

    // 2. Handle Implicit token in URL hash
    if (accessToken && supabaseClient) {
        try {
            showToast('กำลังยืนยันตัวตนกับ Supabase...', 'info', 2000);
            const { data: { user }, error } = await supabaseClient.auth.getUser(accessToken);
            if (user && !error) {
                const email = user.email || '';
                const name = user.user_metadata?.full_name || user.user_metadata?.name || email.split('@')[0];
                const provider = user.app_metadata?.provider || providerFromHash;

                const res = await fetch('/api/auth/oauth-login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ provider, email, name })
                });

                if (res.ok) {
                    const data = await res.json();
                    state.currentUser = data;
                    updateHeaderUI();
                    prefillUserPreferences();
                    window.history.replaceState(null, '', window.location.pathname);
                    showToast(`ยินดีต้อนรับ ${data.displayName} เข้าสู่ระบบด้วย ${provider === 'google' ? 'Google' : 'Facebook'} สำเร็จ 🎉`, 'success', 3500);
                    routeAfterAuth();
                    return true;
                }
            }
        } catch (e) {
            console.warn("OAuth hash token verification failed:", e);
        }
    }

    if (supabaseClient) {
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session && session.user) {
                const user = session.user;
                const email = user.email || '';
                const name = user.user_metadata?.full_name || user.user_metadata?.name || email.split('@')[0];
                const provider = user.app_metadata?.provider || 'google';

                const res = await fetch('/api/auth/oauth-login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ provider, email, name })
                });

                if (res.ok) {
                    const data = await res.json();
                    state.currentUser = data;
                    updateHeaderUI();
                    prefillUserPreferences();
                    window.history.replaceState(null, '', window.location.pathname);
                    showToast(`ยินดีต้อนรับ ${data.displayName} เข้าสู่ระบบด้วย ${provider === 'google' ? 'Google' : 'Facebook'} สำเร็จ 🎉`, 'success', 3500);
                    routeAfterAuth();
                    return true;
                }
            }
        } catch (e) {
            console.warn("Supabase session check error:", e);
        }
    }

    return false;
}

// --- GOOGLE & FACEBOOK SOCIAL LOGIN SYSTEM (GLOBAL SCOPE) ---
let isOAuthInitiating = false;

async function initiateOAuthLogin(provider) {
    if (isOAuthInitiating) return;
    isOAuthInitiating = true;
    setTimeout(() => { isOAuthInitiating = false; }, 3000);

    const providerName = provider === 'google' ? 'Google' : 'Facebook';
    if (typeof showToast === 'function') {
        showToast(`กำลังเชื่อมต่อไปยัง ${providerName} เพื่อเข้าสู่ระบบ...`, 'info', 3000);
    }

    try {
        // Determine canonical redirect target pointing to https://ginder.onrender.com
        const canonicalBase = (window.APP_URL || (window.location.hostname.includes('localhost') || window.location.hostname.includes('127.0.0.1') ? window.location.origin : 'https://ginder.onrender.com')).replace(/\/+$/, '');
        const targetRedirectUrl = `${canonicalBase}/`;

        // 1. Preferred: Use frontend Supabase Client directly if available
        if (supabaseClient && supabaseClient.auth && typeof supabaseClient.auth.signInWithOAuth === 'function') {
            const { data, error } = await supabaseClient.auth.signInWithOAuth({
                provider: provider,
                options: {
                    redirectTo: targetRedirectUrl
                }
            });
            if (error) throw error;
            if (data && data.url) {
                window.location.href = data.url;
                return;
            }
        }

        // 2. Fallback: Fetch OAuth URL from server endpoint
        const res = await fetch(`/api/auth/oauth-url?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(targetRedirectUrl)}`);
        const data = await res.json();

        if (!data.success || !data.url) {
            throw new Error(data.message || 'ไม่สามารถสร้างลิงก์เข้าสู่ระบบได้');
        }

        window.location.href = data.url;
    } catch (err) {
        console.error("OAuth initiate error:", err);
        isOAuthInitiating = false;
        if (typeof showToast === 'function') {
            showToast(`เกิดข้อผิดพลาดในการเชื่อมต่อ ${providerName}: ${err.message}`, 'error', 4500);
        }
    }
}

// Deprecated stubs to prevent any reference errors
function openSocialAuthModal(provider) {
    initiateOAuthLogin(provider || 'google');
}
function closeSocialAuthModal() {}
function openOAuthSetupModal(provider) {
    initiateOAuthLogin(provider || 'google');
}
function handleSocialLogin(provider, email, name) {
    initiateOAuthLogin(provider || 'google');
}

// Expose globally
window.initiateOAuthLogin = initiateOAuthLogin;
window.openSocialAuthModal = openSocialAuthModal;
window.openOAuthSetupModal = openOAuthSetupModal;
window.closeSocialAuthModal = closeSocialAuthModal;
window.handleSocialLogin = handleSocialLogin;

// --- INITIALIZE & ROUTING ---
window.addEventListener('DOMContentLoaded', async () => {
    // 1. Read Room ID & autoJoin from URL query params FIRST to prevent modals or race conditions
    const urlParams = new URLSearchParams(window.location.search);
    const roomIdParam = urlParams.get('roomId');
    if (roomIdParam) {
        state.targetRoomId = roomIdParam.trim().toUpperCase();
        state.autoJoin = true;
        const joinInput = document.getElementById('join-room-id');
        if (joinInput) joinInput.value = state.targetRoomId;
    }

    setupGlobalRipples();
    setupEventListeners();
    setupProfileAndFeedback();
    setupForgotPasswordModal();
    setupPdpaSystem();
    setupWelcomeModal();
    const handled = await handleOAuthCallback();
    if (!handled) {
        checkCurrentUser();
    }
    requestUserLocation();

    // Check if redirected from /admin for admin authentication
    if (urlParams.get('login') === 'admin') {
        sessionStorage.setItem('returnTo', '/admin');
        setTimeout(() => {
            if (typeof showToast === 'function') {
                showToast('กรุณาเข้าสู่ระบบด้วย Google เพื่อเข้าถึงแดชบอร์ดผู้ดูแลระบบ (Admin)', 'info', 4500);
            }
            openAuthModal();
        }, 400);
    }
});

function setupWelcomeModal() {
    const welcomeModal = document.getElementById('welcome-intro-modal');
    const btnStart = document.getElementById('btn-start-from-welcome');
    const btnClose = document.getElementById('btn-close-welcome-modal');
    const chkSkip = document.getElementById('chk-skip-welcome-forever');
    const btnOpen = document.getElementById('btn-open-welcome-modal');

    function openModal() {
        if (!welcomeModal) return;
        welcomeModal.classList.remove('hidden');
    }

    function closeModal() {
        if (!welcomeModal) return;
        welcomeModal.classList.add('hidden');
    }

    if (btnStart) {
        btnStart.addEventListener('click', () => {
            soundFx.playGameStart();
            if (chkSkip && chkSkip.checked) {
                localStorage.setItem('ginder_skip_intro', 'true');
            }
            closeModal();
        });
    }

    if (btnClose) {
        btnClose.addEventListener('click', () => {
            soundFx.playPop();
            if (chkSkip && chkSkip.checked) {
                localStorage.setItem('ginder_skip_intro', 'true');
            }
            closeModal();
        });
    }

    if (btnOpen) {
        btnOpen.addEventListener('click', () => {
            soundFx.playPop();
            openModal();
        });
    }

    if (welcomeModal) {
        welcomeModal.addEventListener('click', (e) => {
            if (e.target === welcomeModal) {
                closeModal();
            }
        });
    }

    // Auto display welcome pop-up modal on first visit (unless user checked skip or roomId is in URL)
    const urlParams = new URLSearchParams(window.location.search);
    const forceIntro = urlParams.get('intro') === '1';
    const isSkipped = localStorage.getItem('ginder_skip_intro') === 'true';

    if (welcomeModal) {
        if (forceIntro || (!isSkipped && !state.targetRoomId)) {
            // Smoothly display after DOM renders
            setTimeout(() => {
                openModal();
            }, 300);
        }
    }
}

function showView(viewName) {
    if (!state.currentUser && viewName !== 'landing' && viewName !== 'auth') {
        // Silently complete guest login so user is never blocked by login screen
        triggerQuickGuestLogin(() => {
            showView(viewName);
        });
        return;
    }

    Object.keys(views).forEach(key => {
        if (!views[key]) return;
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

    // Toggle result screen active body class and dismiss popup when leaving result view
    document.body.classList.toggle('view-result-active', viewName === 'result');
    if (viewName !== 'result' && typeof dismissCelebrationPopup === 'function') {
        dismissCelebrationPopup();
    }

    // Toggle footer during swipe and result views to give maximum screen space for card and buttons
    const appFooter = document.querySelector('.app-footer');
    if (appFooter) {
        if (viewName === 'swipe' || viewName === 'result') {
            appFooter.style.display = 'none';
            if (viewName === 'swipe') document.body.classList.add('in-swipe-game');
            else document.body.classList.remove('in-swipe-game');
        } else {
            appFooter.style.display = '';
            document.body.classList.remove('in-swipe-game');
        }
    }

    // Hide floating feedback button during card swiping, restore when round ends or on other views
    const btnFloatingFeedback = document.getElementById('btn-floating-feedback');
    if (btnFloatingFeedback) {
        if (viewName === 'swipe') {
            btnFloatingFeedback.style.display = 'none';
        } else {
            btnFloatingFeedback.style.display = '';
        }
    }

    // Adapt UI components based on mode (Solo vs Group)
    const swipeModeBadge = document.getElementById('swipe-mode-badge');
    const groupProgressWidget = document.querySelector('.group-progress-widget');
    const btnSoloRetry = document.getElementById('btn-solo-retry');

    if (viewName === 'swipe') {
        setupSwipeAffordance();
        const roomReactionEl = document.getElementById('room-reaction-bar');

        if (state.isSolo) {
            if (roomReactionEl) {
                roomReactionEl.classList.add('hidden');
                roomReactionEl.style.display = 'none';
            }
            if (swipeModeBadge) {
                swipeModeBadge.className = 'swipe-mode-badge';
                swipeModeBadge.style.cursor = 'default';
                swipeModeBadge.title = '';
                const typeText = state.preferences && state.preferences.foodTypes && state.preferences.foodTypes.length > 0 
                    ? state.preferences.foodTypes.join(', ')
                    : 'ทั้งหมด';
                const safeTypeText = String(typeText).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                swipeModeBadge.innerHTML = `<i class="fa-solid fa-user text-accent"></i> <span class="swipe-mode-text">คนเดียว • <strong class="swipe-mode-type">${safeTypeText}</strong></span>`;
                swipeModeBadge.style.display = 'inline-flex';
            }
            if (groupProgressWidget) groupProgressWidget.style.display = 'none';
            const timerContainer = document.getElementById('swipe-timer-container');
            if (timerContainer) {
                timerContainer.style.display = 'none'; // ซ่อนในโหมดเดี่ยว
            }
        } else {
            // โหมดกลุ่ม: ซ่อนแถบปฏิกิริยาตามคำขอ และตั้งค่าปุ่มดูความคืบหน้าของกลุ่ม
            if (roomReactionEl) {
                roomReactionEl.classList.add('hidden');
                roomReactionEl.style.display = 'none';
            }
            if (swipeModeBadge) {
                swipeModeBadge.className = 'swipe-mode-badge group-mode';
                swipeModeBadge.style.cursor = 'pointer';
                swipeModeBadge.title = 'แตะเพื่อเปิดดูความคืบหน้าของเพื่อนในกลุ่ม';
                swipeModeBadge.innerHTML = '<i class="fa-solid fa-users text-accent"></i> <span class="swipe-mode-text">ความคืบหน้ากลุ่ม</span> <span id="badge-group-progress-count" class="badge-mini-tag">0/0</span>';
                swipeModeBadge.style.display = 'inline-flex';
            }
            if (groupProgressWidget) groupProgressWidget.style.display = 'none';
            const timerContainer = document.getElementById('swipe-timer-container');
            if (timerContainer) {
                timerContainer.style.display = 'flex';
            }
            updateGroupProgressWidget();
        }
    } else {
        const roomReactionEl = document.getElementById('room-reaction-bar');
        if (roomReactionEl) {
            roomReactionEl.classList.add('hidden');
            roomReactionEl.style.display = 'none';
        }
        clearSwipeAffordance();
    }

    if (viewName === 'result') {
        if (state.isSolo) {
            if (btnSoloRetry) btnSoloRetry.classList.remove('hidden');
        } else {
            if (btnSoloRetry) btnSoloRetry.classList.add('hidden');
        }
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
    state.isSolo = false;
    state.soloLiked = [];
    resetComboStreak();
    const roomReactionEl = document.getElementById('room-reaction-bar');
    if (roomReactionEl) roomReactionEl.classList.add('hidden');
    if (typeof dismissCelebrationPopup === 'function') dismissCelebrationPopup();

    // Clear HTML fields
    const landingRoomEl = document.getElementById('landing-room-id');
    if (landingRoomEl) landingRoomEl.value = '';
    const joinRoomEl = document.getElementById('join-room-id');
    if (joinRoomEl) joinRoomEl.value = '';
    const lobbyRoomEl = document.getElementById('lobby-room-id');
    if (lobbyRoomEl) lobbyRoomEl.innerText = '----';
    const prefNameEl = document.getElementById('pref-name');
    if (prefNameEl) prefNameEl.value = '';

    const btnStartSoloSwipe = document.getElementById('btn-start-solo-swipe');
    if (btnStartSoloSwipe) btnStartSoloSwipe.classList.add('hidden');
    const btnCreateRoom = document.getElementById('btn-create-room');
    if (btnCreateRoom) btnCreateRoom.classList.remove('hidden');
    const btnSoloRetry = document.getElementById('btn-solo-retry');
    if (btnSoloRetry) btnSoloRetry.classList.add('hidden');

    // Clear selected allergy pills for guest join selectors
    document.querySelectorAll('#view-join .allergy-selector .allergy-pill').forEach(pill => {
        pill.classList.remove('active');
    });

    // Reset Group Preferences Filter Box to defaults
    const groupAllergyChips = document.querySelectorAll('#group-allergy-chips .host-allergy-chip');
    groupAllergyChips.forEach(c => {
        if (c.dataset.allergen === '') c.classList.add('active');
        else c.classList.remove('active');
    });

    const groupFoodChips = document.querySelectorAll('#group-food-chips .solo-chip');
    groupFoodChips.forEach(c => {
        if (c.dataset.type === '') c.classList.add('active');
        else c.classList.remove('active');
    });

    const groupDistSliderEl = document.getElementById('pref-distance');
    if (groupDistSliderEl) groupDistSliderEl.value = 20.0;
    const groupDistValEl = document.getElementById('group-distance-val');
    if (groupDistValEl) groupDistValEl.innerText = 'ไม่จำกัด (ทุกระยะ)';
    document.querySelectorAll('#group-dist-pills .solo-dist-pill').forEach(p => {
        if (p.dataset.dist === '') p.classList.add('active');
        else p.classList.remove('active');
    });

    document.querySelectorAll('#group-budget-pills .solo-budget-pill').forEach(p => {
        if (p.dataset.min === '0' && p.dataset.max === '9999') p.classList.add('active');
        else p.classList.remove('active');
    });

    if (typeof updateGroupFilterBadge === 'function') {
        updateGroupFilterBadge();
    }

    // Reset JS state variables
    state.allergies = [];
    state.preferences = {
        minPrice: 0,
        maxPrice: 9999,
        maxDistance: null,
        foodTypes: []
    };

    // Remove query params from address bar
    try {
        window.history.pushState({}, document.title, window.location.pathname);
    } catch (e) {
        console.warn('pushState error:', e);
    }

    clearSwipeAffordance();
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

            // Sound Toggle Tooltip Badge Micro-interaction
            let badge = soundToggleBtn.querySelector('.sound-tooltip-badge');
            if (badge) badge.remove();
            badge = document.createElement('span');
            badge.className = 'sound-tooltip-badge';
            badge.innerText = muted ? 'ปิดเสียงเอฟเฟกต์ 🔇' : 'เปิดเสียงเอฟเฟกต์ 🔊';
            soundToggleBtn.appendChild(badge);
            setTimeout(() => {
                if (badge.parentNode) badge.parentNode.removeChild(badge);
            }, 1200);
        });
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

    // Mode Selection Actions on Landing Screen
    const setPreferencesMode = (isSolo) => {
        state.isSolo = isSolo;
        const titleEl = document.getElementById('pref-header-title');
        const descEl = document.getElementById('pref-header-desc');
        const btnCreateRoom = document.getElementById('btn-create-room');
        const btnStartSoloSwipe = document.getElementById('btn-start-solo-swipe');
        const nameInput = document.getElementById('pref-name');

        if (isSolo) {
            if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-user text-accent"></i> ตั้งค่าสำหรับกินคนเดียว';
            if (descEl) descEl.innerText = 'กำหนดงบประมาณ ระยะทาง และประเภทอาหารที่คุณอยากทานมื้อนี้';
            if (btnCreateRoom) btnCreateRoom.classList.add('hidden');
            if (btnStartSoloSwipe) btnStartSoloSwipe.classList.remove('hidden');
            if (nameInput && !nameInput.value.trim()) {
                nameInput.value = state.currentUser ? (state.currentUser.displayName || state.currentUser.username) : 'นักชิมเดี่ยว';
            }
        } else {
            if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-sliders text-accent"></i> ตั้งค่าการค้นหา';
            if (descEl) descEl.innerText = 'กำหนดเงื่อนไขร้านอาหารสำหรับทุกคนในห้อง';
            if (btnCreateRoom) btnCreateRoom.classList.remove('hidden');
            if (btnStartSoloSwipe) btnStartSoloSwipe.classList.add('hidden');
            if (nameInput) {
                nameInput.value = getRandomFoodNickname();
            }
        }
    };

    const btnGotoCreate = document.getElementById('btn-goto-create');
    if (btnGotoCreate) {
        btnGotoCreate.addEventListener('click', () => {
            soundFx.playPop();
            setPreferencesMode(false);
            const nameInput = document.getElementById('pref-name');
            if (nameInput) {
                nameInput.value = getRandomFoodNickname();
            }
            btnGotoCreate.classList.add('btn-clicked');
            setTimeout(() => btnGotoCreate.classList.remove('btn-clicked'), 300);
            showView('preferences');
        });
    }

    // Setup Food, Distance & Budget Filters for Solo Mode
    const soloFilterBadge = document.getElementById('solo-filter-badge');

    function updateSoloFilterBadge() {
        if (!soloFilterBadge) return;
        const parts = [];

        // 0. Allergy
        const activeAllergies = document.querySelectorAll('#solo-allergy-chips .solo-allergy-chip.active:not([data-allergen=""])');
        if (activeAllergies.length > 0) {
            const allergyNames = Array.from(activeAllergies).map(c => c.innerText.trim());
            if (allergyNames.length === 1) {
                parts.push(`ไม่เอา: ${allergyNames[0]}`);
            } else {
                parts.push(`แพ้ ${allergyNames.length} อย่าง`);
            }
        }

        // 1. Food craving types
        const activeChips = document.querySelectorAll('#solo-food-chips .solo-chip.active');
        const selectedFood = [];
        activeChips.forEach(c => {
            if (c.dataset.type) {
                selectedFood.push(c.innerText.trim());
            }
        });
        if (selectedFood.length === 1) {
            parts.push(selectedFood[0]);
        } else if (selectedFood.length > 1) {
            parts.push(`${selectedFood[0]} +${selectedFood.length - 1}`);
        }

        // 2. Distance
        const distSlider = document.getElementById('solo-pref-distance');
        const activeDistPill = document.querySelector('#solo-dist-pills .solo-dist-pill.active');
        if (activeDistPill && activeDistPill.dataset.dist) {
            parts.push(`< ${activeDistPill.dataset.dist} กม.`);
        } else if (distSlider && parseFloat(distSlider.value) < 20.0) {
            parts.push(`< ${parseFloat(distSlider.value)} กม.`);
        }

        // 3. Budget
        const activeBudget = document.querySelector('#solo-budget-pills .solo-budget-pill.active');
        if (activeBudget && !(activeBudget.dataset.min === '0' && activeBudget.dataset.max === '9999')) {
            const min = parseInt(activeBudget.dataset.min, 10);
            const max = parseInt(activeBudget.dataset.max, 10);
            if (max < 100) parts.push('< 100฿');
            else if (min >= 300) parts.push('> 300฿');
            else parts.push('100-300฿');
        }

        if (parts.length === 0) {
            soloFilterBadge.innerText = 'ทั้งหมด';
        } else {
            soloFilterBadge.innerText = parts.join(' • ');
        }
    }

    function initFoodChipSelector(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const allChip = container.querySelector('.solo-chip[data-type=""]');
        const specificChips = container.querySelectorAll('.solo-chip:not([data-type=""])');

        if (allChip) {
            allChip.addEventListener('click', () => {
                soundFx.playPop();
                allChip.classList.add('active');
                allChip.classList.remove('just-selected');
                void allChip.offsetWidth;
                allChip.classList.add('just-selected');
                setTimeout(() => allChip.classList.remove('just-selected'), 350);
                const rect = allChip.getBoundingClientRect();
                spawnParticleBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 'sparkle');

                specificChips.forEach(c => c.classList.remove('active'));
                if (containerId === 'solo-food-chips') updateSoloFilterBadge();
                if (containerId === 'group-food-chips' && typeof updateGroupFilterBadge === 'function') updateGroupFilterBadge();
            });
        }

        specificChips.forEach(chip => {
            chip.addEventListener('click', () => {
                soundFx.playPop();
                chip.classList.toggle('active');
                chip.classList.remove('just-selected');
                void chip.offsetWidth;
                chip.classList.add('just-selected');
                setTimeout(() => chip.classList.remove('just-selected'), 350);
                if (chip.classList.contains('active')) {
                    const rect = chip.getBoundingClientRect();
                    spawnParticleBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 'sparkle');
                }

                if (allChip) allChip.classList.remove('active');

                // If none selected, re-activate "All"
                const anyActive = Array.from(specificChips).some(c => c.classList.contains('active'));
                if (!anyActive && allChip) {
                    allChip.classList.add('active');
                }
                if (containerId === 'solo-food-chips') updateSoloFilterBadge();
                if (containerId === 'group-food-chips' && typeof updateGroupFilterBadge === 'function') updateGroupFilterBadge();
            });
        });
    }

    initFoodChipSelector('solo-food-chips');
    initFoodChipSelector('quick-food-chips');
    initFoodChipSelector('group-food-chips');

    // Distance controls for Solo Mode
    const soloDistSlider = document.getElementById('solo-pref-distance');
    const soloDistValLabel = document.getElementById('solo-distance-val');
    const soloDistPills = document.querySelectorAll('#solo-dist-pills .solo-dist-pill');

    function syncSoloDistanceUI(val, fromPill = false) {
        const numVal = parseFloat(val);
        if (soloDistValLabel) {
            if (numVal >= 20.0) {
                soloDistValLabel.innerText = 'ไม่จำกัด (ทุกระยะ)';
            } else {
                soloDistValLabel.innerText = `< ${numVal} กม.`;
            }
        }
        if (!fromPill && soloDistPills.length > 0) {
            soloDistPills.forEach(pill => {
                const pDist = pill.dataset.dist;
                if (numVal >= 20.0 && pDist === '') {
                    pill.classList.add('active');
                } else if (pDist && parseFloat(pDist) === numVal) {
                    pill.classList.add('active');
                } else {
                    pill.classList.remove('active');
                }
            });
        }
        updateSoloFilterBadge();
    }

    if (soloDistSlider) {
        soloDistSlider.addEventListener('input', (e) => {
            syncSoloDistanceUI(e.target.value, false);
        });
    }

    if (soloDistPills.length > 0) {
        soloDistPills.forEach(pill => {
            pill.addEventListener('click', () => {
                soundFx.playPop();
                soloDistPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                const targetDist = pill.dataset.dist === '' ? 20.0 : parseFloat(pill.dataset.dist);
                if (soloDistSlider) {
                    soloDistSlider.value = targetDist;
                }
                syncSoloDistanceUI(targetDist, true);
            });
        });
    }

    // Budget controls for Solo Mode
    const soloBudgetPills = document.querySelectorAll('#solo-budget-pills .solo-budget-pill');
    if (soloBudgetPills.length > 0) {
        soloBudgetPills.forEach(pill => {
            pill.addEventListener('click', () => {
                soundFx.playPop();
                soloBudgetPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                updateSoloFilterBadge();
            });
        });
    }

    // Collapsible Solo Food Filter Toggle (Open/Close or Hide/Show)
    const btnToggleSoloFilter = document.getElementById('btn-toggle-solo-filter');
    const soloFilterBox = document.querySelector('.solo-filter-box');
    const soloFilterContent = document.getElementById('solo-filter-content');
    const soloToggleText = document.getElementById('solo-toggle-text');

    if (btnToggleSoloFilter && soloFilterContent && soloFilterBox) {
        btnToggleSoloFilter.addEventListener('click', () => {
            soundFx.playPop();
            const isCollapsed = soloFilterContent.classList.contains('collapsed');
            if (isCollapsed) {
                soloFilterContent.classList.remove('collapsed');
                soloFilterBox.classList.add('expanded');
                btnToggleSoloFilter.setAttribute('aria-expanded', 'true');
                if (soloToggleText) soloToggleText.innerText = 'ซ่อนตัวกรอง';
            } else {
                soloFilterContent.classList.add('collapsed');
                soloFilterBox.classList.remove('expanded');
                btnToggleSoloFilter.setAttribute('aria-expanded', 'false');
                if (soloToggleText) soloToggleText.innerText = 'เปิดตัวกรอง';
            }
        });
    }

    // Solo allergy chips logic
    const soloAllergyContainer = document.getElementById('solo-allergy-chips');
    if (soloAllergyContainer) {
        const noneChip = soloAllergyContainer.querySelector('.solo-allergy-chip[data-allergen=""]');
        const specificAllergyChips = soloAllergyContainer.querySelectorAll('.solo-allergy-chip:not([data-allergen=""])');

        if (noneChip) {
            noneChip.addEventListener('click', () => {
                soundFx.playPop();
                noneChip.classList.add('active');
                specificAllergyChips.forEach(c => c.classList.remove('active'));
                updateSoloFilterBadge();
            });
        }

        specificAllergyChips.forEach(chip => {
            chip.addEventListener('click', () => {
                soundFx.playPop();
                chip.classList.toggle('active');
                if (noneChip) noneChip.classList.remove('active');

                // If no specific allergies selected, re-activate "ไม่มีแพ้เลย"
                const anyActive = Array.from(specificAllergyChips).some(c => c.classList.contains('active'));
                if (!anyActive && noneChip) {
                    noneChip.classList.add('active');
                }
                updateSoloFilterBadge();
            });
        });
    }

    // Reset button inside solo filter box (Reset all: Allergy, Food, Distance, Budget)
    const btnResetSoloChips = document.getElementById('btn-reset-solo-chips');
    if (btnResetSoloChips) {
        btnResetSoloChips.addEventListener('click', () => {
            soundFx.playPop();

            // Micro-interaction: 360 Spin & Feedback Badge
            const icon = btnResetSoloChips.querySelector('i');
            if (icon) {
                icon.classList.remove('animate-spin-reverse');
                void icon.offsetWidth;
                icon.classList.add('animate-spin-reverse');
            }
            let badge = btnResetSoloChips.querySelector('.reset-feedback-badge');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'reset-feedback-badge';
                badge.innerText = 'รีเซ็ตแล้ว ✨';
                btnResetSoloChips.appendChild(badge);
            }
            badge.classList.add('visible');
            setTimeout(() => {
                if (badge) badge.classList.remove('visible');
            }, 1400);

            // Reset allergy chips
            const soloAllergyChips = document.querySelectorAll('#solo-allergy-chips .solo-allergy-chip');
            soloAllergyChips.forEach(c => {
                if (c.dataset.allergen === '') c.classList.add('active');
                else c.classList.remove('active');
            });
            // Reset food chips
            const chips = document.querySelectorAll('#solo-food-chips .solo-chip');
            chips.forEach(c => {
                if (c.dataset.type === '') c.classList.add('active');
                else c.classList.remove('active');
            });
            // Reset distance
            if (soloDistSlider) soloDistSlider.value = 20.0;
            if (soloDistValLabel) soloDistValLabel.innerText = 'ไม่จำกัด (ทุกระยะ)';
            soloDistPills.forEach(p => {
                if (p.dataset.dist === '') p.classList.add('active');
                else p.classList.remove('active');
            });
            // Reset budget
            soloBudgetPills.forEach(p => {
                if (p.dataset.min === '0' && p.dataset.max === '9999') p.classList.add('active');
                else p.classList.remove('active');
            });
            updateSoloFilterBadge();
        });
    }

    // ==========================================================================
    // UNIFIED GROUP PREFERENCES FILTER BOX (MATCHING SOLO MODE)
    // ==========================================================================
    const groupFilterBadge = document.getElementById('group-filter-badge');

    function updateGroupFilterBadge() {
        if (!groupFilterBadge) return;
        const parts = [];

        // 1. Allergies
        const activeAllergies = document.querySelectorAll('#group-allergy-chips .host-allergy-chip.active:not([data-allergen=""])');
        if (activeAllergies.length === 1) {
            parts.push(`แพ้: ${activeAllergies[0].innerText.trim()}`);
        } else if (activeAllergies.length > 1) {
            parts.push(`แพ้: ${activeAllergies[0].innerText.trim()} +${activeAllergies.length - 1}`);
        }

        // 2. Food craving types
        const activeFoodChips = document.querySelectorAll('#group-food-chips .solo-chip.active:not([data-type=""])');
        if (activeFoodChips.length === 1) {
            parts.push(activeFoodChips[0].innerText.trim());
        } else if (activeFoodChips.length > 1) {
            parts.push(`${activeFoodChips[0].innerText.trim()} +${activeFoodChips.length - 1}`);
        }

        // 3. Distance
        const distSliderEl = document.getElementById('pref-distance');
        const activeDistPill = document.querySelector('#group-dist-pills .solo-dist-pill.active');
        if (activeDistPill && activeDistPill.dataset.dist) {
            parts.push(`< ${activeDistPill.dataset.dist} กม.`);
        } else if (distSliderEl && parseFloat(distSliderEl.value) < 20.0) {
            parts.push(`< ${parseFloat(distSliderEl.value).toFixed(1)} กม.`);
        }

        // 4. Budget
        const activeBudget = document.querySelector('#group-budget-pills .solo-budget-pill.active');
        if (activeBudget && !(activeBudget.dataset.min === '0' && activeBudget.dataset.max === '9999')) {
            const min = parseInt(activeBudget.dataset.min, 10);
            const max = parseInt(activeBudget.dataset.max, 10);
            if (max < 100) parts.push('< 100฿');
            else if (min >= 300) parts.push('> 300฿');
            else parts.push('100-300฿');
        }

        if (parts.length === 0) {
            groupFilterBadge.innerText = 'ทั้งหมด';
        } else {
            groupFilterBadge.innerText = parts.join(' • ');
        }
    }

    // Group allergy chips logic
    const groupAllergyContainer = document.getElementById('group-allergy-chips');
    if (groupAllergyContainer) {
        const noneChip = groupAllergyContainer.querySelector('.host-allergy-chip[data-allergen=""]');
        const specificAllergyChips = groupAllergyContainer.querySelectorAll('.host-allergy-chip:not([data-allergen=""])');

        if (noneChip) {
            noneChip.addEventListener('click', () => {
                soundFx.playPop();
                noneChip.classList.add('active');
                specificAllergyChips.forEach(c => c.classList.remove('active'));
                updateGroupFilterBadge();
            });
        }

        specificAllergyChips.forEach(chip => {
            chip.addEventListener('click', () => {
                soundFx.playPop();
                chip.classList.toggle('active');
                if (noneChip) noneChip.classList.remove('active');

                // If no specific allergies selected, re-activate "ไม่มีแพ้เลย"
                const anyActive = Array.from(specificAllergyChips).some(c => c.classList.contains('active'));
                if (!anyActive && noneChip) {
                    noneChip.classList.add('active');
                }
                updateGroupFilterBadge();
            });
        });
    }

    // Distance controls for Group Mode
    const groupDistSlider = document.getElementById('pref-distance');
    const groupDistValLabel = document.getElementById('group-distance-val');
    const groupDistPills = document.querySelectorAll('#group-dist-pills .solo-dist-pill');

    function syncGroupDistanceUI(val, fromPill = false) {
        const numVal = parseFloat(val);
        if (groupDistValLabel) {
            if (numVal >= 20.0) {
                groupDistValLabel.innerText = 'ไม่จำกัด (ทุกระยะ)';
            } else {
                groupDistValLabel.innerText = `< ${numVal.toFixed(1)} กม.`;
            }
        }
        if (!fromPill && groupDistPills.length > 0) {
            groupDistPills.forEach(pill => {
                const pDist = pill.dataset.dist;
                if (numVal >= 20.0 && pDist === '') {
                    pill.classList.add('active');
                } else if (pDist && parseFloat(pDist) === numVal) {
                    pill.classList.add('active');
                } else {
                    pill.classList.remove('active');
                }
            });
        }
        updateGroupFilterBadge();
    }

    if (groupDistSlider) {
        groupDistSlider.addEventListener('input', (e) => {
            syncGroupDistanceUI(e.target.value, false);
        });
    }

    if (groupDistPills.length > 0) {
        groupDistPills.forEach(pill => {
            pill.addEventListener('click', () => {
                soundFx.playPop();
                groupDistPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                const targetDist = pill.dataset.dist === '' ? 20.0 : parseFloat(pill.dataset.dist);
                if (groupDistSlider) {
                    groupDistSlider.value = targetDist;
                }
                syncGroupDistanceUI(targetDist, true);
            });
        });
    }

    // Budget controls for Group Mode
    const groupBudgetPills = document.querySelectorAll('#group-budget-pills .solo-budget-pill');
    if (groupBudgetPills.length > 0) {
        groupBudgetPills.forEach(pill => {
            pill.addEventListener('click', () => {
                soundFx.playPop();
                groupBudgetPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                updateGroupFilterBadge();
            });
        });
    }

    // Collapsible Group Filter Toggle (Open/Close or Hide/Show)
    const btnToggleGroupFilter = document.getElementById('btn-toggle-group-filter');
    const groupFilterBox = document.querySelector('.group-pref-filter-box');
    const groupFilterContent = document.getElementById('group-filter-content');
    const groupToggleText = document.getElementById('group-toggle-text');

    if (btnToggleGroupFilter && groupFilterContent && groupFilterBox) {
        btnToggleGroupFilter.addEventListener('click', () => {
            soundFx.playPop();
            const isCollapsed = groupFilterContent.classList.contains('collapsed');
            if (isCollapsed) {
                groupFilterContent.classList.remove('collapsed');
                groupFilterBox.classList.add('expanded');
                btnToggleGroupFilter.setAttribute('aria-expanded', 'true');
                if (groupToggleText) groupToggleText.innerText = 'ซ่อนตัวกรอง';
            } else {
                groupFilterContent.classList.add('collapsed');
                groupFilterBox.classList.remove('expanded');
                btnToggleGroupFilter.setAttribute('aria-expanded', 'false');
                if (groupToggleText) groupToggleText.innerText = 'เปิดตัวกรอง';
            }
        });
    }

    // Reset button inside group filter box (Reset all: Allergy, Food, Distance, Budget)
    const btnResetGroupFilters = document.getElementById('btn-reset-group-filters');
    if (btnResetGroupFilters) {
        btnResetGroupFilters.addEventListener('click', () => {
            soundFx.playPop();

            // Micro-interaction: 360 Spin & Feedback Badge
            const icon = btnResetGroupFilters.querySelector('i');
            if (icon) {
                icon.classList.remove('animate-spin-reverse');
                void icon.offsetWidth;
                icon.classList.add('animate-spin-reverse');
            }
            let badge = btnResetGroupFilters.querySelector('.reset-feedback-badge');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'reset-feedback-badge';
                badge.innerText = 'รีเซ็ตแล้ว ✨';
                btnResetGroupFilters.appendChild(badge);
            }
            badge.classList.add('visible');
            setTimeout(() => {
                if (badge) badge.classList.remove('visible');
            }, 1400);

            // Reset allergies to "ไม่มีแพ้เลย"
            const allergyChips = document.querySelectorAll('#group-allergy-chips .host-allergy-chip');
            allergyChips.forEach(c => {
                if (c.dataset.allergen === '') c.classList.add('active');
                else c.classList.remove('active');
            });

            // Reset food chips to "ทั้งหมด"
            const foodChips = document.querySelectorAll('#group-food-chips .solo-chip');
            foodChips.forEach(c => {
                if (c.dataset.type === '') c.classList.add('active');
                else c.classList.remove('active');
            });

            // Reset distance to "ทุกระยะทาง" / 20.0
            if (groupDistSlider) groupDistSlider.value = 20.0;
            if (groupDistValLabel) groupDistValLabel.innerText = 'ไม่จำกัด (ทุกระยะ)';
            groupDistPills.forEach(p => {
                if (p.dataset.dist === '') p.classList.add('active');
                else p.classList.remove('active');
            });

            // Reset budget to "ทุกราคา"
            groupBudgetPills.forEach(p => {
                if (p.dataset.min === '0' && p.dataset.max === '9999') p.classList.add('active');
                else p.classList.remove('active');
            });

            updateGroupFilterBadge();
        });
    }

    // 1-Click Instant Swipe Hub (Ultra-frictionless)
    const btnSoloInstantSwipe = document.getElementById('btn-solo-instant-swipe');
    if (btnSoloInstantSwipe) {
        btnSoloInstantSwipe.addEventListener('click', () => {
            soundFx.playPop();
            btnSoloInstantSwipe.classList.add('btn-clicked');
            setTimeout(() => btnSoloInstantSwipe.classList.remove('btn-clicked'), 320);
            startSoloSwipe();
        });
    }

    const btnStartSoloSwipe = document.getElementById('btn-start-solo-swipe');
    if (btnStartSoloSwipe) {
        btnStartSoloSwipe.addEventListener('click', startSoloSwipe);
    }

    const btnSoloRetry = document.getElementById('btn-solo-retry');
    if (btnSoloRetry) {
        btnSoloRetry.addEventListener('click', () => {
            soundFx.playPop();
            const icon = btnSoloRetry.querySelector('i');
            if (icon) {
                icon.classList.remove('animate-dice-roll');
                void icon.offsetWidth;
                icon.classList.add('animate-dice-roll');
            }
            resetComboStreak();
            startSoloSwipe();
        });
    }

    const landingRoomInput = document.getElementById('landing-room-id');
    const btnLandingJoin = document.getElementById('btn-landing-join');
    const landingRoomStatus = document.getElementById('landing-room-status');
    let checkRoomDebounceTimer = null;

    if (landingRoomInput) {
        landingRoomInput.value = '';
        landingRoomInput.addEventListener('focus', () => {
            landingRoomInput.removeAttribute('readonly');
        });
        landingRoomInput.addEventListener('pointerdown', () => {
            landingRoomInput.removeAttribute('readonly');
        });

        // Anti-Autofill: purge any browser-injected username 'kitti' / 'kitt' on startup
        const purgeAutofill = () => {
            if (landingRoomInput && !landingRoomInput.dataset.userHasTyped) {
                const val = (landingRoomInput.value || '').trim().toLowerCase();
                if (val === 'kitt' || val === 'kitti') {
                    landingRoomInput.value = '';
                    if (landingRoomStatus) {
                        landingRoomStatus.classList.add('hidden');
                        landingRoomStatus.innerHTML = '';
                    }
                    landingRoomInput.style.borderColor = '';
                    landingRoomInput.style.boxShadow = '';
                }
            }
        };

        window.addEventListener('load', purgeAutofill);
        window.addEventListener('pageshow', purgeAutofill);
        setTimeout(purgeAutofill, 50);
        setTimeout(purgeAutofill, 150);
        setTimeout(purgeAutofill, 400);
        setTimeout(purgeAutofill, 800);
    }

    async function handleRoomCheckAndJoin(isAutoTrigger = false) {
        const roomId = landingRoomInput ? landingRoomInput.value.trim().toUpperCase() : '';
        if (!roomId || roomId.length !== 4) {
            soundFx.playTone(220, 'sawtooth', 0.12, 0.08);
            if (landingRoomInput) {
                landingRoomInput.classList.remove('input-shake');
                void landingRoomInput.offsetWidth;
                landingRoomInput.classList.add('input-shake');
                landingRoomInput.focus();
            }
            if (landingRoomStatus) {
                landingRoomStatus.classList.remove('hidden');
                landingRoomStatus.innerHTML = '<span style="color: var(--accent-pink);"><i class="fa-solid fa-circle-exclamation"></i> กรุณากรอกรหัสห้อง 4 หลัก</span>';
            }
            if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
            return;
        }

        // Show verifying indicator
        if (landingRoomStatus) {
            landingRoomStatus.classList.remove('hidden');
            landingRoomStatus.innerHTML = '<span style="color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin text-accent"></i> กำลังตรวจสอบรหัสห้อง...</span>';
        }
        if (btnLandingJoin) {
            btnLandingJoin.disabled = true;
            btnLandingJoin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        }

        const check = await verifyRoomExists(roomId);

        // Discard if user changed input while fetching
        if (landingRoomInput && landingRoomInput.value.trim().toUpperCase() !== roomId) {
            if (btnLandingJoin) {
                btnLandingJoin.disabled = false;
                btnLandingJoin.innerHTML = 'เข้าร่วม';
            }
            return;
        }

        if (btnLandingJoin) {
            btnLandingJoin.disabled = false;
            btnLandingJoin.innerHTML = 'เข้าร่วม';
        }

        if (!check.exists) {
            // Room does NOT exist (Error Prevention)
            soundFx.playTone(220, 'sawtooth', 0.15, 0.08);
            if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
            if (landingRoomInput) {
                landingRoomInput.classList.remove('input-ready');
                landingRoomInput.classList.remove('input-shake');
                void landingRoomInput.offsetWidth;
                landingRoomInput.classList.add('input-shake');
                landingRoomInput.style.borderColor = 'var(--accent-pink)';
                landingRoomInput.style.boxShadow = '0 0 14px rgba(255, 51, 119, 0.4)';
            }
            if (landingRoomStatus) {
                landingRoomStatus.classList.remove('hidden');
                landingRoomStatus.innerHTML = `<span style="color: var(--accent-pink); font-weight: 600;"><i class="fa-solid fa-circle-xmark"></i> ${check.message}</span>`;
            }
            showToast(check.message, 'error');
            return;
        }

        if (check.started) {
            // Room has already started voting
            soundFx.playTone(330, 'sawtooth', 0.12, 0.08);
            if (landingRoomInput) {
                landingRoomInput.classList.remove('input-ready');
                landingRoomInput.style.borderColor = 'var(--accent-orange)';
                landingRoomInput.style.boxShadow = '0 0 14px rgba(238, 120, 22, 0.4)';
            }
            if (landingRoomStatus) {
                landingRoomStatus.classList.remove('hidden');
                landingRoomStatus.innerHTML = `<span style="color: var(--accent-orange); font-weight: 600;"><i class="fa-solid fa-triangle-exclamation"></i> ${check.message}</span>`;
            }
            showToast(check.message, 'warning');
            return;
        }

        // Room is valid and waiting for members!
        soundFx.playTone(880, 'triangle', 0.08, 0.08);
        if (landingRoomInput) {
            landingRoomInput.classList.add('input-ready');
            landingRoomInput.style.borderColor = 'var(--accent-green)';
            landingRoomInput.style.boxShadow = '0 0 14px rgba(0, 255, 38, 0.4)';
        }
        if (landingRoomStatus) {
            landingRoomStatus.classList.remove('hidden');
            landingRoomStatus.innerHTML = `<span style="color: var(--accent-green); font-weight: 600;"><i class="fa-solid fa-circle-check"></i> ${check.message}</span>`;
        }
        showToast(check.message, 'success');

        setTimeout(() => {
            if (views.landing && views.landing.classList.contains('active')) {
                showView('join');
                const joinRoomIdEl = document.getElementById('join-room-id');
                if (joinRoomIdEl) joinRoomIdEl.value = roomId;

                const joinNameInput = document.getElementById('join-name');
                if (joinNameInput && !joinNameInput.value.trim()) {
                    joinNameInput.value = state.currentUser ? (state.currentUser.displayName || state.currentUser.username) : getRandomFoodNickname();
                }
            }
        }, isAutoTrigger ? 450 : 200);
    }

    if (landingRoomInput) {
        landingRoomInput.addEventListener('input', (e) => {
            const rawVal = (landingRoomInput.value || '').trim().toLowerCase();
            // Block untrusted synthetic autofill of "kitt" / "kitti"
            if (!landingRoomInput.dataset.userHasTyped && (rawVal === 'kitt' || rawVal === 'kitti') && !e.isTrusted) {
                landingRoomInput.value = '';
                return;
            }

            landingRoomInput.dataset.userHasTyped = 'true';
            landingRoomInput.value = landingRoomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
            landingRoomInput.style.borderColor = '';
            landingRoomInput.style.boxShadow = '';
            const len = landingRoomInput.value.length;
            if (len === 0) {
                landingRoomInput.dataset.userHasTyped = '';
            }

            if (len > 0) {
                soundFx.playTone(550 + len * 70, 'sine', 0.03, 0.04);
            }

            if (checkRoomDebounceTimer) {
                clearTimeout(checkRoomDebounceTimer);
            }

            if (len === 4) {
                if (btnLandingJoin) btnLandingJoin.classList.add('btn-ready');
                if (navigator.vibrate) navigator.vibrate(20);

                // Debounce check for seamless typing
                checkRoomDebounceTimer = setTimeout(() => {
                    handleRoomCheckAndJoin(true);
                }, 280);
            } else {
                landingRoomInput.classList.remove('input-ready');
                if (btnLandingJoin) btnLandingJoin.classList.remove('btn-ready');
                if (landingRoomStatus) {
                    landingRoomStatus.classList.add('hidden');
                    landingRoomStatus.innerHTML = '';
                }
            }
        });
    }

    if (btnLandingJoin) {
        btnLandingJoin.addEventListener('click', () => {
            handleRoomCheckAndJoin(false);
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

    const btnScanQrFile = document.getElementById('btn-scan-qr-file');
    const qrFileInput = document.getElementById('qr-file-input');
    if (btnScanQrFile && qrFileInput) {
        btnScanQrFile.addEventListener('click', () => {
            soundFx.playPop();
            qrFileInput.click();
        });
        qrFileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                scanQRFromImageFile(e.target.files[0]);
                e.target.value = '';
            }
        });
    }

    const btnCloseQrZoom = document.getElementById('btn-close-qr-zoom');
    if (btnCloseQrZoom) {
        btnCloseQrZoom.addEventListener('click', () => {
            closeQRZoomModal();
        });
    }

    const qrZoomModal = document.getElementById('qr-zoom-modal');
    if (qrZoomModal) {
        qrZoomModal.addEventListener('click', (e) => {
            if (e.target === qrZoomModal) {
                closeQRZoomModal();
            }
        });
    }

    const btnCopyQrZoomLink = document.getElementById('btn-copy-qr-zoom-link');
    if (btnCopyQrZoomLink) {
        btnCopyQrZoomLink.addEventListener('click', () => {
            const joinUrl = state.networkBaseUrl 
                ? `${state.networkBaseUrl}/?roomId=${state.roomId}&autoJoin=1` 
                : `${window.location.origin}/?roomId=${state.roomId}&autoJoin=1`;
            if (navigator.clipboard) {
                navigator.clipboard.writeText(joinUrl).then(() => {
                    if (navigator.vibrate) navigator.vibrate(30);
                    soundFx.playCopy();
                    showToast('คัดลอกลิงก์ห้องเรียบร้อยแล้ว! 🔗', 'success');
                }).catch(() => {
                    showToast(`ลิงก์เข้าห้อง: ${joinUrl}`, 'info');
                });
            } else {
                showToast(`ลิงก์เข้าห้อง: ${joinUrl}`, 'info');
            }
        });
    }

    // Swipe Mode Group Progress Popup Handlers
    const swipeModeBadgeEl = document.getElementById('swipe-mode-badge');
    if (swipeModeBadgeEl) {
        swipeModeBadgeEl.addEventListener('click', () => {
            if (!state.isSolo) {
                openGroupProgressModal();
            }
        });
    }

    const btnCloseGroupProgress = document.getElementById('btn-close-group-progress');
    if (btnCloseGroupProgress) {
        btnCloseGroupProgress.addEventListener('click', () => {
            closeGroupProgressModal();
        });
    }

    const btnDismissGroupProgress = document.getElementById('btn-dismiss-group-progress');
    if (btnDismissGroupProgress) {
        btnDismissGroupProgress.addEventListener('click', () => {
            closeGroupProgressModal();
        });
    }

    const modalGroupProgress = document.getElementById('modal-group-progress');
    if (modalGroupProgress) {
        modalGroupProgress.addEventListener('click', (e) => {
            if (e.target === modalGroupProgress) {
                closeGroupProgressModal();
            }
        });
    }

    // Leave Room Handler
    const handleLeaveRoom = () => {
        socket.disconnect();
        if (state.timerInterval) clearInterval(state.timerInterval);
        resetApplicationState();
        showView('landing');
        socket.connect();
        showToast('ออกจากห้องโหวตเรียบร้อยแล้ว 🍜', 'info');
    };

    const confirmLeaveRoom = (isSwipe = false) => {
        showCustomConfirm({
            title: isSwipe ? 'ออกจากห้องโหวต?' : 'ออกจากห้อง?',
            message: isSwipe
                ? 'การโหวตกำลังดำเนินอยู่ คุณแน่ใจหรือไม่ว่าจะออกจากห้องโหวต?'
                : 'คุณแน่ใจหรือไม่ว่าจะออกจากห้องนี้?',
            confirmText: 'ออกจากห้อง',
            cancelText: 'อยู่ต่อ',
            type: 'danger',
            icon: 'fa-right-from-bracket',
            onConfirm: handleLeaveRoom
        });
    };

    const btnLeaveLobby = document.getElementById('btn-leave-lobby');
    if (btnLeaveLobby) btnLeaveLobby.addEventListener('click', () => confirmLeaveRoom(false));

    const btnLeaveSwipe = document.getElementById('btn-leave-swipe');
    if (btnLeaveSwipe) btnLeaveSwipe.addEventListener('click', () => confirmLeaveRoom(true));

    // Copy Room ID to Clipboard with feedback
    document.getElementById('btn-copy-room-id').addEventListener('click', () => {
        if (!state.roomId) return;

        soundFx.playCopy();
        if (navigator.vibrate) navigator.vibrate(12);

        const copyText = state.roomId;
        const btn = document.getElementById('btn-copy-room-id');
        const originalHtml = btn.innerHTML;

        const setCopiedState = () => {
            btn.innerHTML = '<i class="fa-solid fa-check"></i> คัดลอกรหัสแล้ว! ✨';
            btn.classList.add('copied');
            btn.classList.add('copied-emerald');
            const rect = btn.getBoundingClientRect();
            spawnParticleBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 'sparkle');
            if (navigator.vibrate) navigator.vibrate(15);
            setTimeout(() => {
                btn.innerHTML = originalHtml;
                btn.classList.remove('copied');
                btn.classList.remove('copied-emerald');
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

    // Share Room Join Link (using https://ginder.onrender.com)
    const btnShareLink = document.getElementById('btn-share-room-link');
    if (btnShareLink) {
        btnShareLink.addEventListener('click', () => {
            if (!state.roomId) return;
            soundFx.playCopy();
            if (navigator.vibrate) navigator.vibrate(12);

            let baseUrl = (window.APP_URL || 'https://ginder.onrender.com').replace(/\/+$/, '');
            if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' && window.location.origin) {
                baseUrl = window.location.origin.replace(/\/+$/, '');
            } else if (state.networkBaseUrl) {
                baseUrl = state.networkBaseUrl.replace(/\/+$/, '');
            }
            const joinUrl = `${baseUrl}/?roomId=${state.roomId}&autoJoin=1`;

            if (navigator.share) {
                navigator.share({
                    title: 'GINDER - เข้าร่วมห้องเลือกกินอะไรดี',
                    text: `เข้ามาร่วมปัดเลือกเมนูอาหารด้วยกันในห้อง ${state.roomId}!`,
                    url: joinUrl
                }).catch(() => {});
            } else if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(joinUrl).then(() => {
                    const originalHtml = btnShareLink.innerHTML;
                    btnShareLink.innerHTML = '<i class="fa-solid fa-check"></i> คัดลอกลิงก์แล้ว! ✨';
                    btnShareLink.classList.add('copied-emerald');
                    setTimeout(() => {
                        btnShareLink.innerHTML = originalHtml;
                        btnShareLink.classList.remove('copied-emerald');
                    }, 2000);
                });
            } else {
                if (typeof showToast === 'function') {
                    showToast(`คัดลอกลิงก์: ${joinUrl}`, 'info', 4000);
                }
            }
        });
    }

    // Toggle Lobby Host Settings Summary Card (เปิด/ปิด ดูเงื่อนไขของ Host)
    const lobbySettingsHeader = document.getElementById('lobby-settings-header');
    const lobbySettingsCard = document.getElementById('lobby-host-settings');
    const lobbySettingsHint = document.getElementById('lobby-settings-hint');
    if (lobbySettingsHeader && lobbySettingsCard) {
        const toggleLobbySettings = () => {
            soundFx.playPop();
            if (navigator.vibrate) navigator.vibrate(8);
            const isOpen = lobbySettingsCard.classList.toggle('open');
            if (lobbySettingsHint) {
                lobbySettingsHint.innerText = isOpen ? 'แตะเพื่อย่อ' : 'แตะเพื่อดู';
            }
        };
        lobbySettingsHeader.addEventListener('click', toggleLobbySettings);
        lobbySettingsHeader.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleLobbySettings();
            }
        });
    }

    // Preferences View Actions
    document.getElementById('btn-back-to-landing').addEventListener('click', () => {
        const activeAllergies = document.querySelectorAll('#group-allergy-chips .host-allergy-chip.active:not([data-allergen=""])');
        const activeFood = document.querySelectorAll('#group-food-chips .solo-chip.active:not([data-type=""])');
        const distSliderEl = document.getElementById('pref-distance');
        const activeBudget = document.querySelector('#group-budget-pills .solo-budget-pill.active');

        const hasChanged = activeAllergies.length > 0 ||
                           activeFood.length > 0 ||
                           (distSliderEl && parseFloat(distSliderEl.value) < 20.0) ||
                           (activeBudget && !(activeBudget.dataset.min === '0' && activeBudget.dataset.max === '9999'));

        showView('landing');
        if (hasChanged) {
            showToast('ยกเลิกการตั้งค่าและย้อนกลับแล้ว', 'info');
        }
    });

    // Food Type Selectors (with "Select All" support for Join view)
    function initFoodTypeSelector(containerSelector) {
        const container = document.querySelector(containerSelector);
        if (!container) return;

        const allPill = container.querySelector('.type-pill[data-type="all"]');
        const specificPills = Array.from(container.querySelectorAll('.type-pill:not([data-type="all"])'));

        if (allPill) {
            allPill.addEventListener('click', () => {
                soundFx.playPop();
                if (navigator.vibrate) navigator.vibrate(8);

                const allActive = specificPills.every(p => p.classList.contains('active'));
                if (allActive || allPill.classList.contains('active')) {
                    allPill.classList.remove('active');
                    specificPills.forEach(p => p.classList.remove('active'));
                } else {
                    allPill.classList.add('active');
                    specificPills.forEach(p => p.classList.add('active'));
                }
                if (typeof updatePreferencesState === 'function') updatePreferencesState();
            });
        }

        specificPills.forEach(pill => {
            pill.addEventListener('click', () => {
                soundFx.playPop();
                if (navigator.vibrate) navigator.vibrate(8);

                pill.classList.toggle('active');

                // If all specific pills are active, mark "Select All" as active too
                const allActive = specificPills.every(p => p.classList.contains('active'));
                if (allPill) {
                    allPill.classList.toggle('active', allActive);
                }

                if (typeof updatePreferencesState === 'function') updatePreferencesState();
            });
        });
    }

    initFoodTypeSelector('.pref-food-type-selector');

    // Create Room Request
    document.getElementById('btn-create-room').addEventListener('click', () => {
        let name = document.getElementById('pref-name').value.trim();
        if (!name) {
            name = (state.currentUser && (state.currentUser.displayName || state.currentUser.username))
                   ? (state.currentUser.displayName || state.currentUser.username)
                   : getRandomFoodNickname();
            document.getElementById('pref-name').value = name;
            showToast(`ตั้งชื่อให้เป็น "${name}" เรียบร้อยแล้ว`, 'info');
        }

        // Prepend Host label for consistent display
        if (!name.startsWith('👑 ')) {
            name = '👑 ' + name;
        }

        // 1. Allergies (exclude empty "ไม่มีแพ้เลย")
        const allergies = [];
        document.querySelectorAll('#group-allergy-chips .host-allergy-chip.active').forEach(pill => {
            if (pill.dataset.allergen) {
                allergies.push(pill.dataset.allergen);
            }
        });

        // 2. Food craving types (exclude empty "ทั้งหมด")
        const selectedFood = [];
        document.querySelectorAll('#group-food-chips .solo-chip.active').forEach(pill => {
            if (pill.dataset.type) {
                selectedFood.push(pill.dataset.type);
            }
        });

        // 3. Distance
        const distSliderEl = document.getElementById('pref-distance');
        let selectedMaxDistance = null;
        if (distSliderEl && parseFloat(distSliderEl.value) < 20.0) {
            selectedMaxDistance = parseFloat(distSliderEl.value);
        }

        // 4. Budget
        const activeBudget = document.querySelector('#group-budget-pills .solo-budget-pill.active');
        const minPrice = activeBudget ? parseInt(activeBudget.dataset.min, 10) : 0;
        const maxPrice = activeBudget ? parseInt(activeBudget.dataset.max, 10) : 9999;

        state.name = name;
        state.isCreator = true;
        state.allergies = allergies;
        state.preferences = {
            minPrice: minPrice,
            maxPrice: maxPrice,
            maxDistance: selectedMaxDistance,
            foodTypes: selectedFood
        };

        // Clear targets from QR before creating new
        state.targetRoomId = null;
        state.autoJoin = false;

        socket.emit('create_room', {
            hostName: name,
            preferences: state.preferences,
            allergies: allergies
        });
    });

    // Random Nickname Generator Buttons (Quick Roll)
    const btnRandomPrefName = document.getElementById('btn-random-pref-name');
    if (btnRandomPrefName) {
        btnRandomPrefName.addEventListener('click', () => {
            soundFx.playPop();
            const icon = btnRandomPrefName.querySelector('i');
            if (icon) {
                icon.classList.remove('animate-dice-roll');
                void icon.offsetWidth;
                icon.classList.add('animate-dice-roll');
            }
            const nameInput = document.getElementById('pref-name');
            if (nameInput) {
                nameInput.value = getRandomFoodNickname();
                nameInput.classList.remove('input-char-pop');
                void nameInput.offsetWidth;
                nameInput.classList.add('input-char-pop');
                showToast(`สุ่มชื่อ: "${nameInput.value}"`, 'info');
            }
        });
    }

    const btnRandomJoinName = document.getElementById('btn-random-join-name');
    if (btnRandomJoinName) {
        btnRandomJoinName.addEventListener('click', () => {
            soundFx.playPop();
            const icon = btnRandomJoinName.querySelector('i');
            if (icon) {
                icon.classList.remove('animate-dice-roll');
                void icon.offsetWidth;
                icon.classList.add('animate-dice-roll');
            }
            const joinNameInput = document.getElementById('join-name');
            if (joinNameInput) {
                joinNameInput.value = getRandomFoodNickname();
                joinNameInput.classList.remove('input-char-pop');
                void joinNameInput.offsetWidth;
                joinNameInput.classList.add('input-char-pop');
                showToast(`สุ่มชื่อ: "${joinNameInput.value}"`, 'info');
            }
        });
    }

    // Join View Actions
    document.getElementById('btn-back-to-landing-join').addEventListener('click', () => {
        const name = document.getElementById('join-name').value.trim();
        const activeAllergies = document.querySelectorAll('.allergy-selector .allergy-pill.active').length;

        const hasInput = name.length > 0 || activeAllergies > 0;

        showView('landing');
        if (hasInput) {
            showToast('ย้อนกลับหน้าหลักแล้ว', 'info');
        }
    });

    // Multi-select for Allergies (Join and Host)
    document.querySelectorAll('#view-join .allergy-selector .allergy-pill, .host-allergy-selector .allergy-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            soundFx.playPop();
            if (navigator.vibrate) navigator.vibrate(8);
            pill.classList.toggle('active');
            if (typeof updatePrefAccordionBadges === 'function') {
                updatePrefAccordionBadges();
            }
        });
    });

    // Submit Join Request
    document.getElementById('btn-submit-join').addEventListener('click', async () => {
        const joinInput = document.getElementById('join-room-id');
        const roomId = joinInput ? joinInput.value.trim().toUpperCase() : '';
        let name = document.getElementById('join-name').value.trim();

        if (!roomId || roomId.length !== 4) {
            if (joinInput) {
                joinInput.classList.remove('input-shake');
                void joinInput.offsetWidth;
                joinInput.classList.add('input-shake');
                joinInput.focus();
            }
            if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
            showToast('กรุณากรอกรหัสห้อง 4 หลักให้ถูกต้อง', 'warning');
            return;
        }

        // Verify room existence before socket emit (Error Prevention)
        const btnSubmit = document.getElementById('btn-submit-join');
        if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังตรวจสอบห้อง...';
        }

        const check = await verifyRoomExists(roomId);

        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = 'เข้าห้องโหวต <i class="fa-solid fa-arrow-right"></i>';
        }

        if (!check.exists) {
            if (joinInput) {
                joinInput.classList.remove('input-shake');
                void joinInput.offsetWidth;
                joinInput.classList.add('input-shake');
                joinInput.focus();
            }
            if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
            showToast(check.message || `ไม่พบห้อง "${roomId}" หรือห้องอาจถูกปิดไปแล้ว`, 'error');
            return;
        }

        if (check.started) {
            showToast(check.message || `ห้อง "${roomId}" เริ่มการโหวตไปแล้ว ไม่สามารถเข้าร่วมได้`, 'warning');
            return;
        }

        if (!name) {
            name = (state.currentUser && (state.currentUser.displayName || state.currentUser.username))
                   ? (state.currentUser.displayName || state.currentUser.username)
                   : getRandomFoodNickname();
            document.getElementById('join-name').value = name;
            showToast(`ตั้งชื่อให้เป็น "${name}" เรียบร้อยแล้ว`, 'info');
        }

        // Get selected allergies
        const allergies = [];
        document.querySelectorAll('#view-join .allergy-selector .allergy-pill.active').forEach(pill => {
            if (pill.dataset.allergen) {
                allergies.push(pill.dataset.allergen);
            }
        });

        state.name = name;
        state.allergies = allergies;

        socket.emit('join_room', {
            roomId: roomId,
            name: name,
            allergies: allergies
        });
    });

    // Room ID Character Pop & Status Glow for Join Screen
    const joinRoomInput = document.getElementById('join-room-id');
    if (joinRoomInput) {
        joinRoomInput.addEventListener('input', () => {
            const raw = joinRoomInput.value.toUpperCase();
            joinRoomInput.value = raw;
            joinRoomInput.classList.remove('input-char-pop');
            void joinRoomInput.offsetWidth;
            joinRoomInput.classList.add('input-char-pop');

            if (raw.length === 4) {
                joinRoomInput.classList.add('input-code-ready');
                soundFx.playPop();
            } else {
                joinRoomInput.classList.remove('input-code-ready');
            }
        });
    }

    // Host - Start Game (Enforce > 1 member for group mode)
    document.getElementById('btn-start-game').addEventListener('click', () => {
        if (!state.isCreator) return;
        const userCount = state.users ? state.users.length : 0;
        if (userCount < 2) {
            soundFx.playPop();
            showToast('โหมดกลุ่มต้องมีสมาชิกมากกว่า 1 คนขึ้นไป กรุณารอเพื่อนเข้าห้องก่อนนะ!', 'warning');
            return;
        }
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
    const btnSwipeUndo = document.getElementById('btn-swipe-undo');
    if (btnSwipeUndo) {
        btnSwipeUndo.addEventListener('click', () => {
            if (btnSwipeUndo.disabled) return;
            btnSwipeUndo.classList.add('btn-clicked');
            setTimeout(() => btnSwipeUndo.classList.remove('btn-clicked'), 320);
            undoLastSwipe();
        });
    }

    document.getElementById('btn-swipe-left').addEventListener('click', () => {
        const btn = document.getElementById('btn-swipe-left');
        btn.classList.add('btn-clicked');
        setTimeout(() => btn.classList.remove('btn-clicked'), 320);
        triggerControlBtnReaction('dislike');
        swipeTopCard('left');
    });

    document.getElementById('btn-swipe-right').addEventListener('click', () => {
        const btn = document.getElementById('btn-swipe-right');
        btn.classList.add('btn-clicked');
        setTimeout(() => btn.classList.remove('btn-clicked'), 320);
        triggerControlBtnReaction('like');
        swipeTopCard('right');
    });

    // Gamification: Live Room Emote Reactions 💬
    document.querySelectorAll('.btn-reaction').forEach(btn => {
        btn.addEventListener('click', () => {
            const emoji = btn.dataset.emoji;
            if (emoji) {
                btn.classList.remove('squash-stretch');
                void btn.offsetWidth;
                btn.classList.add('squash-stretch');
                spawnFloatingEmojiPhysics(btn, emoji);
                sendRoomReaction(emoji);
            }
        });
    });

    document.getElementById('btn-toggle-info').addEventListener('click', () => {
        const btn = document.getElementById('btn-toggle-info');
        btn.classList.add('btn-clicked');
        setTimeout(() => btn.classList.remove('btn-clicked'), 320);
        soundFx.playPop();
        triggerControlBtnReaction('info');
        toggleTopCardDrawer();
    });

    // Keyboard Shortcuts for Swiping Experience (Ergonomics & Comfort)
    window.addEventListener('keydown', (e) => {
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return;

        const swipeView = document.getElementById('view-swipe');
        if (!swipeView || !swipeView.classList.contains('active')) return;

        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            const btn = document.getElementById('btn-swipe-left');
            if (btn) {
                btn.classList.add('btn-clicked');
                setTimeout(() => btn && btn.classList.remove('btn-clicked'), 320);
            }
            triggerControlBtnReaction('dislike');
            swipeTopCard('left');
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            const btn = document.getElementById('btn-swipe-right');
            if (btn) {
                btn.classList.add('btn-clicked');
                setTimeout(() => btn && btn.classList.remove('btn-clicked'), 320);
            }
            triggerControlBtnReaction('like');
            swipeTopCard('right');
        } else if (e.key === 'ArrowUp' || e.key === ' ') {
            e.preventDefault();
            const btn = document.getElementById('btn-toggle-info');
            if (btn) {
                btn.classList.add('btn-clicked');
                setTimeout(() => btn && btn.classList.remove('btn-clicked'), 320);
            }
            soundFx.playPop();
            triggerControlBtnReaction('info');
            toggleTopCardDrawer();
        } else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') {
            e.preventDefault();
            const btn = document.getElementById('btn-swipe-undo');
            if (btn && !btn.disabled) {
                btn.classList.add('btn-clicked');
                setTimeout(() => btn && btn.classList.remove('btn-clicked'), 320);
            }
            undoLastSwipe();
        }
    });





    // Restart Application
    const btnRestart = document.getElementById('btn-restart');
    if (btnRestart) {
        btnRestart.addEventListener('click', () => {
            if (typeof soundFx !== 'undefined' && soundFx.play) soundFx.play('click');
            btnRestart.classList.add('btn-clicked');
            setTimeout(() => btnRestart.classList.remove('btn-clicked'), 320);

            try {
                if (socket && typeof socket.disconnect === 'function') socket.disconnect();
            } catch (e) {
                console.warn('Socket disconnect error:', e);
            }
            if (state.timerInterval) clearInterval(state.timerInterval);
            try {
                resetApplicationState();
            } catch (e) {
                console.error('resetApplicationState error:', e);
            }
            showView('landing');
            window.scrollTo({ top: 0, behavior: 'smooth' });
            try {
                if (socket && typeof socket.connect === 'function') socket.connect();
            } catch (e) {
                console.warn('Socket connect error:', e);
            }
        });
    }

    // Result Celebration Popup (Decided / Matched / Solo)
    const celebrationPopup = document.getElementById('result-celebration-popup');
    if (celebrationPopup) {
        const dismissAction = (e) => {
            if (e && e.type === 'touchend') e.preventDefault();
            dismissCelebrationPopup();
        };
        celebrationPopup.addEventListener('click', dismissAction);
        celebrationPopup.addEventListener('touchend', dismissAction, { passive: false });
    }
    const closeCelebrationBtn = document.getElementById('btn-close-celebration-popup');
    if (closeCelebrationBtn) {
        const closeAction = (e) => {
            if (e) {
                e.stopPropagation();
                if (e.type === 'touchend') e.preventDefault();
            }
            dismissCelebrationPopup();
        };
        closeCelebrationBtn.addEventListener('click', closeAction);
        closeCelebrationBtn.addEventListener('touchend', closeAction, { passive: false });
    }

    // Quick Guest / Return to Main App
    const btnQuickGuest = document.getElementById('btn-quick-guest-login');
    if (btnQuickGuest) {
        btnQuickGuest.addEventListener('click', () => {
            btnQuickGuest.disabled = true;
            btnQuickGuest.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังเข้าสู่ระบบ...';
            triggerQuickGuestLogin(() => {
                btnQuickGuest.disabled = false;
                btnQuickGuest.innerHTML = '<i class="fa-solid fa-bolt" style="color: #fde047;"></i> เข้าใช้งานทันทีโดยไม่ต้องล็อกอิน (โหมดทั่วไป)';
                showView('landing');
                showToast('เข้าใช้งานในโหมดทั่วไป สามารถปัดเลือกร้านได้ทันที 🍜', 'info');
            });
        });
    }

    const btnAuthBack = document.getElementById('btn-auth-back-to-app');
    if (btnAuthBack) {
        btnAuthBack.addEventListener('click', () => {
            showView('landing');
        });
    }

    function attachEmailAvailabilityCheck(inputId, feedbackId, feedbackTextId) {
        const inputEl = document.getElementById(inputId);
        const feedbackEl = document.getElementById(feedbackId);
        const feedbackTextEl = document.getElementById(feedbackTextId);
        if (!inputEl || !feedbackEl) return;
        let timer = null;

        inputEl.addEventListener('input', () => {
            if (timer) clearTimeout(timer);
            const val = (inputEl.value || '').trim();
            if (!val) {
                feedbackEl.classList.add('hidden');
                feedbackEl.style.display = 'none';
                inputEl.style.borderColor = '';
                inputEl.setCustomValidity('');
                return;
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(val)) {
                feedbackEl.classList.remove('hidden');
                feedbackEl.style.display = 'flex';
                if (feedbackTextEl) feedbackTextEl.textContent = 'รูปแบบอีเมลไม่ถูกต้อง';
                inputEl.style.borderColor = '#ef4444';
                inputEl.setCustomValidity('รูปแบบอีเมลไม่ถูกต้อง');
                return;
            }

            timer = setTimeout(() => {
                fetch(`/api/auth/check-email?email=${encodeURIComponent(val)}`)
                    .then(res => res.json())
                    .then(data => {
                        if (!data.available) {
                            feedbackEl.classList.remove('hidden');
                            feedbackEl.style.display = 'flex';
                            if (feedbackTextEl) feedbackTextEl.textContent = data.message || 'อีเมลนี้ถูกใช้งานในระบบแล้ว';
                            inputEl.style.borderColor = '#ef4444';
                            inputEl.setCustomValidity(data.message || 'อีเมลนี้ถูกใช้งานในระบบแล้ว');
                        } else {
                            feedbackEl.classList.add('hidden');
                            feedbackEl.style.display = 'none';
                            inputEl.style.borderColor = '';
                            inputEl.setCustomValidity('');
                        }
                    })
                    .catch(() => {});
            }, 350);
        });
    }

    // --- GOOGLE & FACEBOOK SOCIAL LOGIN SYSTEM EVENT LISTENERS ---
    const btnGoogleLogin = document.getElementById('btn-google-login');
    const btnFacebookLogin = document.getElementById('btn-facebook-login');

    if (btnGoogleLogin) {
        btnGoogleLogin.addEventListener('click', () => initiateOAuthLogin('google'));
    }

    if (btnFacebookLogin) {
        btnFacebookLogin.addEventListener('click', () => initiateOAuthLogin('facebook'));
    }
}

function updatePrefAccordionBadges() {
    // 1. Allergies Badge
    const badgeAllergies = document.getElementById('badge-pref-allergies');
    if (badgeAllergies) {
        const activeAllergies = document.querySelectorAll('.host-allergy-selector .allergy-pill.active');
        if (activeAllergies.length === 0) {
            badgeAllergies.innerText = 'ไม่แพ้ / ทานได้หมด';
        } else if (activeAllergies.length === 1) {
            badgeAllergies.innerText = activeAllergies[0].innerText.trim();
        } else {
            badgeAllergies.innerText = `${activeAllergies[0].innerText.trim()} +${activeAllergies.length - 1}`;
        }
    }

    // 2. Food Types Badge
    const badgeFood = document.getElementById('badge-pref-food-types');
    if (badgeFood) {
        const allPill = document.getElementById('pref-food-type-all');
        const activeTypes = document.querySelectorAll('.pref-food-type-selector .type-pill.active:not(#pref-food-type-all)');
        if (allPill && allPill.classList.contains('active')) {
            badgeFood.innerText = 'เลือกทั้งหมด';
        } else if (activeTypes.length === 0) {
            badgeFood.innerText = 'เลือกทั้งหมด';
        } else if (activeTypes.length === 1) {
            badgeFood.innerText = activeTypes[0].innerText.trim();
        } else {
            badgeFood.innerText = `${activeTypes[0].innerText.trim()} +${activeTypes.length - 1}`;
        }
    }

    // 3. Budget Badge
    const badgeBudget = document.getElementById('badge-pref-budget');
    if (badgeBudget) {
        const activeBudget = document.querySelector('.budget-selector .budget-pill.active');
        if (activeBudget) {
            const span = activeBudget.querySelector('span');
            badgeBudget.innerText = span ? span.innerText.trim() : activeBudget.innerText.trim();
        } else {
            badgeBudget.innerText = '< 100฿';
        }
    }

    // 4. Distance Badge
    const badgeDist = document.getElementById('badge-pref-distance');
    const distInput = document.getElementById('pref-distance');
    if (badgeDist && distInput) {
        badgeDist.innerText = `${parseFloat(distInput.value).toFixed(1)} กม.`;
    }
}

function initPrefAccordion() {
    const accordion = document.getElementById('pref-accordion');
    if (!accordion) return;

    const items = accordion.querySelectorAll('.pref-accordion-item');
    items.forEach(item => {
        const header = item.querySelector('.pref-accordion-header');
        if (!header) return;

        header.addEventListener('click', () => {
            soundFx.playPop();
            const isOpen = item.classList.contains('open');

            // Close all other items in accordion ("เปิดเลือกทีละอันๆ")
            items.forEach(it => {
                it.classList.remove('open');
                const hdr = it.querySelector('.pref-accordion-header');
                if (hdr) hdr.setAttribute('aria-expanded', 'false');
            });

            // If this item was closed, open it!
            if (!isOpen) {
                item.classList.add('open');
                header.setAttribute('aria-expanded', 'true');
            }
        });
    });

    updatePrefAccordionBadges();
}

function updatePreferencesState() {
    const selectedTypes = [];
    document.querySelectorAll('.pref-food-type-selector .type-pill.active').forEach(pill => {
        if (pill.dataset.type && pill.dataset.type !== 'all' && !selectedTypes.includes(pill.dataset.type)) {
            selectedTypes.push(pill.dataset.type);
        }
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

    updatePrefAccordionBadges();
}

// --- SOLO MODE HANDLERS ---
async function startSoloSwipe() {
    const btn = document.getElementById('btn-start-solo-swipe');
    const btnInstant = document.getElementById('btn-solo-instant-swipe');

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังเตรียมสำรับ...';
    }
    if (btnInstant) {
        btnInstant.disabled = true;
        btnInstant.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังจัดสำรับร้านเด็ด...';
    }

    // Read selected food craving types from solo filter chips
    const activeSoloPills = document.querySelectorAll('#solo-food-chips .solo-chip.active');
    const selectedTypes = [];
    activeSoloPills.forEach(pill => {
        if (pill.dataset.type) selectedTypes.push(pill.dataset.type);
    });

    // Read distance filter for solo mode
    const soloDistSliderEl = document.getElementById('solo-pref-distance');
    let selectedMaxDistance = null;
    if (soloDistSliderEl && parseFloat(soloDistSliderEl.value) < 20.0) {
        selectedMaxDistance = parseFloat(soloDistSliderEl.value);
    }

    // Read budget filter for solo mode
    const activeSoloBudget = document.querySelector('#solo-budget-pills .solo-budget-pill.active');
    const minPrice = activeSoloBudget ? (parseInt(activeSoloBudget.dataset.min, 10) || 0) : 0;
    const maxPrice = activeSoloBudget ? (parseInt(activeSoloBudget.dataset.max, 10) || 9999) : 9999;

    state.preferences = {
        minPrice: minPrice,
        maxPrice: maxPrice,
        maxDistance: selectedMaxDistance,
        foodTypes: selectedTypes
    };
    // Read allergy filter for solo mode
    const activeSoloAllergies = [];
    const soloNoneChip = document.querySelector('#solo-allergy-chips .solo-allergy-chip[data-allergen=""]');
    const isNoneActive = soloNoneChip && soloNoneChip.classList.contains('active');

    if (isNoneActive) {
        state.allergies = [];
    } else {
        document.querySelectorAll('#solo-allergy-chips .solo-allergy-chip.active:not([data-allergen=""])').forEach(chip => {
            if (chip.dataset.allergen) activeSoloAllergies.push(chip.dataset.allergen);
        });
        if (activeSoloAllergies.length > 0) {
            state.allergies = activeSoloAllergies;
        } else {
            state.allergies = (state.currentUser && Array.isArray(state.currentUser.allergies)) ? [...state.currentUser.allergies] : [];
        }
    }
    state.isSolo = true;
    showView('swipe');
    renderSkeletonDeck();

    const coords = state.userLocation ? {
        latitude: state.userLocation.lat,
        longitude: state.userLocation.lng
    } : null;

    try {
        const res = await fetch('/api/solo/deck', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                preferences: state.preferences,
                allergies: state.allergies,
                coords: coords
            })
        });

        const data = await res.json();
        if (!data.success || !data.restaurants || data.restaurants.length === 0) {
            showToast('ไม่พบร้านอาหารที่ตรงเงื่อนไข ระบบจะลองขยายระยะทางให้', 'warning');
            showView('landing');
            return;
        }

        state.restaurants = data.restaurants;
        state.currentIndex = 0;
        state.votes = {};
        state.soloLiked = [];
        state.isSolo = true;
        state.roomId = null;
        resetComboStreak();

        renderDeck();
        updateProgressBar();
        showToast(`พบร้านเด็ด ${data.restaurants.length} ร้าน! ปัดเลือกร้านที่ชอบได้เลย 🍜`, 'success');
    } catch (err) {
        console.error('Failed to start solo swipe:', err);
        showToast('เกิดข้อผิดพลาดในการโหลดรายการร้านอาหาร', 'error');
        showView('landing');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = 'เริ่มปัดเลย 🍽️ <i class="fa-solid fa-arrow-right"></i>';
        }
        if (btnInstant) {
            btnInstant.disabled = false;
            btnInstant.innerHTML = '<i class="fa-solid fa-bolt"></i> ปัดหาร้านกินเลย! (Instant Swipe)';
        }
    }
}


function renderLobbyQRCode(joinUrl) {
    const canvas = document.getElementById('lobby-qr');
    const container = document.getElementById('lobby-qr-container');
    if (!canvas) return;

    try {
        if (typeof QRious !== 'undefined') {
            new QRious({
                element: canvas,
                value: joinUrl,
                size: 280,
                level: 'M',
                background: '#ffffff',
                foreground: '#100923'
            });
        } else {
            console.warn('[QR] QRious not loaded yet, trying online QR generator fallback...');
            const fallbackImg = new Image();
            fallbackImg.crossOrigin = 'anonymous';
            fallbackImg.onload = () => {
                const ctx = canvas.getContext('2d');
                canvas.width = 280;
                canvas.height = 280;
                ctx.drawImage(fallbackImg, 0, 0, 280, 280);
            };
            fallbackImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=4&data=${encodeURIComponent(joinUrl)}`;
        }
    } catch (err) {
        console.error('[QR] Failed to render lobby QR code:', err);
    }

    // Also render zoom QR code for enlarged modal
    const zoomCanvas = document.getElementById('lobby-qr-zoom');
    if (zoomCanvas) {
        try {
            if (typeof QRious !== 'undefined') {
                new QRious({
                    element: zoomCanvas,
                    value: joinUrl,
                    size: 340,
                    level: 'M',
                    background: '#ffffff',
                    foreground: '#100923'
                });
            } else {
                const fallbackZoomImg = new Image();
                fallbackZoomImg.crossOrigin = 'anonymous';
                fallbackZoomImg.onload = () => {
                    const zctx = zoomCanvas.getContext('2d');
                    zoomCanvas.width = 340;
                    zoomCanvas.height = 340;
                    zctx.drawImage(fallbackZoomImg, 0, 0, 340, 340);
                };
                fallbackZoomImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=340x340&margin=4&data=${encodeURIComponent(joinUrl)}`;
            }
        } catch (e) {}
    }

    const zoomRoomIdEl = document.getElementById('qr-zoom-room-id');
    if (zoomRoomIdEl && state.roomId) {
        zoomRoomIdEl.textContent = state.roomId;
    }

    if (container && !container._hasCopyListener) {
        container._hasCopyListener = true;
        container.addEventListener('click', () => {
            openQRZoomModal(joinUrl);
        });
    }
}

function openQRZoomModal(joinUrl) {
    const modal = document.getElementById('qr-zoom-modal');
    if (!modal) return;
    if (window.soundFx && typeof soundFx.playPop === 'function') soundFx.playPop();

    const zoomRoomIdEl = document.getElementById('qr-zoom-room-id');
    if (zoomRoomIdEl && state.roomId) {
        zoomRoomIdEl.textContent = state.roomId;
    }

    modal.classList.remove('hidden');

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(joinUrl).then(() => {
            if (navigator.vibrate) navigator.vibrate(30);
            showToast('คัดลอกลิงก์ห้องแล้ว! ✨ และขยาย QR Code เต็มจอ', 'success', 2000);
        }).catch(() => {});
    }
}

function closeQRZoomModal() {
    const modal = document.getElementById('qr-zoom-modal');
    if (modal) modal.classList.add('hidden');
}

/**
 * Render Host room creation criteria in Lobby so Host and all members clearly see what was chosen
 * @param {Object} preferences - Food types, max distance, min/max price set by host
 * @param {Array} allAllergies - Aggregated allergies across host and all members in room
 * @param {Array} hostAllergies - Allergies specified by host
 */
function renderLobbyHostSettings(preferences, allAllergies, hostAllergies) {
    const container = document.getElementById('lobby-host-settings');
    if (!container) return;

    preferences = preferences || state.preferences || {};
    const allergies = (Array.isArray(allAllergies) && allAllergies.length > 0)
        ? allAllergies
        : (Array.isArray(hostAllergies) && hostAllergies.length > 0 ? hostAllergies : (state.allergies || []));

    // 1. Food types
    const foodEl = document.getElementById('lobby-setting-food');
    if (foodEl) {
        const types = Array.isArray(preferences.foodTypes) ? preferences.foodTypes.filter(t => t && t !== 'all') : [];
        if (types.length === 0) {
            foodEl.innerHTML = `<span class="setting-pill pill-all"><i class="fa-solid fa-utensils"></i> ทุกประเภทอาหาร</span>`;
        } else {
            foodEl.innerHTML = types.map(t => `<span class="setting-pill"><i class="fa-solid fa-tag"></i> ${escapeHtml(t)}</span>`).join('');
        }
    }

    // 2. Max distance
    const distEl = document.getElementById('lobby-setting-distance');
    if (distEl) {
        const maxDist = preferences.maxDistance;
        if (!maxDist || isNaN(maxDist) || parseFloat(maxDist) >= 20.0) {
            distEl.innerHTML = `<span class="setting-pill"><i class="fa-solid fa-globe"></i> ไม่จำกัด (ทุกระยะ)</span>`;
        } else {
            distEl.innerHTML = `<span class="setting-pill"><i class="fa-solid fa-location-dot"></i> ไม่เกิน ${parseFloat(maxDist)} กม.</span>`;
        }
    }

    // 3. Budget
    const budgetEl = document.getElementById('lobby-setting-budget');
    if (budgetEl) {
        const minP = preferences.minPrice !== undefined ? parseInt(preferences.minPrice, 10) : 0;
        const maxP = preferences.maxPrice !== undefined ? parseInt(preferences.maxPrice, 10) : 9999;
        if (minP === 0 && maxP >= 9999) {
            budgetEl.innerHTML = `<span class="setting-pill"><i class="fa-solid fa-coins"></i> ทุกระดับราคา</span>`;
        } else if (maxP <= 99) {
            budgetEl.innerHTML = `<span class="setting-pill"><i class="fa-solid fa-coins"></i> ต่ำกว่า 100฿ ($)</span>`;
        } else if (minP >= 100 && maxP <= 300) {
            budgetEl.innerHTML = `<span class="setting-pill"><i class="fa-solid fa-coins"></i> 100 - 300฿ ($$)</span>`;
        } else if (minP >= 301) {
            budgetEl.innerHTML = `<span class="setting-pill"><i class="fa-solid fa-coins"></i> มากกว่า 300฿ ($$$)</span>`;
        } else {
            budgetEl.innerHTML = `<span class="setting-pill"><i class="fa-solid fa-coins"></i> ${minP} - ${maxP}฿</span>`;
        }
    }

    // 4. Allergies (Aggregated from all members in room)
    const allergyEl = document.getElementById('lobby-setting-allergies');
    if (allergyEl) {
        if (!allergies || allergies.length === 0) {
            allergyEl.innerHTML = `<span class="setting-pill pill-safe"><i class="fa-solid fa-circle-check"></i> ไม่มีใครแพ้อะไร (ทานได้ทุกอย่าง)</span>`;
        } else {
            allergyEl.innerHTML = allergies.map(a => `<span class="setting-pill pill-allergy"><i class="fa-solid fa-ban"></i> ตัดเมนูที่มี${escapeHtml(a)}</span>`).join('');
        }
    }
}

// --- SOCKET EVENTS ---

socket.on('room_created', (data) => {
    state.roomId = data.roomId;
    if (data.networkUrl) state.networkBaseUrl = data.networkUrl;
    state.isCreator = true;

    if (data.preferences || data.allergies) {
        renderLobbyHostSettings(data.preferences, data.allergies, data.allergies);
    } else if (state.preferences) {
        renderLobbyHostSettings(state.preferences, state.allergies, state.allergies);
    }

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

    if (data.preferences || data.allAllergies) {
        renderLobbyHostSettings(data.preferences, data.allAllergies, data.hostAllergies);
    } else if (state.preferences) {
        renderLobbyHostSettings(state.preferences, state.allergies, state.allergies);
    }

    // Draw QR Code using canonical production URL or network Base URL
    let baseUrl = (window.APP_URL || 'https://ginder.onrender.com').replace(/\/+$/, '');
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' && window.location.origin) {
        baseUrl = window.location.origin.replace(/\/+$/, '');
    } else if (state.networkBaseUrl) {
        baseUrl = state.networkBaseUrl.replace(/\/+$/, '');
    }
    const joinUrl = `${baseUrl}/?roomId=${data.roomId}&autoJoin=1`;
    renderLobbyQRCode(joinUrl);

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
    showToast(data.message, 'warning');
    showView('landing');
});

socket.on('kicked', (data) => {
    showToast('คุณถูกเตะออกจากห้องกลุ่ม', 'error');
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

    // Render Host Settings in Lobby
    if (data.preferences || data.allAllergies) {
        renderLobbyHostSettings(data.preferences, data.allAllergies, data.hostAllergies);
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

        const safeName = escapeHtml(user.name);
        const safeInitial = escapeHtml(user.name ? user.name.charAt(0) : '?');
        let myNameHtml = safeName;
        if (isMe) {
            myNameHtml = `<span>${safeName} (คุณ)</span> <button class="btn-edit-my-name" style="background: none; border: none; color: var(--accent-orange); cursor: pointer; padding: 0.1rem 0.3rem; font-size: 0.85rem;" title="แก้ไขชื่อเล่นของคุณ"><i class="fa-solid fa-pen-to-square"></i></button>`;
        }

        row.innerHTML = `
            <div class="member-info">
                <div class="member-avatar">${safeInitial}</div>
                <div>
                    <div class="member-name" style="display: flex; align-items: center; gap: 0.3rem;">${myNameHtml}</div>
                    ${user.allergies && user.allergies.length ? `<span class="member-status">แพ้: ${user.allergies.map(escapeHtml).join(', ')}</span>` : ''}
                </div>
            </div>
            ${rightSideHtml}
        `;
        membersList.appendChild(row);

        if (isMe) {
            const editBtn = row.querySelector('.btn-edit-my-name');
            if (editBtn) {
                editBtn.addEventListener('click', () => {
                    showCustomPrompt('แก้ไขชื่อเล่นที่คุณต้องการให้เพื่อนเห็นในห้อง:', user.name, (newName) => {
                        if (newName && newName.trim() && newName.trim() !== user.name) {
                            state.name = newName.trim();
                            socket.emit('update_member', {
                                roomId: state.roomId,
                                name: state.name
                            });
                            showToast(`เปลี่ยนชื่อเล่นเป็น "${state.name}" แล้ว`, 'success');
                        }
                    });
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
                showCustomConfirm({
                    title: 'เตะสมาชิกออกจากห้อง?',
                    message: `คุณต้องการนำคุณ "${userName}" ออกจากห้องใช่หรือไม่?`,
                    confirmText: 'เตะออก',
                    cancelText: 'ยกเลิก',
                    type: 'danger',
                    icon: 'fa-user-xmark',
                    onConfirm: () => {
                        socket.emit('kick_user', { roomId: state.roomId, userId: userId });
                        showToast(`นำคุณ ${userName} ออกจากห้องแล้ว`, 'warning');
                    }
                });
            });
        });
    }

    // Control Start Button visibility & Minimum 2 members requirement for group
    const startBtn = document.getElementById('btn-start-game');
    const waitMsg = document.getElementById('host-wait-msg');
    const userCount = data.users ? data.users.length : 0;

    if (state.isCreator) {
        startBtn.classList.remove('hidden');
        waitMsg.classList.add('hidden');

        if (userCount < 2) {
            startBtn.disabled = true;
            startBtn.classList.add('btn-disabled');
            startBtn.innerHTML = '<i class="fa-solid fa-users"></i> รอเพื่อนเข้าห้อง (ต้องการอย่างน้อย 2 คน)';
            startBtn.title = 'โหมดกลุ่มต้องมีสมาชิกมากกว่า 1 คนเพื่อเริ่มปัดโหวต';
        } else {
            startBtn.disabled = false;
            startBtn.classList.remove('btn-disabled');
            startBtn.innerHTML = `<i class="fa-solid fa-play"></i> เริ่มการโหวตเลย! (${userCount} คนพร้อมแล้ว)`;
            startBtn.title = 'กดเพื่อเริ่มการโหวตกลุ่ม';
        }
    } else {
        startBtn.classList.add('hidden');
        waitMsg.classList.remove('hidden');
        if (userCount < 2) {
            waitMsg.innerHTML = '<div class="spinner"></div><span>รอเพื่อนเข้าร่วมห้องเพิ่ม (ต้องการอย่างน้อย 2 คนขึ้นไป)...</span>';
        } else {
            waitMsg.innerHTML = `<div class="spinner"></div><span>สมาชิกครบ ${userCount} คนแล้ว รอหัวหน้าห้องกดเริ่มโหวต...</span>`;
        }
    }
});

socket.on('start_game_error', (data) => {
    soundFx.playPop();
    showToast(data.message || 'ไม่สามารถเริ่มโหวตกลุ่มได้', 'warning');
});

socket.on('game_started', (data) => {
    state.restaurants = data.restaurants;
    state.currentIndex = 0;
    state.votes = {};
    resetComboStreak();

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

// Gamification: Live Room Emote Event
socket.on('room_reaction', (data) => {
    if (data && data.emoji) {
        spawnFloatingReaction(data.emoji, data.senderName || 'เพื่อน');
        if (typeof soundFx !== 'undefined' && soundFx.playPop) {
            soundFx.playPop();
        }
    }
});



socket.on('match_found', (data) => {
    resetComboStreak();
    const r = data.restaurant;
    const isFallback = data.isFallback;

    // Stop local timer animations
    clearInterval(state.timerInterval);

    // Wait 350ms for the swipe animation to finish before showing the results screen
    setTimeout(() => {
        renderResultScreen(r, {
            isSolo: false,
            isFallback: isFallback,
            reason: data.reason
        });
    }, 350);
});

// Celebration Popup Manager (Auto-dismiss popup for DECIDED / MATCHED / SOLO)
let celebrationPopupTimer = null;

function triggerMatchCelebrationPopup(options = {}) {
    const popup = document.getElementById('result-celebration-popup');
    if (!popup) return;

    if (celebrationPopupTimer) {
        clearTimeout(celebrationPopupTimer);
        celebrationPopupTimer = null;
    }

    popup.classList.remove('hidden', 'fade-out');
    // Force DOM reflow so WebKit / iOS Safari triggers CSS keyframe animation smoothly
    void popup.offsetWidth;
    popup.classList.add('active');

    // Auto-dismiss after 2.4s so user can focus on the matched card and navigation button
    celebrationPopupTimer = setTimeout(() => {
        dismissCelebrationPopup();
    }, 2400);
}

function dismissCelebrationPopup() {
    const popup = document.getElementById('result-celebration-popup');
    if (!popup || popup.classList.contains('hidden')) return;

    if (celebrationPopupTimer) {
        clearTimeout(celebrationPopupTimer);
        celebrationPopupTimer = null;
    }

    popup.classList.add('fade-out');
    popup.classList.remove('active');
    setTimeout(() => {
        popup.classList.add('hidden');
        popup.classList.remove('fade-out');
    }, 280);
}

// Render Match / Solo Result Screen
function renderResultScreen(r, options = {}) {
    // End of round: reset combo counter so next round starts fresh from 1
    resetComboStreak();

    // Play lightweight celebratory confetti (optimized for 60fps, no lag)
    triggerConfettiExplosion();

    // Play celebratory sound & gentle vibration
    soundFx.playMatch();
    if (navigator.vibrate) navigator.vibrate([30, 50]);

    showView('result');

    const stamp = document.getElementById('result-stamp');
    const subtitle = document.getElementById('result-subtitle');
    const badgeEl = document.getElementById('match-consensus-badge');
    const percentEl = document.getElementById('match-consensus-percent');
    const retryBtn = document.getElementById('btn-solo-retry');

    if (options.isSolo) {
        if (retryBtn) retryBtn.classList.remove('hidden');
        if (badgeEl) badgeEl.style.display = 'none';
        if (stamp) {
            stamp.innerHTML = options.stampText || "<i class='fa-solid fa-utensils'></i> SOLO WINNER!";
            stamp.className = options.stampClass || "match-stamp animate-bounce";
        }
        if (subtitle) {
            subtitle.innerHTML = options.subtitleHtml || "มื้อนี้เลือกร้านนี้เลย ทานให้อร่อยนะครับ! 🍽️";
        }
    } else {
        if (retryBtn) retryBtn.classList.add('hidden');
        if (options.isFallback) {
            if (stamp) {
                stamp.innerText = "DECIDED! 🎲";
                stamp.className = "match-stamp fallback animate-bounce";
            }
            if (subtitle) subtitle.innerHTML = `<i class="fa-solid fa-clock"></i> ${options.reason || 'หมดเวลา'}`;
            if (badgeEl) badgeEl.style.display = 'none';
        } else {
            if (stamp) {
                stamp.innerHTML = "<i class='fa-solid fa-heart'></i> MATCHED!";
                stamp.className = "match-stamp animate-bounce";
            }
            if (subtitle) subtitle.innerText = "ใจตรงกันเป็นมติเอกฉันท์! ทานให้อร่อยนะครับ";
            if (badgeEl) {
                badgeEl.style.display = 'inline-flex';
                animateCountUp(percentEl, 0, 100, 1200);
            }
        }
    }

    // Trigger celebratory popup announcement that auto-dismisses
    triggerMatchCelebrationPopup(options);

    const cardContainer = document.getElementById('matched-restaurant-card');

    if (r) {
        const distNum = (r.distance !== null && r.distance !== undefined) ? parseFloat(r.distance) : NaN;
        const distDisplay = !isNaN(distNum) ? `${distNum.toFixed(1)} กม.` : 'ไม่ระบุระยะทาง';

        cardContainer.innerHTML = `
            <div class="matched-image-wrapper">
                <img src="${r.image}" alt="${r.name}" class="matched-image" onerror="this.onerror=null; this.src='https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&auto=format&fit=crop';">
                <div class="restaurant-watermark-overlay" aria-hidden="true">
                    <span class="watermark-text">ภาพนี้เป็นเพียงภาพจำลองเว็บ</span>
                </div>
                <div class="card-mockup-badge"><i class="fa-solid fa-camera"></i> ภาพนี้เป็นเพียงภาพจำลองเว็บ</div>
                <div class="matched-result-corner-badge ${options.isFallback ? 'decided' : (options.isSolo ? 'solo' : 'match')}">
                    ${options.isFallback ? '<i class="fa-solid fa-dice animate-dice-roll"></i> DECIDED' : (options.isSolo ? '<i class="fa-solid fa-utensils"></i> WINNER' : '<i class="fa-solid fa-heart"></i> MATCHED')}
                </div>
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

        // Animate winner rating stars pop
        animateWinnerStars(cardContainer);

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
                <p class="matched-desc">ไม่มีร้านที่ตรงกับความต้องการและข้อจำกัด</p>
            </div>
        `;
        document.getElementById('btn-open-map').classList.add('hidden');
    }
}

window.renderResultScreen = renderResultScreen;
window.triggerMatchCelebrationPopup = triggerMatchCelebrationPopup;
window.dismissCelebrationPopup = dismissCelebrationPopup;

// --- SKELETON SHIMMER & UNDO MANAGEMENT ---
function renderSkeletonDeck() {
    const deck = document.getElementById('swipe-deck');
    if (!deck) return;

    // Empty state must remain strictly hidden while loading / cards active
    const emptyStateEl = deck.querySelector('.deck-empty-state');
    if (emptyStateEl) emptyStateEl.classList.add('hidden');
    const emptyStateHtml = emptyStateEl ? emptyStateEl.outerHTML : `
        <div class="deck-empty-state hidden">
            <i class="fa-solid fa-circle-check text-success"
                style="font-size: 3rem; margin-bottom: 1rem;"></i>
            <h3 id="deck-empty-title">คุณปัดครบแล้ว!</h3>
            <p id="deck-empty-desc">กำลังรอเพื่อนๆ ปัดจนครบ...</p>
        </div>
    `;

    deck.innerHTML = `
        ${emptyStateHtml}
        <div class="swipe-card skeleton-card">
            <div class="skeleton-image skeleton-shimmer">
                <i class="fa-solid fa-utensils" style="font-size: 2.8rem; color: rgba(255,255,255,0.18);"></i>
                <div class="skeleton-badge skeleton-shimmer"></div>
            </div>
            <div class="skeleton-details">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                    <div class="skeleton-line title skeleton-shimmer"></div>
                    <div class="skeleton-line skeleton-shimmer" style="width: 50px; height: 20px; border-radius: 12px;"></div>
                </div>
                <div class="skeleton-line meta skeleton-shimmer" style="margin-bottom: 0.7rem;"></div>
                <div class="skeleton-line desc-1 skeleton-shimmer" style="margin-bottom: 0.35rem;"></div>
                <div class="skeleton-line desc-2 skeleton-shimmer"></div>
            </div>
        </div>
    `;
    const counter = document.getElementById('cards-remaining');
    if (counter) counter.innerText = '...';
    updateUndoButtonState();
}

function updateUndoButtonState() {
    const btn = document.getElementById('btn-swipe-undo');
    if (!btn) return;
    const hasHistory = state.swipeHistory && state.swipeHistory.length > 0;
    btn.disabled = !hasHistory;
    if (hasHistory) {
        btn.classList.remove('disabled');
    } else {
        btn.classList.add('disabled');
    }
}

function undoLastSwipe() {
    if (!state.swipeHistory || state.swipeHistory.length === 0) return;
    const last = state.swipeHistory.pop();
    if (!last || !last.restaurant) return;

    // Decrement currentIndex
    if (state.currentIndex > 0) state.currentIndex--;

    // Hide empty state because a card is being restored back into play
    const emptyEl = document.querySelector('.deck-empty-state');
    if (emptyEl) {
        emptyEl.classList.add('hidden');
    }

    // Hide floating feedback button again if a card is restored into play
    const btnFeedback = document.getElementById('btn-floating-feedback');
    if (btnFeedback) btnFeedback.style.display = 'none';
    document.body.classList.add('in-swipe-game');

    // If it was a solo right-swipe, pop from soloLiked
    if (state.isSolo && last.direction === 'right') {
        const idx = state.soloLiked ? state.soloLiked.findLastIndex(r => String(r.id) === String(last.restaurant.id)) : -1;
        if (idx !== -1) {
            state.soloLiked.splice(idx, 1);
        }
    }
    if (state.votes) {
        delete state.votes[last.restaurant.id];
    }

    // Restore card DOM element
    const deck = document.getElementById('swipe-deck');
    const card = last.cardElement;
    if (card && deck) {
        card.classList.remove('swiped');
        card.style.transition = 'none';
        card.style.opacity = '0';
        const startX = last.direction === 'right' ? 120 : -120;
        card.style.transform = `translate3d(${startX}px, 0, 0) rotate(${last.direction === 'right' ? 6 : -6}deg)`;
        card.style.display = 'flex';

        // Hide any active stamps
        const stamps = card.querySelectorAll('.card-stamp');
        stamps.forEach(s => s.style.opacity = '0');

        if (!card.parentNode) {
            deck.appendChild(card);
        }
        setupCardGestures(card);

        // Re-conceal card below so it returns to blank silhouette
        const belowCard = card.previousElementSibling;
        if (belowCard && belowCard.classList.contains('swipe-card')) {
            belowCard.classList.remove('card-revealed');
        }

        requestAnimationFrame(() => {
            card.style.transition = 'transform 0.28s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.28s ease';
            card.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
            card.style.opacity = '1';
        });
    }

    // Revert combo
    state.comboCount = last.comboBefore || 0;
    if (state.comboCount > 1) {
        const container = document.getElementById('combo-streak-container');
        const text = document.getElementById('combo-text');
        if (container && text) {
            text.innerText = `COMBO x${state.comboCount}!`;
            container.classList.remove('hidden');
        }
    } else {
        resetComboStreak();
    }

    updateProgressBar();
    updateUndoButtonState();

    if (typeof soundFx !== 'undefined' && soundFx.playPop) soundFx.playPop();
    if (navigator.vibrate) navigator.vibrate(15);
    showToast(`ย้อนกลับร้าน "${last.restaurant.name}" เรียบร้อย ↺`, 'info');
}

// --- RENDER DECK & CARDS ---
function renderDeck() {
    // Ensure combo streak & swipe history is reset when a fresh deck is rendered
    resetComboStreak();
    state.swipeHistory = [];
    updateUndoButtonState();

    const deck = document.getElementById('swipe-deck');
    if (!deck) return;

    // Empty state should only be visible when there are 0 cards
    const emptyStateEl = deck.querySelector('.deck-empty-state');
    const hasCards = state.restaurants && state.restaurants.length > 0;
    if (emptyStateEl) {
        if (hasCards) {
            emptyStateEl.classList.add('hidden');
        } else {
            emptyStateEl.classList.remove('hidden');
        }
    }
    const emptyStateHtml = emptyStateEl ? emptyStateEl.outerHTML : `
        <div class="deck-empty-state ${hasCards ? 'hidden' : ''}">
            <i class="fa-solid fa-circle-check text-success"
                style="font-size: 3rem; margin-bottom: 1rem;"></i>
            <h3 id="deck-empty-title">คุณปัดครบแล้ว!</h3>
            <p id="deck-empty-desc">กำลังรอเพื่อนๆ ปัดจนครบ...</p>
        </div>
    `;
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

        // Prepare multi-image list (Tinder / Omi story style)
        const images = (Array.isArray(r.images) && r.images.length > 0)
            ? r.images
            : (r.image ? [r.image] : ['https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&auto=format&fit=crop']);
        card._images = images;
        card._currentImgIndex = 0;

        // Preload next images in background for instant responsiveness
        if (images.length > 1) {
            images.forEach(imgUrl => {
                const p = new Image();
                p.src = imgUrl;
            });
        }

        const storyBarsHtml = images.length > 1
            ? `<div class="card-story-bars">
                ${images.map((_, idx) => `<div class="story-bar ${idx === 0 ? 'active' : ''}" data-idx="${idx}"></div>`).join('')}
               </div>
               <div class="card-photo-tap card-photo-tap-left" title="แตะดูรูปก่อนหน้า"></div>
               <div class="card-photo-tap card-photo-tap-right" title="แตะดูรูปถัดไป"></div>
               <button type="button" class="card-photo-nav-hint hint-left" aria-label="รูปก่อนหน้า" title="รูปก่อนหน้า"><i class="fa-solid fa-chevron-left"></i></button>
               <button type="button" class="card-photo-nav-hint hint-right" aria-label="รูปถัดไป" title="รูปถัดไป"><i class="fa-solid fa-chevron-right"></i></button>`
            : '';

        const drawerGalleryHtml = images.length > 1
            ? `<div class="drawer-photo-gallery">
                <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
                    <strong><i class="fa-solid fa-images"></i> รูปภาพและเมนู (${images.length} รูป):</strong>
                    <span style="font-size: 0.72rem; color: var(--text-muted);"><i class="fa-solid fa-circle-info"></i> ภาพนี้เป็นเพียงภาพจำลองเว็บ</span>
                </div>
                <div class="drawer-photo-strip">
                    ${images.map((imgUrl, idx) => `
                        <div class="drawer-thumb-wrap">
                            <img src="${imgUrl}" class="drawer-thumb" alt="มุม ${idx + 1}" onclick="jumpCardPhoto('${r.id}', ${idx})">
                            <span class="drawer-thumb-watermark">ภาพจำลองเว็บ</span>
                        </div>
                    `).join('')}
                </div>
               </div>`
            : '';

        const isHalal = Array.isArray(r.type) && r.type.some(t => String(t).includes('ฮาลาล') || String(t).includes('มุสลิม'));
        const halalBadgeHtml = isHalal
            ? `<div class="card-halal-badge" title="อาหารฮาลาล"><i class="fa-solid fa-star-and-crescent"></i> ฮาลาล</div>`
            : '';

        card.innerHTML = `
            <div class="card-image-wrapper">
                ${storyBarsHtml}
                <img src="${images[0]}" class="card-image" alt="${r.name}" onerror="this.onerror=null; this.src='https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&auto=format&fit=crop';">
                <div class="restaurant-watermark-overlay" aria-hidden="true">
                    <span class="watermark-text">ภาพนี้เป็นเพียงภาพจำลองเว็บ</span>
                </div>
                <div class="card-mockup-badge"><i class="fa-solid fa-camera"></i> ภาพนี้เป็นเพียงภาพจำลองเว็บ</div>
                <div class="card-stamp card-stamp-like">อยากกิน</div>
                <div class="card-stamp card-stamp-dislike">ไม่กิน</div>
                <div class="card-info-badge"><i class="fa-solid fa-location-arrow"></i> ${distDisplay}</div>
                ${halalBadgeHtml}
            </div>
            <div class="card-details">
                <div class="card-title-row">
                    <span class="card-name">${r.name}</span>
                    <span class="card-rating"><i class="fa-solid fa-star"></i> ${r.rating}</span>
                </div>
                <div class="card-meta-row">
                    <span><i class="fa-solid fa-bowl-food"></i> ${Array.isArray(r.type) ? r.type.map(t => t === 'อาหารฮาลาล' ? '<span class="halal-text-badge"><i class="fa-solid fa-star-and-crescent"></i> ฮาลาล</span>' : t).join(', ') : r.type}</span>
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
                    <p><strong>ประเภท:</strong> ${Array.isArray(r.type) ? r.type.map(t => t === 'อาหารฮาลาล' ? '<span class="halal-pill"><i class="fa-solid fa-star-and-crescent"></i> อาหารฮาลาล</span>' : t).join(', ') : r.type}</p>
                    <p><strong>ราคาเฉลี่ยต่อคน:</strong> ~${r.avgPrice} บาท (${r.priceRange})</p>
                    <p><strong>ระยะทาง:</strong> ห่างออกไป ${r.distance} กิโลเมตร</p>
                    <p><strong>ที่ตั้ง:</strong> ${r.address}</p>
                    ${drawerGalleryHtml}
                    ${r.allergens && r.allergens.length ? `
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
    const counter = document.getElementById('cards-remaining');
    if (counter) counter.innerText = Math.max(remaining, 0);
}

function updateGroupProgressWidget() {
    const widgetList = document.getElementById('group-progress-list');
    if (!widgetList) return;
    widgetList.innerHTML = '';

    const total = state.restaurants.length || 1;
    let finishedCount = 0;

    (state.users || []).forEach(user => {
        const userProgress = user.progress || 0;
        const isFinished = userProgress >= total;
        if (isFinished) finishedCount++;

        let statusClass = '';
        let statusText = 'กำลังปัดการ์ด';
        if (isFinished) {
            statusClass = 'finished';
            statusText = 'ปัดครบแล้ว ✓';
        } else if (userProgress > 0) {
            statusClass = 'active';
            statusText = `${userProgress}/${total} ใบ`;
        } else {
            statusText = `0/${total} ใบ`;
        }

        const pct = Math.min(100, Math.round((userProgress / total) * 100));

        const card = document.createElement('div');
        card.className = 'progress-user-card';
        card.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; margin-bottom: 0.2rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <div class="progress-dot ${statusClass}"></div>
                    <span class="progress-user-text" style="font-weight: 600; font-size: 0.88rem; color: var(--text-primary);">${escapeHtml(user.name)}</span>
                </div>
                <span class="progress-user-val" style="font-size: 0.8rem; font-weight: 500; color: ${isFinished ? '#00FF88' : 'var(--text-secondary)'};">${statusText}</span>
            </div>
            <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.08); border-radius: 99px; overflow: hidden;">
                <div style="width: ${pct}%; height: 100%; background: ${isFinished ? '#00FF88' : 'var(--accent-gradient)'}; border-radius: 99px; transition: width 0.3s ease;"></div>
            </div>
        `;
        widgetList.appendChild(card);
    });

    const totalUsers = (state.users || []).length || 1;
    const finishedEl = document.getElementById('modal-group-finished-count');
    if (finishedEl) finishedEl.textContent = `${finishedCount}/${totalUsers}`;

    const badgeCount = document.getElementById('badge-group-progress-count');
    if (badgeCount) badgeCount.textContent = `${finishedCount}/${totalUsers}`;
}

function openGroupProgressModal() {
    const modal = document.getElementById('modal-group-progress');
    if (!modal) return;
    if (window.soundFx && typeof soundFx.playPop === 'function') soundFx.playPop();
    updateGroupProgressWidget();
    modal.classList.remove('hidden');
}

function closeGroupProgressModal() {
    const modal = document.getElementById('modal-group-progress');
    if (modal) modal.classList.add('hidden');
}

// --- POINTER SWIPE GESTURES ---
function setupCardGestures(card) {
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;
    let isDragging = false;
    let hasMoved = false;
    let pointerDownTarget = null;
    let isDownOnPhoto = false;

    const likeStamp = card.querySelector('.card-stamp-like');
    const dislikeStamp = card.querySelector('.card-stamp-dislike');
    const likeBtn = document.getElementById('btn-swipe-right');
    const dislikeBtn = document.getElementById('btn-swipe-left');

    const updateSwipeButtonHints = (deltaX) => {
        if (!likeBtn || !dislikeBtn) return;
        if (deltaX > 15) {
            // Dragging Right -> Like: scale up like button with glow, dim dislike button
            const progress = Math.min((deltaX - 15) / 105, 1);
            likeBtn.style.transform = `scale(${1 + progress * 0.28})`;
            likeBtn.classList.add('swipe-hint-active');
            likeBtn.classList.remove('swipe-hint-dimmed');

            dislikeBtn.style.transform = `scale(${1 - progress * 0.12})`;
            dislikeBtn.classList.remove('swipe-hint-active');
            dislikeBtn.classList.add('swipe-hint-dimmed');
        } else if (deltaX < -15) {
            // Dragging Left -> Dislike: scale up dislike button with glow, dim like button
            const progress = Math.min((-deltaX - 15) / 105, 1);
            dislikeBtn.style.transform = `scale(${1 + progress * 0.28})`;
            dislikeBtn.classList.add('swipe-hint-active');
            dislikeBtn.classList.remove('swipe-hint-dimmed');

            likeBtn.style.transform = `scale(${1 - progress * 0.12})`;
            likeBtn.classList.remove('swipe-hint-active');
            likeBtn.classList.add('swipe-hint-dimmed');
        } else {
            resetSwipeButtonHints();
        }
    };

    const resetSwipeButtonHints = () => {
        if (likeBtn) {
            likeBtn.style.transform = '';
            likeBtn.classList.remove('swipe-hint-active', 'swipe-hint-dimmed');
        }
        if (dislikeBtn) {
            dislikeBtn.style.transform = '';
            dislikeBtn.classList.remove('swipe-hint-active', 'swipe-hint-dimmed');
        }
    };

    // Dedicated click listeners for photo arrow navigation buttons
    const hintLeft = card.querySelector('.card-photo-nav-hint.hint-left');
    const hintRight = card.querySelector('.card-photo-nav-hint.hint-right');

    if (hintLeft) {
        hintLeft.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
        });
        hintLeft.addEventListener('click', (e) => {
            e.stopPropagation();
            switchCardPhoto(card, -1);
        });
    }

    if (hintRight) {
        hintRight.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
        });
        hintRight.addEventListener('click', (e) => {
            e.stopPropagation();
            switchCardPhoto(card, 1);
        });
    }

    card.addEventListener('pointerdown', (e) => {
        // Prevent action inside buttons or open drawer
        if (e.target.closest('.card-drawer') || e.target.closest('.btn-close-drawer')) {
            return;
        }
        // Prevent action if another card is currently being swiped away
        if (document.querySelector('.swipe-card.swiped')) {
            return;
        }

        clearSwipeAffordance();
        isDragging = true;
        hasMoved = false;
        pointerDownTarget = e.target;
        startX = e.clientX;
        startY = e.clientY;
        currentX = e.clientX;
        currentY = e.clientY;

        // Check if pointerdown occurred on the photo area
        const imgWrapper = card.querySelector('.card-image-wrapper');
        if (imgWrapper) {
            const imgRect = imgWrapper.getBoundingClientRect();
            if (e.target.closest('.card-image-wrapper') ||
                (e.clientY >= imgRect.top && e.clientY <= imgRect.bottom &&
                 e.clientX >= imgRect.left && e.clientX <= imgRect.right)) {
                isDownOnPhoto = true;
            } else {
                isDownOnPhoto = false;
            }
        } else {
            isDownOnPhoto = false;
        }

        card.classList.add('dragging');
        card.style.transition = 'none';
        try {
            card.setPointerCapture(e.pointerId);
        } catch (err) {}
    });

    let rafId = null;

    card.addEventListener('pointermove', (e) => {
        if (!isDragging) return;

        currentX = e.clientX;
        currentY = e.clientY;

        if (!rafId) {
            rafId = requestAnimationFrame(() => {
                rafId = null;
                if (!isDragging) return;

                const dX = currentX - startX;
                if (Math.abs(dX) > 8) {
                    hasMoved = true;
                }

                // Calculate rotation based strictly on horizontal movement
                const rotate = dX / 15;

                // Apply transform strictly along horizontal axis (lock Y to 0)
                card.style.transform = `translate3d(${dX}px, 0, 0) rotate(${rotate}deg)`;

                // Fade in Stamps
                if (dX > 20) { // dragging right -> Like
                    likeStamp.style.opacity = Math.min((dX - 20) / 100, 0.9);
                    dislikeStamp.style.opacity = 0;
                } else if (dX < -20) { // dragging left -> Dislike
                    dislikeStamp.style.opacity = Math.min((-dX - 20) / 100, 0.9);
                    likeStamp.style.opacity = 0;
                } else {
                    likeStamp.style.opacity = 0;
                    dislikeStamp.style.opacity = 0;
                }

                // Dynamic button expansion & glow while dragging
                updateSwipeButtonHints(dX);
            });
        }
    });

    const handlePointerEnd = (e) => {
        if (!isDragging) return;
        isDragging = false;
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        card.classList.remove('dragging');
        resetSwipeButtonHints();

        const dX = currentX - startX;
        const dY = currentY - startY;
        const absX = Math.abs(dX);
        const absY = Math.abs(dY);
        const threshold = 120; // threshold for deliberate swipe

        if (hasMoved && e.type !== 'pointercancel' && dX > threshold) {
            // Swipe right (Like)
            executeSwipeAction(card, 'right', dX, 0);
        } else if (hasMoved && e.type !== 'pointercancel' && dX < -threshold) {
            // Swipe left (Dislike)
            executeSwipeAction(card, 'left', dX, 0);
        } else {
            // Just a click/tap or minor drag below threshold: snap back cleanly, NEVER swipe away
            card.style.transition = 'transform 0.2s ease-out';
            card.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
            likeStamp.style.opacity = 0;
            dislikeStamp.style.opacity = 0;

            // Multi-photo navigation (Tinder / Omi style: supports both Click/Tap and Horizontal Slide)
            if (e.type !== 'pointercancel' && card._images && card._images.length > 1 && isDownOnPhoto) {
                // If user slid/swiped horizontally across the photo ("เลื่อนรูปต่อไป")
                if (absX >= 20 && absX <= threshold && absX > absY * 0.7) {
                    if (dX < -20) {
                        // Slid left -> next photo
                        switchCardPhoto(card, 1);
                    } else if (dX > 20) {
                        // Slid right -> previous photo
                        switchCardPhoto(card, -1);
                    }
                }
                // If user tapped or clicked on the photo ("กดรูปต่อไป")
                else if (absX < 20 && absY < 25) {
                    if (pointerDownTarget && (pointerDownTarget.classList.contains('card-photo-tap-left') || pointerDownTarget.classList.contains('hint-left') || pointerDownTarget.closest('.hint-left'))) {
                        switchCardPhoto(card, -1);
                    } else if (pointerDownTarget && (pointerDownTarget.classList.contains('card-photo-tap-right') || pointerDownTarget.classList.contains('hint-right') || pointerDownTarget.closest('.hint-right'))) {
                        switchCardPhoto(card, 1);
                    } else {
                        const imgEl = card.querySelector('.card-image-wrapper') || card;
                        const rect = imgEl.getBoundingClientRect();
                        const tapX = currentX - rect.left;
                        if (tapX < rect.width / 2) {
                            switchCardPhoto(card, -1);
                        } else {
                            switchCardPhoto(card, 1);
                        }
                    }
                }
            }
        }

        try {
            card.releasePointerCapture(e.pointerId);
        } catch (err) {}
    };

    card.addEventListener('pointerup', handlePointerEnd);
    card.addEventListener('pointercancel', handlePointerEnd);
}

// --- TINDER / OMI MULTI-PHOTO SWITCHING ---
function switchCardPhoto(card, direction) {
    if (!card || !card._images || card._images.length <= 1) return;
    const total = card._images.length;
    let nextIdx = (card._currentImgIndex || 0) + direction;
    nextIdx = ((nextIdx % total) + total) % total;

    if (nextIdx === card._currentImgIndex) return;
    card._currentImgIndex = nextIdx;

    const img = card.querySelector('.card-image');
    const bars = card.querySelectorAll('.story-bar');

    if (img) {
        img.style.opacity = '0.35';
        setTimeout(() => {
            img.src = card._images[nextIdx];
            img.style.opacity = '1';
        }, 70);
    }

    bars.forEach((bar, i) => {
        if (i === nextIdx) {
            bar.classList.add('active');
            bar.style.background = '#ffffff';
        } else if (i < nextIdx) {
            bar.classList.remove('active');
            bar.style.background = 'rgba(255, 255, 255, 0.85)';
        } else {
            bar.classList.remove('active');
            bar.style.background = 'rgba(255, 255, 255, 0.38)';
        }
    });

    if (navigator.vibrate) navigator.vibrate(8);
}

window.jumpCardPhoto = function(restaurantId, targetIdx) {
    const card = document.querySelector(`.swipe-card[data-id="${restaurantId}"]`);
    if (!card || !card._images || !card._images[targetIdx]) return;
    const diff = targetIdx - (card._currentImgIndex || 0);
    switchCardPhoto(card, diff);
};


function executeSwipeAction(card, direction, dX = 150, dY = 0) {
    clearSwipeAffordance();
    // Prevent double swiping
    if (card.classList.contains('swiped')) {
        return;
    }
    card.classList.add('swiped');

    // Audio & Haptic feedback + Particles
    if (direction === 'right') {
        soundFx.playLike();
        if (navigator.vibrate) navigator.vibrate([15, 25]);
        // Subtle particle near the like button instead of cluttering food photo
        const likeBtn = document.getElementById('btn-swipe-right');
        if (likeBtn) {
            const rect = likeBtn.getBoundingClientRect();
            spawnParticleBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 'heart');
        }
    } else {
        soundFx.playPass();
        if (navigator.vibrate) navigator.vibrate(10);
    }

    // Animation out strictly horizontal (no Y drift)
    const rotate = dX / 15;
    const flyX = direction === 'right' ? window.innerWidth + 200 : -window.innerWidth - 200;

    card.style.transition = 'transform 0.3s ease-in, opacity 0.3s ease-in';
    card.style.transform = `translate3d(${flyX}px, 0, 0) rotate(${rotate}deg)`;
    card.style.opacity = 0;

    // Smoothly reveal details of the waiting card underneath as top card flies away
    const nextCard = card.previousElementSibling;
    if (nextCard && nextCard.classList.contains('swipe-card')) {
        nextCard.classList.add('card-revealed');
    }

    const rId = card.dataset.id;
    const currentR = state.restaurants.find(r => String(r.id) === String(rId));

    // Reset drag hints on buttons before executing flyout
    const likeBtn = document.getElementById('btn-swipe-right');
    const dislikeBtn = document.getElementById('btn-swipe-left');
    if (likeBtn) {
        likeBtn.style.transform = '';
        likeBtn.classList.remove('swipe-hint-active', 'swipe-hint-dimmed');
    }
    if (dislikeBtn) {
        dislikeBtn.style.transform = '';
        dislikeBtn.classList.remove('swipe-hint-active', 'swipe-hint-dimmed');
    }

    // Save history for Undo
    state.swipeHistory = state.swipeHistory || [];
    state.swipeHistory.push({
        restaurant: currentR,
        direction: direction,
        cardElement: card,
        comboBefore: state.comboCount || 0
    });
    updateUndoButtonState();

    // Register vote
    state.votes[rId] = direction;
    state.currentIndex++;

    // Gamification: Foodie Streak & Combo Counter
    handleSwipeStreak(direction);

    if (state.isSolo) {
        if (direction === 'right' && currentR) {
            state.soloLiked.push(currentR);
        }

        updateProgressBar();

        setTimeout(() => {
            card.remove();

            // Check if deck is finished (last card swiped)
            const remainingCards = document.querySelectorAll('.swipe-card:not(.swiped)');
            if (remainingCards.length === 0) {
                // Reveal empty state only now that the very last card is swiped
                const emptyEl = document.querySelector('.deck-empty-state');
                if (emptyEl) {
                    emptyEl.classList.remove('hidden');
                }
                resetComboStreak();
                setTimeout(() => {
                    let winner = null;
                    let subtitle = '';
                    if (state.soloLiked.length > 0) {
                        winner = state.soloLiked[Math.floor(Math.random() * state.soloLiked.length)];
                        subtitle = `คัดสรรจาก ${state.soloLiked.length} ร้านที่คุณปัดถูกใจ! 🍽️`;
                    } else {
                        winner = state.restaurants[Math.floor(Math.random() * state.restaurants.length)];
                        subtitle = `สุ่มร้านเด็ดให้จากสำรับทั้งหมด! 🍽️`;
                    }
                    renderResultScreen(winner, {
                        isSolo: true,
                        stampText: "<i class='fa-solid fa-utensils'></i> SOLO WINNER!",
                        subtitleHtml: subtitle
                    });

                    // Record history
                    if (winner) {
                        fetch('/api/solo/record-match', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                restaurant: winner,
                                isLuckyPick: false,
                                userName: state.currentUser ? (state.currentUser.displayName || state.currentUser.username) : 'นักชิมเดี่ยว'
                            })
                        }).catch(() => {});
                    }
                }, 350);
            }
        }, 300);
        return;
    }

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

        // Check if group deck is finished for this player (last card swiped)
        const remainingCards = document.querySelectorAll('.swipe-card:not(.swiped)');
        if (remainingCards.length === 0) {
            const emptyEl = document.querySelector('.deck-empty-state');
            if (emptyEl) {
                emptyEl.classList.remove('hidden');
                const emptyTitle = document.getElementById('deck-empty-title');
                const emptyDesc = document.getElementById('deck-empty-desc');
                if (emptyTitle) emptyTitle.innerText = 'คุณปัดครบแล้ว!';
                if (emptyDesc) emptyDesc.innerText = 'กำลังรอเพื่อนๆ ปัดจนครบ...';
            }

            // Restore floating feedback button now that player is done swiping
            const btnFeedback = document.getElementById('btn-floating-feedback');
            if (btnFeedback) btnFeedback.style.display = '';
            document.body.classList.remove('in-swipe-game');
        }
    }, 300);
}

function swipeTopCard(direction) {
    clearSwipeAffordance();
    if (document.querySelector('.swipe-card.swiped')) {
        return;
    }
    const cards = document.querySelectorAll('.swipe-card:not(.swiped)');
    if (cards.length > 0) {
        const topCard = cards[cards.length - 1];
        executeSwipeAction(topCard, direction, direction === 'right' ? 200 : -200, 0);
    }
}



// Gamification: Foodie Streak & Combo Counter
const COMBO_QUOTES = [
    'อร่อยต่อเนื่อง 🤤', 'ปัดไฟลุกแล้ว 🔥', 'หิวไม่ไหวแล้ว ⚡',
    'สายกินตัวจริง 👑', 'จานนี้ต้องโดน! 🌶️', 'เนื้อย่างเยียวยาทุกสิ่ง 🥩',
    'หิวจนท้องร้อง 🍕', 'กระเพาะเรียกร้อง 💖'
];

function resetComboStreak() {
    state.comboCount = 0;
    if (state.comboTimer) {
        clearTimeout(state.comboTimer);
        state.comboTimer = null;
    }
    const container = document.getElementById('combo-streak-container');
    if (container) {
        container.classList.add('hidden');
    }
}

function handleSwipeStreak(direction) {
    const container = document.getElementById('combo-streak-container');
    const textEl = document.getElementById('combo-text');
    const quoteEl = document.getElementById('combo-quote');

    if (direction === 'right') {
        state.comboCount = (state.comboCount || 0) + 1;
        if (state.comboCount >= 2) {
            soundFx.playCombo(state.comboCount);
            if (container && textEl && quoteEl) {
                textEl.innerText = `COMBO x${state.comboCount}!`;
                const quote = COMBO_QUOTES[Math.min(state.comboCount - 2, COMBO_QUOTES.length - 1)];
                quoteEl.innerText = quote;
                container.classList.remove('hidden');

                if (state.comboTimer) clearTimeout(state.comboTimer);
                state.comboTimer = setTimeout(() => {
                    container.classList.add('hidden');
                }, 2800);
            }
        }
    } else {
        state.comboCount = 0;
        if (container) container.classList.add('hidden');
        if (state.comboTimer) clearTimeout(state.comboTimer);
    }
}

// Gamification: Live Room Emote Reactions
function sendRoomReaction(emoji) {
    if (!state.roomId) {
        spawnFloatingReaction(emoji, state.name || 'คุณ');
        soundFx.playPop();
        return;
    }
    socket.emit('send_reaction', {
        roomId: state.roomId,
        emoji
    });
    soundFx.playPop();
}

function spawnFloatingReaction(emoji, senderName) {
    const layer = document.getElementById('floating-reactions-layer');
    if (!layer) return;

    const bubble = document.createElement('div');
    bubble.className = 'floating-reaction-bubble';
    bubble.style.left = `${Math.random() * 70 + 15}%`;
    bubble.innerHTML = `
        <span class="floating-reaction-emoji">${escapeHtml(emoji)}</span>
        <span class="floating-reaction-sender">${escapeHtml(senderName)}</span>
    `;

    layer.appendChild(bubble);
    setTimeout(() => {
        if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
    }, 2800);
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

// --- CELEBRATORY CONFETTI (LIGHTWEIGHT 60FPS OPTIMIZED) ---
function triggerConfettiExplosion() {
    if (typeof confetti !== 'function') return;
    try {
        // Quick, crisp celebratory pop (~36 particles total, zero frame drop on mobile)
        confetti({
            particleCount: 18,
            angle: 60,
            spread: 45,
            origin: { x: 0.05, y: 0.75 },
            colors: ['#FF3377', '#EE7816', '#00FF26'],
            ticks: 75,
            gravity: 1.2,
            scalar: 0.75,
            disableForReducedMotion: true
        });
        confetti({
            particleCount: 18,
            angle: 120,
            spread: 45,
            origin: { x: 0.95, y: 0.75 },
            colors: ['#FF3377', '#EE7816', '#00FF26'],
            ticks: 75,
            gravity: 1.2,
            scalar: 0.75,
            disableForReducedMotion: true
        });
    } catch (e) {
        console.warn('Confetti error:', e);
    }
}

// --- QR SCANNER FUNCTIONALITY (ULTRA-FAST & ROBUST) ---
let html5QrCode = null;
let availableCameras = [];
let currentCameraIndex = 0;
let lastInvalidToastTime = 0;

function createScannerInstance() {
    try {
        return new Html5Qrcode("qr-reader", {
            experimentalFeatures: {
                useBarCodeDetectorIfSupported: true
            },
            verbose: false
        });
    } catch (err) {
        console.warn("[QR Scanner] Hardware acceleration fallback:", err);
        return new Html5Qrcode("qr-reader");
    }
}

function enforceVideoPlaysInline() {
    const applyAttributes = () => {
        const video = document.querySelector('#qr-reader video');
        if (video) {
            video.setAttribute('playsinline', 'true');
            video.setAttribute('webkit-playsinline', 'true');
            video.muted = true;
            if (video.paused) {
                video.play().catch(() => {});
            }
        }
    };
    applyAttributes();
    setTimeout(applyAttributes, 150);
    setTimeout(applyAttributes, 450);
    setTimeout(applyAttributes, 900);
}

function handleCameraError(err) {
    const hintEl = document.getElementById('qr-scanner-hint');
    const isPermissionDenied = err && (
        err.name === 'NotAllowedError' || 
        err.name === 'PermissionDeniedError' ||
        String(err).includes('Permission') ||
        String(err).includes('NotAllowed')
    );

    if (isPermissionDenied) {
        if (hintEl) {
            hintEl.innerHTML = `
                <div style="color: #FF5E7E; font-size: 0.82rem; line-height: 1.5; padding: 0.5rem; background: rgba(255,94,126,0.12); border-radius: 8px; border: 1px solid rgba(255,94,126,0.25);">
                    <i class="fa-solid fa-triangle-exclamation"></i> <strong>เบราว์เซอร์ไม่ได้รับอนุญาตให้ใช้กล้อง</strong><br>
                    แตะที่ไอคอน <strong>"กุญแจ" หรือ "aA"</strong> ที่แถบ URL ด้านบน เลือก <strong>"อนุญาตการใช้กล้อง"</strong> หรือใช้ปุ่ม <em>"เลือกรูป QR จากคลังภาพ"</em> ด้านล่าง
                </div>
            `;
        }
        showToast("กรุณาอนุญาตสิทธิ์การเข้าถึงกล้องในเบราว์เซอร์ หรือเลือกรูป QR จากคลังภาพ", 'error', 5000);
    } else {
        if (hintEl) {
            hintEl.innerHTML = `
                <div style="color: #FFB347; font-size: 0.82rem; line-height: 1.5; padding: 0.5rem; background: rgba(255,179,71,0.12); border-radius: 8px; border: 1px solid rgba(255,179,71,0.25);">
                    <i class="fa-solid fa-triangle-exclamation"></i> ไม่สามารถเปิดกล้องได้ อาจมีแอปอื่นใช้งานกล้องอยู่ หรือคุณสามารถใช้ปุ่ม <em>"เลือกรูป QR จากคลังภาพ"</em> ได้ทันที
                </div>
            `;
        }
        showToast("ไม่สามารถเปิดกล้องได้ กรุณาปิดแอปอื่นที่ใช้กล้อง หรือเลือกรูปภาพ QR Code", 'warning', 4000);
    }
}

function extractRoomIdFromScannedText(decodedText) {
    if (!decodedText) return null;
    const text = String(decodedText).trim();

    // 1. Direct 4-8 alphanumeric room code (e.g. "ABCD", "X9K2")
    if (/^[A-Z0-9]{4,8}$/i.test(text)) {
        return text.toUpperCase();
    }

    // 2. Parse as URL
    try {
        const urlStr = /^[a-zA-Z]+:\/\//i.test(text) ? text : `https://${text}`;
        const url = new URL(urlStr);
        const roomId = url.searchParams.get("roomId") || url.searchParams.get("room");
        if (roomId && /^[A-Z0-9]{4,8}$/i.test(roomId.trim())) {
            return roomId.trim().toUpperCase();
        }
        // Check pathname format e.g. /room/ABCD or /join/ABCD
        const pathMatch = url.pathname.match(/\/(?:room|join)\/([A-Z0-9]{4,8})/i);
        if (pathMatch) {
            return pathMatch[1].toUpperCase();
        }
    } catch (e) {
        // Fallback for tricky URLs
    }

    // 3. RegEx search for roomId query parameter pattern anywhere inside string
    const match = text.match(/[?&]roomId=([A-Z0-9]{4,8})/i) || text.match(/[?&]room=([A-Z0-9]{4,8})/i);
    if (match) {
        return match[1].toUpperCase();
    }

    return null;
}

function handleQRScanSuccess(decodedText) {
    const roomId = extractRoomIdFromScannedText(decodedText);
    console.log(`[QR Fast Scan] Detected raw: "${decodedText}", Extracted roomId: "${roomId}"`);

    const hudEl = document.getElementById('qr-scanner-hud');
    const hintEl = document.getElementById('qr-scanner-hint');

    if (roomId) {
        // Visual flash & Audio/Haptic instant feedback
        if (hudEl) hudEl.classList.add('qr-scan-success-flash');
        if (navigator.vibrate) navigator.vibrate([40, 30, 60]);
        if (window.soundFx && typeof soundFx.playPop === 'function') soundFx.playPop();

        if (hintEl) {
            hintEl.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #00FF88;"></i> พบห้อง <strong>${roomId}</strong> กำลังเข้าร่วม...`;
        }

        // Immediately stop camera to free resources
        stopQRScanner();

        showToast(`พบห้อง ${roomId} กำลังเข้าห้องกลุ่ม... ✨`, 'info', 2000);
        state.targetRoomId = roomId;

        verifyRoomExists(roomId).then(check => {
            if (check.exists && !check.started) {
                attemptAutoJoinRoom();
                showToast(`เข้าร่วมห้อง ${roomId} สำเร็จ! 🎉`, 'success', 2500);
            } else if (check.exists && check.started) {
                showToast(check.message || `ห้อง "${roomId}" เริ่มการโหวตไปแล้ว ไม่สามารถเข้าร่วมได้`, 'warning', 3500);
                state.targetRoomId = null;
            } else {
                showToast(check.message || `ไม่พบห้อง "${roomId}" ในระบบ`, 'error', 3500);
                state.targetRoomId = null;
            }
        }).catch(err => {
            showToast(`เกิดข้อผิดพลาดในการตรวจสอบห้อง: ${err.message}`, 'error');
        });
    } else {
        // Invalid QR code warning (rate-limited so it doesn't spam)
        if (Date.now() - lastInvalidToastTime > 2500) {
            lastInvalidToastTime = Date.now();
            showToast("QR Code นี้ไม่ใช่ห้องของ GINDER", "warning", 2000);
        }
    }
}

function scanQRFromImageFile(file) {
    if (!file) return;
    showToast("กำลังอ่าน QR Code จากรูปภาพ...", "info", 1500);

    const tempScanner = html5QrCode || createScannerInstance();
    tempScanner.scanFile(file, true)
        .then(decodedText => {
            handleQRScanSuccess(decodedText);
        })
        .catch(err => {
            console.warn("QR Scan File error:", err);
            showToast("ไม่พบ QR Code ในรูปภาพนี้ หรือรูปภาพไม่ชัดเจน", "warning", 3000);
        });
}

function startQRScanner() {
    const qrModal = document.getElementById('qr-scanner-modal');
    if (!qrModal) return;
    qrModal.classList.remove('hidden');

    const btnSwitchCam = document.getElementById('btn-switch-camera');
    const hintEl = document.getElementById('qr-scanner-hint');
    const hudEl = document.getElementById('qr-scanner-hud');

    if (hudEl) hudEl.classList.remove('qr-scan-success-flash');
    if (hintEl) {
        hintEl.innerHTML = '<i class="fa-solid fa-bolt text-accent"></i> ตรวจจับความเร็วสูง เล็งกล้องไปที่ QR Code ได้เลย';
    }

    // Clean up any stale scanner instance before starting
    if (html5QrCode) {
        try {
            if (html5QrCode.isScanning) html5QrCode.stop().catch(() => {});
            html5QrCode.clear();
        } catch (e) {}
        html5QrCode = null;
    }

    html5QrCode = createScannerInstance();

    let isHandled = false;
    const qrCodeSuccessCallback = (decodedText, decodedResult) => {
        if (isHandled) return;
        isHandled = true;
        handleQRScanSuccess(decodedText);
    };

    // Ultra-Fast Scanner Configuration (25 FPS, Responsive Wide Area)
    const config = {
        fps: 25,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minDim = Math.min(viewfinderWidth, viewfinderHeight);
            const boxSize = Math.max(180, Math.floor(minDim * 0.85));
            return { width: boxSize, height: boxSize };
        },
        disableFlip: false,
        experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
        }
    };

    // Start with environment camera without forced overconstraints
    html5QrCode.start({ facingMode: "environment" }, config, qrCodeSuccessCallback)
        .then(() => {
            enforceVideoPlaysInline();
            // Discover available camera devices safely AFTER start succeeds (prevents iOS WebKit race condition)
            Html5Qrcode.getCameras().then(cameras => {
                if (cameras && cameras.length > 1) {
                    availableCameras = cameras;
                    if (btnSwitchCam) {
                        btnSwitchCam.style.display = 'inline-flex';
                        btnSwitchCam.onclick = () => switchCamera(config, qrCodeSuccessCallback);
                    }
                } else if (btnSwitchCam) {
                    btnSwitchCam.style.display = 'none';
                }
            }).catch(() => {
                if (btnSwitchCam) btnSwitchCam.style.display = 'none';
            });
        })
        .catch(err => {
            console.warn("[QR Scanner] Primary environment camera failed, falling back to front camera...", err);
            if (html5QrCode) {
                try { html5QrCode.clear(); } catch (e) {}
                html5QrCode = null;
            }
            html5QrCode = createScannerInstance();
            html5QrCode.start({ facingMode: "user" }, config, qrCodeSuccessCallback)
                .then(() => {
                    enforceVideoPlaysInline();
                })
                .catch(err2 => {
                    console.error("[QR Scanner] All camera access attempts failed:", err2);
                    handleCameraError(err2);
                });
        });
}

function switchCamera(config, callback) {
    if (!html5QrCode || availableCameras.length < 2) return;
    currentCameraIndex = (currentCameraIndex + 1) % availableCameras.length;
    const targetCameraId = availableCameras[currentCameraIndex].id;

    if (html5QrCode.isScanning) {
        html5QrCode.stop().then(() => {
            html5QrCode.start(targetCameraId, config, callback)
                .then(() => {
                    enforceVideoPlaysInline();
                })
                .catch(err => {
                    console.error("Failed to switch camera:", err);
                });
        }).catch(err => console.error("Error stopping during camera switch:", err));
    }
}

function stopQRScanner() {
    const qrModal = document.getElementById('qr-scanner-modal');
    if (qrModal) qrModal.classList.add('hidden');

    if (html5QrCode) {
        const instance = html5QrCode;
        html5QrCode = null;
        if (instance.isScanning) {
            instance.stop().then(() => {
                instance.clear();
            }).catch(err => {
                console.warn("QR scanner stop error:", err);
                try { instance.clear(); } catch (e) {}
            });
        } else {
            try { instance.clear(); } catch (e) {}
        }
    }
}

// --- AUTHENTICATION & PROFILE LOGIC ---
state.currentUser = null;

function routeAfterAuth() {
    updateHeaderUI();
    prefillUserPreferences();

    const returnTo = sessionStorage.getItem('returnTo');
    if (returnTo) {
        sessionStorage.removeItem('returnTo');
        window.location.href = returnTo;
        return;
    }

    if (state.targetRoomId) {
        // Scanned QR code with native phone camera -> Verify room first before attempting join!
        verifyRoomExists(state.targetRoomId).then(check => {
            if (check.exists && !check.started) {
                attemptAutoJoinRoom();
            } else {
                showToast(check.message || `ไม่พบห้อง "${state.targetRoomId}" ในระบบ`, 'error');
                state.targetRoomId = null;
                showView('landing');
            }
        });
    } else if (views.auth && views.auth.classList.contains('active')) {
        showView('landing');
    }
}

function attemptAutoJoinRoom() {
    if (!state.targetRoomId) return;

    let displayName = (state.currentUser && (state.currentUser.displayName || state.currentUser.username)) 
        ? (state.currentUser.displayName || state.currentUser.username) 
        : (state.name || getRandomFoodNickname());
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
            }
        })
        .catch(err => {
            if (callback) callback();
            console.error("Guest login failed:", err);
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
                // Frictionless Onboarding: Auto guest login silently in background
                triggerQuickGuestLogin(() => {
                    updateHeaderUI();
                });
            }
        })
        .catch(err => {
            console.error("Error checking auth status:", err);
            triggerQuickGuestLogin(() => {
                updateHeaderUI();
            });
        });
}

function updateHeaderUI() {
    const profileContainer = document.getElementById('user-header-profile');
    if (!profileContainer) return;

    const isMember = (state.currentUser && !state.currentUser.isGuest);

    if (isMember) {
        // --- LOGGED-IN REGISTERED MEMBER ---
        let adminBtn = '';
        if (state.currentUser.role === 'admin') {
            adminBtn = `<a href="/admin" target="_blank" class="btn btn-primary btn-sm btn-header-admin" title="จัดการระบบ (Admin)"><i class="fa-solid fa-crown"></i> <span class="header-admin-label">จัดการ</span></a>`;
        }

        const safeMemberName = (state.currentUser && (state.currentUser.displayName || state.currentUser.username))
            ? String(state.currentUser.displayName || state.currentUser.username).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            : 'สมาชิก';

        profileContainer.innerHTML = `
            <div class="user-profile-group">
                ${adminBtn}
                <div id="btn-header-profile" class="profile-info-badge member-badge" title="คลิกเพื่อจัดการบัญชีสมาชิก">
                    <i class="fa-solid fa-circle-user text-accent"></i>
                    <span class="profile-name-text">${safeMemberName}</span>
                    <i class="fa-solid fa-chevron-down profile-chevron"></i>
                </div>
                <button id="btn-logout" class="btn btn-header-logout" title="ออกจากระบบ" aria-label="ออกจากระบบ" type="button">
                    <i class="fa-solid fa-arrow-right-from-bracket"></i>
                </button>
            </div>
        `;

        const profileBtn = document.getElementById('btn-header-profile');
        if (profileBtn) {
            profileBtn.addEventListener('click', () => {
                openProfileModal();
            });
        }

        const logoutBtn = document.getElementById('btn-logout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                showCustomConfirm({
                    title: 'ออกจากระบบ?',
                    message: 'คุณแน่ใจหรือไม่ว่าต้องการออกจากระบบบัญชีของคุณ?',
                    confirmText: 'ออกจากระบบ',
                    cancelText: 'ยกเลิก',
                    type: 'danger',
                    icon: 'fa-arrow-right-from-bracket',
                    onConfirm: () => {
                        fetch('/api/logout', { method: 'POST' })
                            .then(res => res.json())
                            .then(data => {
                                state.currentUser = (data && data.isGuest) ? data : null;
                                updateHeaderUI();
                                prefillUserPreferences();
                                closeProfileModal();
                                showToast('ออกจากระบบแล้ว คุณยังคงใช้งานระบบแบบทั่วไป (Guest) ได้ตามปกติ 🍜', 'info');
                                showView('landing');
                            })
                            .catch(err => {
                                triggerQuickGuestLogin(() => {
                                    updateHeaderUI();
                                    closeProfileModal();
                                    showView('landing');
                                });
                            });
                    }
                });
            });
        }
    } else {
        // --- GUEST / UNREGISTERED USER (USE FIRST, OPT-IN LOGIN ANYTIME) ---
        const rawGuestName = (state.currentUser && state.currentUser.displayName)
            ? state.currentUser.displayName
            : 'ผู้ใช้งาน';
        const safeGuestName = String(rawGuestName).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        profileContainer.innerHTML = `
            <div class="user-profile-group">
                <div id="btn-header-profile" class="profile-info-badge guest-badge" title="ผู้ใช้ทั่วไป (แตะเพื่อดูโปรไฟล์หรือเปลี่ยนชื่อ)">
                    <i class="fa-solid fa-user-astronaut text-accent"></i>
                    <span class="profile-name-text">${safeGuestName}</span>
                </div>
                <button id="btn-header-login" class="btn btn-header-login-highlight" type="button" title="เข้าสู่ระบบ หรือ สมัครสมาชิก">
                    <i class="fa-solid fa-right-to-bracket text-accent"></i>
                    <span class="header-login-btn-label">เข้าสู่ระบบ</span>
                </button>
            </div>
        `;

        const profileBtn = document.getElementById('btn-header-profile');
        if (profileBtn) {
            profileBtn.addEventListener('click', () => {
                openProfileModal();
            });
        }

        const headerLoginBtn = document.getElementById('btn-header-login');
        if (headerLoginBtn) {
            headerLoginBtn.addEventListener('click', () => {
                openAuthModal();
            });
        }
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
    const tabPdpaBtn = document.getElementById('tab-profile-pdpa');
    const paneInfo = document.getElementById('tab-pane-profile-info');
    const panePassword = document.getElementById('tab-pane-profile-password');
    const paneHistory = document.getElementById('tab-pane-profile-history');
    const paneSecurity = document.getElementById('tab-pane-profile-security');
    const panePdpa = document.getElementById('tab-pane-profile-pdpa');

    if (closeProfileBtn && profileModal) {
        closeProfileBtn.addEventListener('click', () => {
            profileModal.classList.remove('active');
        });
        profileModal.addEventListener('click', (e) => {
            if (e.target === profileModal) profileModal.classList.remove('active');
        });
    }

    function activateProfileTab(activeBtn, activePane) {
        [tabInfoBtn, tabHistoryBtn, tabPdpaBtn].forEach(b => {
            if (b) {
                b.classList.remove('btn-primary', 'active');
                b.classList.add('btn-secondary');
            }
        });
        [paneInfo, paneHistory, panePdpa].forEach(p => {
            if (p) p.classList.add('hidden');
        });

        if (activeBtn) {
            activeBtn.classList.add('btn-primary', 'active');
            activeBtn.classList.remove('btn-secondary');
        }
        if (activePane) activePane.classList.remove('hidden');
    }

    if (tabInfoBtn) tabInfoBtn.addEventListener('click', () => activateProfileTab(tabInfoBtn, paneInfo));
    if (tabHistoryBtn) tabHistoryBtn.addEventListener('click', () => {
        activateProfileTab(tabHistoryBtn, paneHistory);
        loadMatchHistory();
    });
    if (tabPdpaBtn) tabPdpaBtn.addEventListener('click', () => activateProfileTab(tabPdpaBtn, panePdpa));

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
    if (typeof attachEmailAvailabilityCheck === 'function') {
        attachEmailAvailabilityCheck('profile-recovery-email', 'profile-recovery-email-feedback', 'profile-recovery-email-feedback-text');
    }
    if (formSecurity) {
        formSecurity.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = (document.getElementById('profile-recovery-email')?.value || '').trim();
            const securityQuestion = (document.getElementById('profile-recovery-question')?.value || '').trim();
            const securityAnswer = (document.getElementById('profile-recovery-answer')?.value || '').trim();
            const recoveryPin = (document.getElementById('profile-recovery-pin')?.value || '').trim();

            if (email) {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(email)) {
                    showToast('รูปแบบอีเมลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง', 'warning');
                    document.getElementById('profile-recovery-email')?.focus();
                    return;
                }
            }

            fetch('/api/user/security', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, securityQuestion, securityAnswer, recoveryPin })
            })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        showToast(data.message || 'บันทึกข้อมูลความปลอดภัยเรียบร้อยแล้ว', 'success');
                        loadUserSecuritySettings();
                    } else {
                        showToast(data.message || 'บันทึกข้อมูลไม่สำเร็จ', 'error');
                        if (data.message && data.message.includes('อีเมล')) {
                            const emailInput = document.getElementById('profile-recovery-email');
                            const fb = document.getElementById('profile-recovery-email-feedback');
                            const fbTxt = document.getElementById('profile-recovery-email-feedback-text');
                            if (emailInput) {
                                emailInput.style.borderColor = '#ef4444';
                                emailInput.focus();
                            }
                            if (fb) {
                                fb.classList.remove('hidden');
                                fb.style.display = 'flex';
                            }
                            if (fbTxt) fbTxt.textContent = data.message;
                        }
                    }
                })
                .catch(err => showToast('เกิดข้อผิดพลาด: ' + err.message, 'error'));
        });
    }

    // Update Profile Form Submit
    const formProfile = document.getElementById('form-update-profile');
    if (formProfile) {
        formProfile.addEventListener('submit', (e) => {
            e.preventDefault();
            const displayName = document.getElementById('profile-display-name').value.trim();
            if (!displayName) return;

            const selectedAllergies = [];
            document.querySelectorAll('#profile-allergy-selector .allergy-pill.active').forEach(p => {
                if (p.dataset.allergen) selectedAllergies.push(p.dataset.allergen);
            });

            fetch('/api/user/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayName, allergies: selectedAllergies })
            })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        state.currentUser.displayName = data.displayName;
                        state.currentUser.allergies = data.allergies || selectedAllergies;
                        updateHeaderUI();
                        prefillUserPreferences();
                        showToast('บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว', 'success');
                        if (profileModal) profileModal.classList.remove('active');
                    } else {
                        showToast(data.message || 'บันทึกข้อมูลไม่สำเร็จ', 'error');
                    }
                })
                .catch(err => showToast('เกิดข้อผิดพลาด: ' + err.message, 'error'));
        });
    }

    // Update Password Form Submit & Real-time Validation
    const formPassword = document.getElementById('form-update-password');
    const inputCurrentPwd = document.getElementById('profile-current-password');
    const inputNewPwd = document.getElementById('profile-new-password');
    const inputConfirmPwd = document.getElementById('profile-confirm-password');
    const feedbackPwd = document.getElementById('profile-new-password-feedback');

    function checkPasswordMatch() {
        if (!feedbackPwd || !inputCurrentPwd || !inputNewPwd) return;
        const cur = inputCurrentPwd.value;
        const nxt = inputNewPwd.value;
        if (cur && nxt && cur === nxt) {
            feedbackPwd.classList.remove('hidden');
            feedbackPwd.style.display = 'flex';
            inputNewPwd.style.borderColor = '#ef4444';
        } else {
            feedbackPwd.classList.add('hidden');
            feedbackPwd.style.display = 'none';
            inputNewPwd.style.borderColor = '';
        }
    }

    if (inputCurrentPwd && inputNewPwd) {
        inputCurrentPwd.addEventListener('input', checkPasswordMatch);
        inputNewPwd.addEventListener('input', checkPasswordMatch);
    }

    if (formPassword) {
        formPassword.addEventListener('submit', (e) => {
            e.preventDefault();
            const currentPassword = inputCurrentPwd ? inputCurrentPwd.value : '';
            const newPassword = inputNewPwd ? inputNewPwd.value : '';
            const confirmPassword = inputConfirmPwd ? inputConfirmPwd.value : '';

            if (currentPassword === newPassword) {
                showToast('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม', 'warning');
                if (inputNewPwd) inputNewPwd.focus();
                return;
            }

            if (newPassword !== confirmPassword) {
                showToast('รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน', 'warning');
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
                        showToast('เปลี่ยนรหัสผ่านสำเร็จเรียบร้อย', 'success');
                        formPassword.reset();
                        checkPasswordMatch();
                        if (profileModal) profileModal.classList.remove('active');
                    } else {
                        showToast(data.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ', 'error');
                    }
                })
                .catch(err => showToast('เกิดข้อผิดพลาด: ' + err.message, 'error'));
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
                        showToast(data.message, 'success');
                        formFeedback.reset();
                        if (feedbackModal) feedbackModal.classList.remove('active');
                    } else {
                        showToast(data.message || 'ส่งข้อความไม่สำเร็จ', 'error');
                    }
                })
                .catch(err => showToast('เกิดข้อผิดพลาด: ' + err.message, 'error'));
        });
    }

    // PDPA: Data Subject Rights (DSR) in Profile
    const btnPdpaExport = document.getElementById('btn-pdpa-export-data');
    if (btnPdpaExport) {
        btnPdpaExport.addEventListener('click', () => {
            btnPdpaExport.disabled = true;
            btnPdpaExport.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังรวบรวมสำเนาข้อมูล...';
            fetch('/api/pdpa/export-my-data')
                .then(res => {
                    if (!res.ok) throw new Error('ไม่สามารถดาวน์โหลดข้อมูลได้');
                    return res.json();
                })
                .then(data => {
                    btnPdpaExport.disabled = false;
                    btnPdpaExport.innerHTML = '<i class="fa-solid fa-download"></i> ดาวน์โหลดสำเนาข้อมูลส่วนบุคคลของฉัน (JSON)';
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `ginder_personal_data_${data.user?.username || 'user'}_${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    showToast('ดาวน์โหลดสำเนาข้อมูลส่วนบุคคลตามสิทธิ PDPA (Right of Access) สำเร็จเรียบร้อย', 'success');
                })
                .catch(err => {
                    btnPdpaExport.disabled = false;
                    btnPdpaExport.innerHTML = '<i class="fa-solid fa-download"></i> ดาวน์โหลดสำเนาข้อมูลส่วนบุคคลของฉัน (JSON)';
                    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
                });
        });
    }

    const btnPdpaDelete = document.getElementById('btn-pdpa-delete-account');
    if (btnPdpaDelete) {
        btnPdpaDelete.addEventListener('click', () => {
            const confirmInput = document.getElementById('pdpa-delete-confirm-text') || document.getElementById('pdpa-delete-confirm-password');
            const confirmVal = confirmInput ? confirmInput.value.trim() : '';
            if (confirmVal !== 'DELETE') {
                showToast('กรุณาพิมพ์คำว่า DELETE (ตัวพิมพ์ใหญ่) เพื่อยืนยันการลบบัญชี', 'warning');
                if (confirmInput) confirmInput.focus();
                return;
            }

            showCustomConfirm({
                title: 'ยืนยันการลบบัญชีถาวร?',
                message: 'ข้อมูลและประวัติทั้งหมดของคุณจะถูกลบอย่างถาวรและไม่สามารถกู้คืนได้อีก คุณแน่ใจหรือไม่?',
                confirmText: 'ลบบัญชีถาวร',
                cancelText: 'ยกเลิก',
                type: 'danger',
                icon: 'fa-trash',
                onConfirm: () => {
                    btnPdpaDelete.disabled = true;
                    btnPdpaDelete.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังลบข้อมูล...';

                    fetch('/api/pdpa/delete-my-account', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password: 'DELETE' })
                    })
                        .then(res => res.json().then(data => ({ ok: res.ok, data })))
                        .then(({ ok, data }) => {
                            btnPdpaDelete.disabled = false;
                            btnPdpaDelete.innerHTML = '<i class="fa-solid fa-trash"></i> ขอลบข้อมูลและปิดบัญชีถาวร';
                            if (!ok || !data.success) {
                                showToast(data.message || 'ไม่สามารถลบบัญชีได้', 'error');
                                return;
                            }
                            showToast(data.message || 'ลบบัญชีและข้อมูลส่วนบุคคลตามสิทธิ PDPA สำเร็จแล้ว', 'success');
                            localStorage.removeItem('ginder_pdpa_consent');
                            window.location.reload();
                        })
                        .catch(err => {
                            btnPdpaDelete.disabled = false;
                            btnPdpaDelete.innerHTML = '<i class="fa-solid fa-trash"></i> ขอลบข้อมูลและปิดบัญชีถาวร';
                            showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
                        });
                }
            });
        });
    }
}

function openProfileModal() {
    if (!state.currentUser) return;
    const modal = document.getElementById('modal-profile');
    if (!modal) return;
    document.getElementById('profile-username').value = state.currentUser.username || '';
    document.getElementById('profile-display-name').value = state.currentUser.displayName || '';

    // Update Connected Provider Badge
    const providerBadge = document.getElementById('profile-provider-badge');
    const providerText = document.getElementById('profile-provider-text');
    if (providerBadge && providerText) {
        const provider = state.currentUser.provider || (state.currentUser.isGuest ? 'guest' : 'standard');
        if (provider === 'google') {
            providerBadge.style.borderColor = 'rgba(66, 133, 244, 0.4)';
            providerBadge.style.background = 'rgba(66, 133, 244, 0.1)';
            providerText.innerHTML = `<svg class="oauth-svg-icon" viewBox="0 0 24 24" width="16" height="16" style="vertical-align: middle; margin-right: 4px;"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg> บัญชี Google`;
        } else if (provider === 'facebook') {
            providerBadge.style.borderColor = 'rgba(24, 119, 242, 0.4)';
            providerBadge.style.background = 'rgba(24, 119, 242, 0.1)';
            providerText.innerHTML = `<i class="fa-brands fa-facebook-f" style="color: #1877F2; margin-right: 4px;"></i> บัญชี Facebook`;
        } else if (state.currentUser.isGuest) {
            providerBadge.style.borderColor = 'rgba(255, 140, 0, 0.4)';
            providerBadge.style.background = 'rgba(255, 140, 0, 0.1)';
            providerText.innerHTML = `<i class="fa-solid fa-user-ninja text-accent" style="margin-right: 4px;"></i> โหมดผู้เยี่ยมชม (Guest)`;
        } else {
            providerBadge.style.borderColor = 'var(--glass-border)';
            providerBadge.style.background = 'rgba(255, 255, 255, 0.06)';
            providerText.innerHTML = `<i class="fa-solid fa-user text-accent" style="margin-right: 4px;"></i> บัญชีบุคคล`;
        }
    }

    const guestNotice = document.getElementById('profile-guest-notice');
    const btnProfileToLogin = document.getElementById('btn-profile-to-login');
    if (guestNotice) {
        if (state.currentUser.isGuest) {
            guestNotice.classList.remove('hidden');
            if (btnProfileToLogin && !btnProfileToLogin._bound) {
                btnProfileToLogin._bound = true;
                btnProfileToLogin.addEventListener('click', () => {
                    modal.classList.remove('active');
                    openAuthModal();
                });
            }
        } else {
            guestNotice.classList.add('hidden');
        }
    }

    const pdpaDeleteText = document.getElementById('pdpa-delete-confirm-text');
    if (pdpaDeleteText) pdpaDeleteText.value = '';
    const pdpaDeletePassword = document.getElementById('pdpa-delete-confirm-password');
    if (pdpaDeletePassword) pdpaDeletePassword.value = '';

    // Prefill profile allergies
    const userProfileAllergies = (state.currentUser && Array.isArray(state.currentUser.allergies)) ? state.currentUser.allergies : [];
    document.querySelectorAll('#profile-allergy-selector .allergy-pill').forEach(pill => {
        if (userProfileAllergies.includes(pill.dataset.allergen)) {
            pill.classList.add('active');
        } else {
            pill.classList.remove('active');
        }
    });

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
                    <div style="position: relative; width: 55px; height: 55px; border-radius: 8px; overflow: hidden; flex-shrink: 0;">
                        <img src="${r.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100'}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100'">
                        <span style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.78); color: #fff; font-size: 0.52rem; text-align: center; padding: 1px 0; font-weight: 500;">ภาพจำลองเว็บ</span>
                    </div>
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
    const userAllergies = (state.currentUser && Array.isArray(state.currentUser.allergies)) ? state.currentUser.allergies : [];
    state.allergies = [...userAllergies];

    // Prefill profile allergy selector
    document.querySelectorAll('#profile-allergy-selector .allergy-pill').forEach(pill => {
        if (userAllergies.includes(pill.dataset.allergen)) {
            pill.classList.add('active');
        } else {
            pill.classList.remove('active');
        }
    });

    // Prefill solo allergy chips
    const soloAllergyChips = document.querySelectorAll('#solo-allergy-chips .solo-allergy-chip');
    if (soloAllergyChips.length > 0) {
        if (userAllergies.length === 0) {
            soloAllergyChips.forEach(c => {
                if (c.dataset.allergen === '') c.classList.add('active');
                else c.classList.remove('active');
            });
        } else {
            soloAllergyChips.forEach(c => {
                if (c.dataset.allergen === '') {
                    c.classList.remove('active');
                } else if (userAllergies.includes(c.dataset.allergen)) {
                    c.classList.add('active');
                } else {
                    c.classList.remove('active');
                }
            });
        }
        if (typeof updateSoloFilterBadge === 'function') {
            updateSoloFilterBadge();
        }
    }

    // Prefill join allergy selectors
    const selectors = ['#view-join .allergy-selector'];
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

    // Prefill group allergy chips
    const groupAllergyChips = document.querySelectorAll('#group-allergy-chips .host-allergy-chip');
    if (groupAllergyChips.length > 0) {
        if (userAllergies.length === 0) {
            groupAllergyChips.forEach(c => {
                if (c.dataset.allergen === '') c.classList.add('active');
                else c.classList.remove('active');
            });
        } else {
            groupAllergyChips.forEach(c => {
                if (c.dataset.allergen === '') {
                    c.classList.remove('active');
                } else if (userAllergies.includes(c.dataset.allergen)) {
                    c.classList.add('active');
                } else {
                    c.classList.remove('active');
                }
            });
        }
        if (typeof updateGroupFilterBadge === 'function') {
            updateGroupFilterBadge();
        }
    }
}

// Modal actions
const authModal = document.getElementById('auth-modal');
const btnCloseAuth = document.getElementById('btn-close-auth');
const btnModalGoogleLogin = document.getElementById('btn-modal-google-login');
const btnModalFacebookLogin = document.getElementById('btn-modal-facebook-login');

function openAuthModal() {
    if (authModal) authModal.classList.remove('hidden');
}

function closeAuthModal() {
    if (authModal) authModal.classList.add('hidden');
}

if (btnCloseAuth) btnCloseAuth.addEventListener('click', closeAuthModal);

if (btnModalGoogleLogin) {
    btnModalGoogleLogin.addEventListener('click', () => {
        closeAuthModal();
        initiateOAuthLogin('google');
    });
}

if (btnModalFacebookLogin) {
    btnModalFacebookLogin.addEventListener('click', () => {
        closeAuthModal();
        initiateOAuthLogin('facebook');
    });
}

const btnModalQuickGuest = document.getElementById('btn-modal-quick-guest');
if (btnModalQuickGuest) {
    btnModalQuickGuest.addEventListener('click', () => {
        closeAuthModal();
        triggerQuickGuestLogin(() => {
            showToast('ใช้งานต่อในโหมดทั่วไป สามารถปัดอาหารต่อได้ทันที 🍜', 'info');
        });
    });
}

if (authModal) {
    authModal.addEventListener('click', (e) => {
        if (e.target === authModal) {
            closeAuthModal();
        }
    });
}

// Handle allergy selector inside profile modal
document.querySelectorAll('#profile-allergy-selector .allergy-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        soundFx.playPop();
        if (navigator.vibrate) navigator.vibrate(8);
        pill.classList.toggle('active');
    });
});

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

// --- FORGOT PASSWORD MODAL CONTROLS (METHODS 2 & 3) ---
function setupForgotPasswordModal() {
    const forgotModal = document.getElementById('modal-forgot-password');
    if (!forgotModal) return;
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
                showToast('กรุณากรอกชื่อผู้ใช้', 'warning');
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
                        showToast(data.message || 'ไม่พบบัญชีผู้ใช้นี้', 'error');
                        return;
                    }

                    if (!data.hasSecurityQuestion && !data.hasPin) {
                        showToast('บัญชีนี้ยังไม่ได้ตั้งคำถามลับหรือ PIN กู้คืนไว้ ระบบแนะนำให้ใช้แท็บ "รหัส OTP อีเมล" ในการกู้คืนแทน', 'warning');
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
                    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
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
                showToast('กรุณาตอบคำถามความปลอดภัย หรือกรอก Recovery PIN อย่างใดอย่างหนึ่ง', 'warning');
                return;
            }

            if (!newPassword || newPassword.length < 4) {
                showToast('รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 4 ตัวอักษร', 'warning');
                return;
            }

            if (newPassword !== confirmPassword) {
                showToast('รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน', 'warning');
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
                        showToast(data.message || 'ตั้งรหัสผ่านใหม่สำเร็จแล้ว สามารถเข้าสู่ระบบได้ทันที', 'success');
                        closeForgotModal();

                        // Prefill login input
                        const viewLogin = document.getElementById('view-login-username');
                        const modalLogin = document.getElementById('login-username');
                        if (viewLogin) viewLogin.value = currentForgotUsername;
                        if (modalLogin) modalLogin.value = currentForgotUsername;
                    } else {
                        showToast(data.message || 'การยืนยันไม่ถูกต้อง', 'error');
                    }
                })
                .catch(err => {
                    btnQSubmit.disabled = false;
                    btnQSubmit.innerHTML = '<i class="fa-solid fa-check"></i> บันทึกรหัสผ่านใหม่';
                    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
                });
        });
    }

    // TAB 2: Method 2 - Step 1 Send Email OTP
    const btnESendOtp = document.getElementById('btn-forgot-e-send-otp');
    if (btnESendOtp) {
        btnESendOtp.addEventListener('click', () => {
            const inputVal = (document.getElementById('forgot-e-input')?.value || '').trim();
            if (!inputVal) {
                showToast('กรุณากรอกชื่อผู้ใช้ หรืออีเมล', 'warning');
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
                            showToast(`${data.message} [Dev Mode OTP: ${data.devOtp}]`, 'info', 6000);
                            const otpInput = document.getElementById('forgot-e-otp');
                            if (otpInput) otpInput.value = data.devOtp;
                        } else {
                            showToast(data.message, 'success');
                        }
                    } else {
                        showToast(data.message || 'ส่งรหัส OTP ไม่สำเร็จ', 'error');
                    }
                })
                .catch(err => {
                    btnESendOtp.disabled = false;
                    btnESendOtp.innerHTML = '<i class="fa-solid fa-paper-plane"></i> ส่งรหัส OTP ไปที่อีเมล';
                    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
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
                showToast('กรุณากรอกรหัส OTP 6 หลัก', 'warning');
                return;
            }

            if (!newPassword || newPassword.length < 4) {
                showToast('รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 4 ตัวอักษร', 'warning');
                return;
            }

            if (newPassword !== confirmPassword) {
                showToast('รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน', 'warning');
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
                        showToast(data.message || 'ตั้งรหัสผ่านใหม่สำเร็จแล้ว สามารถเข้าสู่ระบบได้ทันที', 'success');
                        closeForgotModal();

                        const viewLogin = document.getElementById('view-login-username');
                        const modalLogin = document.getElementById('login-username');
                        if (viewLogin) viewLogin.value = currentForgotUsername;
                        if (modalLogin) modalLogin.value = currentForgotUsername;
                    } else {
                        showToast(data.message || 'รหัส OTP ไม่ถูกต้อง', 'error');
                    }
                })
                .catch(err => {
                    btnESubmit.disabled = false;
                    btnESubmit.innerHTML = '<i class="fa-solid fa-check"></i> ยืนยันรหัสผ่านใหม่';
                    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
                });
        });
    }
}

// ==============================================================================
// PDPA & COOKIE CONSENT SYSTEM
// ==============================================================================
function setupPdpaSystem() {
    const banner = document.getElementById('cookie-consent-banner');
    const prefsModal = document.getElementById('modal-cookie-preferences');
    const policyModal = document.getElementById('modal-privacy-policy');
    const floatingBtn = document.getElementById('btn-floating-pdpa');

    const btnAcceptAll = document.getElementById('btn-cookie-accept-all');
    const btnReject = document.getElementById('btn-cookie-reject');
    const btnCustomize = document.getElementById('btn-cookie-customize');

    const btnClosePrefs = document.getElementById('btn-close-cookie-prefs') || document.getElementById('btn-close-cookie-modal');
    const btnSavePrefs = document.getElementById('btn-cookie-save-prefs');
    const btnAcceptAllModal = document.getElementById('btn-cookie-accept-all-modal');

    const switchFunctional = document.getElementById('pref-cookie-functional');
    const switchAnalytics = document.getElementById('pref-cookie-analytics');
    const switchMarketing = document.getElementById('pref-cookie-marketing');

    // Privacy & Terms Modal
    const tabPolicyPrivacy = document.getElementById('tab-policy-privacy');
    const tabPolicyTerms = document.getElementById('tab-policy-terms');
    const panePolicyPrivacy = document.getElementById('pane-policy-privacy');
    const panePolicyTerms = document.getElementById('pane-policy-terms');
    const btnClosePolicy = document.getElementById('btn-close-privacy-policy') || document.getElementById('btn-close-privacy-modal');
    const btnClosePolicyAction = document.getElementById('btn-close-privacy-policy-action');

    function openPolicyModal(tab = 'privacy') {
        if (!policyModal) return;
        if (tab === 'privacy') {
            if (tabPolicyPrivacy) {
                tabPolicyPrivacy.classList.add('btn-primary', 'active');
                tabPolicyPrivacy.classList.remove('btn-secondary');
            }
            if (tabPolicyTerms) {
                tabPolicyTerms.classList.remove('btn-primary', 'active');
                tabPolicyTerms.classList.add('btn-secondary');
            }
            if (panePolicyPrivacy) panePolicyPrivacy.classList.remove('hidden');
            if (panePolicyTerms) panePolicyTerms.classList.add('hidden');
        } else {
            if (tabPolicyTerms) {
                tabPolicyTerms.classList.add('btn-primary', 'active');
                tabPolicyTerms.classList.remove('btn-secondary');
            }
            if (tabPolicyPrivacy) {
                tabPolicyPrivacy.classList.remove('btn-primary', 'active');
                tabPolicyPrivacy.classList.add('btn-secondary');
            }
            if (panePolicyTerms) panePolicyTerms.classList.remove('hidden');
            if (panePolicyPrivacy) panePolicyPrivacy.classList.add('hidden');
        }
        policyModal.classList.add('active');
    }

    function closePolicyModal() {
        if (policyModal) policyModal.classList.remove('active');
    }

    if (tabPolicyPrivacy) tabPolicyPrivacy.addEventListener('click', () => openPolicyModal('privacy'));
    if (tabPolicyTerms) tabPolicyTerms.addEventListener('click', () => openPolicyModal('terms'));
    if (btnClosePolicy) btnClosePolicy.addEventListener('click', closePolicyModal);
    if (btnClosePolicyAction) btnClosePolicyAction.addEventListener('click', closePolicyModal);
    if (policyModal) {
        policyModal.addEventListener('click', (e) => {
            if (e.target === policyModal) closePolicyModal();
        });
    }

    document.querySelectorAll('.btn-trigger-privacy').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            openPolicyModal('privacy');
        });
    });
    document.querySelectorAll('.btn-trigger-terms').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            openPolicyModal('terms');
        });
    });

    function openPrefsModal() {
        try {
            const saved = JSON.parse(localStorage.getItem('ginder_pdpa_consent') || '{}');
            if (saved && saved.consentChoices) {
                if (switchFunctional) switchFunctional.checked = saved.consentChoices.functional !== false;
                if (switchAnalytics) switchAnalytics.checked = !!saved.consentChoices.analytics;
                if (switchMarketing) switchMarketing.checked = !!saved.consentChoices.marketing;
            }
        } catch (e) {}

        if (prefsModal) prefsModal.classList.add('active');
    }

    function closePrefsModal() {
        if (prefsModal) prefsModal.classList.remove('active');
    }

    if (btnClosePrefs) btnClosePrefs.addEventListener('click', closePrefsModal);
    if (prefsModal) {
        prefsModal.addEventListener('click', (e) => {
            if (e.target === prefsModal) closePrefsModal();
        });
    }

    if (btnCustomize) btnCustomize.addEventListener('click', openPrefsModal);
    if (floatingBtn) floatingBtn.addEventListener('click', openPrefsModal);
    document.querySelectorAll('.btn-trigger-cookie-prefs').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            openPrefsModal();
        });
    });
    const btnProfileOpenCookie = document.getElementById('btn-profile-open-cookie-prefs');
    if (btnProfileOpenCookie) {
        btnProfileOpenCookie.addEventListener('click', () => {
            const profileModal = document.getElementById('modal-profile');
            if (profileModal) profileModal.classList.remove('active');
            openPrefsModal();
        });
    }

    function recordConsent(choices, consentType) {
        const consentPayload = {
            consentType: consentType || 'custom',
            consentChoices: {
                necessary: true,
                functional: choices.functional !== false,
                analytics: !!choices.analytics,
                marketing: !!choices.marketing
            },
            privacyPolicyVersion: '1.0'
        };

        // Save locally for immediate offline/fast response
        localStorage.setItem('ginder_pdpa_consent', JSON.stringify({
            ...consentPayload,
            timestamp: new Date().toISOString()
        }));

        // Hide banner & modal
        if (banner) banner.classList.remove('active');
        closePrefsModal();

        // Send to server audit log
        fetch('/api/pdpa/consent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(consentPayload)
        }).catch(err => console.warn('Failed to sync consent to server:', err));
    }

    if (btnAcceptAll) {
        btnAcceptAll.addEventListener('click', () => {
            recordConsent({ functional: true, analytics: true, marketing: true }, 'accept_all');
        });
    }

    if (btnAcceptAllModal) {
        btnAcceptAllModal.addEventListener('click', () => {
            if (switchFunctional) switchFunctional.checked = true;
            if (switchAnalytics) switchAnalytics.checked = true;
            if (switchMarketing) switchMarketing.checked = true;
            recordConsent({ functional: true, analytics: true, marketing: true }, 'accept_all');
        });
    }

    if (btnReject) {
        btnReject.addEventListener('click', () => {
            recordConsent({ functional: false, analytics: false, marketing: false }, 'reject_optional');
        });
    }

    if (btnSavePrefs) {
        btnSavePrefs.addEventListener('click', () => {
            const choices = {
                functional: switchFunctional ? switchFunctional.checked : true,
                analytics: switchAnalytics ? switchAnalytics.checked : false,
                marketing: switchMarketing ? switchMarketing.checked : false
            };
            recordConsent(choices, 'custom');
        });
    }

    // Check if consent has already been recorded
    const existingConsent = localStorage.getItem('ginder_pdpa_consent');
    if (!existingConsent) {
        fetch('/api/pdpa/my-consent')
            .then(res => res.json())
            .then(data => {
                if (data && data.consentChoices) {
                    localStorage.setItem('ginder_pdpa_consent', JSON.stringify(data));
                } else {
                    if (banner) banner.classList.add('active');
                }
            })
            .catch(() => {
                if (banner) banner.classList.add('active');
            });
    }
}




