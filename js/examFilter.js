        /* ═══════════════════ FILTRO DE EXÁMENES ═══════════════════ */
        let examList = [];          // claves únicas de examen ordenadas
        let activeExams = new Set(); // exámenes actualmente activos
        let _examCounts = new Map(); // clave → nº de preguntas

        function _examKey(q) {
            const v = q.exam;
            return (v != null && String(v).trim() !== "") ? String(v).trim() : "__no_exam__";
        }

        function _examLabel(key) {
            return key === "__no_exam__" ? "Sin examen" : key;
        }

        function buildExamList() {
            _examCounts = new Map();
            allQuestions.forEach(function(q) {
                const k = _examKey(q);
                _examCounts.set(k, (_examCounts.get(k) || 0) + 1);
            });
            examList = Array.from(_examCounts.keys()).sort(function(a, b) {
                if (a === "__no_exam__") return -1;
                if (b === "__no_exam__") return 1;
                return a.localeCompare(b, "es");
            });
            activeExams = new Set(examList);
            _syncExamBtn();
        }

        function getFilteredQuestions() {
            if (activeExams.size >= examList.length) return allQuestions.slice();
            return allQuestions.filter(function(q) { return activeExams.has(_examKey(q)); });
        }

        /* Muestra el overlay. isFirstLoad=true → no hay quiz en curso todavía. */
        function openExamOverlay(isFirstLoad) {
            _renderExamOverlayContent();
            document.getElementById("examApplyBtn").textContent = isFirstLoad ? "Comenzar quiz" : "Aplicar y reiniciar";
            document.getElementById("examOverlay").classList.add("open");
        }

        function closeExamOverlay() {
            document.getElementById("examOverlay").classList.remove("open");
        }

        function _renderExamOverlayContent() {
            const box = document.getElementById("examOverlayContent");
            box.innerHTML = examList.map(function(k) {
                return '<label class="exam-check-row">' +
                    '<input type="checkbox" data-key="' + escapeHTML(k) + '"' +
                        (activeExams.has(k) ? " checked" : "") +
                        ' onchange="syncExamCheckboxes()">' +
                    '<span class="exam-check-name">' + escapeHTML(_examLabel(k)) + '</span>' +
                    '<span class="exam-check-count">' + (_examCounts.get(k) || 0) + ' preg.</span>' +
                    '</label>';
            }).join("");
            _updateApplyBtn();
        }

        function syncExamCheckboxes() {
            activeExams.clear();
            document.querySelectorAll("#examOverlayContent input[data-key]:checked").forEach(function(cb) {
                activeExams.add(cb.dataset.key);
            });
            _updateApplyBtn();
        }

        function selectAllExams(all) {
            activeExams = all ? new Set(examList) : new Set();
            _renderExamOverlayContent();
        }

        function _updateApplyBtn() {
            const n = Array.from(activeExams).reduce(function(s, k) {
                return s + (_examCounts.get(k) || 0);
            }, 0);
            const btn = document.getElementById("examApplyBtn");
            if (!btn) return;
            const label = btn.textContent.split("·")[0].trim();
            btn.textContent = label + " · " + n + " preguntas";
            btn.disabled = (n === 0);
        }

        function applyExamFilter() {
            syncExamCheckboxes();
            closeExamOverlay();
            clearProgress();
            startActiveMode();
        }

        /* Muestra/oculta el botón de filtro en la cabecera. */
        function _syncExamBtn() {
            const btn = document.getElementById("examBtn");
            if (btn) btn.style.display = examList.length > 1 ? "" : "none";
        }

        /* Punto de entrada tras cargar un nuevo archivo.
           Sustituye la llamada directa a startActiveMode() en loadQuestionsFromFile / applyQuestionsData. */
        function onQuestionsLoaded() {
            buildExamList();
            if (examList.length > 1) {
                openExamOverlay(true);
            } else {
                startActiveMode();
            }
        }

        document.addEventListener("keydown", function(e) {
            if (e.key === "Escape") closeExamOverlay();
        });
