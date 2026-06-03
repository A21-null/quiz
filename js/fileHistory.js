        /* ═══════════════════ HISTORIAL DE ARCHIVOS + APERTURA POR URL (#hash) ═══════════════════ */
        /* Aditivo: no altera el flujo existente. Almacenamiento en localStorage (clave quiz4-files).
           Permite abrir un JSON con  index.html#ruta/archivo.json  (p.ej. para lanzar el quiz
           desde un script) y reabrir archivos usados recientemente desde el listado "Recientes". */
        const FILES_KEY = "quiz4-files";
        const FILES_MAX = 15;
        let lastLoadedKey = null;

        function loadFileHistory() {
            try {
                const arr = JSON.parse(lsGet(FILES_KEY) || "[]");
                return Array.isArray(arr) ? arr : [];
            } catch (e) { return []; }
        }

        function saveFileHistory(arr) {
            try {
                lsSet(FILES_KEY, JSON.stringify(arr));
            } catch (e) {
                // Cuota excedida: conserva metadatos, descarta el contenido cacheado de los antiguos
                try {
                    const slim = arr.map((it, i) => i === 0 ? it : { key: it.key, name: it.name, ts: it.ts, count: it.count });
                    lsSet(FILES_KEY, JSON.stringify(slim));
                } catch (e2) { console.warn("No se pudo guardar el historial de archivos:", e2); }
            }
        }

        function recordFileHistory(key, name, contentText, count) {
            if (!key) return;
            const arr = loadFileHistory().filter(it => it.key !== key);
            arr.unshift({ key: key, name: name || key, ts: Date.now(), content: contentText || "", count: count || 0 });
            while (arr.length > FILES_MAX) arr.pop();
            saveFileHistory(arr);
        }

        function removeFileHistory(key) {
            saveFileHistory(loadFileHistory().filter(it => it.key !== key));
            renderRecentFiles();
        }

        function baseName(p) {
            const s = String(p).split(/[\\/]/).pop();
            return s || String(p);
        }

        /** Aplica un array de preguntas ya parseado y arranca el quiz (misma lógica que el cargador de archivos). */
        function applyQuestionsData(data, label) {
            if (!Array.isArray(data)) {
                throw new Error("El JSON debe ser un array de preguntas.");
            }
            allQuestions = data.map(normalizeQuestionObject);
            if (allQuestions.length === 0) {
                throw new Error("El archivo no contiene preguntas.");
            }
            document.getElementById("fileStatus").textContent = label + " · " + allQuestions.length + " preguntas";
            document.getElementById("loadingMessage").style.display = "none";
            onQuestionsLoaded();
            return allQuestions.length;
        }

        function getHashKey() {
            let h = location.hash || "";
            if (h.charAt(0) === "#") h = h.slice(1);
            try { h = decodeURIComponent(h); } catch (e) {}
            return h.trim();
        }

        /** Lee la ruta del hash (#ruta.json), intenta fetch (servidor local) y si falla usa la copia cacheada. */
        function loadFromHash() {
            const key = getHashKey();
            if (!key || key === lastLoadedKey) return;

            fetch(key).then(function(res) {
                if (!res.ok) throw new Error("HTTP " + res.status);
                return res.text();
            }).then(function(text) {
                const n = applyQuestionsData(JSON.parse(text), baseName(key));
                lastLoadedKey = key;
                recordFileHistory(key, baseName(key), text, n);
                renderRecentFiles();
            }).catch(function() {
                // Fallback: copia local guardada en una carga anterior (sirve en GitHub Pages, donde preguntas/ no se publica)
                const hit = loadFileHistory().find(it => it.key === key);
                if (hit && hit.content) {
                    try {
                        const n = applyQuestionsData(JSON.parse(hit.content), baseName(key));
                        lastLoadedKey = key;
                        recordFileHistory(key, baseName(key), hit.content, n);
                        renderRecentFiles();
                        return;
                    } catch (e) { /* contenido cacheado corrupto: cae al aviso */ }
                }
                showFileLoadError(key);
            });
        }

        /** Abre un archivo por su clave/ruta poniéndola en el hash (URL compartible/scriptable). */
        function openByUrl(key) {
            if (key === getHashKey()) {
                lastLoadedKey = null;   // mismo hash: hashchange no se dispara, recarga manualmente
                loadFromHash();
            } else {
                location.hash = encodeURI(key);   // dispara hashchange -> loadFromHash
            }
        }

        /** Botón inicio: vuelve a la ruta básica (sin #hash) con una recarga limpia. */
        function goHome() {
            location.assign(location.pathname + location.search);
        }

        function showFileLoadError(key) {
            const toast = document.createElement("div");
            toast.textContent = "No se pudo abrir “" + key + "” — cárgalo una vez con el selector de arriba.";
            toast.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--surface);border:1px solid var(--border);color:var(--text-dim);padding:12px 18px;border-radius:10px;font-size:0.88rem;font-weight:600;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.4);max-width:90vw;text-align:center;";
            document.body.appendChild(toast);
            setTimeout(function() { if (toast.parentElement) toast.remove(); }, 6000);
        }

        function renderRecentFiles() {
            const box = document.getElementById("recentFiles");
            if (!box) return;
            const arr = loadFileHistory();
            box.innerHTML = "";
            // Solo visible en la ruta básica (sin #hash) y cuando no hay un quiz en curso
            const quizActive = document.getElementById("quizContainer").classList.contains("active");
            if (!arr.length || quizActive || getHashKey()) { box.style.display = "none"; return; }
            box.style.display = "block";

            const title = document.createElement("div");
            title.textContent = "Recientes";
            title.style.cssText = "font-size:0.78rem;font-weight:700;color:var(--text-dim);margin:14px 0 6px;text-transform:uppercase;letter-spacing:0.5px;";
            box.appendChild(title);

            arr.forEach(function(it) {
                const row = document.createElement("div");
                row.style.cssText = "display:flex;align-items:center;gap:8px;margin:4px 0;";

                const btn = document.createElement("button");
                btn.textContent = "📄 " + (it.name || it.key);
                btn.title = it.key + (it.count ? (" · " + it.count + " preguntas") : "");
                btn.onclick = function() { openByUrl(it.key); };
                btn.style.cssText = "flex:1;min-width:0;text-align:left;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:7px;cursor:pointer;font-size:0.85rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

                const del = document.createElement("button");
                del.textContent = "✕";
                del.title = "Quitar del historial";
                del.onclick = function(e) { e.stopPropagation(); removeFileHistory(it.key); };
                del.style.cssText = "flex:none;background:var(--surface);border:1px solid var(--border);color:var(--text-dim);padding:8px 10px;border-radius:7px;cursor:pointer;font-size:0.85rem;";

                row.appendChild(btn);
                row.appendChild(del);
                box.appendChild(row);
            });
        }

        window.addEventListener("hashchange", loadFromHash);
        window.addEventListener("load", function() { renderRecentFiles(); loadFromHash(); });

