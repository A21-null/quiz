        /* ═══════════════════ CONTROL POR TECLADO (SELECCIÓN AUTOMÁTICA) ═══════════════════ */
let focusedOptionIndex = -1; 

document.addEventListener("keydown", function(e) {
    if (appMode === "recall") return;   // en modo Recall manda su propio control de teclado
    const activeElem = document.activeElement;
    // Si estás escribiendo en un cuadro de texto, las flechas no deben cambiar la selección
    const isTyping = activeElem.tagName === "TEXTAREA" ||
                     (activeElem.tagName === "INPUT" && activeElem.type === "text");
    
    if (isTyping) return;

    const options = document.querySelectorAll(".option");
    if (options.length === 0) return;

    // --- FLECHAS ARRIBA / ABAJO: Navegar y Seleccionar automáticamente ---
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (answerChecked) return;

        // Calcular nuevo índice
        if (e.key === "ArrowDown") {
            focusedOptionIndex = (focusedOptionIndex + 1) % options.length;
        } else {
            focusedOptionIndex = (focusedOptionIndex - 1 + options.length) % options.length;
        }

        // SELECCIÓN AUTOMÁTICA: Llamamos a la función de selección del quiz
        const q = questions[currentQuestion];
        const isMulti = getCorrectAnswers(q).length > 1;
        selectOption(focusedOptionIndex, isMulti);

        // Hacer scroll suave si la lista es larga
        options[focusedOptionIndex].scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    // --- NÚMEROS (1-9): Selección rápida ---
    if (e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key) - 1;
        if (options[idx]) {
            focusedOptionIndex = idx; // Sincronizamos el índice de las flechas
            const q = questions[currentQuestion];
            selectOption(idx, getCorrectAnswers(q).length > 1);
        }
    }

    // --- FLECHA DERECHA / ENTER: Corregir o Siguiente ---
    if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        if (!answerChecked) {
            checkAnswer();
        } else {
            nextQuestion();
        }
    }

    // --- FLECHA IZQUIERDA: Volver ---
    if (e.key === "ArrowLeft") {
        e.preventDefault();
        prevQuestion();
    }
});
        /* ═══════════════════ NAVIGATION ═══════════════════ */
        function nextQuestion() {
            if (currentQuestion === questions.length - 1) {
                if (failedQuestions.length > 0) {
                    startReviewRound();
                } else {
                    clearProgress();
                    showCompletionMessage();
                }
            } else {
                currentQuestion++;
                saveProgress();
                loadQuestion();
            }
        }

        function prevQuestion() {
            currentQuestion = currentQuestion > 0 ? currentQuestion - 1 : questions.length - 1;
            saveProgress();
            loadQuestion();
        }

        function startReviewRound() {
            questions = shuffleArray(failedQuestions.slice());
            failedQuestions = [];
            currentQuestion = 0;
            isReviewMode = true;
            reviewRound++;
            saveProgress();
            updatePhaseIndicator();
            loadQuestion();
        }

        function showCompletionMessage() {
            const container = document.getElementById("optionsContainer");
            const answerDiv = document.getElementById("answer");
            const questionDiv = document.getElementById("question");
            const hintDiv = document.getElementById("multiSelectHint");

            document.getElementById("figurePreview").classList.add("hidden");
            clearCodePreview();
            document.getElementById("columnsLayout").classList.add("single-col");

            questionDiv.innerHTML = "";
            hintDiv.innerHTML = "";
            container.innerHTML = "";
            answerDiv.innerHTML = "";
            answerDiv.className = "answer";

            const total = stats.correct + stats.incorrect;
            const pct = total > 0 ? Math.round((stats.correct / total) * 100) : 0;

            const div = document.createElement("div");
            div.className = "completion-message";
            div.innerHTML = `
                <h2>Completado</h2>
                <p>Has respondido correctamente a todas las preguntas pendientes de revisión.</p>
                <p><strong>Aciertos:</strong> ${stats.correct} · <strong>Fallos:</strong> ${stats.incorrect} · <strong>Porcentaje:</strong> ${pct}%</p>
                <p><strong>Total de intentos:</strong> ${totalTriesCount}</p>
                <button onclick="restartQuiz()">Reiniciar</button>
            `;
            container.appendChild(div);
            document.getElementById("navButtons").style.display = "none";
        }

        function restartQuiz() {
            clearProgress();
            initQuiz(true);
        }

        function resetStats() {
            if (confirm("¿Resetear estadísticas?")) {
                stats = { correct: 0, incorrect: 0 };
                totalTriesCount = 0;
                triesMap.clear();
                updateStats();
                saveProgress();
            }
        }
