        /* ═══════════════════ CONFIG / STATE ═══════════════════ */
        const JQUERY_CDN = "https://code.jquery.com/jquery-3.7.1.min.js";
        const SAFE_HTML_TAG_RE = /<(?:\/?(?:div|span|p|br|ul|ol|li|strong|em|b|i|u|img|table|thead|tbody|tr|td|th|code|pre|blockquote|sub|sup|a|hr|small|mark|kbd|details|summary)\b|!--)/i;

        let allQuestions = [];
        let questions = [];
        let currentQuestion = 0;
        let stats = { correct: 0, incorrect: 0 };
        let selectedOptions = new Set();
        let answerChecked = false;

        let failedQuestions = [];
        let isReviewMode = false;
        let reviewRound = 0;

        let triesMap = new Map();
        let totalTriesCount = 0;

        /* ── Almacenamiento local con interruptor maestro (gobernado desde Ajustes) ──
           lsSet respeta el interruptor: si el usuario desactiva el almacenamiento,
           dejamos de escribir (las lecturas y los borrados siguen permitidos). */
        let storageEnabled = (function () {
            try { return localStorage.getItem("quiz5-storage") !== "off"; }
            catch (e) { return false; }
        })();
        function lsGet(k)    { try { return localStorage.getItem(k); } catch (e) { return null; } }
        function lsSet(k, v) { if (!storageEnabled) return; try { localStorage.setItem(k, v); } catch (e) {} }
        function lsRemove(k) { try { localStorage.removeItem(k); } catch (e) {} }

        /* Modo activo de la app: "test" (quiz) | "recall" (recuerdo activo). */
        let appMode = (lsGet("quiz5-mode") === "recall") ? "recall" : "test";

        if (lsGet("quiz4-theme") === "light") {
            document.body.classList.add("light");
        }

        function toggleTheme() {
            document.body.classList.toggle("light");
            lsSet("quiz4-theme", document.body.classList.contains("light") ? "light" : "dark");
        }

