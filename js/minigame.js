// ─── Panel open / close ──────────────────────────────────────────────────────

function openMinigame() {
    document.getElementById("minigamePanel").classList.add("open");
    document.body.classList.add("minigame-open");
    if (gameState === "idle")   drawStartScreen();
    else if (gameState === "paused") drawPauseOverlay();
}

function closeMinigame() {
    if (gameState === "playing") pauseGame();
    document.getElementById("minigamePanel").classList.remove("open");
    document.body.classList.remove("minigame-open");
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CW = 328, CH = 500;
const LANE_W        = CW / 3;                                   // ~109 px
const LANE_CENTERS  = [LANE_W * 0.5, LANE_W * 1.5, LANE_W * 2.5];

const PLAYER_W = 38, PLAYER_H = 58;
const PLAYER_Y = CH - 96;          // top-edge of player (fixed)
const HIT_IX = 5, HIT_IY = 6;

const OBS_A_W  = LANE_W - 18;      // single-lane obstacle
const OBS_B_W  = LANE_W * 2 - 18;  // double-lane obstacle
const OBS_H    = 40;

const BASE_SPEED  = 130;  // px / s  (starts slow)
const SPEED_GROW  = 45;   // grows with sqrt(elapsed)
const MAX_SPEED   = 820;
const BASE_INT    = 850;  // ms between spawns
const INT_DECAY   = 70;   // shrinks with sqrt(elapsed)
const MIN_INT     = 180;

const SCORE_K     = 0.07;
const DEATH_MS    = 860;
const FLASH_MS    = 200;
const N_PARTS     = 18;

const DASH_H = 26, DASH_GAP = 18;  // road dash tile
const LS_KEY = "mg_hiscore";

// ─── State ───────────────────────────────────────────────────────────────────

let gameState = "idle";
let rafHandle = null, lastTime = 0;

let player = { lane: 1, x: 0, targetX: 0, moving: false, queuedDir: null };

let recentLanes = []; // últimos 2 carriles spawneados (anti-streak)
let obstacles  = [];  // { x, y, w, h, type }  x=center, y=top-edge
let particles  = [];  // { x, y, vx, vy, life, color }

let elapsed    = 0;
let score      = 0;
let hiScore    = 0;
let spawnTimer = 0;
let dashOffset = 0;   // scrolling road dashes
let deathTimer = 0, deathPX = 0, deathPY = 0;
let canStart   = false;

let canvas, ctx;

// ─── Init ────────────────────────────────────────────────────────────────────

function initMiniGame() {
    canvas  = document.getElementById("mgCanvas");
    ctx     = canvas.getContext("2d");
    hiScore = parseInt(localStorage.getItem(LS_KEY) || "0", 10);

    player.x = player.targetX = LANE_CENTERS[1];

    document.getElementById("mgLeft").addEventListener("pointerdown",  () => handleMove("left"));
    document.getElementById("mgRight").addEventListener("pointerdown", () => handleMove("right"));
    canvas.addEventListener("touchstart", onCanvasTouch, { passive: false });
    canvas.addEventListener("click", onCanvasClick);
    document.addEventListener("keydown", onKey);

    drawStartScreen();
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
    if (e.key === " ") { e.preventDefault(); handleStart(); return; }
    if (e.key === "ArrowLeft"  || e.key === "a" || e.key === "A") { e.preventDefault(); handleMove("left");  return; }
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") { e.preventDefault(); handleMove("right"); return; }
}

function onCanvasTouch(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const tx = e.touches[0].clientX - rect.left;
    if (gameState === "playing") handleMove(tx < CW / 2 ? "left" : "right");
    else handleStart();
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

function handleStart() {
    if (gameState === "idle")   { startGame(); return; }
    if (gameState === "paused") { resumeGame(); return; }
    if (gameState === "dead" && canStart) { startGame(); return; }
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

function startGame() {
    elapsed = 0; score = 0; spawnTimer = BASE_INT; dashOffset = 0;
    obstacles = []; particles = []; recentLanes = [];
    deathTimer = 0; canStart = false;

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
    gameState  = "dead";
    deathTimer = 0; canStart = false;
    deathPX    = player.x;
    deathPY    = PLAYER_Y + PLAYER_H / 2;
    updatePauseBtn();
    spawnParticles();
}

function endDeathAnimation() {
    if (score > hiScore) { hiScore = Math.floor(score); localStorage.setItem(LS_KEY, hiScore); }
    gameState = "idle";
    updatePauseBtn();
    drawStartScreen();
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
        console.error("[minijuego] error en gameLoop:", err);
        // Recuperar: volver a idle y mostrar pantalla inicial
        cancelAnimationFrame(rafHandle); rafHandle = null;
        gameState = "idle";
        updatePauseBtn();
        drawStartScreen();
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
    elapsed += delta;
    score   += curSpeed() * delta * SCORE_K;

    // Road scroll
    dashOffset = (dashOffset + curSpeed() * delta) % (DASH_H + DASH_GAP);

    // Player lerp
    const diff = player.targetX - player.x;
    player.x += diff * 0.2;
    if (Math.abs(diff) < 0.5) {
        player.x = player.targetX;
        if (player.moving) {
            player.moving = false;
            if (player.queuedDir) { const d = player.queuedDir; player.queuedDir = null; handleMove(d); }
        }
    }

    // Spawn
    spawnTimer -= delta * 1000;
    if (spawnTimer <= 0) { trySpawnObstacle(); spawnTimer = getSpawnInt(); }

    // Move obstacles
    const spd = curSpeed();
    obstacles.forEach(o => o.y += spd * delta);
    obstacles = obstacles.filter(o => o.y < CH + 10);

    checkCollisions();
}

function updateDeath(delta) {
    deathTimer += delta * 1000;
    particles.forEach(p => { p.x += p.vx * delta; p.y += p.vy * delta; p.life -= delta * 1.1; });
    particles = particles.filter(p => p.life > 0);
    if (deathTimer >= DEATH_MS) endDeathAnimation();
}

function pickLaneWithBias() {
    // Center (lane 1) always has 2× base weight.
    // Player's lane gains extra weight over time (0→2 over 60s).
    // Recent lanes are penalized to avoid streaks.
    const playerBonus = Math.min(2, elapsed / 30);
    const weights = [1, 2, 1];
    weights[player.lane] += playerBonus;
    // Penalize the last 2 spawned lanes (halve their weight each time they appear)
    recentLanes.forEach(l => { weights[l] = Math.max(0.1, weights[l] * 0.25); });
    const total = weights[0] + weights[1] + weights[2];
    const r = Math.random() * total;
    if (r < weights[0]) return 0;
    if (r < weights[0] + weights[1]) return 1;
    return 2;
}

function trySpawnObstacle() {
    const useB = elapsed >= 30 && Math.random() < Math.min(0.45, (elapsed - 30) / 120);
    if (useB) {
        // double-lane: prefer the pair that covers the player's lane
        const pairs = [[0,1],[1,2]];
        const preferred = pairs.filter(p => p.includes(player.lane));
        const other     = pairs.filter(p => !p.includes(player.lane));
        // fallback to preferred if other is empty (e.g. player in center lane)
        const pool = (other.length > 0 && Math.random() >= 0.7) ? other : preferred;
        const pair = pool[Math.floor(Math.random() * pool.length)];
        const cx = (LANE_CENTERS[pair[0]] + LANE_CENTERS[pair[1]]) / 2;
        obstacles.push({ x: cx, y: -OBS_H, w: OBS_B_W, h: OBS_H, type: "B" });
    } else {
        const lane = pickLaneWithBias();
        obstacles.push({ x: LANE_CENTERS[lane], y: -OBS_H, w: OBS_A_W, h: OBS_H, type: "A" });
        recentLanes.push(lane);
        if (recentLanes.length > 2) recentLanes.shift();
    }
}

function checkCollisions() {
    const px = player.x - PLAYER_W / 2 + HIT_IX;
    const py = PLAYER_Y + HIT_IY;
    const pw = PLAYER_W - 2 * HIT_IX;
    const ph = PLAYER_H - 2 * HIT_IY;

    for (const o of obstacles) {
        const ox = o.x - o.w / 2, oy = o.y;
        if (px < ox + o.w && px + pw > ox && py < oy + o.h && py + ph > oy) {
            triggerDeath(); return;
        }
    }
}

function spawnParticles() {
    const colors = ["#6c8cff", "#f87171", "#facc15", "#4ade80"];
    for (let i = 0; i < N_PARTS; i++) {
        const ang = (i / N_PARTS) * Math.PI * 2 + Math.random() * 0.4;
        const spd = 70 + Math.random() * 150;
        particles.push({
            x: deathPX, y: deathPY,
            vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
            life: 0.8 + Math.random() * 0.4,
            color: colors[i % colors.length]
        });
    }
}

// ─── Render ──────────────────────────────────────────────────────────────────

function render() {
    ctx.clearRect(0, 0, CW, CH);
    drawRoad();
    drawObstacles();
    drawPlayer();
    drawHUD();
}

function renderDeath() {
    ctx.clearRect(0, 0, CW, CH);
    drawRoad();
    drawObstacles();
    ctx.globalAlpha = 0.25; drawPlayer(); ctx.globalAlpha = 1;
    drawParticles();
    if (deathTimer < FLASH_MS) {
        const a = 0.5 * (1 - deathTimer / FLASH_MS);
        ctx.fillStyle = `rgba(248,113,113,${a})`;
        ctx.fillRect(0, 0, CW, CH);
    }
}

// ─── Draw helpers ─────────────────────────────────────────────────────────────

function drawRoad() {
    // Background
    ctx.fillStyle = "#0f1117";
    ctx.fillRect(0, 0, CW, CH);

    // Road surface (full width)
    const roadGrad = ctx.createLinearGradient(0, 0, 0, CH);
    roadGrad.addColorStop(0, "#181b26");
    roadGrad.addColorStop(1, "#1e2232");
    ctx.fillStyle = roadGrad;
    ctx.fillRect(0, 0, CW, CH);

    // Lane dividers — scrolling dashed lines
    ctx.setLineDash([DASH_H, DASH_GAP]);
    ctx.lineDashOffset = -dashOffset;
    ctx.strokeStyle = "rgba(55,65,100,0.85)";
    ctx.lineWidth = 2.5;
    for (let i = 1; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(LANE_W * i, 0);
        ctx.lineTo(LANE_W * i, CH);
        ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // Road edge lines
    ctx.strokeStyle = "rgba(80,90,130,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(1, 0); ctx.lineTo(1, CH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(CW - 1, 0); ctx.lineTo(CW - 1, CH); ctx.stroke();
}

function drawObstacles() {
    obstacles.forEach(o => {
        const ox = o.x - o.w / 2;
        const color = o.type === "A" ? "#f87171" : "#facc15";
        roundedRect(ctx, ox, o.y, o.w, o.h, 6);
        ctx.fillStyle = color;
        ctx.fill();
        // grille stripe
        const sw = o.w * 0.5, sh = Math.max(3, o.h * 0.18);
        ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.fillRect(ox + (o.w - sw) / 2, o.y + (o.h - sh) / 2, sw, sh);
    });
}

function drawPlayer() {
    const px = player.x - PLAYER_W / 2;
    const py = PLAYER_Y;

    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(player.x, py + PLAYER_H + 5, PLAYER_W * 0.44, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    roundedRect(ctx, px, py, PLAYER_W, PLAYER_H, 7);
    ctx.fillStyle = "#6c8cff";
    ctx.fill();

    // Windshield
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(px + 7, py + 7, PLAYER_W - 14, 14);

    // Wheels
    [[px - 3, py + 7], [px + PLAYER_W - 7, py + 7],
     [px - 3, py + PLAYER_H - 16], [px + PLAYER_W - 7, py + PLAYER_H - 16]
    ].forEach(([wx, wy]) => {
        roundedRect(ctx, wx, wy, 10, 11, 3);
        ctx.fillStyle = "#0f1117";
        ctx.fill();
    });
}

function drawParticles() {
    particles.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, 5 * p.life), 0, Math.PI * 2);
        ctx.fillStyle = hexAlpha(p.color, p.life * 0.9);
        ctx.fill();
    });
}

function drawHUD() {
    const s = Math.floor(score);
    ctx.font = "bold 18px 'JetBrains Mono', monospace";
    ctx.textAlign = "right";
    ctx.fillStyle = "#e2e4ed";
    ctx.fillText(s, CW - 10, 26);

    ctx.font = "bold 9px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#8b8fa7";
    ctx.fillText("SCORE", CW - 10, 14);

    if (s > hiScore && hiScore > 0) {
        ctx.textAlign = "center";
        roundedRect(ctx, CW / 2 - 36, 6, 72, 18, 5);
        ctx.fillStyle = "rgba(74,222,128,0.18)";
        ctx.fill();
        ctx.font = "bold 9px Inter, sans-serif";
        ctx.fillStyle = "#4ade80";
        ctx.fillText("NEW BEST", CW / 2, 18);
    }
    ctx.textAlign = "left";
}

function drawStartScreen() {
    if (!ctx) return;
    ctx.clearRect(0, 0, CW, CH);
    drawRoad();

    ctx.fillStyle = "rgba(15,17,23,0.62)";
    ctx.fillRect(0, 0, CW, CH);

    ctx.textAlign = "center";
    ctx.font = "800 32px Inter, sans-serif";
    ctx.fillStyle = "#6c8cff";
    ctx.fillText("DODGE", CW / 2, 188);

    ctx.font = "400 13px Inter, sans-serif";
    ctx.fillStyle = "#8b8fa7";
    ctx.fillText("evita los obstáculos", CW / 2, 212);

    ctx.font = "700 15px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#e2e4ed";
    ctx.fillText(`BEST: ${hiScore}`, CW / 2, 252);

    ctx.font = "600 13px Inter, sans-serif";
    ctx.fillStyle = "#8b8fa7";
    ctx.fillText("SPACE · tap · clic para empezar", CW / 2, 296);

    // Static player
    const px = LANE_CENTERS[1] - PLAYER_W / 2;
    roundedRect(ctx, px, PLAYER_Y, PLAYER_W, PLAYER_H, 7);
    ctx.fillStyle = "#6c8cff"; ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(px + 7, PLAYER_Y + 7, PLAYER_W - 14, 14);

    ctx.textAlign = "left";
}

function drawPauseOverlay() {
    if (!ctx) return;
    ctx.fillStyle = "rgba(15,17,23,0.78)";
    ctx.fillRect(0, 0, CW, CH);
    ctx.textAlign = "center";
    ctx.font = "800 26px Inter, sans-serif";
    ctx.fillStyle = "#e2e4ed";
    ctx.fillText("PAUSA", CW / 2, CH / 2 - 16);
    ctx.font = "600 13px Inter, sans-serif";
    ctx.fillStyle = "#8b8fa7";
    ctx.fillText("SPACE · tap para continuar", CW / 2, CH / 2 + 14);
    ctx.textAlign = "left";
}

// ─── Utilities ───────────────────────────────────────────────────────────────

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

// ─── Boot ────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", initMiniGame);
