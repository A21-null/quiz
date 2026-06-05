// ─── Panel open / close ──────────────────────────────────────────────────────

function openMinigame() {
    document.getElementById("minigamePanel").classList.add("open");
    document.body.classList.add("minigame-open");
    if (gameState === "idle")   { if (!rafHandle) startIdleAnim(); }
    else if (gameState === "paused") drawPauseOverlay();
}

function closeMinigame() {
    if (gameState === "playing") pauseGame();
    document.getElementById("minigamePanel").classList.remove("open");
    document.body.classList.remove("minigame-open");
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CW = 328, CH = 500;
const LANE_W        = CW / 3;
const LANE_CENTERS  = [LANE_W * 0.5, LANE_W * 1.5, LANE_W * 2.5];

const PLAYER_W = 38, PLAYER_H = 58;
const GROUND_Y = CH - 96;      // top-edge of player when on ground
const HIT_IX = 5, HIT_IY = 6;

// Jump physics
const GRAVITY   = 1900;   // px/s²
const JUMP_VY   = -600;   // initial upward velocity

// Obstacles
const OBS_A_W   = LANE_W - 18;     // single-lane tall
const OBS_B_W   = LANE_W * 2 - 18; // double-lane tall
const OBS_H     = 42;
const OBS_C_W   = LANE_W - 22;     // single-lane LOW (jumpable)
const OBS_C_H   = 20;
// Train
const TRAIN_LEN = 380;              // body length (px, in screen y-axis)
const TRAIN_W   = OBS_A_W;         // one lane wide
const TRAIN_H   = OBS_C_H;         // front barrier same height as low fence

// Speed / spawn
const BASE_SPEED = 130;
const SPEED_GROW = 45;
const MAX_SPEED  = 820;
const BASE_INT   = 850;
const INT_DECAY  = 70;
const MIN_INT    = 180;

// Scoring
const SCORE_K    = 0.07;
const COIN_VAL   = 12;
const COIN_R     = 13;        // coin radius (pixels)
const MULT_T     = [6, 14]; // coin streak thresholds for x2, x3

// Death
const DEATH_MS   = 860;
const FLASH_MS   = 200;
const N_PARTS    = 22;

// Power-up durations (s)
const PU_DUR     = { shield: 7, magnet: 5, x2: 8 };

const DASH_H = 26, DASH_GAP = 18;
const LS_KEY = "mg_hiscore2";

// ─── Audio (Web Audio API, fully synthesised) ─────────────────────────────────

let audioCtx = null;
let muted = false;

function getACtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
}

function playTone(freq, dur, type = "sine", vol = 0.18, sweep = null) {
    if (muted) return;
    try {
        const ac = getACtx();
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.connect(gain); gain.connect(ac.destination);
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ac.currentTime);
        if (sweep) osc.frequency.linearRampToValueAtTime(sweep, ac.currentTime + dur);
        gain.gain.setValueAtTime(vol, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
        osc.start(); osc.stop(ac.currentTime + dur);
    } catch(_) {}
}

function playJump()    { playTone(220, 0.12, "sine", 0.14, 420); }
function playCoin()    { playTone(880, 0.07, "sine", 0.12); setTimeout(() => playTone(1100, 0.05, "sine", 0.08), 50); }
function playPowerup() {
    [440, 550, 660, 880].forEach((f, i) => setTimeout(() => playTone(f, 0.09, "triangle", 0.12), i * 55));
}
function playDeath()   { playTone(300, 0.08, "sawtooth", 0.2, 80); setTimeout(() => playTone(120, 0.3, "sawtooth", 0.15, 60), 80); }
function playShield()  { playTone(600, 0.05, "sine", 0.1); }

// ─── State ───────────────────────────────────────────────────────────────────

let gameState = "idle";
let rafHandle = null, lastTime = 0;

let player = { lane: 1, x: 0, targetX: 0, moving: false, queuedDir: null };

// Jump state
let playerYOff = 0;  // pixels above GROUND_Y (0 = on ground, positive = in air)
let playerVY   = 0;  // vertical velocity (px/s, negative = up)

// Game objects
let recentLanes = [];
let obstacles  = [];
let coins      = [];
let powerups   = [];
let particles  = [];

// Timers & counters
let elapsed    = 0;
let score      = 0;
let hiScore    = 0;
let spawnTimer = 0;
let coinTimer  = 0;
let dashOffset = 0;
let animFrame  = 0;   // for character animation
let deathTimer = 0, deathPX = 0, deathPY = 0;
let canStart   = false;

// Multiplier / coins
let coinCount  = 0;
let coinStreak = 0;
let multiplier = 1;
let multAnim   = 0;   // countdown for "x2!" popup
let totalCoinsSpawned = 0; // cuenta monedas generadas para la moneda especial

// Active power-up
let activePU    = null;  // { type, timeLeft }
let shieldHits  = 0;
let playerRiding = null; // reference to train obstacle being ridden

// Parallax
let bgOff1 = 0, bgOff2 = 0;   // two building layers
let bgBuildings1 = null;
let bgBuildings2 = null;

// Touch tracking for swipe gestures
let touchStartX = 0, touchStartY = 0;

let canvas, ctx;

// ─── Parallax building data ───────────────────────────────────────────────────

function genBuildingStrip(seed, count, minW, maxW, minH, maxH) {
    const strip = [];
    let x = 0;
    for (let i = 0; i < count; i++) {
        const w = minW + ((seed * (i + 1) * 17 + 3) % (maxW - minW + 1));
        const h = minH + ((seed * (i + 1) * 11 + 7) % (maxH - minH + 1));
        const wins = Math.floor(h / 22);
        strip.push({ x, w, h, wins });
        x += w + 3;
    }
    return { buildings: strip, totalW: x };
}

// ─── Init ────────────────────────────────────────────────────────────────────

function initMiniGame() {
    canvas  = document.getElementById("mgCanvas");
    ctx     = canvas.getContext("2d");
    hiScore = parseInt(lsGet(LS_KEY) || "0", 10);

    player.x = player.targetX = LANE_CENTERS[1];

    // Generate building data
    bgBuildings1 = genBuildingStrip(42, 24, 18, 42, 60, 130);
    bgBuildings2 = genBuildingStrip(77, 30, 10, 26, 30, 70);

    // Controls
    document.getElementById("mgLeft").addEventListener("pointerdown",  () => handleMove("left"));
    document.getElementById("mgRight").addEventListener("pointerdown", () => handleMove("right"));
    const jBtn = document.getElementById("mgJump");
    if (jBtn) jBtn.addEventListener("pointerdown", () => handleJump());
    const mBtn = document.getElementById("mgMute");
    if (mBtn) mBtn.addEventListener("click", toggleMute);

    canvas.addEventListener("touchstart", onCanvasTouch,     { passive: false });
    canvas.addEventListener("touchmove",  onCanvasTouchMove, { passive: false });
    canvas.addEventListener("touchend",   onCanvasTouchEnd,  { passive: false });
    canvas.addEventListener("click", onCanvasClick);
    // Capture phase: fires before quiz keydown handlers so we can block them
    document.addEventListener("keydown", onKey, true);

    startIdleAnim();
}

// ─── Input ───────────────────────────────────────────────────────────────────

function onKey(e) {
    if (e.repeat) return;
    const panelOpen = document.getElementById("minigamePanel").classList.contains("open");

    if (e.key === "Escape") {
        if (gameState === "playing") pauseGame();
        if (panelOpen) closeMinigame();
        return;
    }

    if (!panelOpen) return;

    // Panel is open: swallow the event so the quiz never sees it
    e.stopImmediatePropagation();
    e.preventDefault();

    if (e.key === " " || e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
        if (gameState === "playing") handleJump();
        else handleStart();
        return;
    }
    if (e.key === "ArrowLeft"  || e.key === "a" || e.key === "A") { handleMove("left");  return; }
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") { handleMove("right"); return; }
}

function onCanvasTouch(e) {
    e.preventDefault();
    const t = e.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
}

function onCanvasTouchMove(e) {
    if (gameState === "playing") e.preventDefault();
}

function onCanvasTouchEnd(e) {
    e.preventDefault();
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    const adx = Math.abs(dx), ady = Math.abs(dy);

    if (gameState !== "playing") {
        handleStart();
        return;
    }
    if (adx > 35 && adx >= ady) {
        handleMove(dx < 0 ? "left" : "right");
    } else if (dy < -35 && ady > adx) {
        handleJump();
    }
}

function onCanvasClick() {
    if (gameState !== "playing") handleStart();
}

function handleMove(dir) {
    if (gameState !== "playing") return;
    if (!player.moving) {
        if (dir === "left"  && player.lane > 0) { player.lane--; player.targetX = LANE_CENTERS[player.lane]; player.moving = true; }
        if (dir === "right" && player.lane < 2) { player.lane++; player.targetX = LANE_CENTERS[player.lane]; player.moving = true; }
    } else {
        player.queuedDir = dir;
    }
}

function handleJump() {
    if (gameState !== "playing") return;
    if (playerRiding) {
        // Jump off the train
        playerRiding = null;
        playerVY = JUMP_VY;
        playJump();
        return;
    }
    if (playerYOff <= 1) {
        playerVY = JUMP_VY;
        playJump();
    }
}

function handleStart() {
    if (gameState === "idle")               { startGame(); return; }
    if (gameState === "paused")             { resumeGame(); return; }
    if (gameState === "dead" && canStart)   { startGame(); return; }
}

function toggleMute() {
    muted = !muted;
    const btn = document.getElementById("mgMute");
    if (btn) btn.textContent = muted ? "🔇" : "🔊";
}

// ─── Pause button ────────────────────────────────────────────────────────────

function updatePauseBtn() {
    const btn = document.getElementById("mgPauseBtn");
    if (!btn) return;
    if      (gameState === "playing") { btn.style.display = ""; btn.textContent = "⏸"; btn.title = "Pausar"; }
    else if (gameState === "paused")  { btn.style.display = ""; btn.textContent = "▶"; btn.title = "Reanudar"; }
    else                              { btn.style.display = "none"; }
}

function togglePause() {
    if (gameState === "playing") pauseGame();
    else if (gameState === "paused") resumeGame();
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

function startIdleAnim() {
    gameState = "idle";
    lastTime  = performance.now();
    rafHandle = requestAnimationFrame(idleLoop);
}

function idleLoop(ts) {
    if (gameState !== "idle") return;
    const delta = Math.min((ts - lastTime) / 1000, 0.1);
    lastTime = ts;
    dashOffset = (dashOffset + 80 * delta) % (DASH_H + DASH_GAP);
    bgOff1 = (bgOff1 + 80 * 0.12 * delta) % (bgBuildings1 ? bgBuildings1.totalW : 1000);
    bgOff2 = (bgOff2 + 80 * 0.30 * delta) % (bgBuildings2 ? bgBuildings2.totalW : 1000);
    drawStartScreen();
    rafHandle = requestAnimationFrame(idleLoop);
}

function startGame() {
    elapsed = 0; score = 0; spawnTimer = BASE_INT; coinTimer = BASE_INT * 1.3;
    dashOffset = 0; animFrame = 0;
    obstacles = []; coins = []; powerups = []; particles = []; recentLanes = [];
    deathTimer = 0; canStart = false;
    playerYOff = 0; playerVY = 0;
    coinCount = 0; coinStreak = 0; multiplier = 1; multAnim = 0; totalCoinsSpawned = 0;
    activePU = null; shieldHits = 0; playerRiding = null;

    player.lane = 1;
    player.x = player.targetX = LANE_CENTERS[1];
    player.moving = false; player.queuedDir = null;

    gameState = "playing";
    lastTime  = performance.now();
    updatePauseBtn();
    rafHandle = requestAnimationFrame(gameLoop);
}

function pauseGame() {
    gameState = "paused";
    cancelAnimationFrame(rafHandle); rafHandle = null;
    updatePauseBtn();
    drawPauseOverlay();
}

function resumeGame() {
    gameState = "playing";
    lastTime  = performance.now();
    updatePauseBtn();
    rafHandle = requestAnimationFrame(gameLoop);
}

function triggerDeath() {
    if (activePU && activePU.type === "shield" && shieldHits > 0) {
        shieldHits--;
        playShield();
        if (shieldHits <= 0) activePU = null;
        return;
    }
    gameState  = "dead";
    deathTimer = 0; canStart = false;
    deathPX    = player.x;
    deathPY    = GROUND_Y - playerYOff + PLAYER_H / 2;
    updatePauseBtn();
    spawnParticles();
    playDeath();
}

function endDeathAnimation() {
    if (score > hiScore) { hiScore = Math.floor(score); lsSet(LS_KEY, hiScore); }
    cancelAnimationFrame(rafHandle); rafHandle = null;
    startIdleAnim();
}

// ─── Game loop ───────────────────────────────────────────────────────────────

function gameLoop(ts) {
    try {
        const delta = Math.min((ts - lastTime) / 1000, 0.1);
        lastTime = ts;

        if (gameState === "playing") {
            update(delta);
            render();
            rafHandle = requestAnimationFrame(gameLoop);
        } else if (gameState === "dead") {
            updateDeath(delta);
            if (gameState === "dead") {
                renderDeath();
                rafHandle = requestAnimationFrame(gameLoop);
            }
        }
    } catch (err) {
        console.error("[minijuego] error:", err);
        cancelAnimationFrame(rafHandle); rafHandle = null;
        gameState = "idle";
        updatePauseBtn();
        startIdleAnim();
    }
}

// ─── Update ──────────────────────────────────────────────────────────────────

function curSpeed() {
    return Math.min(BASE_SPEED + SPEED_GROW * Math.sqrt(elapsed), MAX_SPEED);
}

function getSpawnInt() {
    return Math.max(MIN_INT, BASE_INT - INT_DECAY * Math.sqrt(elapsed));
}

function update(delta) {
    elapsed   += delta;
    animFrame += 1;

    const spd = curSpeed();
    const scoreMulti = (activePU && activePU.type === "x2") ? 2 : 1;
    score += spd * delta * SCORE_K * multiplier * scoreMulti;

    // Road scroll
    dashOffset = (dashOffset + spd * delta) % (DASH_H + DASH_GAP);
    bgOff1 = (bgOff1 + spd * 0.12 * delta) % (bgBuildings1.totalW);
    bgOff2 = (bgOff2 + spd * 0.30 * delta) % (bgBuildings2.totalW);

    // Jump physics
    if (playerYOff > 0 || playerVY < 0) {
        playerVY  += GRAVITY * delta;
        playerYOff -= playerVY * delta;
        if (playerYOff <= 0) { playerYOff = 0; playerVY = 0; }
    }

    // Train riding
    if (playerRiding) {
        const o = playerRiding;
        // Unboard: train gone, off-lane, or top of train (back end) has passed the player
        if (!obstacles.includes(o) ||
            Math.abs(player.x - o.x) > LANE_W * 0.6 ||
            o.y > GROUND_Y) {
            playerRiding = null;
        } else {
            playerYOff = 0;
            playerVY   = 0;
        }
    } else {
        // Mark cleared when player is airborne above the front barrier (bottom of train)
        for (const o of obstacles) {
            if (o.type !== "T" || o.cleared) continue;
            if (Math.abs(player.x - o.x) > LANE_W * 0.55) continue;
            if (playerYOff > TRAIN_H + 4) o.cleared = true;
        }
        // Board when falling back down, barrier was jumped, and body is still at player
        if (playerVY >= 0) {
            for (const o of obstacles) {
                if (o.type !== "T" || !o.cleared) continue;
                if (Math.abs(player.x - o.x) > LANE_W * 0.55) continue;
                // Front barrier (bottom) has reached player AND body (top) still above
                if (o.y + o.trainLen > GROUND_Y && o.y < GROUND_Y) {
                    playerRiding = o;
                    playerYOff   = 0;
                    playerVY     = 0;
                    break;
                }
            }
        }
    }

    // Player lane lerp
    const diff = player.targetX - player.x;
    player.x += diff * 0.3;
    if (Math.abs(diff) < 0.5 || (Math.abs(diff) < 15 && player.queuedDir)) {
        player.x = player.targetX;
        if (player.moving) {
            player.moving = false;
            if (player.queuedDir) { const d = player.queuedDir; player.queuedDir = null; handleMove(d); }
        }
    }

    // Spawn obstacles
    spawnTimer -= delta * 1000;
    if (spawnTimer <= 0) { trySpawnObstacle(); spawnTimer = getSpawnInt(); }

    // Spawn coins
    coinTimer -= delta * 1000;
    if (coinTimer <= 0) { trySpawnCoin(); coinTimer = getSpawnInt() * 1.1 + 200; }

    // Move obstacles, coins, powerups
    obstacles.forEach(o => o.y += spd * delta);
    obstacles = obstacles.filter(o => o.y < CH + 20);   // cull when front edge off-screen bottom

    coins.forEach(c => { c.y += spd * delta; });
    coins = coins.filter(c => c.y < CH + 20 && !c.done);

    powerups.forEach(p => { p.y += spd * delta; });
    powerups = powerups.filter(p => p.y < CH + 20 && !p.done);

    // Active power-up countdown
    if (activePU) {
        activePU.timeLeft -= delta;
        if (activePU.timeLeft <= 0) activePU = null;
    }

    // Multiplier anim
    if (multAnim > 0) multAnim -= delta;

    // Magnet: attract nearby coins
    if (activePU && activePU.type === "magnet") {
        const py = GROUND_Y - playerYOff;
        coins.forEach(c => {
            const dist = Math.hypot(c.x - player.x, c.y - py);
            if (dist < 130) {
                c.x += (player.x - c.x) * 0.18;
                c.y += (py - c.y) * 0.18;
            }
        });
    }

    checkCollisions();
}

function updateDeath(delta) {
    deathTimer += delta * 1000;
    particles.forEach(p => { p.x += p.vx * delta; p.y += p.vy * delta; p.life -= delta * 1.1; });
    particles = particles.filter(p => p.life > 0);
    if (deathTimer >= DEATH_MS) endDeathAnimation();
}

// ─── Spawn helpers ────────────────────────────────────────────────────────────

function pickLaneWithBias() {
    const playerBonus = Math.min(2, elapsed / 30);
    const weights = [1, 2, 1];
    weights[player.lane] += playerBonus;
    recentLanes.forEach(l => { weights[l] = Math.max(0.1, weights[l] * 0.25); });
    const total = weights[0] + weights[1] + weights[2];
    const r = Math.random() * total;
    if (r < weights[0]) return 0;
    if (r < weights[0] + weights[1]) return 1;
    return 2;
}

// Returns true if spawnY falls inside the body of any train in the given lane.
// Since all objects fall at the same speed, relative positions are constant —
// if the spawn point is inside a train body now, it will always be.
function isInsideTrain(lane, spawnY) {
    const MARGIN = 200;
    return obstacles.some(o =>
        o.type === "T" && o.lane === lane &&
        spawnY >= o.y - MARGIN && spawnY < o.y + o.trainLen + MARGIN
    );
}

function trySpawnObstacle() {
    // Train (type T) — after 20s, ~12% chance, single lane, rideable
    if (elapsed >= 20 && Math.random() < 0.12) {
        const lane = [0, 1, 2][Math.floor(Math.random() * 3)];
        const obs = {
            x: LANE_CENTERS[lane], y: -TRAIN_LEN,
            w: TRAIN_W, h: TRAIN_H,
            trainLen: TRAIN_LEN, lane,
            type: "T"
        };
        obstacles.push(obs);
        // Pre-populate coins along train body
        // Coins in groups of 3, with a big gap between groups
        const GROUP_SIZE = 3, COIN_GAP = 22, GROUP_GAP = 70;
        let ry = 36;
        while (ry < TRAIN_LEN - 30) {
            for (let ci = 0; ci < GROUP_SIZE; ci++) {
                coins.push({ x: LANE_CENTERS[lane], y: -TRAIN_LEN + ry + ci * COIN_GAP, lane, done: false, popAnim: 0 });
            }
            ry += GROUP_SIZE * COIN_GAP + GROUP_GAP;
        }
        return;
    }

    // Low jumpable obstacle (type C) – after 15s
    if (elapsed >= 15 && Math.random() < 0.25) {
        const lane = pickLaneWithBias();
        if (isInsideTrain(lane, -OBS_H)) return;
        const obs = { x: LANE_CENTERS[lane], y: -OBS_H, w: OBS_C_W, h: OBS_C_H, type: "C" };
        obstacles.push(obs);
        recentLanes.push(lane);
        if (recentLanes.length > 2) recentLanes.shift();
        return;
    }

    // Power-up spawn (low chance, only after 10s)
    if (elapsed >= 10 && Math.random() < 0.06) {
        const lane = [0, 1, 2][Math.floor(Math.random() * 3)];
        if (isInsideTrain(lane, -30)) return;
        const types = ["shield", "magnet", "x2"];
        const type  = types[Math.floor(Math.random() * types.length)];
        powerups.push({ x: LANE_CENTERS[lane], y: -30, lane, type, done: false });
        return;
    }

    const useB = elapsed >= 30 && Math.random() < Math.min(0.45, (elapsed - 30) / 120);
    if (useB) {
        const pairs = [[0,1],[1,2]];
        const preferred = pairs.filter(p => p.includes(player.lane));
        const other     = pairs.filter(p => !p.includes(player.lane));
        const pool = (other.length > 0 && Math.random() >= 0.7) ? other : preferred;
        const pair = pool[Math.floor(Math.random() * pool.length)];
        // Skip if either lane of the double obstacle is inside a train
        if (isInsideTrain(pair[0], -OBS_H) || isInsideTrain(pair[1], -OBS_H)) return;
        const cx = (LANE_CENTERS[pair[0]] + LANE_CENTERS[pair[1]]) / 2;
        const obs = { x: cx, y: -OBS_H, w: OBS_B_W, h: OBS_H, type: "B" };
        obstacles.push(obs);
    } else {
        const lane = pickLaneWithBias();
        if (isInsideTrain(lane, -OBS_H)) return;
        const obs = { x: LANE_CENTERS[lane], y: -OBS_H, w: OBS_A_W, h: OBS_H, type: "A" };
        obstacles.push(obs);
        recentLanes.push(lane);
        if (recentLanes.length > 2) recentLanes.shift();
    }
}

const COIN_SPAWN_Y    = -20;
const COIN_CLEARANCE  = 100; // min px between coin and any obstacle (same lane, vertical)

function laneOfObstacle(o) {
    // Returns set of lanes covered by obstacle o
    const covered = new Set();
    for (let i = 0; i < 3; i++) {
        const lx = LANE_CENTERS[i];
        if (lx >= o.x - o.w / 2 - 8 && lx <= o.x + o.w / 2 + 8) covered.add(i);
    }
    return covered;
}


function trySpawnCoin() {
    // A lane is unsafe if any obstacle in that lane is within COIN_CLEARANCE of spawn y
    const unsafe = new Set();
    obstacles.forEach(o => {
        if (Math.abs(o.y - COIN_SPAWN_Y) < COIN_CLEARANCE) {
            laneOfObstacle(o).forEach(l => unsafe.add(l));
        }
    });

    const free = [0, 1, 2].filter(l => !unsafe.has(l) && !isInsideTrain(l, COIN_SPAWN_Y));
    if (!free.length) return;
    const lane = free[Math.floor(Math.random() * free.length)];

    // Cada 50 monedas generadas, aparece una moneda especial (papel)
    const nextCount = totalCoinsSpawned + 1;
    if (nextCount % 50 === 0) {
        totalCoinsSpawned = nextCount;
        coins.push({ x: LANE_CENTERS[lane], y: COIN_SPAWN_Y, lane, done: false, popAnim: 0, special: true });
        return;
    }

    // Coin row: spawn 1-3 coins stacked vertically
    const n = Math.random() < 0.4 ? 3 : 1;
    for (let i = 0; i < n; i++) {
        totalCoinsSpawned++;
        coins.push({ x: LANE_CENTERS[lane], y: COIN_SPAWN_Y - i * 28, lane, done: false, popAnim: 0 });
    }
}

// ─── Collisions ───────────────────────────────────────────────────────────────

function checkCollisions() {
    const playerTop = GROUND_Y - playerYOff;
    const px = player.x - PLAYER_W / 2 + HIT_IX;
    const py = playerTop + HIT_IY;
    const pw = PLAYER_W - 2 * HIT_IX;
    const ph = PLAYER_H - 2 * HIT_IY;

    for (const o of obstacles) {
        const ox = o.x - o.w / 2, oy = o.y;

        // X overlap (same for all types)
        if (!(px < ox + o.w && px + pw > ox)) continue;

        if (o.type === "T") {
            if (playerRiding === o) continue;   // riding: always safe

            const frontY = oy + o.trainLen - o.h;  // top of front barrier (at the bottom)

            // 1) Front barrier: bottom of the train, player must jump over it
            if (py < oy + o.trainLen && py + ph > frontY) {
                if (playerYOff <= TRAIN_H + 8) { triggerDeath(); return; }
            }

            // 2) Body: the upper part of the train. Kills if player never jumped.
            if (!o.cleared) {
                if (py < frontY && py + ph > oy) { triggerDeath(); return; }
            }
            continue;
        }

        // Standard AABB for A, B, C
        if (!(py < oy + o.h && py + ph > oy)) continue;
        if (o.type === "C") {
            if (playerYOff > OBS_C_H + 8) continue;
        }
        triggerDeath(); return;
    }

    // Coin collection
    coins.forEach(c => {
        if (c.done) return;
        let hit = false;
        if (c.special) {
            const cpw = 54, cph = 36;
            const playerMidY = playerTop + PLAYER_H / 2;
            hit = player.x + PLAYER_W * 0.5 > c.x - cpw / 2 &&
                  player.x - PLAYER_W * 0.5 < c.x + cpw / 2 &&
                  playerMidY + PLAYER_H * 0.5 > c.y - cph / 2 &&
                  playerMidY - PLAYER_H * 0.5 < c.y + cph / 2;
        } else {
            const dist = Math.hypot(c.x - player.x, c.y - (playerTop + PLAYER_H / 2));
            hit = dist < PLAYER_W * 0.55 + COIN_R;
        }
        if (hit) {
            c.done = true;
            c.popAnim = 1;
            coinCount++;
            coinStreak++;
            score += COIN_VAL * multiplier * (c.special ? 10 : 1);
            multiplier = coinStreak >= MULT_T[1] ? 3 : coinStreak >= MULT_T[0] ? 2 : 1;
            if (coinStreak === MULT_T[0] || coinStreak === MULT_T[1]) multAnim = 1.2;
            playCoin();
        }
    });

    // Power-up collection
    powerups.forEach(p => {
        if (p.done) return;
        const dist = Math.hypot(p.x - player.x, p.y - (playerTop + PLAYER_H / 2));
        if (dist < PLAYER_W * 0.7 + 14) {
            p.done = true;
            activePU = { type: p.type, timeLeft: PU_DUR[p.type] };
            if (p.type === "shield") shieldHits = 1;
            playPowerup();
        }
    });
}

function spawnParticles() {
    const colors = ["#ff6b35", "#f87171", "#facc15", "#4ade80", "#6c8cff", "#ffffff"];
    for (let i = 0; i < N_PARTS; i++) {
        const ang = (i / N_PARTS) * Math.PI * 2 + Math.random() * 0.4;
        const spd = 80 + Math.random() * 160;
        particles.push({
            x: deathPX, y: deathPY,
            vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
            life: 0.8 + Math.random() * 0.4,
            color: colors[i % colors.length]
        });
    }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
    ctx.clearRect(0, 0, CW, CH);
    drawBackground();
    drawRoad();
    drawCoins();
    drawPowerupItems();
    drawObstacles();
    drawPlayer(GROUND_Y - playerYOff, 1.0);
    drawHUD();
}

function renderDeath() {
    ctx.clearRect(0, 0, CW, CH);
    drawBackground();
    drawRoad();
    drawObstacles();
    ctx.globalAlpha = 0.25; drawPlayer(GROUND_Y - playerYOff, 1.0); ctx.globalAlpha = 1;
    drawParticles();
    if (deathTimer < FLASH_MS) {
        const a = 0.5 * (1 - deathTimer / FLASH_MS);
        ctx.fillStyle = `rgba(248,113,113,${a})`;
        ctx.fillRect(0, 0, CW, CH);
    }
}

// ─── Background & parallax ────────────────────────────────────────────────────

function drawBackground() {
    // Sky/base
    ctx.fillStyle = "#08090e";
    ctx.fillRect(0, 0, CW, CH);

    // Far buildings (layer 1) — very dark, top portion
    drawBuildingLayer(bgBuildings1, bgOff1, 0, 90, "#0e1018", "#131620", 0.18);
    // Mid buildings (layer 2)
    drawBuildingLayer(bgBuildings2, bgOff2, 0, 55, "#131620", "#1a1f2e", 0.35);

    // Vignette on sides
    const vl = ctx.createLinearGradient(0, 0, 28, 0);
    vl.addColorStop(0, "rgba(0,0,0,0.55)");
    vl.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = vl; ctx.fillRect(0, 0, 28, CH);
    const vr = ctx.createLinearGradient(CW, 0, CW - 28, 0);
    vr.addColorStop(0, "rgba(0,0,0,0.55)");
    vr.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = vr; ctx.fillRect(CW - 28, 0, 28, CH);
}

function drawBuildingLayer(strip, offset, yBase, maxH, bodyColor, winGlow, winAlpha) {
    if (!strip) return;
    const { buildings, totalW } = strip;

    // Draw twice for seamless tiling
    for (let rep = -1; rep <= 1; rep++) {
        const xShift = rep * totalW - offset;
        buildings.forEach(b => {
            const bx = b.x + xShift;
            if (bx + b.w < 0 || bx > CW) return;
            const by = yBase;
            const bh = Math.min(b.h, maxH);
            // Building body
            ctx.fillStyle = bodyColor;
            ctx.fillRect(bx, by, b.w, bh);
            // Windows
            ctx.fillStyle = `rgba(255,220,120,${winAlpha})`;
            for (let row = 0; row < b.wins; row++) {
                const wy = by + 5 + row * 16;
                if (wy + 8 > by + bh) break;
                for (let col = 0; col < Math.floor(b.w / 9); col++) {
                    if ((row + col) % 3 !== 0) continue; // sparse windows
                    ctx.fillRect(bx + 3 + col * 9, wy, 5, 7);
                }
            }
        });
    }
}

function drawRoad() {
    const roadGrad = ctx.createLinearGradient(0, 0, 0, CH);
    roadGrad.addColorStop(0, "#181b26");
    roadGrad.addColorStop(1, "#1e2232");
    ctx.fillStyle = roadGrad;
    ctx.fillRect(0, 0, CW, CH);

    // Asphalt texture patches (static, uses seeded positions)
    ctx.fillStyle = "rgba(255,255,255,0.02)";
    const patchSeeds = [30, 110, 195, 260, 48, 155, 215, 72, 140];
    patchSeeds.forEach((xs, i) => {
        const ys = ((xs * 37 + i * 61) % CH);
        ctx.fillRect(xs, ys, 18 + (xs % 22), 4 + (i % 3));
    });

    // Lane dividers — scrolling dashed lines
    ctx.setLineDash([DASH_H, DASH_GAP]);
    ctx.lineDashOffset = -dashOffset;
    ctx.strokeStyle = "rgba(55,65,100,0.85)";
    ctx.lineWidth = 2.5;
    for (let i = 1; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(LANE_W * i, 0); ctx.lineTo(LANE_W * i, CH); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.lineDashOffset = 0;

    // Road edge lines
    ctx.strokeStyle = "rgba(80,90,130,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(1, 0); ctx.lineTo(1, CH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(CW - 1, 0); ctx.lineTo(CW - 1, CH); ctx.stroke();
}

// ─── Draw objects ─────────────────────────────────────────────────────────────

function drawObstacles() {
    obstacles.forEach(o => {
        const ox = o.x - o.w / 2;
        if (o.type === "T") {
            drawTrain(o);
        } else if (o.type === "C") {
            drawFenceLow(ox, o.y, o.w, o.h);
        } else {
            drawFenceHigh(ox, o.y, o.w, o.h, o.type === "B");
        }
    });
}

// Train car — jump on and ride (type T)
// Repeating green-fence support column drawn on each side of the elevated train
function drawElevSupport(sx, sy, sw, sh) {
    if (sh <= 0) return;
    const RAIL_PERIOD = OBS_C_H + 3; // same height as a low fence + small gap
    const sy0 = Math.max(sy, 0);
    const sh0 = Math.min(sy + sh, CH) - sy0;
    if (sh0 <= 0) return;

    ctx.save();
    ctx.beginPath(); ctx.rect(sx, sy0, sw, sh0); ctx.clip();

    // Dark background (the underside of the elevated platform)
    ctx.fillStyle = "#071a07";
    ctx.fillRect(sx, sy0, sw, sh0);

    // Repeating horizontal rails (green)
    for (let ry = sy; ry < sy + sh + RAIL_PERIOD; ry += RAIL_PERIOD) {
        const railY = Math.max(ry, sy0);
        // Post (dark green vertical bar, full height between rails)
        ctx.fillStyle = "#14532d";
        ctx.fillRect(sx + 1,      ry, 3, RAIL_PERIOD - 1);
        ctx.fillRect(sx + sw - 4, ry, 3, RAIL_PERIOD - 1);
        // Horizontal rail bar
        ctx.fillStyle = "#15803d";
        ctx.fillRect(sx, ry, sw, 3);
        // Rail highlight
        ctx.fillStyle = "#4ade80";
        ctx.fillRect(sx, ry, sw, 1);
    }

    ctx.restore();
}

function drawTrain(o) {
    const ox      = o.x - o.w / 2;
    const oy      = o.y;
    const len     = o.trainLen;
    // Front barrier is at the BOTTOM (first to reach the player as the train falls)
    const frontY  = oy + len - o.h;   // top of front barrier
    // Body = everything above the front barrier
    const bodyTop = Math.max(oy, 0);
    const bodyBot = Math.min(frontY, CH);
    const bodyLen = bodyBot - bodyTop;
    if (bodyBot < 0 || oy > CH) return;

    const SW = 9; // support column width on each side

    // Wide elevation shadow
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(ox - SW + 3, bodyTop, o.w + SW * 2 - 6, Math.min(bodyLen + o.h, CH - bodyTop));

    // Left & right elevation support columns (repeating green fences)
    drawElevSupport(ox - SW, bodyTop, SW, bodyLen);
    drawElevSupport(ox + o.w, bodyTop, SW, bodyLen);

    // Train body (slate-blue) — only the body part, not the barrier
    if (bodyLen > 0) {
        ctx.fillStyle = "#334155";
        ctx.fillRect(ox, bodyTop, o.w, bodyLen);

        // Platform edge walls
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(ox,           bodyTop, 4, bodyLen);
        ctx.fillRect(ox + o.w - 4, bodyTop, 4, bodyLen);

        // Side stripe (yellow accent)
        ctx.fillStyle = "#fbbf24";
        ctx.fillRect(ox + 4,       bodyTop, 3, bodyLen);
        ctx.fillRect(ox + o.w - 7, bodyTop, 3, bodyLen);

        // Windows (pairs every 38px along body)
        ctx.fillStyle = "#7dd3fc";
        for (let ry = 8; ry < len - o.h - 14; ry += 38) {
            const wy = oy + ry;
            if (wy < 0 || wy > CH) continue;
            const wh = Math.min(16, CH - wy);
            if (wh <= 0) continue;
            ctx.fillRect(ox + 8,        wy, 10, wh);
            ctx.fillRect(ox + o.w - 18, wy, 10, wh);
            ctx.fillStyle = "rgba(255,255,255,0.3)";
            ctx.fillRect(ox + 8,        wy, 4, Math.min(5, wh));
            ctx.fillRect(ox + o.w - 18, wy, 4, Math.min(5, wh));
            ctx.fillStyle = "#7dd3fc";
        }

        // Top highlight
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        ctx.fillRect(ox + 2, bodyTop, o.w - 4, Math.min(4, bodyLen));
    }

    // Front barrier at the BOTTOM of the train (the part to jump over)
    if (frontY < CH) {
        drawFenceLow(ox, frontY, o.w, o.h);
    }

    // Riding indicator: golden outline around body
    if (playerRiding === o && bodyLen > 0) {
        ctx.strokeStyle = "rgba(251,191,36,0.65)";
        ctx.lineWidth = 2;
        ctx.strokeRect(ox - 1, bodyTop, o.w + 2, bodyLen);
    }
}

// Tall metal fence — must dodge (type A: red, type B: yellow warning)
function drawFenceHigh(ox, oy, w, h, warning) {
    const baseCol   = warning ? "#f59e0b" : "#ef4444";
    const darkCol   = warning ? "#92400e" : "#991b1b";
    const railCol   = warning ? "#78350f" : "#7f1d1d";
    const postW     = 6;
    const numPosts  = w > 100 ? 4 : 2;

    // Drop shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(ox + 3, oy + h, w - 3, 5);

    // Main body fill
    roundedRect(ctx, ox, oy, w, h, 4);
    ctx.fillStyle = baseCol; ctx.fill();

    // Warning type: diagonal black stripes clipped to body
    if (warning) {
        ctx.save();
        roundedRect(ctx, ox, oy, w, h, 4); ctx.clip();
        ctx.strokeStyle = "rgba(0,0,0,0.22)";
        ctx.lineWidth = 9;
        for (let sx = -h; sx < w + h; sx += 18) {
            ctx.beginPath();
            ctx.moveTo(ox + sx, oy);
            ctx.lineTo(ox + sx + h * 1.2, oy + h);
            ctx.stroke();
        }
        ctx.restore();
    }

    // Top-edge highlight (3-D depth illusion)
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(ox + 2, oy + 1, w - 4, 4);

    // Horizontal rails
    ctx.fillStyle = railCol;
    ctx.fillRect(ox, oy + 4,          w, 4);   // top rail
    ctx.fillRect(ox, oy + h - 8,      w, 4);   // bottom rail
    if (h > 28) ctx.fillRect(ox, oy + h * 0.48, w, 3); // mid rail

    // Vertical posts
    ctx.fillStyle = darkCol;
    const gap = w / (numPosts - 1);
    for (let i = 0; i < numPosts; i++) {
        const px = ox + Math.round(i * gap) - (i === numPosts - 1 ? postW : 0);
        ctx.fillRect(px, oy, postW, h);
    }

    // Post caps (small bright tops)
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    for (let i = 0; i < numPosts; i++) {
        const px = ox + Math.round(i * gap) - (i === numPosts - 1 ? postW : 0);
        ctx.fillRect(px + 1, oy, postW - 2, 3);
    }
}

// Low hurdle fence — jump over (type C: green)
function drawFenceLow(ox, oy, w, h) {
    const postW = 5;
    const postH = h + 6;
    const barH  = Math.max(6, h - 4);

    // Drop shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(ox + 3, oy + postH, w - 3, 4);

    // Posts
    ctx.fillStyle = "#15803d";
    ctx.fillRect(ox,           oy - 2, postW, postH);
    ctx.fillRect(ox + w - postW, oy - 2, postW, postH);

    // Horizontal bar
    roundedRect(ctx, ox + postW, oy + (h - barH) / 2, w - postW * 2, barH, 3);
    ctx.fillStyle = "#4ade80"; ctx.fill();

    // Bar highlight
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillRect(ox + postW + 2, oy + (h - barH) / 2 + 1, w - postW * 2 - 4, 3);

    // Post caps
    ctx.fillStyle = "#86efac";
    ctx.fillRect(ox + 1,           oy - 3, postW - 2, 3);
    ctx.fillRect(ox + w - postW + 1, oy - 3, postW - 2, 3);
}

function drawCoins() {
    coins.forEach(c => {
        if (c.done) return;

        if (c.special) {
            // ── Moneda especial: papel "NOTAS: DAW 10" ────────────────
            const pw = 54, ph = 36, fold = 10;
            const lx = c.x - pw / 2, ty = c.y - ph / 2;

            // Sombra suave
            ctx.shadowColor = "rgba(0,0,0,0.35)";
            ctx.shadowBlur = 5;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;

            // Cuerpo del papel con esquina doblada (top-right)
            ctx.fillStyle = "#fffde7";
            ctx.beginPath();
            ctx.moveTo(lx, ty);
            ctx.lineTo(lx + pw - fold, ty);
            ctx.lineTo(lx + pw, ty + fold);
            ctx.lineTo(lx + pw, ty + ph);
            ctx.lineTo(lx, ty + ph);
            ctx.closePath();
            ctx.fill();

            // Resetear sombra
            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            // Borde del papel
            ctx.strokeStyle = "#bdbdbd";
            ctx.lineWidth = 1;
            ctx.stroke();

            // Triángulo del doblez (esquina oscura)
            ctx.fillStyle = "#e0dbb0";
            ctx.beginPath();
            ctx.moveTo(lx + pw - fold, ty);
            ctx.lineTo(lx + pw, ty + fold);
            ctx.lineTo(lx + pw - fold, ty + fold);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = "#bdbdbd";
            ctx.lineWidth = 0.8;
            ctx.stroke();

            // Líneas rayadas (azul pálido)
            ctx.strokeStyle = "rgba(100,149,237,0.5)";
            ctx.lineWidth = 0.7;
            for (let ln = 0; ln < 3; ln++) {
                const ly = ty + 6 + ln * 5;
                ctx.beginPath();
                ctx.moveTo(lx + 3, ly);
                ctx.lineTo(lx + pw - (ln === 0 ? fold + 2 : 4), ly);
                ctx.stroke();
            }

            // Texto — dos líneas
            ctx.fillStyle = "#333";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = "bold 16px sans-serif";
            ctx.fillText("DAW", c.x, c.y - 5);
            ctx.font = "bold 12px sans-serif";
            ctx.fillText("10", c.x, c.y + 12);

        } else {
            // ── Moneda normal dorada ───────────────────────────────────
            // Coin glow
            const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, COIN_R * 1.6);
            grad.addColorStop(0, "rgba(255,220,60,0.35)");
            grad.addColorStop(1, "rgba(255,180,0,0)");
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(c.x, c.y, COIN_R * 1.6, 0, Math.PI * 2); ctx.fill();

            // Coin body
            ctx.beginPath(); ctx.arc(c.x, c.y, COIN_R, 0, Math.PI * 2);
            const cg = ctx.createRadialGradient(c.x - 2, c.y - 2, 1, c.x, c.y, COIN_R);
            cg.addColorStop(0, "#ffe566");
            cg.addColorStop(0.6, "#f5a623");
            cg.addColorStop(1, "#c97a00");
            ctx.fillStyle = cg; ctx.fill();

            // Inner highlight
            ctx.beginPath(); ctx.arc(c.x - 2, c.y - 2, COIN_R * 0.35, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255,255,200,0.6)"; ctx.fill();
        }
    });
}

function drawPowerupItems() {
    const PU_COLORS = { shield: "#22d3ee", magnet: "#f97316", x2: "#a78bfa" };
    const PU_ICONS  = { shield: "🛡", magnet: "🧲", x2: "×2" };
    powerups.forEach(p => {
        if (p.done) return;
        const r = 14;
        const pulse = 0.85 + 0.15 * Math.sin(animFrame * 0.18);
        const col = PU_COLORS[p.type];

        // Glow
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.2 * pulse);
        grad.addColorStop(0, col + "55");
        grad.addColorStop(1, col + "00");
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.2 * pulse, 0, Math.PI * 2); ctx.fill();

        // Diamond body
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.PI / 4);
        roundedRect(ctx, -r * 0.75, -r * 0.75, r * 1.5, r * 1.5, 4);
        ctx.fillStyle = col; ctx.fill();
        ctx.restore();

        // Icon
        ctx.font = p.type === "x2" ? "bold 10px monospace" : "12px serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#fff";
        ctx.fillText(PU_ICONS[p.type], p.x, p.y + 4);
        ctx.textAlign = "left";
    });
}

// ─── Player (geometric runner, top-down style) ────────────────────────────────

function drawPlayer(playerTop, alpha) {
    const px = player.x - PLAYER_W / 2;
    const py = playerTop;
    ctx.globalAlpha = alpha;

    // Shadow (elongated when jumping)
    const shadowScale = 1 + playerYOff * 0.004;
    ctx.fillStyle = `rgba(0,0,0,${0.3 - playerYOff * 0.001})`;
    ctx.beginPath();
    ctx.ellipse(player.x, GROUND_Y + PLAYER_H + 5, PLAYER_W * 0.44 * shadowScale, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Shield aura
    if (activePU && activePU.type === "shield" && shieldHits > 0) {
        const pulse = 0.7 + 0.3 * Math.sin(animFrame * 0.3);
        ctx.beginPath();
        ctx.arc(player.x, py + PLAYER_H / 2, PLAYER_W * 0.75, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(34,211,238,${pulse})`;
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    // Running leg animation
    const onGround = playerYOff < 2;
    const legSwing = onGround ? Math.sin(animFrame * 0.32) * 6 : 0;

    // Jacket body
    roundedRect(ctx, px + 6, py + 18, 26, 24, 5);
    ctx.fillStyle = "#ff6b35"; ctx.fill();

    // Hood / backpack
    ctx.fillStyle = "#c84b1a";
    ctx.fillRect(px + 10, py + 14, 18, 10);

    // Head (circle)
    ctx.beginPath();
    ctx.arc(player.x, py + 10, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#fde68a"; ctx.fill();

    // Hair
    ctx.fillStyle = "#1a0a00";
    ctx.fillRect(px + 11, py + 2, 16, 7);

    // Left arm
    ctx.fillStyle = "#ff6b35";
    ctx.fillRect(px + 1, py + 20 - legSwing * 0.5, 6, 12);
    // Right arm
    ctx.fillRect(px + 31, py + 20 + legSwing * 0.5, 6, 12);

    // Left leg
    ctx.fillStyle = "#1e3a5f";
    ctx.fillRect(px + 10, py + 40 + legSwing, 8, 16);
    // Right leg
    ctx.fillRect(px + 20, py + 40 - legSwing, 8, 16);

    // Shoes
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(px + 9, py + 53 + legSwing, 10, 5);
    ctx.fillRect(px + 19, py + 53 - legSwing, 10, 5);

    ctx.globalAlpha = 1;
}

function drawParticles() {
    particles.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, 5 * p.life), 0, Math.PI * 2);
        ctx.fillStyle = hexAlpha(p.color, p.life * 0.9);
        ctx.fill();
    });
}

// ─── HUD ──────────────────────────────────────────────────────────────────────

function drawHUD() {
    const s = Math.floor(score);

    // Score
    ctx.font = "bold 18px 'JetBrains Mono', monospace";
    ctx.textAlign = "right";
    ctx.fillStyle = "#e2e4ed";
    ctx.fillText(s, CW - 10, 26);
    ctx.font = "bold 9px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#8b8fa7";
    ctx.fillText("SCORE", CW - 10, 14);

    // Coins counter
    ctx.textAlign = "left";
    ctx.font = "bold 12px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#f5a623";
    ctx.fillText(`●  ${coinCount}`, 10, 22);

    // Multiplier
    if (multiplier > 1) {
        const pulse = 0.85 + 0.15 * Math.sin(animFrame * 0.25);
        ctx.save();
        ctx.translate(10 + 44, 34);
        ctx.scale(pulse, pulse);
        ctx.font = "bold 13px 'JetBrains Mono', monospace";
        ctx.fillStyle = multiplier >= 3 ? "#a78bfa" : "#4ade80";
        ctx.fillText(`×${multiplier}`, 0, 0);
        ctx.restore();
    }

    // Multiplier popup
    if (multAnim > 0) {
        const a = Math.min(1, multAnim);
        const rise = (1.2 - multAnim) * 20;
        ctx.font = "bold 22px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = `rgba(74,222,128,${a})`;
        ctx.fillText(`×${multiplier}!`, CW / 2, CH / 2 - 60 - rise);
        ctx.textAlign = "left";
    }

    // Active power-up bar
    if (activePU) {
        const col = { shield: "#22d3ee", magnet: "#f97316", x2: "#a78bfa" }[activePU.type];
        const dur = PU_DUR[activePU.type];
        const frac = Math.max(0, activePU.timeLeft / dur);
        const bw = 80, bh = 6, bx = CW / 2 - 40, by = 8;

        ctx.fillStyle = "rgba(0,0,0,0.4)";
        roundedRect(ctx, bx - 1, by - 1, bw + 2, bh + 2, 3);
        ctx.fill();

        ctx.fillStyle = col;
        roundedRect(ctx, bx, by, bw * frac, bh, 2);
        ctx.fill();

        ctx.font = "bold 9px monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = col;
        const labels = { shield: "ESCUDO", magnet: "IMÁN", x2: "×2 SCORE" };
        ctx.fillText(labels[activePU.type], CW / 2, by + bh + 9);
        ctx.textAlign = "left";
    }

    // NEW BEST banner
    if (s > hiScore && hiScore > 0) {
        ctx.textAlign = "center";
        roundedRect(ctx, CW / 2 - 36, CH - 38, 72, 18, 5);
        ctx.fillStyle = "rgba(74,222,128,0.18)"; ctx.fill();
        ctx.font = "bold 9px monospace";
        ctx.fillStyle = "#4ade80";
        ctx.fillText("NEW BEST!", CW / 2, CH - 25);
        ctx.textAlign = "left";
    }

    // Jump height indicator (subtle arc)
    if (playerYOff > 5) {
        const frac = Math.min(playerYOff / 120, 1);
        ctx.strokeStyle = `rgba(108,140,255,${frac * 0.5})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(player.x, GROUND_Y + PLAYER_H + 8, PLAYER_W * 0.5, Math.PI, 2 * Math.PI);
        ctx.stroke();
    }
}

// ─── Static screens ───────────────────────────────────────────────────────────

function drawStartScreen() {
    if (!ctx) return;
    ctx.clearRect(0, 0, CW, CH);
    drawBackground();
    drawRoad();

    ctx.fillStyle = "rgba(8,9,14,0.72)";
    ctx.fillRect(0, 0, CW, CH);

    // Title
    ctx.textAlign = "center";
    ctx.font = "800 36px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#ff6b35";
    ctx.fillText("ETSE RUN", CW / 2, 170);

    // Subtitle
    ctx.font = "400 12px monospace";
    ctx.fillStyle = "#8b8fa7";
    ctx.fillText("salta, esquiva, recoge monedas y USC.NOTAS", CW / 2, 192);

    // Best score
    ctx.font = "700 15px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#e2e4ed";
    ctx.fillText(`BEST: ${hiScore}`, CW / 2, 228);

    // Controls hint
    ctx.font = "600 11px monospace";
    ctx.fillStyle = "#8b8fa7";
    ctx.fillText("← → mover   ↑ / ESPACIO saltar", CW / 2, 266);
    ctx.fillText("tap · clic para empezar", CW / 2, 284);

    // Obstacle legend (3 rows, compact)
    const LX   = CW / 2 - 58;  // icon x
    const TX   = CW / 2 - 18;  // label x
    const ICON_W = 34;
    let   gy   = 298;           // current row y

    ctx.font = "bold 9px monospace";
    ctx.fillStyle = "#8b8fa7";
    ctx.textAlign = "center";
    ctx.fillText("GUÍA DE OBSTÁCULOS:", CW / 2, gy);
    ctx.textAlign = "left";
    gy += 9;

    // Row 1 — tall fence (red): must dodge
    const LEGEND_H = 26;
    drawFenceHigh(LX, gy, ICON_W, LEGEND_H, false);
    ctx.font = "9px monospace"; ctx.fillStyle = "#e2e4ed";
    ctx.fillText("esquivar", TX, gy + LEGEND_H / 2 + 4);
    gy += LEGEND_H + 10;

    // Row 2 — low fence (green): must jump
    drawFenceLow(LX, gy, ICON_W, OBS_C_H);
    ctx.font = "9px monospace"; ctx.fillStyle = "#e2e4ed";
    ctx.fillText("saltar ↑", TX, gy + OBS_C_H / 2 + 4);
    gy += OBS_C_H + 10;

    // Row 3 — train: jump to board and ride
    drawFenceLow(LX, gy, ICON_W, OBS_C_H);            // front barrier
    ctx.fillStyle = "#334155";
    ctx.fillRect(LX, gy + OBS_C_H, ICON_W, 14);       // mini body
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(LX + 2, gy + OBS_C_H, 3, 14);        // side stripe
    ctx.fillRect(LX + ICON_W - 5, gy + OBS_C_H, 3, 14);
    ctx.fillStyle = "#7dd3fc";
    ctx.fillRect(LX + 6, gy + OBS_C_H + 3, 8, 7);    // window
    ctx.font = "9px monospace"; ctx.fillStyle = "#fbbf24";
    ctx.fillText("tren: subirse ↑", TX, gy + OBS_C_H / 2 + 4);

    // Static runner
    ctx.textAlign = "left";
    drawPlayer(GROUND_Y, 1.0);
}

function drawPauseOverlay() {
    if (!ctx) return;
    ctx.fillStyle = "rgba(8,9,14,0.82)";
    ctx.fillRect(0, 0, CW, CH);
    ctx.textAlign = "center";
    ctx.font = "800 26px monospace";
    ctx.fillStyle = "#e2e4ed";
    ctx.fillText("PAUSA", CW / 2, CH / 2 - 16);
    ctx.font = "600 12px monospace";
    ctx.fillStyle = "#8b8fa7";
    ctx.fillText("ESPACIO · tap para continuar", CW / 2, CH / 2 + 14);
    ctx.textAlign = "left";
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function roundedRect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) {
        ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
    } else {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }
}

function hexAlpha(hex, a) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", initMiniGame);
