        /* ═══════════════════ LOAD QUESTION ═══════════════════ */
        function loadQuestion() {
            focusedOptionIndex = -1;
            const q = questions[currentQuestion];
            document.getElementById("current").textContent = currentQuestion + 1;
            document.getElementById("total").textContent = questions.length;

            const pointsBadge = document.getElementById("pointsBadge");
            pointsBadge.textContent = q.points ? q.points + " pts" : "";
            pointsBadge.classList.toggle("hidden", !q.points);

            const examBadge = document.getElementById("examBadge");
            examBadge.textContent = q.exam || "";
            examBadge.classList.toggle("hidden", !q.exam);

            const questionEl = document.getElementById("question");
            setRichContent(questionEl, q.q || "");

            const imgEl = document.getElementById("imgQ");
            const questionImg = q.img_q || q.img || "";
            if (questionImg && String(questionImg).trim().length > 0) {
                imgEl.src = String(questionImg);
                imgEl.style.display = "block";
            } else {
                imgEl.src = "";
                imgEl.style.display = "none";
            }

            const cols = document.getElementById("columnsLayout");
            const isFigure = (q.type === "figure" || q.type === "code") && !!q.figure;
            cols.classList.toggle("single-col", !isFigure);

            const figPrev = document.getElementById("figurePreview");
            const figIframe = document.getElementById("figureIframe");
            if (isFigure) {
                figPrev.classList.remove("hidden");
                figIframe.srcdoc = String(q.figure);
            } else {
                figPrev.classList.add("hidden");
                figIframe.srcdoc = "";
            }

            clearCodePreview();

            const container = document.getElementById("optionsContainer");
            const hintDiv = document.getElementById("multiSelectHint");
            container.innerHTML = "";
            hintDiv.innerHTML = "";
            selectedOptions = new Set();
            answerChecked = false;

            const checkBtn = document.getElementById("checkBtn");
            checkBtn.textContent = "Corregir";
            checkBtn.onclick = checkAnswer;
            checkBtn.style.display = "";

            if (q.type === "multiple") {
                buildMultipleChoice(q, container, hintDiv);
            } else if ((q.type === "figure" || q.type === "code") && Array.isArray(q.files) && q.files.length > 1) {
                buildTabbedEditor(q, container);
            } else if ((q.type === "figure" || q.type === "code") && Array.isArray(q.files) && q.files.length === 1) {
                buildSingleFileEditor(container, q.files[0]);
            } else if (q.type === "exact") {
                buildExactInput(container);
            } else {
                buildSingleEditor(q, container, null, q.type);
            }

            const answerDiv = document.getElementById("answer");
            answerDiv.className = "answer";
            answerDiv.innerHTML = "";
        }

        /* ═══════════════════ BUILD UI ═══════════════════ */
        function buildMultipleChoice(q, container, hintDiv) {
            const correctAnswers = getCorrectAnswers(q);
            const isMulti = correctAnswers.length > 1;

            if (isMulti) {
                hintDiv.innerHTML = '<div class="multi-select-hint">Esta pregunta tiene múltiples respuestas correctas. Selecciona todas.</div>';
            }

            const optionsDiv = document.createElement("div");
            optionsDiv.className = "options";

            q.options = shuffleArray(q.options);

            q.options.forEach((opt, idx) => {
                const row = document.createElement("div");
                row.className = "option";
                row.onclick = () => selectOption(idx, isMulti);

                const cb = document.createElement("div");
                cb.className = "option-checkbox";
                cb.textContent = "✓";

                const txt = document.createElement("div");
                txt.className = "option-text rich-content";
                setRichContent(txt, opt);

                row.appendChild(cb);
                row.appendChild(txt);
                optionsDiv.appendChild(row);
            });

            container.appendChild(optionsDiv);
        }

        function buildExactInput(container) {
            const input = document.createElement("input");
            input.type = "text";
            input.id = "userAnswer";
            input.placeholder = "Escribe tu respuesta exacta…";
            container.appendChild(input);
        }

        function buildSingleFileEditor(container, file) {
            const ta = document.createElement("textarea");
            ta.className = "code-input";
            ta.id = "codeInput0";
            ta.placeholder = (file?.name || "archivo") + "…";
            ta.spellcheck = false;
            ta.value = getFileInitialContent(file);
            enableTabKey(ta);
            container.appendChild(ta);
        }

        function buildSingleEditor(q, container, filename, typeName) {
            const useTextarea = typeName !== "exact";
            const el = document.createElement(useTextarea ? "textarea" : "input");

            if (useTextarea) {
                el.className = "free-answer" + (typeName === "theory" ? " theory" : " code-input");
                el.id = "userAnswer";
                el.placeholder = filename ? (filename + "…") : "Escribe tu respuesta aquí…";
                el.spellcheck = false;
                enableTabKey(el);
            } else {
                el.type = "text";
                el.id = "userAnswer";
                el.placeholder = "Escribe tu respuesta aquí…";
            }

            container.appendChild(el);
        }

        function buildTabbedEditor(q, container) {
            const tabsBar = document.createElement("div");
            tabsBar.className = "tabs-bar";

            q.files.forEach((f, i) => {
                const btn = document.createElement("button");
                btn.className = "tab-btn" + (i === 0 ? " active" : "");
                btn.textContent = f.name || ("archivo-" + (i + 1));
                btn.onclick = () => switchTab(i);
                tabsBar.appendChild(btn);
            });

            container.appendChild(tabsBar);

            q.files.forEach((f, i) => {
                const panel = document.createElement("div");
                panel.className = "tab-panel" + (i === 0 ? " active" : "");
                panel.id = "tabPanel" + i;

                const ta = document.createElement("textarea");
                ta.className = "code-input";
                ta.id = "codeInput" + i;
                ta.placeholder = (f.name || ("archivo-" + (i + 1))) + "…";
                ta.spellcheck = false;
                ta.value = getFileInitialContent(f);
                enableTabKey(ta);

                panel.appendChild(ta);
                container.appendChild(panel);
            });
        }

        function switchTab(idx) {
            document.querySelectorAll(".tab-btn").forEach((b, i) => b.classList.toggle("active", i === idx));
            document.querySelectorAll(".tab-panel").forEach((p, i) => p.classList.toggle("active", i === idx));
        }

        function getFileInitialContent(file) {
            return String(
                file?.starter ??
                file?.initial ??
                file?.template ??
                file?.content ??
                file?.code ??
                ""
            );
        }

        function getFileExpectedContent(file) {
            return String(
                file?.answer ??
                file?.expected ??
                ""
            );
        }

