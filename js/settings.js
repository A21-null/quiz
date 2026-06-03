        /* ═══════════════════ AJUSTES + CONTROL DE MODO ═══════════════════
           Panel de ajustes (engranaje de la cabecera): cambia de modo Test/Recall,
           tema claro/oscuro, activa/desactiva el almacenamiento local y permite
           borrar los datos guardados. startActiveMode() es el despachador que arranca
           el motor correcto (quiz o Recall) tras cargar un archivo. */

        /* Despacha la sesión al motor activo. Lo invocan loadQuestionsFromFile y
           applyQuestionsData en lugar de llamar a initQuiz() directamente. */
        function startActiveMode() {
            const quizC = document.getElementById("quizContainer");
            const recallC = document.getElementById("recallRoot");
            document.getElementById("loadingMessage").style.display = "none";

            if (appMode === "recall") {
                quizC.classList.remove("active");
                recallC.classList.add("active");
                Recall.start(getFilteredQuestions());
            } else {
                Recall.stop();
                recallC.classList.remove("active");
                quizC.classList.add("active");
                initQuiz();
            }

            renderRecentFiles();
        }

        function openSettings() {
            syncSettingsUI();
            document.getElementById("settingsOverlay").classList.add("open");
        }
        function closeSettings() {
            document.getElementById("settingsOverlay").classList.remove("open");
        }

        /* Refleja el estado actual en los controles del panel. */
        function syncSettingsUI() {
            document.getElementById("modeTestBtn").classList.toggle("active", appMode === "test");
            document.getElementById("modeRecallBtn").classList.toggle("active", appMode === "recall");
            document.getElementById("darkModeToggle").checked = !document.body.classList.contains("light");
            document.getElementById("storageToggle").checked = storageEnabled;
        }

        function setMode(mode) {
            if (mode !== "test" && mode !== "recall") return;
            appMode = mode;
            lsSet("quiz5-mode", mode);
            syncSettingsUI();

            if (allQuestions && allQuestions.length) {
                startActiveMode();      // ya hay preguntas cargadas: rearranca el motor elegido
                closeSettings();
            } else {
                // sin archivo cargado: solo deja ambos contenedores ocultos (se ve el cargador)
                Recall.stop();
                document.getElementById("quizContainer").classList.remove("active");
                document.getElementById("recallRoot").classList.remove("active");
            }
        }

        function setDarkMode(dark) {
            document.body.classList.toggle("light", !dark);
            lsSet("quiz4-theme", document.body.classList.contains("light") ? "light" : "dark");
        }

        /* Interruptor maestro de almacenamiento. La bandera se escribe directamente
           (incluso al desactivar) para que la elección persista entre sesiones. */
        function setStorageEnabled(on) {
            storageEnabled = !!on;
            try { localStorage.setItem("quiz5-storage", on ? "on" : "off"); } catch (e) {}
        }

        function clearLocalData() {
            if (!confirm("¿Borrar todos los datos locales? Se perderán el tema, el progreso del quiz, el historial de archivos y las cajas de Recall.")) return;
            ["quiz4-theme", "quiz4-files", "quiz4-session", "quiz5-mode", "quiz5-storage",
             "recall-manual-config", "recall-manual-boxes", "recall-theme"].forEach(lsRemove);
            settingsToast("Datos locales borrados");
        }

        function settingsToast(msg) {
            const toast = document.createElement("div");
            toast.textContent = msg;
            toast.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--surface);border:1px solid var(--border);color:var(--text);padding:12px 18px;border-radius:10px;font-size:0.88rem;font-weight:600;z-index:10001;box-shadow:0 4px 20px rgba(0,0,0,0.4);";
            document.body.appendChild(toast);
            setTimeout(function () { if (toast.parentElement) toast.remove(); }, 3000);
        }

        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape") closeSettings();
        });
