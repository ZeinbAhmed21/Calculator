/* =============================================================
   BLUSH CALCULATOR — application script
   -------------------------------------------------------------
   01. Helpers & constants
   02. Math engine (tokenizer + recursive-descent parser, no eval)
   03. Number & expression formatting
   04. Application state
   05. Display rendering
   06. Input handling (digits, operators, functions, equals)
   07. History
   08. Effects: toasts, sound, haptics, sparkles
   09. Theme & settings
   10. Keyboard support
   11. Modals & UI wiring
   12. Boot
   ============================================================= */

(function () {
    "use strict";

    /* ---------------------------------------------------------
       01. Helpers & constants
       --------------------------------------------------------- */
    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

    const STORAGE_SETTINGS = "blush:settings";
    const STORAGE_HISTORY = "blush:history";
    const MAX_EXPR_LENGTH = 36;
    const MAX_HISTORY = 30;

    const DEFAULT_SETTINGS = Object.freeze({
        theme: "coquette",
        appearance: "light",   // light | dark | auto
        reducedMotion: false,
        haptic: true,
        sound: false,
        volume: 35
    });

    /** Pretty symbols used on the display (kept inside the expression string). */
    const SYMBOL = { "*": "×", "/": "÷", "-": "−" };
    const RAW = { "×": "*", "÷": "/", "−": "-", "–": "-", "—": "-" };

    const root = document.documentElement;
    const mainDisplay = $("#mainDisplay");
    const historyLine = $("#historyLine");
    const displayEl = $(".display");
    const calculatorCard = $(".calculator-card");
    const historyPanel = $("#historyPanel");
    const historyList = $("#historyList");
    const historyEmpty = $("#historyEmpty");
    const toastContainer = $("#toastContainer");

    let settings = Object.assign({}, DEFAULT_SETTINGS);
    let lastFocusedBeforeModal = null;

    const mediaDark = window.matchMedia("(prefers-color-scheme: dark)");
    const mediaMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    /* ---------------------------------------------------------
       02. Math engine — safe expression evaluation (no eval!)
       --------------------------------------------------------- */
    function CalcError(code, message) {
        this.name = "CalcError";
        this.code = code;
        this.message = message;
    }
    CalcError.prototype = Object.create(Error.prototype);

    const OPERATIONS = {
        "+": (a, b) => a + b,
        "-": (a, b) => a - b,
        "*": (a, b) => a * b,
        "/": (a, b) => {
            if (b === 0) throw new CalcError("div0", "Can't divide by zero");
            return a / b;
        }
    };

    /** Turn display characters into pure operator characters. */
    function normalize(src) {
        return String(src)
            .replace(/[×∙·]/g, "*")
            .replace(/[÷]/g, "/")
            .replace(/[−–—]/g, "-")
            .replace(/[, \s]/g, "");
    }

    /** Split an expression string into tokens. Throws CalcError on junk. */
    function tokenize(src) {
        const s = normalize(src);
        const tokens = [];
        let i = 0;

        while (i < s.length) {
            const ch = s[i];

            if (ch >= "0" && ch <= "9" || ch === ".") {
                let j = i;
                let dots = 0;
                while (j < s.length && ((s[j] >= "0" && s[j] <= "9") || s[j] === ".")) {
                    if (s[j] === ".") dots++;
                    j++;
                }
                // optional exponent, e.g. 1.5e-4
                if (s[j] === "e" || s[j] === "E") {
                    let k = j + 1;
                    if (s[k] === "+" || s[k] === "-") k++;
                    let digits = 0;
                    while (k < s.length && s[k] >= "0" && s[k] <= "9") { digits++; k++; }
                    if (digits > 0) j = k;
                }
                const raw = s.slice(i, j);
                if (dots > 1 || raw === ".") throw new CalcError("syntax", "Check your expression");
                const value = Number(raw);
                if (!Number.isFinite(value)) throw new CalcError("syntax", "Check your expression");
                tokens.push({ t: "num", v: value });
                i = j;
                continue;
            }

            if (ch === "(") { tokens.push({ t: "lp" }); i++; continue; }
            if (ch === ")") { tokens.push({ t: "rp" }); i++; continue; }
            if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "%") {
                tokens.push({ t: "op", v: ch });
                i++;
                continue;
            }
            throw new CalcError("syntax", "Check your expression");
        }
        return tokens;
    }

    /**
     * Recursive-descent parser producing a numeric value.
     * Grammar:
     *   expr   := term (('+' | '-') term)*
     *   term   := factor (('*' | '/') factor | implicit factor)*
     *   factor := ('+' | '-') factor | primary ('%')*
     *   primary:= number | '(' expr ')'
     *
     * Percent semantics: "200 + 10%" => 220 (percent of the running total),
     * while "50%" alone evaluates to 0.5.
     */
    function parseExpression(src) {
        const tokens = tokenize(src);
        let pos = 0;

        const peek = () => tokens[pos];

        function evalNode(node) {
            return node.k === "pct" ? node.value / 100 : node.value;
        }

        function parsePrimary() {
            const tk = peek();
            if (!tk) throw new CalcError("syntax", "Check your expression");
            if (tk.t === "num") { pos++; return { k: "num", value: tk.v }; }
            if (tk.t === "lp") {
                pos++;
                const node = parseAdditive();
                if (!peek() || peek().t !== "rp") throw new CalcError("syntax", "Check your expression");
                pos++;
                return node;
            }
            throw new CalcError("syntax", "Check your expression");
        }

        function parseFactor() {
            const tk = peek();
            if (tk && tk.t === "op" && (tk.v === "-" || tk.v === "+")) {
                pos++;
                const value = evalNode(parseFactor());
                return { k: "num", value: tk.v === "-" ? -value : value };
            }
            let node = parsePrimary();
            while (peek() && peek().t === "op" && peek().v === "%") {
                pos++;
                node = { k: "pct", value: evalNode(node) };
            }
            return node;
        }

        function parseMultiplicative() {
            let left = parseFactor();
            while (peek()) {
                const tk = peek();
                if (tk.t === "op" && (tk.v === "*" || tk.v === "/")) {
                    pos++;
                    const value = OPERATIONS[tk.v](evalNode(left), evalNode(parseFactor()));
                    left = { k: "num", value };
                } else if (tk.t === "num" || tk.t === "lp") {
                    // implicit multiplication: 2(3+4)
                    const value = evalNode(left) * evalNode(parseFactor());
                    left = { k: "num", value };
                } else {
                    break;
                }
            }
            return left;
        }

        function parseAdditive() {
            let left = parseMultiplicative();
            while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
                const op = tokens[pos++].v;
                const right = parseMultiplicative();
                const lv = evalNode(left);
                let value;
                if (right.k === "pct") {
                    // "200 + 10%" and "200 - 10%" use percent-of-total behaviour
                    const part = lv * right.value / 100;
                    value = op === "+" ? lv + part : lv - part;
                } else {
                    value = OPERATIONS[op](lv, evalNode(right));
                }
                left = { k: "num", value };
            }
            return left;
        }

        if (tokens.length === 0) throw new CalcError("syntax", "Nothing to calculate");

        const ast = parseAdditive();
        if (pos !== tokens.length) throw new CalcError("syntax", "Check your expression");
        return evalNode(ast);
    }

    /* ---------------------------------------------------------
       03. Number & expression formatting
       --------------------------------------------------------- */

    /** Kill binary floating point dust such as 0.1 + 0.2 => 0.30000000000000004 */
    function roundSmart(n) {
        if (!Number.isFinite(n)) return n;
        const rounded = Number(n.toPrecision(12));
        return Object.is(rounded, -0) ? 0 : rounded;
    }

    function groupInteger(intPart) {
        return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    /** Format a result for display: grouping, decimals, exponentials. */
    function formatNumber(n) {
        n = roundSmart(n);
        if (!Number.isFinite(n)) throw new CalcError("overflow", "That number is a little too big");

        const abs = Math.abs(n);
        if (abs !== 0 && (abs >= 1e12 || abs < 1e-9)) {
            return n.toExponential(6).replace(/\.?0+e/, "e");
        }

        const parts = n.toString().split(".");
        const grouped = groupInteger(parts[0]);
        return parts.length > 1 ? grouped + "." + parts[1] : grouped;
    }

    /** Group the digits of a typed expression for pretty display. */
    function formatExpression(expr) {
        if (!expr) return "0";
        if (/[eE]/.test(expr)) return expr; // exponentials stay untouched
        return expr.replace(/(\d+\.?\d*|\.\d+)/g, (match) => {
            const parts = match.split(".");
            const grouped = groupInteger(parts[0]);
            return parts.length > 1 ? grouped + "." + parts[1] : grouped;
        });
    }

    /* ---------------------------------------------------------
       04. Application state
       --------------------------------------------------------- */
    const state = {
        expr: "",          // raw expression, using display symbols
        result: null,      // last calculated value
        historyLine: "",   // "12 × 3 =" line above the value
        error: null,       // error message currently displayed
        justEvaluated: false,
        history: []
    };

    const endsWithValue = (expr) => /[0-9.%)]$/.test(expr);
    const lastChar = (expr) => expr.slice(-1);
    const displaySymbol = (op) => SYMBOL[op] || op;
    const isOperatorChar = (ch) => ch === "+" || ch === "−" || ch === "×" || ch === "÷";

    function resetForInput() {
        if (state.error) {
            state.error = null;
            state.expr = "";
        }
        if (state.justEvaluated) {
            state.expr = "";
            state.justEvaluated = false;
            state.result = null;
        }
    }

    /* ---------------------------------------------------------
       05. Display rendering
       --------------------------------------------------------- */
    function render() {
        if (state.error) {
            mainDisplay.textContent = state.error;
            mainDisplay.classList.add("is-error");
            mainDisplay.classList.remove("is-long", "is-xlong");
        } else {
            const text = formatExpression(state.expr);
            mainDisplay.textContent = text;
            mainDisplay.classList.remove("is-error");
            mainDisplay.classList.toggle("is-xlong", text.length > 18);
            mainDisplay.classList.toggle("is-long", text.length > 11 && text.length <= 18);
        }

        historyLine.innerHTML = state.historyLine
            ? escapeHtml(state.historyLine)
            : "&nbsp;";

        // keep the tail of long expressions visible
        mainDisplay.scrollLeft = mainDisplay.scrollWidth;
        historyLine.scrollLeft = historyLine.scrollWidth;
    }

    function flashUpdated() {
        displayEl.classList.remove("is-updated");
        void displayEl.offsetWidth; // restart animation
        displayEl.classList.add("is-updated");
        mainDisplay.classList.remove("just-updated");
        void mainDisplay.offsetWidth;
        mainDisplay.classList.add("just-updated");
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, (c) => (
            { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
        ));
    }

    /* ---------------------------------------------------------
       06. Input handling
       --------------------------------------------------------- */
    function inputDigit(digit) {
        resetForInput();
        if (state.expr.length >= MAX_EXPR_LENGTH) {
            toast("That's as long as this expression gets", "error");
            return;
        }
        // a digit right after ")" implies multiplication — handled by the parser
        state.expr += digit;
        render();
    }

    function inputDecimal() {
        resetForInput();
        if (state.expr.length >= MAX_EXPR_LENGTH) return;

        if (!endsWithValue(state.expr) || state.expr.slice(-1) === ")" || state.expr.slice(-1) === "%") {
            state.expr += "0.";
            render();
            return;
        }
        const trailing = state.expr.match(/[0-9.]*$/)[0];
        if (trailing.includes(".")) {
            toast("One decimal per number, darling", "error");
            return;
        }
        state.expr += ".";
        render();
    }

    function inputOperator(op) {
        resetForInput();

        if (!state.expr) {
            if (op === "-") { state.expr = "−"; render(); }
            return; // no leading operators other than minus
        }

        const last = lastChar(state.expr);
        const pretty = displaySymbol(op);

        if (last === "(") {
            if (op === "-") state.expr += "−";
            render();
            return;
        }
        if (isOperatorChar(last)) {
            // allow "×−3" style unary minus, otherwise replace the pending operator
            if (op === "-" && (last === "×" || last === "÷")) state.expr += "−";
            else state.expr = state.expr.slice(0, -1) + pretty;
            render();
            return;
        }
        if (last === "%") { /* operators after % are fine */ }

        if (state.expr.length >= MAX_EXPR_LENGTH) return;
        state.expr += pretty;
        render();
    }

    function inputPercent() {
        resetForInput();
        if (!endsWithValue(state.expr) || lastChar(state.expr) === ")") {
            toast("Add a number before the percent sign", "error");
            return;
        }
        if (lastChar(state.expr) === "%") return;
        state.expr += "%";
        render();
    }

    function inputNegate() {
        resetForInput();

        if (!state.expr) {
            state.expr = "−";
            render();
            return;
        }

        const match = state.expr.match(/(\d+\.?\d*)(%?)$/);
        if (!match) {
            if (lastChar(state.expr) !== "−") state.expr += "−";
            render();
            return;
        }

        const start = state.expr.length - match[0].length;
        const before = state.expr.slice(0, start);
        const minusStandalone = before === "−";
        const minusAfterBracket = /[−+×÷(]$/.test(before);

        if (minusStandalone || minusAfterBracket) {
            state.expr = before.slice(0, -1) + match[0];
        } else {
            state.expr = before + "−" + match[0];
        }
        render();
    }

    function insertParen(ch) {
        resetForInput();

        if (ch === "(") {
            if (state.expr.length >= MAX_EXPR_LENGTH) return;
            const last = lastChar(state.expr);
            // "(3" right after a value means multiplication — parser handles it
            state.expr += "(";
        } else {
            const opens = (state.expr.match(/\(/g) || []).length;
            const closes = (state.expr.match(/\)/g) || []).length;
            if (opens <= closes) {
                toast("No open parenthesis to close", "error");
                return;
            }
            if (endsWithValue(state.expr)) state.expr += ")";
            else return;
        }
        render();
    }

    function inputParenSmart() {
        const expectsValue = !state.expr || isOperatorChar(lastChar(state.expr)) || lastChar(state.expr) === "(";
        const opens = (state.expr.match(/\(/g) || []).length;
        const closes = (state.expr.match(/\)/g) || []).length;
        if (expectsValue || opens > closes && !endsWithValue(state.expr)) insertParen("(");
        else if (opens > closes) insertParen(")");
        else insertParen("(");
    }

    function inputBackspace() {
        if (state.error) {
            state.error = null;
            render();
            return;
        }
        if (state.justEvaluated) return;

        let expr = state.expr;
        if (!expr) return;

        // remove "−(" pairs created by the negate key in one tap
        if (expr.slice(-2) === "−(") expr = expr.slice(0, -2);
        else expr = expr.slice(0, -1);

        state.expr = expr;
        render();
    }

    function inputClear() {
        state.expr = "";
        state.result = null;
        state.historyLine = "";
        state.error = null;
        state.justEvaluated = false;
        render();
        floatHeart();
        tone(320, 0.09, "sine", 0.8);
    }

    function inputEquals() {
        if (state.error || !state.expr) return;

        if (!endsWithValue(state.expr)) {
            showError(new CalcError("syntax", "Finish your expression first"));
            return;
        }

        let value;
        try {
            value = parseExpression(state.expr);
        } catch (err) {
            showError(err instanceof CalcError || err.name === "CalcError"
                ? err
                : new CalcError("syntax", "Check your expression"));
            return;
        }

        let formatted;
        try {
            formatted = formatNumber(value);
        } catch (err) {
            showError(err);
            return;
        }

        state.historyLine = formatExpression(state.expr) + " =";
        state.expr = formatted;       // continue calculating from the result
        state.result = roundSmart(value);
        state.error = null;
        state.justEvaluated = true;

        addHistory(state.historyLine, formatted);
        render();
        flashUpdated();
        burstSparkles($('[data-action="equals"]'));
        tone(720, 0.08, "sine", 1);
        setTimeout(() => tone(960, 0.1, "sine", 0.8), 90);
    }

    function showError(err) {
        state.error = (err && err.message) ? err.message : "Check your expression";
        state.justEvaluated = false;
        render();
        shakeDisplay();
        toast(state.error, "error");
        tone(220, 0.12, "triangle", 0.9);
    }

    /** Route a raw input token coming from buttons or the keyboard. */
    function handleInput(action, value) {
        switch (action) {
            case "digit": inputDigit(value); break;
            case "decimal": inputDecimal(); break;
            case "op": inputOperator(value); break;
            case "percent": inputPercent(); break;
            case "negate": inputNegate(); break;
            case "paren": inputParenSmart(); break;
            case "paren-char": insertParen(value); break;
            case "backspace": inputBackspace(); break;
            case "clear": inputClear(); break;
            case "equals": inputEquals(); break;
            default: return;
        }
        const isSoft = action === "op" || action === "percent" || action === "equals";
        if (isSoft) tone(action === "op" ? 520 : 640, 0.05, "sine", 0.5);
        else tone(600, 0.04, "sine", 0.4);
        hapticBuzz();
    }

    /* ---------------------------------------------------------
       07. History
       --------------------------------------------------------- */
    function addHistory(expression, result) {
        state.history.unshift({ expr: expression, result: result });
        if (state.history.length > MAX_HISTORY) state.history.length = MAX_HISTORY;
        saveHistory();
        renderHistory();
    }

    function renderHistory() {
        historyList.innerHTML = "";
        historyEmpty.hidden = state.history.length > 0;

        state.history.forEach((item, index) => {
            const li = document.createElement("li");
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "history-item";
            btn.dataset.index = String(index);
            btn.setAttribute("aria-label", "Use " + item.result + " in a new calculation");
            btn.style.animationDelay = Math.min(index * 28, 240) + "ms";
            btn.innerHTML =
                '<span class="h-expr"></span><span class="h-result"></span>' +
                '<span class="h-reuse" aria-hidden="true">&#8634;</span>';
            btn.querySelector(".h-expr").textContent = item.expr;
            btn.querySelector(".h-result").textContent = item.result;
            li.appendChild(btn);
            historyList.appendChild(li);
        });
    }

    function reuseHistory(index) {
        const item = state.history[index];
        if (!item) return;
        state.expr = item.result;
        state.result = null;
        state.error = null;
        state.justEvaluated = false;
        state.historyLine = item.expr;
        render();
        toast("Result ready to reuse");
    }

    function saveHistory() {
        try { localStorage.setItem(STORAGE_HISTORY, JSON.stringify(state.history)); } catch (e) { /* ignore */ }
    }

    function loadHistory() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE_HISTORY) || "[]");
            if (Array.isArray(raw)) {
                state.history = raw
                    .filter((h) => h && typeof h.result === "string")
                    .slice(0, MAX_HISTORY);
            }
        } catch (e) { state.history = []; }
    }

    /* ---------------------------------------------------------
       08. Effects: toasts, sound, haptics, sparkles
       --------------------------------------------------------- */
    function toast(message, type) {
        const el = document.createElement("div");
        el.className = "toast" + (type === "error" ? " toast--error" : "");
        el.innerHTML = '<span class="toast-icon"></span><span class="toast-msg"></span>';
        el.querySelector(".toast-icon").textContent = type === "error" ? "!" : "♥";
        el.querySelector(".toast-msg").textContent = message;
        toastContainer.appendChild(el);

        while (toastContainer.children.length > 3) toastContainer.firstElementChild.remove();

        setTimeout(() => {
            el.classList.add("is-leaving");
            setTimeout(() => el.remove(), 320);
        }, 2200);
    }

    function prefersReducedMotion() {
        return settings.reducedMotion || mediaMotion.matches;
    }

    function hapticBuzz() {
        if (settings.haptic && typeof navigator.vibrate === "function") navigator.vibrate(8);
    }

    let audioContext = null;
    function tone(frequency, duration, wave, gainScale) {
        if (!settings.sound) return;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            if (!audioContext) audioContext = new AudioCtx();
            if (audioContext.state === "suspended") audioContext.resume();

            const now = audioContext.currentTime;
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();
            const peak = Math.max((settings.volume / 100) * 0.12 * (gainScale || 1), 0.0005);

            osc.type = wave || "sine";
            osc.frequency.setValueAtTime(frequency, now);
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(peak, now + 0.008);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

            osc.connect(gain);
            gain.connect(audioContext.destination);
            osc.start(now);
            osc.stop(now + duration + 0.03);
        } catch (e) { /* audio is a nicety, never a blocker */ }
    }

    function burstSparkles(button) {
        if (!button || prefersReducedMotion() || !calculatorCard) return;

        const cardRect = calculatorCard.getBoundingClientRect();
        const rect = button.getBoundingClientRect();
        const cx = rect.left - cardRect.left + rect.width / 2;
        const cy = rect.top - cardRect.top + rect.height / 2;
        const glyphs = ["✦", "✧", "·", "✵"];

        for (let i = 0; i < 12; i++) {
            const angle = (Math.PI * 2 * i) / 12 + Math.random() * 0.4;
            const distance = 38 + Math.random() * 46;
            const spark = document.createElement("span");
            spark.className = "spark";
            spark.textContent = glyphs[i % glyphs.length];
            spark.style.left = cx + "px";
            spark.style.top = cy + "px";
            spark.style.setProperty("--dx", Math.cos(angle) * distance + "px");
            spark.style.setProperty("--dy", Math.sin(angle) * distance + "px");
            spark.style.fontSize = 9 + Math.random() * 8 + "px";
            spark.style.animationDelay = Math.random() * 90 + "ms";
            calculatorCard.appendChild(spark);
            setTimeout(() => spark.remove(), 900);
        }
    }

    function floatHeart() {
        if (prefersReducedMotion() || !displayEl) return;
        const heart = document.createElement("span");
        heart.className = "float-heart";
        heart.textContent = "♥";
        displayEl.appendChild(heart);
        setTimeout(() => heart.remove(), 1200);
    }

    function shakeDisplay() {
        if (prefersReducedMotion() || !displayEl) return;
        displayEl.classList.remove("is-shaken");
        void displayEl.offsetWidth;
        displayEl.classList.add("is-shaken");
        setTimeout(() => displayEl.classList.remove("is-shaken"), 400);
    }

    /* ---------------------------------------------------------
       09. Theme & settings
       --------------------------------------------------------- */
    function saveSettings() {
        try { localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings)); } catch (e) { /* ignore */ }
    }

    function resolveAppearance(preference) {
        if (preference === "auto") return mediaDark.matches ? "dark" : "light";
        return preference === "dark" ? "dark" : "light";
    }

    function applyAppearance() {
        root.setAttribute("data-theme", settings.theme);
        root.setAttribute("data-appearance", resolveAppearance(settings.appearance));
    }

    function applyMotionPreference() {
        if (settings.reducedMotion) root.setAttribute("data-reduced-motion", "true");
        else root.removeAttribute("data-reduced-motion");
    }

    function loadSettings() {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(STORAGE_SETTINGS) || "null"); } catch (e) { saved = null; }
        const valid = saved && typeof saved === "object" ? saved : {};
        settings = Object.assign({}, DEFAULT_SETTINGS, valid);

        // No stored preferences yet → honour the system motion preference
        if (!saved) settings.reducedMotion = mediaMotion.matches;

        if (["coquette", "vanilla", "midnight"].indexOf(settings.theme) === -1) settings.theme = "coquette";
        if (["light", "dark", "auto"].indexOf(settings.appearance) === -1) settings.appearance = "light";
        settings.volume = Math.min(100, Math.max(0, Number(settings.volume) || 0));
    }

    function setTheme(theme, announce) {
        settings.theme = theme;
        applyAppearance();
        syncThemeUI();
        saveSettings();
        if (announce) {
            const label = $('.theme-card[data-theme-value="' + theme + '"] .theme-name');
            toast((label ? label.textContent : theme) + " theme applied");
        }
    }

    function setAppearance(preference) {
        settings.appearance = preference;
        applyAppearance();
        syncAppearanceUI();
        saveSettings();
    }

    function syncThemeUI() {
        $$(".theme-card").forEach((card) => {
            const active = card.dataset.themeValue === settings.theme;
            card.setAttribute("aria-checked", active ? "true" : "false");
            card.tabIndex = active ? 0 : -1;
        });
    }

    function syncAppearanceUI() {
        $$(".seg").forEach((seg) => {
            const active = seg.dataset.appearanceValue === settings.appearance;
            seg.setAttribute("aria-checked", active ? "true" : "false");
            seg.tabIndex = active ? 0 : -1;
        });
    }

    function syncSettingsUI() {
        setSwitch($("#reducedMotion"), settings.reducedMotion);
        setSwitch($("#hapticFeedback"), settings.haptic);
        setSwitch($("#soundEffects"), settings.sound);
        const range = $("#soundVolume");
        range.value = String(settings.volume);
        paintRange(range);
    }

    function setSwitch(el, on) {
        if (el) el.setAttribute("aria-checked", on ? "true" : "false");
    }

    function paintRange(range) {
        const pct = ((range.value - range.min) / (range.max - range.min)) * 100;
        range.style.setProperty("--range-value", pct + "%");
    }

    function toggleSwitch(el, key, message) {
        const next = el.getAttribute("aria-checked") !== "true";
        el.setAttribute("aria-checked", next ? "true" : "false");
        settings[key] = next;
        if (key === "reducedMotion") applyMotionPreference();
        if (key === "sound" && next) tone(680, 0.08, "sine", 0.8);
        saveSettings();
        if (message) toast(message + (next ? " on" : " off"));
    }

    function resetEverything() {
        try {
            localStorage.removeItem(STORAGE_SETTINGS);
            localStorage.removeItem(STORAGE_HISTORY);
        } catch (e) { /* ignore */ }

        settings = Object.assign({}, DEFAULT_SETTINGS, { reducedMotion: mediaMotion.matches });
        state.history = [];
        state.expr = "";
        state.result = null;
        state.historyLine = "";
        state.error = null;
        state.justEvaluated = false;

        applyAppearance();
        applyMotionPreference();
        syncThemeUI();
        syncAppearanceUI();
        syncSettingsUI();
        renderHistory();
        render();
        toast("Fresh start — everything reset");
    }

    /* ---------------------------------------------------------
       10. Keyboard support
       --------------------------------------------------------- */
    const KEY_TO_SELECTOR = {
        "0": '[data-value="0"]', "1": '[data-value="1"]', "2": '[data-value="2"]',
        "3": '[data-value="3"]', "4": '[data-value="4"]', "5": '[data-value="5"]',
        "6": '[data-value="6"]', "7": '[data-value="7"]', "8": '[data-value="8"]',
        "9": '[data-value="9"]',
        ".": '[data-action="decimal"]', ",": '[data-action="decimal"]',
        "+": '[data-value="+"]', "-": '[data-value="-"]',
        "*": '[data-value="*"]', "/": '[data-value="/"]', "x": '[data-value="*"]',
        "%": '[data-action="percent"]',
        "=": '[data-action="equals"]', "Enter": '[data-action="equals"]',
        "Backspace": '[data-action="backspace"]',
        "Escape": '[data-action="clear"]',
        "Delete": '[data-action="clear"]'
    };

    function flashKey(selector) {
        const btn = selector && $(selector, calculatorCard);
        if (!btn) return;
        btn.classList.add("is-pressed");
        setTimeout(() => btn.classList.remove("is-pressed"), 140);
    }

    function onKeyDown(event) {
        const target = event.target;
        // let native controls (switches, sliders, focused keys) behave normally
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        if (target && target.closest && (target.closest(".overlay") || target.classList.contains("key"))) {
            if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") return;
        }

        const key = event.key;
        let handled = true;

        if (key >= "0" && key <= "9") {
            handleInput("digit", key);
            flashKey(KEY_TO_SELECTOR[key]);
        } else if (key === "." || key === ",") {
            handleInput("decimal");
            flashKey(KEY_TO_SELECTOR["."]);
        } else if (key === "+" || key === "-" || key === "*" || key === "/") {
            handleInput("op", key);
            flashKey(KEY_TO_SELECTOR[key]);
        } else if (key === "%") {
            handleInput("percent");
            flashKey(KEY_TO_SELECTOR["%"]);
        } else if (key === "(" || key === ")") {
            handleInput("paren-char", key);
        } else if (key === "=" || key === "Enter") {
            handleInput("equals");
            flashKey(KEY_TO_SELECTOR["="]);
        } else if (key === "Backspace") {
            handleInput("backspace");
            flashKey(KEY_TO_SELECTOR["Backspace"]);
            event.preventDefault();
        } else if (key === "Escape" || key === "Delete") {
            if (openModalId()) { closeModal(openModalId()); return; }
            handleInput("clear");
            flashKey(KEY_TO_SELECTOR["Escape"]);
        } else {
            handled = false;
        }

        if (handled) event.preventDefault();
    }

    /* ---------------------------------------------------------
       11. Modals & UI wiring
       --------------------------------------------------------- */
    const MODALS = ["themeModal", "settingsModal"];
    function openModalId() {
        return MODALS.find((id) => !document.getElementById(id).hidden) || null;
    }

    function openModal(id) {
        const modal = document.getElementById(id);
        if (!modal || !modal.hidden) return;
        lastFocusedBeforeModal = document.activeElement;
        modal.hidden = false;
        document.body.style.overflow = "hidden";
        const closer = $(".modal-close", modal);
        if (closer) closer.focus();
    }

    function closeModal(id) {
        const modal = document.getElementById(id);
        if (!modal || modal.hidden) return;
        modal.hidden = true;
        if (!openModalId()) document.body.style.overflow = "";
        if (lastFocusedBeforeModal && lastFocusedBeforeModal.focus) lastFocusedBeforeModal.focus();
    }

    /** Roving arrow-key navigation for radio groups. */
    function wireRadioGroup(containerSelector, itemSelector, onSelect) {
        const container = $(containerSelector);
        if (!container) return;
        container.addEventListener("click", (event) => {
            const item = event.target.closest(itemSelector);
            if (item) onSelect(item);
        });
        container.addEventListener("keydown", (event) => {
            if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;
            const items = $$(itemSelector, container);
            const index = items.indexOf(document.activeElement);
            if (index === -1) return;
            event.preventDefault();
            let next = index;
            if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % items.length;
            else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = items.length - 1;
            items[next].focus();
            onSelect(items[next]);
        });
    }

    async function copyResult() {
        if (state.error || !state.expr) {
            toast("Nothing to copy just yet", "error");
            return;
        }
        const text = formatExpression(state.expr);
        const ok = await copyText(text);
        const btn = $("#copyResult");
        if (ok) {
            btn.classList.add("is-copied");
            setTimeout(() => btn.classList.remove("is-copied"), 1600);
            toast("Copied " + text + " to clipboard");
        } else {
            toast("Copy was blocked by the browser", "error");
        }
    }

    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text).then(() => true).catch(() => legacyCopy(text));
        }
        return Promise.resolve(legacyCopy(text));
    }

    function legacyCopy(text) {
        try {
            const area = document.createElement("textarea");
            area.value = text;
            area.setAttribute("readonly", "");
            area.style.position = "fixed";
            area.style.opacity = "0";
            document.body.appendChild(area);
            area.select();
            const ok = document.execCommand("copy");
            area.remove();
            return ok;
        } catch (e) {
            return false;
        }
    }

    function toggleHistoryPanel() {
        const willOpen = historyPanel.hidden;
        historyPanel.hidden = !willOpen;
        $("#historyToggle").setAttribute("aria-expanded", willOpen ? "true" : "false");
        if (willOpen) renderHistory();
    }

    function buildParticles() {
        const host = $("#floatingParticles");
        if (!host || prefersReducedMotion()) return;
        const glyphs = ["♥", "✦", "🎀", "✧"];
        for (let i = 0; i < 14; i++) {
            const petal = document.createElement("span");
            const isDot = i % 3 === 0;
            petal.className = "petal" + (isDot ? " petal--dot" : "");
            if (!isDot) petal.textContent = glyphs[i % glyphs.length];
            petal.style.left = Math.random() * 100 + "%";
            petal.style.setProperty("--drift", (Math.random() * 120 - 60) + "px");
            petal.style.animationDuration = 16 + Math.random() * 22 + "s";
            petal.style.animationDelay = -Math.random() * 30 + "s";
            petal.style.fontSize = 8 + Math.random() * 8 + "px";
            host.appendChild(petal);
        }
    }

    function wireEvents() {
        // Keypad
        calculatorCard.addEventListener("click", (event) => {
            const key = event.target.closest(".key");
            if (!key) return;
            if (key.dataset.action === "op") handleInput("op", key.dataset.value);
            else if (key.dataset.action) handleInput(key.dataset.action);
            else if (key.dataset.value) handleInput("digit", key.dataset.value);
        });

        // Display: click the value to copy it
        displayEl.addEventListener("click", (event) => {
            if (event.target.closest(".display-value")) copyResult();
        });

        // Header actions
        $("#historyToggle").addEventListener("click", toggleHistoryPanel);
        $("#copyResult").addEventListener("click", copyResult);

        // History list
        historyList.addEventListener("click", (event) => {
            const item = event.target.closest(".history-item");
            if (item) reuseHistory(Number(item.dataset.index));
        });
        $("#historyClear").addEventListener("click", () => {
            if (!state.history.length) { toast("History is already empty"); return; }
            state.history = [];
            saveHistory();
            renderHistory();
            toast("History cleared");
        });

        // Floating buttons
        $("#themeFloatToggle").addEventListener("click", () => openModal("themeModal"));
        $("#settingsFloatToggle").addEventListener("click", () => openModal("settingsModal"));

        // Modals: close buttons + backdrop + escape
        MODALS.forEach((id) => {
            const modal = document.getElementById(id);
            modal.addEventListener("click", (event) => {
                if (event.target === modal || event.target.closest("[data-close]")) closeModal(id);
            });
        });

        // Theme + appearance radios
        wireRadioGroup(".theme-grid", ".theme-card", (item) => setTheme(item.dataset.themeValue, true));
        wireRadioGroup(".segmented", ".seg", (item) => setAppearance(item.dataset.appearanceValue));

        // Settings switches
        $("#reducedMotion").addEventListener("click", function () {
            toggleSwitch(this, "reducedMotion", "Reduced motion");
        });
        $("#hapticFeedback").addEventListener("click", function () {
            toggleSwitch(this, "haptic", "Haptic feedback");
        });
        $("#soundEffects").addEventListener("click", function () {
            toggleSwitch(this, "sound", "Sound effects");
        });
        const volume = $("#soundVolume");
        volume.addEventListener("input", function () {
            settings.volume = Number(this.value);
            paintRange(this);
            saveSettings();
        });
        volume.addEventListener("change", () => tone(700, 0.08, "sine", 0.9));
        $("#clearAllData").addEventListener("click", resetEverything);

        // Keyboard
        document.addEventListener("keydown", onKeyDown);

        // Follow the system appearance while set to "auto"
        const onSchemeChange = () => { if (settings.appearance === "auto") applyAppearance(); };
        if (mediaDark.addEventListener) mediaDark.addEventListener("change", onSchemeChange);
        else if (mediaDark.addListener) mediaDark.addListener(onSchemeChange);

        const onMotionChange = () => { if (settings.reducedMotion) applyMotionPreference(); };
        if (mediaMotion.addEventListener) mediaMotion.addEventListener("change", onMotionChange);
    }

    /* ---------------------------------------------------------
       12. Boot
       --------------------------------------------------------- */
    function init() {
        loadSettings();
        loadHistory();
        applyAppearance();
        applyMotionPreference();
        syncThemeUI();
        syncAppearanceUI();
        syncSettingsUI();
        renderHistory();
        render();
        buildParticles();
        wireEvents();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
