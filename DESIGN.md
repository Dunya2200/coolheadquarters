# DESIGN.md — Контракт дизайн-системы Apple Liquid Glass (HIG iOS 26 / iOS 27)

## 1. Протокол Layer Gate (разделение слоёв)

- **Слой 1 (Контент — БЕЗ стекла):** фон страницы, карточка погоды и цитаты, сетка дежурных по дням недели, карточки объявлений, список дней рождения, подвал. Все поверхности сплошные и высококонтрастные.
- **Слой 2 (Структура — БЕЗ стекла):** адаптивная сетка разделов, формы внутри шторок, сегментированные переключатели в покое.
- **Слой 3 (Плавающий UI — Liquid Glass РАЗРЕШЕНО):**
  1. Верхний плавающий командный бар (`.lg-regular.lg-pill`, `data-lg-refract`, ширина `<= 760px`).
  2. Прогрессивный край прокрутки (`.lg-scroll-edge-top`, прямой потомок `<body>`).
  3. Нижний плавающий док быстрых действий командира (`.lg-regular.lg-pill`, `data-lg-refract`, одна акцентная CTA `.lg-btn-prominent`).
  4. Модальные шторки форм (`.lg-thick`, высокая плотность 78% для WCAG AAA).

Вложенный `backdrop-filter` (Glass-on-Glass) запрещён. Внутри стеклянных капсул элементы используют концентрические скругления `R_inner = max(0px, R_outer - padding)` и полупрозрачную заливку.

## 2. Матрица тиров и контрастность WCAG 2.2

| Тир | Заливка (Светлая / Тёмная) | Размытие (Tier 1) | Порог контраста |
| :--- | :--- | :--- | :--- |
| Tier 0 (Базовый / `[data-glass="off"]`) | `#F2F2F5` / `#1E1E24`, текст `#111114` / `#FFFFFF` | Нет (`none`) | AAA (>12:1) |
| `.lg-regular` | `color-mix(in oklab, surface 64%, transparent)` | `blur(14px) saturate(160%)` | AA (>=4.8:1..6.5:1) |
| `.lg-thick` | `color-mix(in oklab, surface 78%, transparent)` | `blur(24px) saturate(150%)` | AAA (>=7.7:1..9.7:1) |
| `.lg-btn-prominent` | Сплошной акцент (`#0066CC` / `#0A84FF`) | Нет | AA (>=4.5:1) |

## 3. Трёхуровневая кроссбраузерная архитектура и защита от багов

- **Tier 0:** сплошной читаемый интерфейс при отсутствии GPU, при `prefers-reduced-transparency: reduce`, `prefers-contrast: more`, `forced-colors: active` и по тумблеру `#lg-reduce-toggle` (`[data-glass="off"]`).
- **Tier 1:** `@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))` для Safari, Firefox и Chromium; `-webkit-backdrop-filter` указывается первым. Френелевская кромка `1px` рисуется на `::before` через `mask-composite: exclude` без `mix-blend-mode`.
- **Tier 2:** живое преломление по закону Снеллиуса (`n = 1.5168`, выпуклый сквиркл, 4-кратная симметрия квадрантов на Canvas) включается строго через JS-проверку `navigator.userAgentData` в Chromium. Фильтры SVG создаются в `#lg-svg-host` (без `display: none`) с `filterUnits="userSpaceOnUse"` и `color-interpolation-filters="sRGB"`, пересчитываются только в `ResizeObserver` через `rAF` для панелей `<= 800px`.

## 4. Кинематика и доступность

- Пружинные кривые Apple реализованы через CSS `linear()`: `--spring-smooth` (559 ms), `--spring-snappy` (466 ms), `--spring-bouncy` (563 ms).
- При `prefers-reduced-motion: reduce` анимации и курсорный блик отключаются.
- Все иконки — векторные SVG в стиле SF Symbols (22 символа + `img/logo.svg`), эмодзи не используются.
