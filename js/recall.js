        /* ═══════════════════ MODO RECALL (recuerdo activo / autocorrección) ═══════════════════
           Entrenador de recuerdo activo para preguntas de desarrollo. Por tarjeta:
             1) Estudia (ves la respuesta con cuenta atrás) → 2) Escribe de memoria →
             3) Te autocorriges (1-5) → 4) Resultado: planificador Leitner.
           Encapsulado en un IIFE: expone window.Recall y no contamina el espacio global del
           quiz. Reutiliza los helpers globales richToHTML/escapeHTML/renderMathSafely y el
           interruptor de almacenamiento lsGet/lsSet. Lee las preguntas de allQuestions. */
        const Recall = (function () {
            "use strict";

            const CFG_KEY = "recall-manual-config";
            const BOX_KEY = "recall-manual-boxes";   // cajas Leitner persistidas por questionKey

            let studySecs = 8;
            let scaleLen = false;
            let configLoaded = false;

            const SCORE_LABELS = { 1: "Muy baja", 2: "Baja", 3: "Media", 4: "Alta", 5: "Muy alta" };
            /* score → nueva caja Leitner. La caja gobierna cuándo reaparece la tarjeta. */
            function applyScoreToBox(oldBox, score) {
                switch (score) {
                    case 1: return 1;                          // reinicio duro
                    case 2: return Math.max(1, oldBox - 1);
                    case 3: return oldBox;                     // se mantiene
                    case 4: return Math.min(5, oldBox + 1);
                    case 5: return Math.min(5, oldBox + 2);    // gradúa más rápido
                }
                return oldBox;
            }
            /* "Hueco" (en repasos) hasta que la tarjeta vuelve a salir, según su caja. */
            const GAP = { 1: 1, 2: 2, 3: 4, 4: 7 };  // caja 5 = dominada, no reaparece

            /* Estado de sesión */
            let cards = [];          // { q, box, dueAt, seen }
            let step = 0;
            let current = null;
            let phase = "idle";      // idle | study | recall | self-grade | result | done
            let points = 0, streak = 0, reps = 0;
            let timerHandle = null, timerEndsAt = 0, timerTotalMs = 0;

            /* ── Persistencia (respeta el interruptor global vía lsGet/lsSet) ── */
            function loadConfig() {
                if (configLoaded) return;
                configLoaded = true;
                try {
                    const raw = lsGet(CFG_KEY);
                    if (raw) {
                        const c = JSON.parse(raw);
                        if (typeof c.studySecs === "number") studySecs = c.studySecs;
                        if (typeof c.scaleLen === "boolean") scaleLen = c.scaleLen;
                    }
                } catch (e) {}
            }
            function saveConfig() {
                lsSet(CFG_KEY, JSON.stringify({ studySecs, scaleLen }));
            }
            function loadBoxes() {
                try { const raw = lsGet(BOX_KEY); return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
            }
            function saveBoxes() {
                const obj = {};
                cards.forEach(c => { obj[questionKey(c.q)] = c.box; });
                lsSet(BOX_KEY, JSON.stringify(obj));
            }

            /* ── Helpers locales (el resto se reutiliza del quiz) ── */
            function htmlToPlainText(htmlStr) {
                if (htmlStr == null) return "";
                const tmp = document.createElement("div");
                tmp.innerHTML = String(htmlStr);
                tmp.querySelectorAll("br").forEach(b => b.replaceWith("\n"));
                return (tmp.textContent || tmp.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
            }

            function questionKey(q) {
                return [q.q || "", q.a || "", q.exam || "", q.points || ""].join("||");
            }

            /* Una pregunta es "de desarrollo" si NO es test/figura/código/exacta y tiene
               respuesta de referencia (la necesitamos para autocorregir). */
            function isDevelopQuestion(q) {
                if (!q || q.a == null || String(q.a).trim() === "") return false;
                if (Array.isArray(q.options) && q.options.length > 0) return false; // tipo test
                const blocked = ["multiple", "figure", "code", "exact", "command"];
                if (q.type && blocked.includes(q.type)) return false;
                return true;
            }

            /* Si la referencia trae alternativas |OR|, usamos la más completa (la más larga). */
            function refAnswer(q) {
                const a = String(q.a || "");
                if (a.includes("|OR|")) {
                    return a.split("|OR|").map(s => s.trim()).filter(Boolean)
                            .sort((x, y) => y.length - x.length)[0] || a;
                }
                return a;
            }

            function shuffle(arr) {
                const a = arr.slice();
                for (let i = a.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [a[i], a[j]] = [a[j], a[i]];
                }
                return a;
            }

            /* ── Construcción de sesión y planificador Leitner continuo ── */
            function buildSession(devQuestions) {
                const savedBoxes = loadBoxes();
                cards = shuffle(devQuestions).map(q => {
                    const k = questionKey(q);
                    const box = savedBoxes[k] != null ? Number(savedBoxes[k]) : 1;
                    return { q, box, dueAt: 0, seen: false };
                });
                step = 0; points = 0; streak = 0; reps = 0;
                current = null; phase = "idle";

                document.getElementById("dash").classList.add("active");
                updateStats();
                renderBoxes();
                nextCard();
            }

            /* Tarjeta activa (box<5) con menor dueAt; empates al azar. */
            function pickNext() {
                const active = cards.filter(c => c.box < 5);
                if (active.length === 0) return null;
                let min = Infinity;
                active.forEach(c => { if (c.dueAt < min) min = c.dueAt; });
                const pool = active.filter(c => c.dueAt === min);
                return pool[Math.floor(Math.random() * pool.length)];
            }

            function nextCard() {
                current = pickNext();
                if (!current) { finishSession(); return; }
                step++;
                current.seen = true;
                enterStudy();
            }

            /* ── Fase 1 — Estudio: pregunta + respuesta visible, cuenta atrás ── */
            function enterStudy() {
                phase = "study";
                const q = current.q;
                const secs = computeStudySecs(q);

                const html = `
                    <span class="phase-pill study">Estudia</span>
                    ${metaHTML(q)}
                    <div class="question" id="qBody">${richToHTML(q.q)}</div>
                    <div class="answer-ref">
                      <div class="answer-ref-label">Respuesta de referencia</div>
                      <div id="refBody">${richToHTML(refAnswer(q))}</div>
                    </div>
                    <div class="countdown">
                      <div class="ring-wrap">
                        <svg width="52" height="52" viewBox="0 0 52 52">
                          <circle class="ring-bg" cx="26" cy="26" r="22"></circle>
                          <circle class="ring-fg" id="ringFg" cx="26" cy="26" r="22"></circle>
                        </svg>
                        <div class="ring-num" id="ringNum">${secs}</div>
                      </div>
                      <div class="countdown-text">Memoriza la respuesta. Cuando el tiempo acabe, la ocultaremos y tendrás que escribirla.</div>
                    </div>
                    <div class="controls">
                      <button class="btn btn-primary" onclick="Recall.enterRecall()">Ocultar y responder ahora</button>
                      <button class="btn btn-ghost" onclick="Recall.addTime(5)">+5s</button>
                    </div>
                    <div class="kbd-hint"><kbd>Espacio</kbd> ocultar ya · <kbd>+</kbd> sumar tiempo</div>
                `;
                document.getElementById("cardArea").innerHTML = html;
                renderMathSafely(document.getElementById("cardArea"));
                startTimer(secs);
            }

            function computeStudySecs(q) {
                let s = studySecs;
                if (scaleLen) {
                    const len = htmlToPlainText(refAnswer(q)).length;
                    s += Math.round(len / 120);
                }
                return Math.max(1, Math.min(120, s));
            }

            function startTimer(secs) {
                clearTimer();
                timerTotalMs = secs * 1000;
                timerEndsAt = Date.now() + timerTotalMs;
                const C = 2 * Math.PI * 22;
                const ring = document.getElementById("ringFg");
                if (ring) { ring.style.strokeDasharray = C; ring.style.strokeDashoffset = 0; }
                tickTimer();
                timerHandle = setInterval(tickTimer, 100);
            }
            function tickTimer() {
                const left = Math.max(0, timerEndsAt - Date.now());
                const num = document.getElementById("ringNum");
                const ring = document.getElementById("ringFg");
                if (num) num.textContent = Math.ceil(left / 1000);
                if (ring) {
                    const C = 2 * Math.PI * 22;
                    const frac = timerTotalMs > 0 ? left / timerTotalMs : 0;
                    ring.style.strokeDashoffset = C * (1 - frac);
                }
                if (left <= 0) { clearTimer(); enterRecall(); }
            }
            function clearTimer() { if (timerHandle) { clearInterval(timerHandle); timerHandle = null; } }
            function addTime(s) {
                if (phase !== "study") return;
                timerEndsAt += s * 1000;
                timerTotalMs += s * 1000;
            }

            /* ── Fase 2 — Recuerdo: respuesta oculta, el usuario escribe de memoria ── */
            function enterRecall() {
                if (phase !== "study") return;
                clearTimer();
                phase = "recall";
                const q = current.q;
                const html = `
                    <span class="phase-pill recall">Escribe de memoria</span>
                    ${metaHTML(q)}
                    <div class="question">${richToHTML(q.q)}</div>
                    <div class="recall-box">
                      <textarea id="recallInput" placeholder="Escribe aquí lo que recuerdes de la respuesta…"></textarea>
                    </div>
                    <div class="controls">
                      <button class="btn btn-primary" id="gradeBtn" onclick="Recall.revealAnswer()">Ver respuesta y corregir</button>
                    </div>
                    <div class="kbd-hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> para ver la respuesta</div>
                `;
                document.getElementById("cardArea").innerHTML = html;
                renderMathSafely(document.getElementById("cardArea"));
                const ta = document.getElementById("recallInput");
                ta.focus();
            }

            /* ── Fase 3 — Autocorrección: referencia + lo escrito, eliges 1-5 ── */
            function revealAnswer() {
                if (phase !== "recall") return;
                const ta = document.getElementById("recallInput");
                const userAnswer = ta ? ta.value.trim() : "";
                phase = "self-grade";
                const q = current.q;

                let html = `
                    <span class="phase-pill recall">Corrige tú mismo</span>
                    ${metaHTML(q)}
                    <div class="question">${richToHTML(q.q)}</div>
                    <div class="answer-ref">
                      <div class="answer-ref-label">Respuesta de referencia</div>
                      <div>${richToHTML(refAnswer(q))}</div>
                    </div>`;

                if (userAnswer) {
                    html += `<div class="answer-ref" style="border-left:3px solid var(--text-dim)">
                      <div class="answer-ref-label" style="color:var(--text-dim)">Lo que escribiste</div>
                      <div>${escapeHTML(userAnswer).replace(/\n/g, "<br>")}</div></div>`;
                } else {
                    html += `<div class="warn">No escribiste nada. Sé honesto al puntuar.</div>`;
                }

                html += `
                    <div style="margin-top:16px;font-size:0.85rem;color:var(--text-dim)">¿Cuánto coincidía lo tuyo con la referencia?</div>
                    <div class="manual-scale">
                      <button class="manual-btn m1" onclick="Recall.selfScore(1)">Muy baja</button>
                      <button class="manual-btn m2" onclick="Recall.selfScore(2)">Baja</button>
                      <button class="manual-btn m3" onclick="Recall.selfScore(3)">Media</button>
                      <button class="manual-btn m4" onclick="Recall.selfScore(4)">Alta</button>
                      <button class="manual-btn m5" onclick="Recall.selfScore(5)">Muy alta</button>
                    </div>
                    <div class="kbd-hint">Teclas <kbd>1</kbd>–<kbd>5</kbd> para puntuar</div>`;

                const area = document.getElementById("cardArea");
                area.innerHTML = html;
                renderMathSafely(area);
                area.dataset.userAnswer = userAnswer || "";
            }

            function selfScore(score) {
                if (phase !== "self-grade") return;
                const userAnswer = document.getElementById("cardArea").dataset.userAnswer || "";
                showResult(score, userAnswer);
            }

            /* ── Fase 4 — Resultado: medidor de 5 niveles + aplica Leitner ── */
            function showResult(score, userAnswer) {
                phase = "result";
                const q = current.q;
                const oldBox = current.box;
                const newBox = applyScoreToBox(oldBox, score);
                current.box = newBox;

                // puntuación gamificada: recordar tarjetas de caja baja vale más
                if (score >= 4) streak++; else streak = 0;
                const mult = 1 + Math.min(streak, 5) * 0.1;
                const gained = Math.round(score * (6 - oldBox) * 4 * mult);
                points += gained;
                reps++;

                if (newBox < 5) current.dueAt = step + GAP[newBox];

                saveBoxes();
                updateStats();
                renderBoxes();

                const segs = [1, 2, 3, 4, 5].map(i =>
                    `<div class="seg ${i <= score ? "on" + score : ""}"></div>`).join("");

                const lvlColor = `var(--lvl${score})`;
                const boxMoved = newBox === oldBox
                    ? `Caja ${oldBox} (sin cambio)`
                    : (newBox > oldBox ? `Caja ${oldBox} → ${newBox} ▲` : `Caja ${oldBox} → ${newBox} ▼`);

                let html = `
                    <span class="phase-pill result">Resultado</span>
                    ${metaHTML(q)}
                    <div class="question">${richToHTML(q.q)}</div>
                    <div class="score-block">
                      <div class="score-meter">${segs}</div>
                      <div class="score-label" style="color:${lvlColor}">Coincidencia: ${SCORE_LABELS[score]}</div>
                      <div class="delta-note">${boxMoved} · +${gained} pts${streak >= 2 ? " · racha x" + mult.toFixed(1) : ""}</div>
                    </div>
                    <div class="answer-ref">
                      <div class="answer-ref-label">Respuesta de referencia</div>
                      <div>${richToHTML(refAnswer(q))}</div>
                    </div>`;

                if (userAnswer) {
                    html += `<div class="answer-ref" style="border-left:3px solid var(--text-dim)">
                      <div class="answer-ref-label" style="color:var(--text-dim)">Lo que escribiste</div>
                      <div>${escapeHTML(userAnswer).replace(/\n/g, "<br>")}</div></div>`;
                }

                html += `
                    <div class="controls">
                      <button class="btn btn-primary" id="nextBtn" onclick="Recall.nextCard()">Siguiente →</button>
                    </div>
                    <div class="kbd-hint"><kbd>Enter</kbd> siguiente</div>`;

                document.getElementById("cardArea").innerHTML = html;
                renderMathSafely(document.getElementById("cardArea"));
            }

            /* ── Fin de sesión ── */
            function finishSession() {
                phase = "done";
                clearTimer();
                document.getElementById("cardArea").innerHTML = `
                    <div class="done">
                      <h2>¡Todo dominado! ⚡</h2>
                      <p>Has llevado las ${cards.length} preguntas a la caja 5.</p>
                      <div class="big">${points} pts</div>
                      <p>${reps} repasos · racha máxima durante la sesión</p>
                      <button onclick="Recall.restart()">Repetir sesión</button>
                    </div>`;
            }
            function restart() {
                cards.forEach(c => { c.box = 1; c.dueAt = 0; c.seen = false; });
                step = 0; points = 0; streak = 0; reps = 0;
                saveBoxes(); updateStats(); renderBoxes(); nextCard();
            }

            /* ── UI: meta de pregunta, stats, histograma de cajas ── */
            function metaHTML(q) {
                const box = current ? current.box : 1;
                let h = '<div class="q-meta">';
                h += `<span class="badge box b${box}">Caja ${box}</span>`;
                if (q.exam) h += `<span class="badge exam">${escapeHTML(q.exam)}</span>`;
                if (q.points) h += `<span class="badge points">${escapeHTML(String(q.points))} pts</span>`;
                h += "</div>";
                return h;
            }

            function updateStats() {
                const total = cards.length;
                const mastered = cards.filter(c => c.box >= 5).length;
                document.getElementById("sMastered").textContent = mastered + "/" + total;
                document.getElementById("sStreak").textContent = streak;
                document.getElementById("sPoints").textContent = points;
                document.getElementById("sReps").textContent = reps;
                const pct = total > 0 ? Math.round((mastered / total) * 100) : 0;
                document.getElementById("progFill").style.width = pct + "%";
                document.getElementById("progText").textContent = pct + "% dominado";
            }

            function renderBoxes() {
                const counts = [0, 0, 0, 0, 0];
                cards.forEach(c => counts[c.box - 1]++);
                const max = Math.max(1, ...counts);
                const cont = document.getElementById("boxes");
                cont.innerHTML = [1, 2, 3, 4, 5].map(b => {
                    const n = counts[b - 1];
                    const h = Math.round((n / max) * 100);
                    return `<div class="box-col">
                      <span class="box-count">${n}</span>
                      <div class="box-bar b${b}" style="height:${h}%"></div>
                      <span class="box-tag">C${b}</span>
                    </div>`;
                }).join("");
            }

            /* ── Teclado (solo actúa en modo Recall) ── */
            document.addEventListener("keydown", e => {
                if (typeof gameState !== "undefined" && gameState === "playing") return;
                if (appMode !== "recall") return;
                const el = document.activeElement;
                const typing = el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && el.type !== "checkbox"));

                if (phase === "study" && !typing) {
                    if (e.code === "Space") { e.preventDefault(); enterRecall(); }
                    if (e.key === "+" || e.key === "=") { e.preventDefault(); addTime(5); }
                }
                if (phase === "recall" && el && el.id === "recallInput" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault(); revealAnswer();
                }
                if (phase === "self-grade" && !typing && e.key >= "1" && e.key <= "5") {
                    e.preventDefault(); selfScore(parseInt(e.key, 10));
                }
                if (phase === "result" && !typing && e.key === "Enter") { e.preventDefault(); nextCard(); }
            });

            /* ── API pública ── */
            /* start(questions): filtra las de desarrollo y arranca la sesión Leitner. */
            function start(allQs) {
                loadConfig();
                const dev = (allQs || []).filter(isDevelopQuestion);
                const status = document.getElementById("fileStatus");
                const dash = document.getElementById("dash");
                if (dev.length === 0) {
                    phase = "idle";
                    if (dash) dash.classList.remove("active");
                    if (status) status.textContent = "Modo Recall · este archivo no tiene preguntas de desarrollo (teoría)";
                    return false;
                }
                buildSession(dev);
                return true;
            }

            /* stop(): detiene temporizadores y oculta el cuadro de mando (al cambiar de modo). */
            function stop() {
                clearTimer();
                phase = "idle";
                const dash = document.getElementById("dash");
                if (dash) dash.classList.remove("active");
            }

            return {
                start, stop,
                enterRecall, addTime, revealAnswer, selfScore, nextCard, restart
            };
        })();
        window.Recall = Recall;
