        /* ═══════════════════ USER INTERACTION ═══════════════════ */
        function selectOption(idx, isMulti) {
            if (answerChecked) return;
            const opts = document.querySelectorAll(".option");

            if (isMulti) {
                if (selectedOptions.has(idx)) {
                    selectedOptions.delete(idx);
                    opts[idx].classList.remove("selected");
                } else {
                    selectedOptions.add(idx);
                    opts[idx].classList.add("selected");
                }
            } else {
                opts.forEach(o => o.classList.remove("selected"));
                selectedOptions.clear();
                selectedOptions.add(idx);
                opts[idx].classList.add("selected");
            }
        }

        function checkAnswer() {
            if (answerChecked) return;

            const q = questions[currentQuestion];
            const key = getQuestionKey(q);
            triesMap.set(key, (triesMap.get(key) || 0) + 1);
            totalTriesCount++;
            updateStats();

            const answerDiv = document.getElementById("answer");

            if (q.type === "multiple") {
                checkMultipleChoice(q, answerDiv);
            } else if (q.type === "exact" || q.type === "command") {
                checkExactOrCommand(q, answerDiv);
            } else if (q.type === "figure" || q.type === "code") {
                checkCodeOrFigure(q, answerDiv);
            } else {
                checkTheory(q, answerDiv);
            }
            saveProgress();
        }

        function checkMultipleChoice(q, answerDiv) {
            const correctAnswers = getCorrectAnswers(q);
            const selectedAnswers = Array.from(selectedOptions).map(i => q.options[i]);
            const isCorrect =
                selectedOptions.size > 0 &&
                correctAnswers.length === selectedAnswers.length &&
                correctAnswers.every(a => selectedAnswers.includes(a)) &&
                selectedAnswers.every(a => correctAnswers.includes(a));

            const opts = document.querySelectorAll(".option");
            q.options.forEach((opt, idx) => {
                const isC = correctAnswers.includes(opt);
                const isS = selectedOptions.has(idx);
                if (isC && isS) opts[idx].classList.add("correct");
                else if (isC && !isS) opts[idx].classList.add("missed");
                else if (!isC && isS) opts[idx].classList.add("incorrect");
            });

            let html = "";
            if (isCorrect) {
                html += '<strong class="result-ok">Correcto ✓</strong>';
                stats.correct++;
                answerDiv.className = "answer show correct-answer";
            } else {
                html += '<strong class="result-ko">Incorrecto ✗</strong>';
                if (correctAnswers.length > 1) {
                    html += "<br>Respuestas correctas:<ul>";
                    correctAnswers.forEach(ans => {
                        html += "<li>" + richToHTML(ans) + "</li>";
                    });
                    html += "</ul>";
                } else {
                    html += "<br>La respuesta correcta es: " + richToHTML(correctAnswers[0] || "");
                }
                stats.incorrect++;
                addToFailedQuestions(q);
                answerDiv.className = "answer show incorrect-answer";
            }

            const tries = triesInfoHTML(q);
            if (tries) html += "<br>" + tries;

            answerDiv.innerHTML = appendExtrasHTML(q, html);
            applyExtrasRendering(answerDiv);

            answerChecked = true;
            updateStats();
        }

        function checkExactOrCommand(q, answerDiv) {
            const input = document.getElementById("userAnswer");
            const userAnswer = input ? input.value : "";
            const isCorrect =
                userAnswer.trim().length > 0 &&
                normalizeAnswer(userAnswer) === normalizeAnswer(q.a);

            let html = "";
            if (isCorrect) {
                if (input) input.classList.add("correct");
                html = '<strong class="result-ok">Correcto ✓</strong>';
                stats.correct++;
                answerDiv.className = "answer show correct-answer";
            } else {
                if (input) input.classList.add("incorrect");
                html = '<strong class="result-ko">Incorrecto ✗</strong><br>La respuesta correcta es: ' + richToHTML(q.a);
                stats.incorrect++;
                addToFailedQuestions(q);
                answerDiv.className = "answer show incorrect-answer";
            }

            const tries = triesInfoHTML(q);
            if (tries) html += "<br>" + tries;

            answerDiv.innerHTML = appendExtrasHTML(q, html);
            applyExtrasRendering(answerDiv);

            answerChecked = true;
            updateStats();
        }

        function checkTheory(q, answerDiv) {
            const input = document.getElementById("userAnswer");
            const userAnswer = input ? input.value : "";
            const normalizedUser = normalizeAnswer(userAnswer);
            const normalizedCorrect = normalizeAnswer(q.a);

            if (normalizedUser && (normalizedUser === normalizedCorrect || normalizedCorrect.includes(normalizedUser))) {
                if (input) input.classList.add("correct");
                let html = '<strong class="result-ok">Correcto ✓</strong><br>Respuesta: ' + richToHTML(q.a);
                const tries = triesInfoHTML(q);
                if (tries) html += "<br>" + tries;
                answerDiv.innerHTML = appendExtrasHTML(q, html);
                answerDiv.className = "answer show correct-answer";
                applyExtrasRendering(answerDiv);
                stats.correct++;
                answerChecked = true;
                updateStats();
                return;
            }

            let html = '<strong class="result-warn">Corrección manual</strong><br>Respuesta esperada:<br>' + richToHTML(q.a);
            const tries = triesInfoHTML(q);
            if (tries) html += "<br>" + tries;
            html = appendExtrasHTML(q, html);
            html += '<div class="action-buttons">' +
                '<button class="btn-correct-m" onclick="markCorrect()">✓ Correcto</button>' +
                '<button class="btn-incorrect-m" onclick="markIncorrect()">✗ Incorrecto</button>' +
                '</div>';

            if (input && userAnswer.trim()) {
                input.classList.add("incorrect");
            }

            answerDiv.innerHTML = html;
            answerDiv.className = "answer show warning-answer";
            applyExtrasRendering(answerDiv);
        }

        function checkCodeOrFigure(q, answerDiv) {
            const userFiles = [];

            if (Array.isArray(q.files) && q.files.length > 0) {
                q.files.forEach((f, i) => {
                    const ta = document.getElementById("codeInput" + i);
                    userFiles.push({
                        name: f.name || ("archivo-" + (i + 1)),
                        code: ta ? ta.value : ""
                    });
                });
            } else {
                const ta = document.getElementById("userAnswer");
                userFiles.push({ name: "respuesta", code: ta ? ta.value : "" });
            }

            let userFullHTML = buildRenderableHTML(q, userFiles);

            const errBox = document.getElementById("syntaxErrors");
            errBox.classList.remove("show");
            errBox.innerHTML = "";

            if (window._quiz4ErrorHandler) {
                window.removeEventListener("message", window._quiz4ErrorHandler);
            }

            window._quiz4ErrorHandler = function(event) {
                if (!event.data || !event.data.quizErrors) return;
                const errors = event.data.quizErrors;
                if (!errors.length) return;

                let html = '<div class="err-title">Errores detectados en tu código</div>';
                errors.forEach(err => {
                    let detail = "";
                    if (err.type === "js") {
                        detail = "<b>JS</b>";
                        if (err.line) detail += " (línea " + err.line + ")";
                        detail += ": " + escapeHTML(err.msg || "");
                    } else {
                        detail = "<b>CSS</b>: " + escapeHTML(err.msg || "");
                    }
                    html += '<div class="err-item">' + detail + '</div>';
                });

                errBox.innerHTML = html;
                errBox.classList.add("show");
            };

            window.addEventListener("message", window._quiz4ErrorHandler);

            const userPrevContainer = document.getElementById("userPreviewContainer");
            const userPrevIframe = document.getElementById("userPreviewIframe");
            userPrevContainer.classList.remove("hidden");
            requestAnimationFrame(() => {
                userPrevIframe.srcdoc = userFullHTML;
            });

            let expectedHTML = '<strong class="result-warn">Corrección manual</strong>';

            if (Array.isArray(q.files) && q.files.length > 0) {
                const hasExpected = q.files.some(f => getFileExpectedContent(f).trim().length > 0);
                if (hasExpected) {
                    expectedHTML += "<br>Respuesta esperada:";
                    q.files.forEach(f => {
                        const expected = getFileExpectedContent(f);
                        if (expected.trim().length > 0) {
                            expectedHTML += '<br><strong>' + escapeHTML(f.name || "archivo") + ":</strong>";
                            expectedHTML += '<pre>' + escapeHTML(expected) + '</pre>';
                        }
                    });
                } else if (q.a) {
                    expectedHTML += "<br>" + richToHTML(q.a);
                }
            } else if (q.a) {
                expectedHTML += "<br>" + richToHTML(q.a);
            }

            const tries = triesInfoHTML(q);
            if (tries) expectedHTML += "<br>" + tries;

            expectedHTML = appendExtrasHTML(q, expectedHTML);
            expectedHTML += '<div class="action-buttons">' +
                '<button class="btn-correct-m" onclick="markCorrect()">✓ Correcto</button>' +
                '<button class="btn-incorrect-m" onclick="markIncorrectWithRetry()">✗ Incorrecto</button>' +
                '</div>';

            answerDiv.innerHTML = expectedHTML;
            answerDiv.className = "answer show warning-answer";
            applyExtrasRendering(answerDiv);
        }

        function buildRenderableHTML(q, userFiles) {
            let cssCode = "";
            let jsCode = "";
            let mainCode = "";

            userFiles.forEach(f => {
                const name = String(f.name || "").toLowerCase();
                if (name.endsWith(".css")) {
                    cssCode += f.code + "\n";
                } else if (name.endsWith(".js") || name.includes("jquery") || name.includes("script")) {
                    jsCode += f.code + "\n";
                } else {
                    mainCode += f.code + "\n";
                }
            });

            let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
            html += '<script src="' + JQUERY_CDN + '"><\/script>';
            html += '<script>';
            html += 'var __errors = [];';
            html += 'window.onerror = function(msg, src, line, col) {';
            html += '  __errors.push({type:"js", msg: String(msg || ""), line: line || 0, col: col || 0});';
            html += '  parent.postMessage({quizErrors: __errors}, "*");';
            html += '  return true;';
            html += '};';
            html += '<\/script>';

            if (cssCode.trim()) {
                html += '<style>' + cssCode + '<\/style>';
            }

            html += '</head><body>';

            if (q.html_context) {
                const bodyMatch = String(q.html_context).match(/<body[^>]*>([\s\S]*)<\/body>/i);
                html += bodyMatch ? bodyMatch[1] : String(q.html_context);
            }

            if (mainCode.trim()) {
                html += mainCode;
            }

            if (jsCode.trim()) {
                html += '<script>' + jsCode + '<\/script>';
            }

            html += '<script>';
            html += 'window.addEventListener("load", function() {';
            html += '  try {';
            html += '    var sheets = document.styleSheets;';
            html += '    for (var s = 0; s < sheets.length; s++) {';
            html += '      try {';
            html += '        var rules = sheets[s].cssRules || sheets[s].rules;';
            html += '        if (!rules || rules.length === 0) {';
            html += '          var owner = sheets[s].ownerNode;';
            html += '          if (owner && owner.tagName === "STYLE" && owner.textContent.trim().length > 0) {';
            html += '            __errors.push({type:"css", msg:"Hoja de estilos vacía tras parsear — posible error de sintaxis CSS"});';
            html += '          }';
            html += '        }';
            html += '      } catch(e) {';
            html += '        __errors.push({type:"css", msg:"Error accediendo a reglas CSS: " + e.message});';
            html += '      }';
            html += '    }';
            html += '  } catch(e) {}';
            html += '  parent.postMessage({quizErrors: __errors}, "*");';
            html += '});';
            html += '<\/script>';

            html += '</body></html>';
            return html;
        }

        /* ═══════════════════ MANUAL MARKING / RETRY ═══════════════════ */
        function markCorrect() {
            if (answerChecked) return;
            const q = questions[currentQuestion];
            const answerDiv = document.getElementById("answer");

            stats.correct++;
            answerChecked = true;
            answerDiv.className = "answer show correct-answer";

            const existing = answerDiv.innerHTML;
            answerDiv.innerHTML = '<strong class="result-ok">Marcado como correcto ✓</strong><br>' + existing;

            const btns = answerDiv.querySelector(".action-buttons");
            if (btns) btns.remove();

            updateStats();
            applyExtrasRendering(answerDiv);
            saveProgress();
        }

        function markIncorrect() {
            if (answerChecked) return;
            const q = questions[currentQuestion];
            const answerDiv = document.getElementById("answer");

            stats.incorrect++;
            answerChecked = true;
            answerDiv.className = "answer show incorrect-answer";

            const existing = answerDiv.innerHTML;
            answerDiv.innerHTML = '<strong class="result-ko">Marcado como incorrecto ✗</strong><br>' + existing;

            const btns = answerDiv.querySelector(".action-buttons");
            if (btns) btns.remove();

            addToFailedQuestions(q);
            updateStats();
            applyExtrasRendering(answerDiv);
            saveProgress();
        }

        function markIncorrectWithRetry() {
            if (answerChecked) return;
            const answerDiv = document.getElementById("answer");
            const btns = answerDiv.querySelector(".action-buttons");
            if (btns) {
                btns.innerHTML =
                    '<button class="btn-retry" onclick="retryQuestion()">↻ Reintentar</button>' +
                    '<button class="btn-skip" onclick="skipQuestion()">Saltar →</button>';
            }
        }

        function retryQuestion() {
            answerChecked = false;
            const answerDiv = document.getElementById("answer");
            answerDiv.className = "answer";
            answerDiv.innerHTML = "";
            clearCodePreview();

            const q = questions[currentQuestion];
            if (Array.isArray(q.files) && q.files.length > 0) {
                q.files.forEach((f, i) => {
                    const ta = document.getElementById("codeInput" + i);
                    if (ta) ta.classList.remove("correct", "incorrect");
                });
            } else {
                const input = document.getElementById("userAnswer");
                if (input) input.classList.remove("correct", "incorrect");
            }
        }

        function skipQuestion() {
            if (answerChecked) return;
            const q = questions[currentQuestion];
            const answerDiv = document.getElementById("answer");

            stats.incorrect++;
            answerChecked = true;
            addToFailedQuestions(q);
            updateStats();

            const btns = answerDiv.querySelector(".action-buttons");
            if (btns) {
                btns.innerHTML = '<strong class="result-ko">Saltada — marcada como incorrecta</strong>';
            }
            answerDiv.className = "answer show incorrect-answer";
            applyExtrasRendering(answerDiv);
            saveProgress();
        }
       
