        /* ═══════════════════ RICH CONTENT / LATEX ═══════════════════ */
        function escapeHTML(str) {
            return String(str)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        }

        function looksLikeRichHTML(str) {
            return SAFE_HTML_TAG_RE.test(String(str || ""));
        }

        function sanitizeHTML(str) {
            const template = document.createElement("template");
            template.innerHTML = String(str || "");

            template.content.querySelectorAll("script").forEach(el => el.remove());

            template.content.querySelectorAll("*").forEach(el => {
                [...el.attributes].forEach(attr => {
                    const name = attr.name.toLowerCase();
                    const value = String(attr.value || "");
                    if (name.startsWith("on")) {
                        el.removeAttribute(attr.name);
                    }
                    if ((name === "href" || name === "src") && /^\s*javascript:/i.test(value)) {
                        el.removeAttribute(attr.name);
                    }
                });
            });

            return template.innerHTML;
        }

        function richToHTML(value) {
            const str = value == null ? "" : String(value);
            if (looksLikeRichHTML(str)) {
                return sanitizeHTML(str);
            }
            return escapeHTML(str).replace(/\n/g, "<br>");
        }

        function setRichContent(el, value) {
            el.innerHTML = richToHTML(value);
            renderMathSafely(el);
        }

        function renderMathSafely(root) {
            if (typeof renderMathInElement !== "function" || !root) return;
            try {
                renderMathInElement(root, {
                    delimiters: [
                        { left: "$$", right: "$$", display: true },
                        { left: "\\[", right: "\\]", display: true },
                        { left: "$", right: "$", display: false },
                        { left: "\\(", right: "\\)", display: false }
                    ],
                    ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
                    throwOnError: false
                });
            } catch (err) {
                console.warn("KaTeX:", err);
            }
        }

        /* ═══════════════════ HELPERS ═══════════════════ */
        function getQuestionKey(q) {
            return [q.q || "", q.a || "", q.exam || "", q.points || "", q.type || ""].join("||");
        }

        function getCorrectAnswers(q) {
            if (typeof q.a === "string" && q.a.includes("|OR|")) {
                return q.a.split("|OR|").map(x => x.trim()).filter(Boolean);
            }
            return [String(q.a || "").trim()].filter(Boolean);
        }

        function normalizeAnswer(str) {
            return String(str || "")
                .replace(/\r\n/g, "\n")
                .trim()
                .toLowerCase()
                .replace(/\s+/g, " ");
        }

        function triesInfoHTML(q) {
            const tries = triesMap.get(getQuestionKey(q)) || 1;
            if (tries > 1) {
                return '<span class="tries-info">Intentos en esta pregunta: ' + tries + '</span>';
            }
            return "";
        }

        function addToFailedQuestions(q) {
            const key = getQuestionKey(q);
            if (!failedQuestions.some(item => getQuestionKey(item) === key)) {
                failedQuestions.push(q);
            }
        }

        function updateStats() {
            document.getElementById("correct").textContent = stats.correct;
            document.getElementById("incorrect").textContent = stats.incorrect;
            const total = stats.correct + stats.incorrect;
            document.getElementById("percentage").textContent = total > 0 ? Math.round((stats.correct / total) * 100) + "%" : "0%";
            document.getElementById("totalTries").textContent = totalTriesCount;
        }

        function updatePhaseIndicator() {
            const el = document.getElementById("phaseIndicator");
            if (isReviewMode) {
                el.className = "phase-indicator review";
                el.textContent = "Revisión · Ronda " + reviewRound + " · " + questions.length + " pregunta" + (questions.length === 1 ? "" : "s");
            } else {
                el.className = "phase-indicator normal";
                el.textContent = "Primera vuelta";
            }
        }

        function appendExtrasHTML(q, baseHTML) {
            let html = baseHTML || "";

            const explanation = q.details || q.explicacion || "";
            if (String(explanation).trim().length > 0) {
                html += '<div class="details-box rich-content"><strong>Explicación:</strong><br>' + richToHTML(explanation) + '</div>';
            }

            if (q.img_a && String(q.img_a).trim().length > 0) {
                html += '<img src="' + escapeHTML(String(q.img_a)) + '" class="answer-image" alt="Imagen explicativa">';
            }

            return html;
        }

        function applyExtrasRendering(answerDiv) {
            renderMathSafely(answerDiv);
        }

        function enableTabKey(textarea) {
            textarea.addEventListener("keydown", function(e) {
                if (e.key === "Tab") {
                    e.preventDefault();
                    const start = this.selectionStart;
                    const end = this.selectionEnd;
                    this.value = this.value.substring(0, start) + "    " + this.value.substring(end);
                    this.selectionStart = this.selectionEnd = start + 4;
                }
            });
        }

        function clearCodePreview() {
            const userPrevContainer = document.getElementById("userPreviewContainer");
            const userPrevIframe = document.getElementById("userPreviewIframe");
            const errBox = document.getElementById("syntaxErrors");
            userPrevContainer.classList.add("hidden");
            userPrevIframe.srcdoc = "";
            errBox.classList.remove("show");
            errBox.innerHTML = "";
        }

