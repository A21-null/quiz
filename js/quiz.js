        /* ═══════════════════ FILE LOADING ═══════════════════ */
        function loadQuestionsFromFile(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const data = JSON.parse(e.target.result);
                    if (!Array.isArray(data)) {
                        throw new Error("El JSON debe ser un array de preguntas.");
                    }

                    allQuestions = data.map(normalizeQuestionObject);
                    if (allQuestions.length === 0) {
                        throw new Error("El archivo no contiene preguntas.");
                    }

                    document.getElementById("fileStatus").textContent = file.name + " · " + allQuestions.length + " preguntas";
                    document.getElementById("loadingMessage").style.display = "none";
                    document.getElementById("quizContainer").classList.add("active");

                    startActiveMode();
                    recordFileHistory(file.name, file.name, e.target.result, allQuestions.length);
                    renderRecentFiles();
                    // Refleja el archivo en la URL (#hash). lastLoadedKey antes evita recarga doble.
                    lastLoadedKey = file.name;
                    location.hash = encodeURI(file.name);
                } catch (err) {
                    console.error(err);
                    alert("No se pudo cargar el JSON: " + err.message);
                    document.getElementById("fileStatus").textContent = "Error al cargar el archivo";
                }
            };
            reader.readAsText(file, "utf-8");
        }

        function normalizeQuestionObject(q) {
            const normalized = { ...q };

            if (!normalized.type) {
                if (Array.isArray(normalized.options)) normalized.type = "multiple";
                else if (normalized.files && normalized.figure) normalized.type = "figure";
                else if (normalized.files) normalized.type = "code";
                else normalized.type = "theory";
            }

            if (normalized.img && !normalized.img_q) {
                normalized.img_q = normalized.img;
            }

            if (!Array.isArray(normalized.options)) {
                normalized.options = [];
            }

            if (normalized.q == null) normalized.q = "";
            if (normalized.a == null) normalized.a = "";

            return normalized;
        }

        function initQuiz(forceRestart = false) {
            selectedOptions = new Set();
            answerChecked = false;

            let restored = false;
            if (!forceRestart) {
                restored = loadProgress();
            }

            if (!restored) {
                questions = shuffleArray(allQuestions.slice());
                currentQuestion = 0;
                stats = { correct: 0, incorrect: 0 };
                failedQuestions = [];
                isReviewMode = false;
                reviewRound = 0;
                triesMap = new Map();
                totalTriesCount = 0;
            }

            updateStats();
            updatePhaseIndicator();
            document.getElementById("navButtons").style.display = "flex";
            document.getElementById("columnsLayout").classList.remove("single-col");
            loadQuestion();

            if (restored) {
                const raw = lsGet(SAVE_KEY);
                const ts = raw ? JSON.parse(raw).ts : null;
                if (ts) showResumeToast(ts);
            }
        }

        function shuffleArray(arr) {
            const copy = arr.slice();
            for (let i = copy.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [copy[i], copy[j]] = [copy[j], copy[i]];
            }
            return copy;
        }

        /* ═══════════════════ PERSISTENCIA (localStorage) ═══════════════════ */
        const SAVE_KEY = "quiz4-session";

        /** Huella ligera del JSON cargado para detectar cambios de archivo */
        function computeFingerprint(data) {
            // Usa la longitud + primeras/últimas preguntas como huella rápida
            const n = data.length;
            const sample = [data[0], data[Math.floor(n / 2)], data[n - 1]]
                .filter(Boolean)
                .map(q => (q.q || "") + (q.a || ""))
                .join("|");
            return n + ":" + sample.length + ":" + sample.slice(0, 120);
        }

        function saveProgress() {
            if (!allQuestions.length) return;
            try {
                // Guarda los índices de las preguntas en allQuestions en lugar de los objetos completos
                const questionIndices = questions.map(q => allQuestions.indexOf(q));
                const failedIndices = failedQuestions.map(q => allQuestions.indexOf(q));
                const triesObj = {};
                triesMap.forEach((v, k) => { triesObj[k] = v; });

                const session = {
                    fingerprint: computeFingerprint(allQuestions),
                    questionIndices,
                    currentQuestion,
                    stats,
                    failedIndices,
                    isReviewMode,
                    reviewRound,
                    triesObj,
                    totalTriesCount,
                    ts: Date.now()
                };
                lsSet(SAVE_KEY, JSON.stringify(session));
            } catch (e) {
                console.warn("No se pudo guardar el progreso:", e);
            }
        }

        function loadProgress() {
            try {
                const raw = lsGet(SAVE_KEY);
                if (!raw) return false;
                const session = JSON.parse(raw);
                if (!session || session.fingerprint !== computeFingerprint(allQuestions)) return false;

                questions = session.questionIndices.map(i => allQuestions[i]).filter(Boolean);
                currentQuestion = Math.min(session.currentQuestion, questions.length - 1);
                stats = session.stats || { correct: 0, incorrect: 0 };
                failedQuestions = (session.failedIndices || []).map(i => allQuestions[i]).filter(Boolean);
                isReviewMode = session.isReviewMode || false;
                reviewRound = session.reviewRound || 0;
                triesMap = new Map(Object.entries(session.triesObj || {}));
                triesMap.forEach((v, k) => triesMap.set(k, Number(v)));
                totalTriesCount = session.totalTriesCount || 0;
                return true;
            } catch (e) {
                console.warn("No se pudo restaurar el progreso:", e);
                return false;
            }
        }

        function clearProgress() {
            lsRemove(SAVE_KEY);
        }

        function showResumeToast(saved) {
            const toast = document.createElement("div");
            const date = new Date(saved);
            const timeStr = date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
            const dateStr = date.toLocaleDateString("es", { day: "numeric", month: "short" });

            const span = document.createElement("span");
            span.textContent = "\u2713 Progreso restaurado \u2014 guardado el " + dateStr + " a las " + timeStr;

            const btn = document.createElement("button");
            btn.textContent = "\u21BA Reiniciar";
            btn.title = "Empezar desde cero";
            btn.onclick = function() { toast.remove(); clearProgress(); restartQuiz(); };
            btn.style.cssText = "background:var(--surface2);border:1px solid var(--border);color:var(--text-dim);padding:5px 12px;border-radius:7px;cursor:pointer;font-size:0.82rem;font-weight:700;";

            toast.appendChild(span);
            toast.appendChild(btn);
            toast.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--surface);border:1px solid var(--green-border);color:var(--green);padding:12px 18px;border-radius:10px;font-size:0.88rem;font-weight:600;z-index:9999;display:flex;align-items:center;gap:14px;box-shadow:0 4px 20px rgba(0,0,0,0.4);animation:fadeInUp 0.3s ease;";

            document.body.appendChild(toast);
            setTimeout(function() { if (toast.parentElement) toast.remove(); }, 5000);
        }

