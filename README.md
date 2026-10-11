# 🎀 Blush Calculator

A luxury **coquette** calculator web app — soft, feminine, elegant and polished, like a premium beauty-tech product. Built with plain **HTML5, CSS3 and Vanilla JavaScript**. No frameworks, no build step, no dependencies.

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)

---

## ✨ Features

### Design
- **Glassmorphism** calculator card with frosted glass, soft shadows and a delicate gold hairline
- **3 themes** — Coquette Pink, Vanilla Cream, Midnight Rose — each with a **Light / Dark / Auto** appearance mode
- Animated ambient glows, film grain and drifting petals in the background
- Refined micro-interactions: key press, hover glow, sparkle burst on `=`, floating heart on `AC`
- Typography pairing: *Cormorant Garamond* for headings, *DM Sans* for numbers

### Calculator
- Addition, subtraction, multiplication, division
- **Operator precedence** via a proper recursive-descent parser — **`eval()` is never used**
- Decimals, negative numbers, unary minus, parentheses, implicit multiplication `2(3+4)`
- **Percentage** with calculator-style semantics: `200 + 10%` → `220`
- `AC` (clear all) and backspace
- Consecutive operations and reusing the last result
- Friendly division-by-zero message, invalid input guards, no crashes
- Smart formatting: thousands separators, cleaned float dust (`0.1 + 0.2` → `0.3`), exponentials for very large/small numbers

### Product touches
- **Calculation history** — collapsible panel, click any entry to reuse its result, graceful empty state
- **Copy result** button with a visual confirmation
- **Settings**: reduced motion, haptic feedback, sound effects (off by default) + volume, full reset
- **Keyboard support** for everything, with visible key-press feedback
- Toast notifications for copies and errors
- **`localStorage` persistence** for theme, appearance, settings and history
- Respects the system `prefers-reduced-motion` preference

### Accessibility & responsiveness
- Full keyboard navigation with visible focus states
- Accessible labels on every icon-only control, plus `aria-keyshortcuts`
- Live regions so results are announced to screen readers
- Comfortable touch targets (46 px+), no horizontal overflow
- Responsive from 320 px phones to large desktop screens
- **Lighthouse: 100 Accessibility · 100 Best Practices · 100 SEO**

---

## 🚀 Getting started

No install, no build step. Just open the file:

```
open index.html
```

Or serve it locally (recommended, so the clipboard API works):

```bash
npx serve .
# then open http://localhost:3000
```

```
python -m http.server 8000
```

---

## ⌨️ Keyboard shortcuts

| Key | Action |
| --- | --- |
| `0`–`9`, `.` | Enter digits and the decimal point |
| `+` `-` `*` `/` | Operators |
| `(` `)` | Parentheses |
| `%` | Percentage |
| `Enter` or `=` | Calculate |
| `Backspace` | Delete last character |
| `Esc` or `Delete` | Clear all |

---

## 🗂 Project structure

```
calculator/
├── index.html   # Semantic markup, inline SVG icons, ARIA
├── style.css    # Design system, themes, animations, responsive
└── script.js    # Parser, input handling, history, settings, effects
```

Everything is driven by **CSS custom properties**, so adding a new theme is a matter of adding one block of colour variables:

```css
html[data-theme="mytheme"] {
  --bg: #...;  --text: #...;  --accent: #...;
  --key-bg: ...;  --op-bg: ...;  --eq-bg: ...;
}
```

---

## 🧮 How the math works

`script.js` contains a small, safe expression engine:

1. **`tokenize()`** — turns the expression string into numbers, operators and brackets
2. **`parseExpression()`** — a recursive-descent parser with four levels:
   `additive → multiplicative → factor → primary`
3. **`formatNumber()`** — rounds float noise, groups digits, falls back to exponential notation

Percent nodes are evaluated as `value / 100` normally, but when a percent node is the direct right operand of a top-level `+` or `-`, it is treated as *percent of the running total* — exactly like a physical calculator.

---

## 📄 License

Free to use, learn from and adapt. A star on the repo would make the bow sparkle a little brighter. 🎀
