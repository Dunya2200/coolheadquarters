"use strict";

/* =========================================================
   APPLE LIQUID GLASS · ДВИЖОК ПРЕЛОМЛЕНИЯ СНЕЛЛИУСА (TIER 2)
   ========================================================= */

/**
 * Предвычисляет таблицу смещений Снеллиуса для выпуклой сквиркл-фаски
 * f(u) = (1 - (1 - u)^4)^(1/4) для оптического крон-стекла BK7 (n = 1.5168).
 */
function buildSnellLUT(ior = 1.5168, thickness = 0.85, steps = 128) {
  const lut = new Float32Array(steps);
  const r0 = ((ior - 1) / (ior + 1)) ** 2;
  let maxShift = 0;

  for (let i = 0; i < steps; i += 1) {
    const u = Math.max(0.008, i / (steps - 1));
    const oneMinusU = 1 - u;
    const g = 1 - oneMinusU ** 4;
    const h = g ** 0.25;
    const slope = (oneMinusU ** 3) * (g ** -0.75);
    const thetaS = Math.atan(slope);
    const thetaR = Math.asin(Math.min(0.999, Math.sin(thetaS) / ior));
    const fresnelR = r0 + (1 - r0) * (1 - Math.cos(thetaS)) ** 5;
    const shift = (thickness + h) * Math.tan(thetaS - thetaR) * (1 - fresnelR);
    lut[i] = shift;
    if (shift > maxShift) maxShift = shift;
  }

  if (maxShift > 0) {
    for (let i = 0; i < steps; i += 1) {
      lut[i] /= maxShift;
    }
  }

  return lut;
}

function initLiquidGlassEngine() {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const defs = document.getElementById("lg-filter-defs");

  // Безопасная детекция Chromium (без @supports (backdrop-filter: url()))
  const isChromium =
    navigator.userAgentData?.brands?.some((b) => /Chromium/i.test(b.brand)) ??
    (Boolean(window.chrome) && !/CriOS|FxiOS|EdgiOS/i.test(navigator.userAgent));

  const reducedMedia = window.matchMedia(
    "(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)"
  );
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const snellLut = buildSnellLUT(1.5168, 0.85, 128);
  const instances = new Map();

  function makeDisplacementMap(w, h, radius, bezel) {
    const W = Math.max(2, Math.round(w));
    const H = Math.max(2, Math.round(h));
    const r = Math.min(radius, W / 2, H / 2);
    const b = Math.min(bezel, W / 2, H / 2);

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(W, H);
    const data = img.data;

    const hx = W / 2;
    const hy = H / 2;
    const sdf = (px, py) => {
      const qx = Math.abs(px - hx) - (hx - r);
      const qy = Math.abs(py - hy) - (hy - r);
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    };

    const halfW = Math.ceil(W / 2);
    const halfH = Math.ceil(H / 2);
    const lutMaxIdx = snellLut.length - 1;

    const writePixel = (px, py, dx, dy) => {
      const idx = (py * W + px) * 4;
      data[idx] = Math.round(128 + dx * 127);
      data[idx + 1] = Math.round(128 + dy * 127);
      data[idx + 2] = 128;
      data[idx + 3] = 255;
    };

    // 4-кратная симметрия квадрантов: экономия 75% CPU
    for (let y = 0; y < halfH; y += 1) {
      const by = H - 1 - y;
      for (let x = 0; x < halfW; x += 1) {
        const rx = W - 1 - x;
        const inset = -sdf(x + 0.5, y + 0.5);
        let dx = 0;
        let dy = 0;

        if (inset > 0 && inset < b) {
          const nx = sdf(x + 1.5, y + 0.5) - sdf(x - 0.5, y + 0.5);
          const ny = sdf(x + 0.5, y + 1.5) - sdf(x + 0.5, y - 0.5);
          const len = Math.hypot(nx, ny) || 1;
          const lutIdx = Math.min(lutMaxIdx, Math.max(0, Math.round((inset / b) * lutMaxIdx)));
          const mag = snellLut[lutIdx];
          dx = (-nx / len) * mag;
          dy = (-ny / len) * mag;
        }

        writePixel(x, y, dx, dy);
        if (rx !== x) writePixel(rx, y, -dx, dy);
        if (by !== y) writePixel(x, by, dx, -dy);
        if (rx !== x && by !== y) writePixel(rx, by, -dx, -dy);
      }
    }

    ctx.putImageData(img, 0, 0);
    return {
      dataUrl: canvas.toDataURL("image/png"),
      scale: Math.round(b * 1.05)
    };
  }

  function updateElementFilter(el) {
    const manualOff = document.documentElement.getAttribute("data-glass") === "off";
    if (!isChromium || reducedMedia.matches || manualOff || !defs) {
      el.classList.remove("is-refracting");
      return;
    }

    const rect = el.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);

    // Ограничение производительности: преломляем только компактные элементы <= 800px
    if (w < 16 || h < 16 || w > 800 || h > 800) {
      el.classList.remove("is-refracting");
      return;
    }

    let rec = instances.get(el);
    if (!rec) {
      const id = `lg-f-${instances.size + 1}`;
      const filter = document.createElementNS(SVG_NS, "filter");
      filter.setAttribute("id", id);
      filter.setAttribute("filterUnits", "userSpaceOnUse");
      filter.setAttribute("color-interpolation-filters", "sRGB");

      const feImg = document.createElementNS(SVG_NS, "feImage");
      feImg.setAttribute("x", "0");
      feImg.setAttribute("y", "0");
      feImg.setAttribute("preserveAspectRatio", "none");
      feImg.setAttribute("result", "map");

      const feDisp = document.createElementNS(SVG_NS, "feDisplacementMap");
      feDisp.setAttribute("in", "SourceGraphic");
      feDisp.setAttribute("in2", "map");
      feDisp.setAttribute("xChannelSelector", "R");
      feDisp.setAttribute("yChannelSelector", "G");

      filter.append(feImg, feDisp);
      defs.appendChild(filter);
      rec = { id, filter, feImg, feDisp, lastW: 0, lastH: 0 };
      instances.set(el, rec);
    }

    if (rec.lastW !== w || rec.lastH !== h) {
      const cs = getComputedStyle(el);
      const radius = parseFloat(cs.borderTopLeftRadius) || 24;
      const bezel = Number(el.dataset.lgBezel) || 20;
      const { dataUrl, scale } = makeDisplacementMap(w, h, radius, bezel);

      rec.filter.setAttribute("x", "0");
      rec.filter.setAttribute("y", "0");
      rec.filter.setAttribute("width", String(w));
      rec.filter.setAttribute("height", String(h));
      rec.feImg.setAttribute("width", String(w));
      rec.feImg.setAttribute("height", String(h));
      rec.feImg.setAttribute("href", dataUrl);
      rec.feDisp.setAttribute("scale", String(scale));
      rec.lastW = w;
      rec.lastH = h;
    }

    el.style.setProperty("--lg-filter-url", `url(#${rec.id})`);
    el.classList.add("is-refracting");
  }

  let rafPending = false;
  const dirtyEls = new Set();
  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      dirtyEls.add(entry.target);
    }
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        dirtyEls.forEach(updateElementFilter);
        dirtyEls.clear();
      });
    }
  });

  document.querySelectorAll("[data-lg-refract]").forEach((el) => {
    resizeObserver.observe(el);
    updateElementFilter(el);
  });

  // Интерактивный блик по движению указателя (отключается при reduced-motion)
  document.querySelectorAll(".lg-surface").forEach((el) => {
    let pointerRaf = 0;
    el.addEventListener(
      "pointermove",
      (e) => {
        if (reducedMotion.matches || document.documentElement.getAttribute("data-glass") === "off") {
          return;
        }
        if (pointerRaf) return;
        pointerRaf = requestAnimationFrame(() => {
          pointerRaf = 0;
          const r = el.getBoundingClientRect();
          el.style.setProperty("--lg-mx", `${e.clientX - r.left}px`);
          el.style.setProperty("--lg-my", `${e.clientY - r.top}px`);
        });
      },
      { passive: true }
    );
  });

  // Прогрессивный край прокрутки
  const edgeTop = document.querySelector(".lg-scroll-edge-top");
  if (edgeTop) {
    const updateEdge = () => {
      edgeTop.style.setProperty("--edge-fade", String(Math.min(window.scrollY / 28, 1)));
    };
    window.addEventListener("scroll", updateEdge, { passive: true });
    updateEdge();
  }

  // Морфинг активной пилюли в верхней навигации
  const navItems = Array.from(document.querySelectorAll(".top-nav__links .lg-nav-item"));
  function activateNavTab(nextItem) {
    if (!nextItem || nextItem.classList.contains("is-active")) return;
    const apply = () => {
      navItems.forEach((item) => item.classList.remove("is-active"));
      nextItem.classList.add("is-active");
    };
    if (!document.startViewTransition || reducedMotion.matches) {
      apply();
      return;
    }
    document.startViewTransition(apply);
  }

  navItems.forEach((link) => {
    link.addEventListener("click", () => {
      activateNavTab(link);
    });
  });

  // Наблюдение за секциями для обновления активной вкладки при прокрутке
  if ("IntersectionObserver" in window && navItems.length > 0) {
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const targetId = visible.target.id;
        const match = navItems.find((item) => item.dataset.navSection === targetId);
        if (match) activateNavTab(match);
      },
      { rootMargin: "-25% 0px -55% 0px", threshold: [0.1, 0.35] }
    );

    ["overview", "duties", "notices", "birthdays"].forEach((id) => {
      const section = document.getElementById(id);
      if (section) sectionObserver.observe(section);
    });
  }

  function syncAll() {
    document.querySelectorAll("[data-lg-refract]").forEach(updateElementFilter);
  }

  reducedMedia.addEventListener("change", syncAll);

  return { syncAll };
}

/* =========================================================
   КОНСТАНТЫ И СХЕМА ДАННЫХ P05 («КЛАССНЫЙ ШТАБ»)
   ========================================================= */

const STORAGE_KEY = "p05-class-hq-v1";

// Замените на координаты вашего города при адаптации для другой школы
const DEFAULT_CITY = {
  name: "Москва",
  lat: 55.75,
  lon: 37.62
};

const WEEKDAY_NAMES = {
  0: "Воскресенье",
  1: "Понедельник",
  2: "Вторник",
  3: "Среда",
  4: "Четверг",
  5: "Пятница",
  6: "Суббота"
};

const MONTH_NAMES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь"
];

const MONTH_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря"
];

const NOTICE_TITLE_LIMIT = 80;
const NOTICE_BODY_LIMIT = 280;

/**
 * Документация weekday в JavaScript:
 * Date.prototype.getDay() возвращает 0 для воскресенья и 1..6 для понедельника..субботы.
 * В школьной сетке 5-6 учебных дней используются значения 1..6; значение 0 трактуется как выходной.
 */
function getTodayJsWeekday(date = new Date()) {
  return date.getDay();
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toMonthDay(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}-${day}`;
}

function addDays(baseDate, offsetDays) {
  const copy = new Date(baseDate.getTime());
  copy.setDate(copy.getDate() + offsetDays);
  return copy;
}

function createDefaultSettings(overrides = {}) {
  const theme = overrides.theme === "dark" ? "dark" : "light";
  const glass = overrides.glass === "off" ? "off" : "on";
  const workdays = overrides.workdays === 6 ? 6 : 5;
  const lat = Number.isFinite(Number(overrides.lat)) ? Number(overrides.lat) : DEFAULT_CITY.lat;
  const lon = Number.isFinite(Number(overrides.lon)) ? Number(overrides.lon) : DEFAULT_CITY.lon;
  return { theme, glass, workdays, lat, lon };
}

function createEmptyDuties() {
  return [1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    names: ["", ""]
  }));
}

function createEmptyState(prevSettings = {}) {
  return {
    notices: [],
    duties: createEmptyDuties(),
    birthdays: [],
    settings: createDefaultSettings(prevSettings)
  };
}

function createDemoState(prevSettings = {}, baseDate = new Date()) {
  const todayIso = toIsoDate(baseDate);
  const tomorrowIso = toIsoDate(addDays(baseDate, 1));
  const plusThreeIso = toIsoDate(addDays(baseDate, 3));
  const pastIso = toIsoDate(addDays(baseDate, -7));

  const todayMd = toMonthDay(baseDate);
  const nearDay = addDays(baseDate, 2);
  const nearMd =
    nearDay.getMonth() === baseDate.getMonth()
      ? toMonthDay(nearDay)
      : toMonthDay(addDays(baseDate, -2));

  return {
    notices: [
      {
        id: "n1",
        title: "Сбор макулатуры",
        body: "Кабинет 12, принести перевязанные связки до 14:00",
        date: tomorrowIso,
        archived: false
      },
      {
        id: "n2",
        title: "Сверка графика дежурных",
        body: "Кабинет 14, командирам рядов проверить расписание на следующую неделю",
        date: todayIso,
        archived: false
      },
      {
        id: "n3",
        title: "Репетиция школьного концерта",
        body: "Актовый зал, общий сбор участников в 15:15 после шестого урока",
        date: plusThreeIso,
        archived: false
      },
      {
        id: "n4",
        title: "Итоги собрания актива",
        body: "План мероприятий на месяц согласован и передан классному руководителю",
        date: pastIso,
        archived: true
      }
    ],
    duties: [
      { weekday: 1, names: ["Алина С.", "Тимур К."] },
      { weekday: 2, names: ["Дарья М.", "Максим П."] },
      { weekday: 3, names: ["Егор В.", "Полина Л."] },
      { weekday: 4, names: ["София К.", "Артём Б."] },
      { weekday: 5, names: ["Кира Н.", "Иван Р."] },
      { weekday: 6, names: ["Никита Г.", "Анна Д."] }
    ],
    birthdays: [
      { id: "b1", name: "Егор В.", className: "10А", md: todayMd },
      { id: "b2", name: "Дарья М.", className: "10А", md: nearMd },
      { id: "b3", name: "София К.", className: "10А", md: "03-21" },
      { id: "b4", name: "Алина С.", className: "10А", md: "05-14" },
      { id: "b5", name: "Тимур К.", className: "10А", md: "09-09" },
      { id: "b6", name: "Максим П.", className: "10А", md: "12-08" }
    ],
    settings: createDefaultSettings(prevSettings)
  };
}

function sanitizeStoredState(rawObj) {
  if (!rawObj || typeof rawObj !== "object" || Array.isArray(rawObj)) {
    return createEmptyState();
  }

  const notices = Array.isArray(rawObj.notices)
    ? rawObj.notices
        .filter((item) => item && typeof item === "object")
        .map((item, idx) => ({
          id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : `n-restored-${idx}`,
          title: typeof item.title === "string" ? item.title : "Без заголовка",
          body: typeof item.body === "string" ? item.body : "",
          date: typeof item.date === "string" ? item.date : "",
          archived: Boolean(item.archived)
        }))
    : [];

  const dutyMap = new Map();
  if (Array.isArray(rawObj.duties)) {
    rawObj.duties.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const wd = Number(entry.weekday);
      if (wd >= 1 && wd <= 6) {
        const names = Array.isArray(entry.names) ? entry.names : [];
        dutyMap.set(wd, [
          typeof names[0] === "string" ? names[0].trim() : "",
          typeof names[1] === "string" ? names[1].trim() : ""
        ]);
      }
    });
  }
  const duties = [1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    names: dutyMap.get(weekday) || ["", ""]
  }));

  const birthdays = Array.isArray(rawObj.birthdays)
    ? rawObj.birthdays
        .filter((item) => item && typeof item === "object")
        .map((item, idx) => ({
          id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : `b-restored-${idx}`,
          name: typeof item.name === "string" ? item.name : "Одноклассник",
          className: typeof item.className === "string" ? item.className : "",
          md: typeof item.md === "string" && /^\d{2}-\d{2}$/.test(item.md) ? item.md : "01-01"
        }))
    : [];

  const settings = createDefaultSettings(
    rawObj.settings && typeof rawObj.settings === "object" ? rawObj.settings : {}
  );

  return { notices, duties, birthdays, settings };
}

function saveState(stateObj) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateObj));
  } catch (err) {
    console.warn("Не удалось сохранить данные в localStorage:", err);
  }
}

function loadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.warn("Доступ к localStorage ограничен:", err);
    return createDemoState();
  }

  // Первый визит: ключа ещё нет — предзаполняем демо-набором Москвы
  if (raw === null) {
    const initial = createDemoState();
    saveState(initial);
    return initial;
  }

  // Защитное чтение: битый JSON не роняет приложение
  try {
    const parsed = JSON.parse(raw);
    return sanitizeStoredState(parsed);
  } catch (err) {
    console.warn("Повреждённый JSON в localStorage, показано пустое состояние:", err);
    return createEmptyState();
  }
}

/* =========================================================
   ФОРМАТИРОВАНИЕ ДАТ, СОЗДАНИЕ DOM И РЕНДЕРИНГ ИНТЕРФЕЙСА
   ========================================================= */

function createSvgIcon(symbolId, extraClass = "") {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", extraClass ? `icon ${extraClass}` : "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#${symbolId}`);
  svg.appendChild(use);
  return svg;
}

function getDaysInMonth(monthNumber) {
  const daysByMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return daysByMonth[monthNumber - 1] || 31;
}

function formatFullTodayLabel(date = new Date()) {
  const weekday = WEEKDAY_NAMES[getTodayJsWeekday(date)] || "";
  const day = date.getDate();
  const month = MONTH_GENITIVE[date.getMonth()] || "";
  const year = date.getFullYear();
  return `${weekday}, ${day} ${month} ${year}`;
}

function formatShortIsoDate(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate || "Без даты";
  const parts = isoDate.split("-");
  const monthIdx = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  const monthName = MONTH_GENITIVE[monthIdx] || parts[1];
  return `${day} ${monthName}`;
}

function formatMonthDay(md) {
  if (!/^\d{2}-\d{2}$/.test(md)) return md;
  const parts = md.split("-");
  const monthIdx = Number(parts[0]) - 1;
  const day = Number(parts[1]);
  const monthName = MONTH_GENITIVE[monthIdx] || parts[0];
  return `${day} ${monthName}`;
}

function daysUntilBirthday(md, baseDate = new Date()) {
  const parts = md.split("-");
  const month = Number(parts[0]) - 1;
  const day = Number(parts[1]);
  const todayStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  let target = new Date(baseDate.getFullYear(), month, day);
  if (target < todayStart) {
    target = new Date(baseDate.getFullYear() + 1, month, day);
  }
  return Math.round((target.getTime() - todayStart.getTime()) / 86400000);
}

function createEmptyStateBlock(titleText, descText) {
  const wrap = document.createElement("div");
  wrap.className = "empty-state";
  const title = document.createElement("p");
  title.className = "empty-state__title";
  title.textContent = titleText;
  const desc = document.createElement("p");
  desc.className = "empty-state__desc";
  desc.textContent = descText;
  wrap.append(title, desc);
  return wrap;
}

function initApp() {
  const lgEngine = initLiquidGlassEngine();
  let state = loadState();
  let noticeFilter = "active";
  let selectedBirthdayMonth = new Date().getMonth() + 1;
  let latestNoticeId = null;
  let activeSheetMode = null;
  let lastTriggerEl = null;

  // Публичная ссылка для быстрой проверки состояния в DevTools Console
  window.classHqState = state;
  window.notices = state.notices;

  const todayDateLabelEl = document.getElementById("today-date-label");
  const todayWeekdayBadgeEl = document.getElementById("today-weekday-badge");
  const todayDutyBodyEl = document.getElementById("today-duty-body");
  const editTodayDutyBtn = document.getElementById("edit-today-duty-btn");
  const upcomingBirthdaysBodyEl = document.getElementById("upcoming-birthdays-body");

  const dutiesGridEl = document.getElementById("duties-grid");
  const workdays5Btn = document.getElementById("workdays-5-btn");
  const workdays6Btn = document.getElementById("workdays-6-btn");

  const noticesListEl = document.getElementById("notices-list");
  const noticesActiveBtn = document.getElementById("notices-active-btn");
  const noticesArchiveBtn = document.getElementById("notices-archive-btn");
  const noticesActiveCountEl = document.getElementById("notices-active-count");
  const noticesArchiveCountEl = document.getElementById("notices-archive-count");

  const birthdaysListEl = document.getElementById("birthdays-list");
  const birthdayMonthSelect = document.getElementById("birthday-month-select");

  const themeToggleBtn = document.getElementById("theme-toggle");
  const glassReduceBtn = document.getElementById("lg-reduce-toggle");
  const clearDataBtn = document.getElementById("clear-data-btn");
  const restoreDemoBtn = document.getElementById("restore-demo-btn");
  const statusAnnouncerEl = document.getElementById("status-announcer");

  const openNoticeSheetBtn = document.getElementById("open-notice-sheet-btn");
  const openDutySheetBtn = document.getElementById("open-duty-sheet-btn");
  const openBirthdaySheetBtn = document.getElementById("open-birthday-sheet-btn");

  const sheetBackdropEl = document.getElementById("sheet-backdrop");
  const sheetDialogEl = document.getElementById("sheet-dialog");
  const sheetTitleEl = document.getElementById("sheet-title");
  const sheetCloseBtn = document.getElementById("sheet-close-btn");

  const noticeForm = document.getElementById("notice-form");
  const noticeEditIdInput = document.getElementById("notice-edit-id");
  const noticeTitleInput = document.getElementById("notice-title-input");
  const noticeBodyInput = document.getElementById("notice-body-input");
  const noticeDateInput = document.getElementById("notice-date-input");
  const noticeTitleCountEl = document.getElementById("notice-title-count");
  const noticeBodyCountEl = document.getElementById("notice-body-count");
  const noticeTitleErrorEl = document.getElementById("notice-title-error");
  const noticeBodyErrorEl = document.getElementById("notice-body-error");
  const noticeDateErrorEl = document.getElementById("notice-date-error");
  const noticeSubmitBtn = document.getElementById("notice-submit-btn");

  const dutyForm = document.getElementById("duty-form");
  const dutyWeekdaySelect = document.getElementById("duty-weekday-select");
  const dutyFirstInput = document.getElementById("duty-first-input");
  const dutySecondInput = document.getElementById("duty-second-input");
  const dutyWeekdayErrorEl = document.getElementById("duty-weekday-error");
  const dutyFirstErrorEl = document.getElementById("duty-first-error");
  const dutySecondErrorEl = document.getElementById("duty-second-error");

  const birthdayForm = document.getElementById("birthday-form");
  const birthdayNameInput = document.getElementById("birthday-name-input");
  const birthdayClassInput = document.getElementById("birthday-class-input");
  const birthdayMonthInput = document.getElementById("birthday-month-input");
  const birthdayDayInput = document.getElementById("birthday-day-input");
  const birthdayNameErrorEl = document.getElementById("birthday-name-error");
  const birthdayClassErrorEl = document.getElementById("birthday-class-error");
  const birthdayDateErrorEl = document.getElementById("birthday-date-error");

  function announce(message) {
    if (!statusAnnouncerEl) return;
    statusAnnouncerEl.textContent = "";
    requestAnimationFrame(() => {
      statusAnnouncerEl.textContent = message;
    });
  }

  function populateMonthSelects() {
    [birthdayMonthSelect, birthdayMonthInput].forEach((selectEl) => {
      if (!selectEl) return;
      selectEl.innerHTML = "";
      MONTH_NAMES.forEach((monthName, idx) => {
        const option = document.createElement("option");
        option.value = String(idx + 1);
        option.textContent = monthName;
        selectEl.appendChild(option);
      });
    });
  }

  function syncThemeAndGlassUI() {
    const isDark = state.settings.theme === "dark";
    const isGlassOff = state.settings.glass === "off";

    document.documentElement.setAttribute("data-theme", state.settings.theme);
    document.documentElement.setAttribute("data-glass", state.settings.glass);

    if (themeToggleBtn) {
      themeToggleBtn.setAttribute(
        "aria-label",
        isDark ? "Включить светлую тему" : "Включить тёмную тему"
      );
    }

    if (glassReduceBtn) {
      glassReduceBtn.setAttribute("aria-pressed", String(isGlassOff));
      glassReduceBtn.setAttribute(
        "aria-label",
        isGlassOff ? "Вернуть прозрачность стекла" : "Уменьшить прозрачность стекла"
      );
    }

    lgEngine.syncAll();
  }

  function syncCounters() {
    if (noticeTitleInput && noticeTitleCountEl) {
      const len = noticeTitleInput.value.trim().length;
      noticeTitleCountEl.textContent = `${len} / ${NOTICE_TITLE_LIMIT}`;
      noticeTitleCountEl.classList.toggle("is-over", len > NOTICE_TITLE_LIMIT);
    }
    if (noticeBodyInput && noticeBodyCountEl) {
      const len = noticeBodyInput.value.trim().length;
      noticeBodyCountEl.textContent = `${len} / ${NOTICE_BODY_LIMIT}`;
      noticeBodyCountEl.classList.toggle("is-over", len > NOTICE_BODY_LIMIT);
    }
  }

  function renderTodaySummary(now = new Date()) {
    const todayJsWeekday = getTodayJsWeekday(now);
    if (todayDateLabelEl) {
      todayDateLabelEl.textContent = formatFullTodayLabel(now);
    }
    if (todayWeekdayBadgeEl) {
      todayWeekdayBadgeEl.textContent = WEEKDAY_NAMES[todayJsWeekday] || "";
    }

    if (todayDutyBodyEl) {
      todayDutyBodyEl.innerHTML = "";
      const isWeekend =
        todayJsWeekday === 0 || (todayJsWeekday === 6 && state.settings.workdays === 5);

      if (isWeekend) {
        const mondayDuty = state.duties.find((d) => d.weekday === 1);
        const mondayNames = mondayDuty
          ? mondayDuty.names.filter(Boolean).join(" и ")
          : "";
        const heading = document.createElement("p");
        heading.className = "today-duty-names";
        heading.textContent = "Сегодня выходной";
        const note = document.createElement("p");
        note.className = "today-duty-note";
        note.textContent = mondayNames
          ? `Ближайшие дежурные в понедельник: ${mondayNames}.`
          : "Ближайшее дежурство — в понедельник. Нажмите «Изменить», чтобы назначить пару.";
        todayDutyBodyEl.append(heading, note);
      } else {
        const entry = state.duties.find((d) => d.weekday === todayJsWeekday);
        const activeNames = entry ? entry.names.filter(Boolean) : [];
        const namesEl = document.createElement("p");
        namesEl.className = "today-duty-names";
        namesEl.textContent =
          activeNames.length > 0 ? activeNames.join(" и ") : "Дежурные не назначены";
        const note = document.createElement("p");
        note.className = "today-duty-note";
        note.textContent =
          activeNames.length > 0
            ? "Ответственные за порядок в кабинете и готовность к урокам сегодня."
            : "Нажмите «Изменить», чтобы назначить двух дежурных на сегодня.";
        todayDutyBodyEl.append(namesEl, note);
      }
    }

    if (upcomingBirthdaysBodyEl) {
      upcomingBirthdaysBodyEl.innerHTML = "";
      if (state.birthdays.length === 0) {
        const emptyNote = document.createElement("p");
        emptyNote.className = "today-duty-note";
        emptyNote.textContent =
          "Список именинников пока пуст. Добавьте записи через кнопку внизу.";
        upcomingBirthdaysBodyEl.appendChild(emptyNote);
      } else {
        const sorted = state.birthdays
          .slice()
          .sort((a, b) => daysUntilBirthday(a.md, now) - daysUntilBirthday(b.md, now))
          .slice(0, 3);
        const list = document.createElement("ul");
        list.className = "upcoming-list";
        sorted.forEach((person) => {
          const item = document.createElement("li");
          item.className = "upcoming-item";

          const nameSpan = document.createElement("span");
          nameSpan.className = "upcoming-item__name";
          nameSpan.textContent = person.className
            ? `${person.name} (${person.className})`
            : person.name;

          const diff = daysUntilBirthday(person.md, now);
          const dateSpan = document.createElement("span");
          dateSpan.className = "upcoming-item__date";
          if (diff === 0) dateSpan.textContent = "Сегодня";
          else if (diff === 1) dateSpan.textContent = "Завтра";
          else dateSpan.textContent = formatMonthDay(person.md);

          item.append(nameSpan, dateSpan);
          list.appendChild(item);
        });
        upcomingBirthdaysBodyEl.appendChild(list);
      }
    }
  }

  function renderDuties(now = new Date()) {
    if (!dutiesGridEl) return;
    const todayJsWeekday = getTodayJsWeekday(now);
    const workdays = state.settings.workdays;

    dutiesGridEl.style.setProperty("--workdays", String(workdays));
    if (workdays5Btn && workdays6Btn) {
      workdays5Btn.classList.toggle("is-active", workdays === 5);
      workdays5Btn.setAttribute("aria-pressed", String(workdays === 5));
      workdays6Btn.classList.toggle("is-active", workdays === 6);
      workdays6Btn.setAttribute("aria-pressed", String(workdays === 6));
    }

    dutiesGridEl.innerHTML = "";
    for (let weekday = 1; weekday <= workdays; weekday += 1) {
      const entry = state.duties.find((d) => d.weekday === weekday) || {
        weekday,
        names: ["", ""]
      };
      const isToday = weekday === todayJsWeekday;

      const card = document.createElement("article");
      card.className = isToday ? "duty-day-card is-today" : "duty-day-card";
      if (isToday) {
        card.setAttribute("aria-current", "date");
      }

      const head = document.createElement("div");
      head.className = "duty-day-card__head";
      const title = document.createElement("h3");
      title.className = "duty-day-card__name";
      title.textContent = WEEKDAY_NAMES[weekday];
      head.appendChild(title);

      if (isToday) {
        const pill = document.createElement("span");
        pill.className = "today-pill";
        pill.textContent = "Сегодня";
        head.appendChild(pill);
      }

      const list = document.createElement("ul");
      list.className = "duty-people";
      [0, 1].forEach((slotIdx) => {
        const name = (entry.names[slotIdx] || "").trim();
        const li = document.createElement("li");
        li.className = name ? "duty-person" : "duty-person duty-person--empty";
        li.textContent = name || `Дежурный ${slotIdx + 1}: не назначен`;
        list.appendChild(li);
      });

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-secondary btn-compact";
      editBtn.textContent = "Назначить";
      editBtn.setAttribute(
        "aria-label",
        `Назначить дежурных на ${WEEKDAY_NAMES[weekday].toLowerCase()}`
      );
      editBtn.addEventListener("click", () => {
        openSheet("duty", { weekday }, editBtn);
      });

      card.append(head, list, editBtn);
      dutiesGridEl.appendChild(card);
    }
  }

  function renderNotices() {
    if (!noticesListEl) return;
    const activeItems = state.notices.filter((item) => !item.archived);
    const archivedItems = state.notices.filter((item) => item.archived);

    if (noticesActiveCountEl) noticesActiveCountEl.textContent = String(activeItems.length);
    if (noticesArchiveCountEl) noticesArchiveCountEl.textContent = String(archivedItems.length);

    if (noticesActiveBtn && noticesArchiveBtn) {
      noticesActiveBtn.classList.toggle("is-active", noticeFilter === "active");
      noticesActiveBtn.setAttribute("aria-pressed", String(noticeFilter === "active"));
      noticesArchiveBtn.classList.toggle("is-active", noticeFilter === "archive");
      noticesArchiveBtn.setAttribute("aria-pressed", String(noticeFilter === "archive"));
    }

    const visibleItems = noticeFilter === "archive" ? archivedItems : activeItems;
    noticesListEl.innerHTML = "";

    if (visibleItems.length === 0) {
      const emptyBlock =
        noticeFilter === "archive"
          ? createEmptyStateBlock(
              "Архив объявлений пуст",
              "Сюда попадают завершённые объявления после нажатия «В архив»."
            )
          : createEmptyStateBlock(
              "Актуальных объявлений пока нет",
              "Нажмите «Объявление» на нижней панели, чтобы опубликовать новость или поручение для класса."
            );
      noticesListEl.appendChild(emptyBlock);
      return;
    }

    visibleItems.forEach((notice) => {
      const card = document.createElement("article");
      card.className =
        notice.id === latestNoticeId ? "notice-card is-entering" : "notice-card";

      const top = document.createElement("div");
      top.className = "notice-card__top";

      const title = document.createElement("h3");
      title.className = "notice-card__title";
      title.textContent = notice.title;

      const dateBadge = document.createElement("span");
      dateBadge.className = "notice-card__date";
      dateBadge.textContent = formatShortIsoDate(notice.date);
      top.append(title, dateBadge);

      const body = document.createElement("p");
      body.className = "notice-card__body";
      body.textContent = notice.body;

      const actions = document.createElement("div");
      actions.className = "notice-card__actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-secondary btn-compact";
      editBtn.append(
        createSvgIcon("icon-edit", "icon--sm"),
        document.createTextNode("Изменить")
      );
      editBtn.addEventListener("click", () => {
        openSheet("notice", { notice }, editBtn);
      });

      const archiveBtn = document.createElement("button");
      archiveBtn.type = "button";
      archiveBtn.className = "btn-secondary btn-compact";
      archiveBtn.append(
        createSvgIcon("icon-archive", "icon--sm"),
        document.createTextNode(notice.archived ? "Вернуть" : "В архив")
      );
      archiveBtn.addEventListener("click", () => {
        state.notices = state.notices.map((item) =>
          item.id === notice.id ? { ...item, archived: !item.archived } : item
        );
        window.notices = state.notices;
        saveState(state);
        renderNotices();
        announce(
          notice.archived
            ? "Объявление возвращено в актуальные"
            : "Объявление перенесено в архив"
        );
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-secondary btn-compact btn-danger-soft";
      deleteBtn.append(
        createSvgIcon("icon-trash", "icon--sm"),
        document.createTextNode("Удалить")
      );
      deleteBtn.addEventListener("click", () => {
        state.notices = state.notices.filter((item) => item.id !== notice.id);
        window.notices = state.notices;
        saveState(state);
        renderNotices();
        announce("Объявление удалено");
      });

      actions.append(editBtn, archiveBtn, deleteBtn);
      card.append(top, body, actions);
      noticesListEl.appendChild(card);
    });

    latestNoticeId = null;
  }

  function renderBirthdays(now = new Date()) {
    if (!birthdaysListEl) return;
    if (birthdayMonthSelect) {
      birthdayMonthSelect.value = String(selectedBirthdayMonth);
    }

    const todayMd = toMonthDay(now);
    const filtered = state.birthdays
      .filter((item) => Number(item.md.split("-")[0]) === selectedBirthdayMonth)
      .slice()
      .sort((a, b) => Number(a.md.split("-")[1]) - Number(b.md.split("-")[1]));

    birthdaysListEl.innerHTML = "";
    if (filtered.length === 0) {
      birthdaysListEl.appendChild(
        createEmptyStateBlock(
          `В месяце «${MONTH_NAMES[selectedBirthdayMonth - 1]}» именинников нет`,
          "Выберите другой месяц или добавьте день рождения через кнопку внизу."
        )
      );
      return;
    }

    filtered.forEach((person) => {
      const isToday = person.md === todayMd;
      const item = document.createElement("article");
      item.className = isToday ? "birthday-item is-today" : "birthday-item";

      const info = document.createElement("div");
      info.className = "birthday-item__info";
      const nameEl = document.createElement("h3");
      nameEl.className = "birthday-item__name";
      nameEl.textContent = person.name;
      const metaEl = document.createElement("p");
      metaEl.className = "birthday-item__meta";
      metaEl.textContent = person.className
        ? `${formatMonthDay(person.md)} · ${person.className}`
        : formatMonthDay(person.md);
      info.append(nameEl, metaEl);

      const actions = document.createElement("div");
      actions.className = "birthday-item__actions";
      if (isToday) {
        const badge = document.createElement("span");
        badge.className = "today-pill";
        badge.textContent = "Сегодня";
        actions.appendChild(badge);
      }

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-icon-soft btn-danger-soft";
      deleteBtn.setAttribute("aria-label", `Удалить день рождения: ${person.name}`);
      deleteBtn.appendChild(createSvgIcon("icon-trash", "icon--sm"));
      deleteBtn.addEventListener("click", () => {
        state.birthdays = state.birthdays.filter((b) => b.id !== person.id);
        saveState(state);
        renderAll();
        announce(`Запись о дне рождения удалена: ${person.name}`);
      });

      actions.appendChild(deleteBtn);
      item.append(info, actions);
      birthdaysListEl.appendChild(item);
    });
  }

  function renderAll() {
    const now = new Date();
    syncThemeAndGlassUI();
    renderTodaySummary(now);
    renderDuties(now);
    renderNotices();
    renderBirthdays(now);
  }

  function clearFieldError(inputEl, errorEl) {
    if (inputEl) inputEl.removeAttribute("aria-invalid");
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.hidden = true;
    }
  }

  function clearAllFormErrors() {
    clearFieldError(noticeTitleInput, noticeTitleErrorEl);
    clearFieldError(noticeBodyInput, noticeBodyErrorEl);
    clearFieldError(noticeDateInput, noticeDateErrorEl);
    clearFieldError(dutyWeekdaySelect, dutyWeekdayErrorEl);
    clearFieldError(dutyFirstInput, dutyFirstErrorEl);
    clearFieldError(dutySecondInput, dutySecondErrorEl);
    clearFieldError(birthdayNameInput, birthdayNameErrorEl);
    clearFieldError(birthdayClassInput, birthdayClassErrorEl);
    clearFieldError(birthdayDayInput, birthdayDateErrorEl);
  }

  function openSheet(mode, payload = {}, triggerEl = null) {
    if (!sheetDialogEl || !sheetBackdropEl) return;
    activeSheetMode = mode;
    lastTriggerEl = triggerEl || document.activeElement;
    clearAllFormErrors();

    [noticeForm, dutyForm, birthdayForm].forEach((f) => {
      if (f) f.hidden = true;
    });

    if (mode === "notice" && noticeForm) {
      const editing = payload.notice || null;
      sheetTitleEl.textContent = editing ? "Редактировать объявление" : "Новое объявление";
      noticeSubmitBtn.textContent = editing ? "Сохранить изменения" : "Опубликовать объявление";
      noticeEditIdInput.value = editing ? editing.id : "";
      noticeTitleInput.value = editing ? editing.title : "";
      noticeBodyInput.value = editing ? editing.body : "";
      noticeDateInput.value = editing ? editing.date : toIsoDate(new Date());
      syncCounters();
      noticeForm.hidden = false;
    } else if (mode === "duty" && dutyForm) {
      const defaultWd =
        payload.weekday ||
        (getTodayJsWeekday() >= 1 && getTodayJsWeekday() <= state.settings.workdays
          ? getTodayJsWeekday()
          : 1);
      const entry = state.duties.find((d) => d.weekday === defaultWd) || { names: ["", ""] };
      sheetTitleEl.textContent = "Назначить дежурных";
      dutyWeekdaySelect.value = String(defaultWd);
      dutyFirstInput.value = entry.names[0] || "";
      dutySecondInput.value = entry.names[1] || "";
      dutyForm.hidden = false;
    } else if (mode === "birthday" && birthdayForm) {
      sheetTitleEl.textContent = "Добавить день рождения";
      birthdayNameInput.value = "";
      birthdayClassInput.value = "";
      birthdayMonthInput.value = String(selectedBirthdayMonth);
      birthdayDayInput.value = "";
      birthdayForm.hidden = false;
    }

    sheetBackdropEl.hidden = false;
    sheetDialogEl.hidden = false;

    const activeForm =
      mode === "notice" ? noticeForm : mode === "duty" ? dutyForm : birthdayForm;
    const firstInput = activeForm
      ? activeForm.querySelector("input:not([type='hidden']), select, textarea")
      : sheetCloseBtn;
    if (firstInput) firstInput.focus();
  }

  function closeSheet() {
    if (!sheetDialogEl || !sheetBackdropEl || sheetDialogEl.hidden) return;
    sheetDialogEl.hidden = true;
    sheetBackdropEl.hidden = true;
    activeSheetMode = null;
    if (lastTriggerEl && typeof lastTriggerEl.focus === "function") {
      lastTriggerEl.focus();
    }
    lastTriggerEl = null;
  }

  if (dutyWeekdaySelect) {
    dutyWeekdaySelect.addEventListener("change", () => {
      const wd = Number(dutyWeekdaySelect.value);
      const entry = state.duties.find((d) => d.weekday === wd) || { names: ["", ""] };
      dutyFirstInput.value = entry.names[0] || "";
      dutySecondInput.value = entry.names[1] || "";
      clearFieldError(dutyFirstInput, dutyFirstErrorEl);
      clearFieldError(dutySecondInput, dutySecondErrorEl);
    });
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
      saveState(state);
      syncThemeAndGlassUI();
      announce(
        state.settings.theme === "dark" ? "Включена тёмная тема" : "Включена светлая тема"
      );
    });
  }

  if (glassReduceBtn) {
    glassReduceBtn.addEventListener("click", () => {
      state.settings.glass = state.settings.glass === "off" ? "on" : "off";
      saveState(state);
      syncThemeAndGlassUI();
      announce(
        state.settings.glass === "off"
          ? "Прозрачность стекла уменьшена"
          : "Эффект жидкого стекла включён"
      );
    });
  }

  [workdays5Btn, workdays6Btn].forEach((btn) => {
    if (!btn) return;
    btn.addEventListener("click", () => {
      const days = Number(btn.dataset.workdays) === 6 ? 6 : 5;
      state.settings.workdays = days;
      saveState(state);
      renderTodaySummary();
      renderDuties();
      announce(`Выбрана ${days}-дневная учебная неделя`);
    });
  });

  [noticesActiveBtn, noticesArchiveBtn].forEach((btn) => {
    if (!btn) return;
    btn.addEventListener("click", () => {
      noticeFilter = btn.dataset.noticeFilter === "archive" ? "archive" : "active";
      renderNotices();
    });
  });

  if (birthdayMonthSelect) {
    birthdayMonthSelect.addEventListener("change", () => {
      selectedBirthdayMonth = Number(birthdayMonthSelect.value) || 1;
      renderBirthdays();
    });
  }

  if (openNoticeSheetBtn) {
    openNoticeSheetBtn.addEventListener("click", () =>
      openSheet("notice", {}, openNoticeSheetBtn)
    );
  }
  if (openDutySheetBtn) {
    openDutySheetBtn.addEventListener("click", () =>
      openSheet("duty", {}, openDutySheetBtn)
    );
  }
  if (openBirthdaySheetBtn) {
    openBirthdaySheetBtn.addEventListener("click", () =>
      openSheet("birthday", {}, openBirthdaySheetBtn)
    );
  }
  if (editTodayDutyBtn) {
    editTodayDutyBtn.addEventListener("click", () => {
      const todayWd = getTodayJsWeekday();
      const targetWd =
        todayWd >= 1 && todayWd <= state.settings.workdays ? todayWd : 1;
      openSheet("duty", { weekday: targetWd }, editTodayDutyBtn);
    });
  }

  if (sheetCloseBtn) {
    sheetCloseBtn.addEventListener("click", closeSheet);
  }
  if (sheetBackdropEl) {
    sheetBackdropEl.addEventListener("click", closeSheet);
  }

  document.addEventListener("keydown", (e) => {
    if (!sheetDialogEl || sheetDialogEl.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeSheet();
      return;
    }
    if (e.key === "Tab") {
      const focusable = Array.from(
        sheetDialogEl.querySelectorAll(
          'button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  if (clearDataBtn) {
    clearDataBtn.addEventListener("click", () => {
      state = createEmptyState(state.settings);
      window.classHqState = state;
      window.notices = state.notices;
      saveState(state);
      renderAll();
      announce("Данные штаба очищены");
    });
  }

  if (restoreDemoBtn) {
    restoreDemoBtn.addEventListener("click", () => {
      state = createDemoState(state.settings);
      window.classHqState = state;
      window.notices = state.notices;
      saveState(state);
      renderAll();
      announce("Демо-данные штаба восстановлены");
    });
  }

  function showFieldError(inputEl, errorEl, message) {
    if (inputEl) inputEl.setAttribute("aria-invalid", "true");
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
  }

  function hasPhoneOrAddress(value) {
    const clean = String(value || "").trim();
    if (!clean) return false;
    const hasPhone =
      /(\+7|8)[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{2}[\s().-]*\d{2}/.test(clean) ||
      /(?:\d[\s()-]*){7,}/.test(clean);
    const hasAddress =
      /(?:^|[\s,;.(])(?:ул\.?|улица|просп\.?|пр-т|проспект|пер\.?|переулок|бул\.?|бульвар|шоссе|подъезд|кв\.?|квартира|дом|д\.\s*\d)/iu.test(
        clean
      );
    return hasPhone || hasAddress;
  }

  function isValidIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  if (noticeTitleInput) {
    noticeTitleInput.addEventListener("input", () => {
      syncCounters();
      clearFieldError(noticeTitleInput, noticeTitleErrorEl);
    });
  }
  if (noticeBodyInput) {
    noticeBodyInput.addEventListener("input", () => {
      syncCounters();
      clearFieldError(noticeBodyInput, noticeBodyErrorEl);
    });
  }
  if (noticeDateInput) {
    noticeDateInput.addEventListener("input", () =>
      clearFieldError(noticeDateInput, noticeDateErrorEl)
    );
  }

  if (dutyFirstInput) {
    dutyFirstInput.addEventListener("input", () =>
      clearFieldError(dutyFirstInput, dutyFirstErrorEl)
    );
  }
  if (dutySecondInput) {
    dutySecondInput.addEventListener("input", () =>
      clearFieldError(dutySecondInput, dutySecondErrorEl)
    );
  }

  if (birthdayNameInput) {
    birthdayNameInput.addEventListener("input", () =>
      clearFieldError(birthdayNameInput, birthdayNameErrorEl)
    );
  }
  if (birthdayClassInput) {
    birthdayClassInput.addEventListener("input", () =>
      clearFieldError(birthdayClassInput, birthdayClassErrorEl)
    );
  }
  if (birthdayDayInput) {
    birthdayDayInput.addEventListener("input", () =>
      clearFieldError(birthdayDayInput, birthdayDateErrorEl)
    );
  }

  if (noticeForm) {
    noticeForm.addEventListener("submit", (event) => {
      event.preventDefault();
      clearAllFormErrors();

      const editId = noticeEditIdInput.value.trim();
      const title = noticeTitleInput.value.trim();
      const body = noticeBodyInput.value.trim();
      const date = noticeDateInput.value.trim();
      let firstInvalid = null;

      if (!title) {
        showFieldError(
          noticeTitleInput,
          noticeTitleErrorEl,
          "Введите заголовок объявления, чтобы одноклассники сразу поняли тему."
        );
        firstInvalid = firstInvalid || noticeTitleInput;
      } else if (title.length > NOTICE_TITLE_LIMIT) {
        showFieldError(
          noticeTitleInput,
          noticeTitleErrorEl,
          `Сократите заголовок до ${NOTICE_TITLE_LIMIT} символов (сейчас ${title.length}).`
        );
        firstInvalid = firstInvalid || noticeTitleInput;
      } else if (hasPhoneOrAddress(title)) {
        showFieldError(
          noticeTitleInput,
          noticeTitleErrorEl,
          "Уберите номер телефона или домашний адрес из заголовка."
        );
        firstInvalid = firstInvalid || noticeTitleInput;
      }

      if (!body) {
        showFieldError(
          noticeBodyInput,
          noticeBodyErrorEl,
          "Добавьте подробности объявления, например номер кабинета или время."
        );
        firstInvalid = firstInvalid || noticeBodyInput;
      } else if (body.length > NOTICE_BODY_LIMIT) {
        showFieldError(
          noticeBodyInput,
          noticeBodyErrorEl,
          `Сократите текст объявления до ${NOTICE_BODY_LIMIT} символов (сейчас ${body.length}).`
        );
        firstInvalid = firstInvalid || noticeBodyInput;
      } else if (hasPhoneOrAddress(body)) {
        showFieldError(
          noticeBodyInput,
          noticeBodyErrorEl,
          "Уберите номер телефона или домашний адрес из текста объявления."
        );
        firstInvalid = firstInvalid || noticeBodyInput;
      }

      if (!isValidIsoDate(date)) {
        showFieldError(
          noticeDateInput,
          noticeDateErrorEl,
          "Укажите корректную дату события."
        );
        firstInvalid = firstInvalid || noticeDateInput;
      }

      if (firstInvalid) {
        firstInvalid.focus();
        return;
      }

      if (editId) {
        state.notices = state.notices.map((item) =>
          item.id === editId ? { ...item, title, body, date } : item
        );
        latestNoticeId = editId;
        announce("Объявление обновлено");
      } else {
        const newId = `n-${Date.now()}`;
        state.notices.unshift({
          id: newId,
          title,
          body,
          date,
          archived: false
        });
        latestNoticeId = newId;
        noticeFilter = "active";
        announce("Новое объявление добавлено");
      }

      window.notices = state.notices;
      saveState(state);
      noticeForm.reset();
      noticeEditIdInput.value = "";
      syncCounters();
      renderAll();
      closeSheet();
    });
  }

  if (dutyForm) {
    dutyForm.addEventListener("submit", (event) => {
      event.preventDefault();
      clearAllFormErrors();

      const weekday = Number(dutyWeekdaySelect.value);
      const firstName = dutyFirstInput.value.trim();
      const secondName = dutySecondInput.value.trim();
      let firstInvalid = null;

      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 6) {
        showFieldError(
          dutyWeekdaySelect,
          dutyWeekdayErrorEl,
          "Выберите учебный день от понедельника до субботы."
        );
        firstInvalid = firstInvalid || dutyWeekdaySelect;
      }

      if (!firstName) {
        showFieldError(
          dutyFirstInput,
          dutyFirstErrorEl,
          "Укажите имя первого дежурного."
        );
        firstInvalid = firstInvalid || dutyFirstInput;
      } else if (firstName.length > 40) {
        showFieldError(
          dutyFirstInput,
          dutyFirstErrorEl,
          "Сократите имя первого дежурного до 40 символов."
        );
        firstInvalid = firstInvalid || dutyFirstInput;
      } else if (hasPhoneOrAddress(firstName)) {
        showFieldError(
          dutyFirstInput,
          dutyFirstErrorEl,
          "Нельзя указывать телефон или адрес в имени дежурного."
        );
        firstInvalid = firstInvalid || dutyFirstInput;
      }

      if (!secondName) {
        showFieldError(
          dutySecondInput,
          dutySecondErrorEl,
          "Укажите имя второго дежурного (на каждый день назначается пара)."
        );
        firstInvalid = firstInvalid || dutySecondInput;
      } else if (secondName.length > 40) {
        showFieldError(
          dutySecondInput,
          dutySecondErrorEl,
          "Сократите имя второго дежурного до 40 символов."
        );
        firstInvalid = firstInvalid || dutySecondInput;
      } else if (hasPhoneOrAddress(secondName)) {
        showFieldError(
          dutySecondInput,
          dutySecondErrorEl,
          "Нельзя указывать телефон или адрес в имени дежурного."
        );
        firstInvalid = firstInvalid || dutySecondInput;
      }

      if (firstInvalid) {
        firstInvalid.focus();
        return;
      }

      state.duties = state.duties.map((entry) =>
        entry.weekday === weekday ? { weekday, names: [firstName, secondName] } : entry
      );
      if (weekday === 6 && state.settings.workdays === 5) {
        state.settings.workdays = 6;
      }

      saveState(state);
      dutyForm.reset();
      renderAll();
      closeSheet();
      announce(`Дежурные на ${WEEKDAY_NAMES[weekday].toLowerCase()} обновлены`);
    });
  }

  if (birthdayForm) {
    birthdayForm.addEventListener("submit", (event) => {
      event.preventDefault();
      clearAllFormErrors();

      const name = birthdayNameInput.value.trim();
      const className = birthdayClassInput.value.trim();
      const month = Number(birthdayMonthInput.value);
      const day = Number(birthdayDayInput.value.trim());
      const maxDays = getDaysInMonth(month);
      let firstInvalid = null;

      if (!name) {
        showFieldError(
          birthdayNameInput,
          birthdayNameErrorEl,
          "Введите имя и инициал одноклассника (например, София К.)."
        );
        firstInvalid = firstInvalid || birthdayNameInput;
      } else if (name.length > 40) {
        showFieldError(
          birthdayNameInput,
          birthdayNameErrorEl,
          "Сократите имя до 40 символов."
        );
        firstInvalid = firstInvalid || birthdayNameInput;
      } else if (hasPhoneOrAddress(name)) {
        showFieldError(
          birthdayNameInput,
          birthdayNameErrorEl,
          "Уберите номер телефона или домашний адрес из имени."
        );
        firstInvalid = firstInvalid || birthdayNameInput;
      }

      if (className.length > 10) {
        showFieldError(
          birthdayClassInput,
          birthdayClassErrorEl,
          "Сократите обозначение класса до 10 символов (например, 10А)."
        );
        firstInvalid = firstInvalid || birthdayClassInput;
      } else if (className && hasPhoneOrAddress(className)) {
        showFieldError(
          birthdayClassInput,
          birthdayClassErrorEl,
          "В поле класса нельзя указывать телефон или адрес."
        );
        firstInvalid = firstInvalid || birthdayClassInput;
      }

      if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > maxDays) {
        showFieldError(
          birthdayDayInput,
          birthdayDateErrorEl,
          `Укажите число от 1 до ${maxDays} для выбранного месяца.`
        );
        firstInvalid = firstInvalid || birthdayDayInput;
      }

      if (firstInvalid) {
        firstInvalid.focus();
        return;
      }

      const md = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      state.birthdays.push({
        id: `b-${Date.now()}`,
        name,
        className,
        md
      });
      selectedBirthdayMonth = month;

      saveState(state);
      birthdayForm.reset();
      renderAll();
      closeSheet();
      announce(`Добавлен день рождения: ${name}`);
    });
  }

  /* =========================================================
     ПОГОДА НА ЗАВТРА (OPEN-METEO) И ЦИТАТА (ADVICE SLIP)
     ========================================================= */

  // Фолбэк строго по спецификации P05 + резерв цитат на случай полной недоступности сети
  const FALLBACK_WEATHER = { tmax: 12, code: 2 };
  const FALLBACK_QUOTES = [
    "Порядок в классе начинается с одного понятного расписания.",
    "Маленькие ежедневные договорённости экономят часы всей команде.",
    "Хорошая подготовка к утру делает спокойным весь учебный день."
  ];
  let fallbackQuoteCursor = 0;

  const weatherBodyEl = document.getElementById("weather-body");
  const weatherUpdatedLabelEl = document.getElementById("weather-updated-label");
  const weatherRefreshBtn = document.getElementById("weather-refresh-btn");
  const headerWeatherTextEl = document.getElementById("header-weather-text");
  const headerWeatherIconEl = document.getElementById("header-weather-icon");

  const quoteBodyEl = document.getElementById("quote-body");
  const quoteRefreshBtn = document.getElementById("quote-refresh-btn");

  const WMO_MAP = {
    0: { label: "Ясно", icon: "icon-weather-sun" },
    1: { label: "Преимущественно ясно", icon: "icon-weather-partly" },
    2: { label: "Переменная облачность", icon: "icon-weather-partly" },
    3: { label: "Пасмурно", icon: "icon-weather-cloud" },
    45: { label: "Туман", icon: "icon-weather-cloud" },
    48: { label: "Изморозь и туман", icon: "icon-weather-cloud" },
    51: { label: "Лёгкая морось", icon: "icon-weather-rain" },
    53: { label: "Умеренная морось", icon: "icon-weather-rain" },
    55: { label: "Плотная морось", icon: "icon-weather-rain" },
    61: { label: "Небольшой дождь", icon: "icon-weather-rain" },
    63: { label: "Умеренный дождь", icon: "icon-weather-rain" },
    65: { label: "Сильный дождь", icon: "icon-weather-rain" },
    71: { label: "Небольшой снег", icon: "icon-weather-snow" },
    73: { label: "Умеренный снег", icon: "icon-weather-snow" },
    75: { label: "Сильный снегопад", icon: "icon-weather-snow" },
    77: { label: "Снежная крупа", icon: "icon-weather-snow" },
    80: { label: "Кратковременный дождь", icon: "icon-weather-rain" },
    81: { label: "Ливень", icon: "icon-weather-rain" },
    82: { label: "Сильный ливень", icon: "icon-weather-rain" },
    85: { label: "Небольшой снегопад", icon: "icon-weather-snow" },
    86: { label: "Сильный снегопад", icon: "icon-weather-snow" },
    95: { label: "Гроза", icon: "icon-weather-storm" },
    96: { label: "Гроза с градом", icon: "icon-weather-storm" },
    99: { label: "Сильная гроза с градом", icon: "icon-weather-storm" }
  };

  function describeWmoCode(code) {
    return WMO_MAP[Number(code)] || { label: "Переменная облачность", icon: "icon-weather-partly" };
  }

  function formatSignedTemp(temp) {
    const rounded = Math.round(Number(temp));
    return rounded > 0 ? `+${rounded}°` : `${rounded}°`;
  }

  function formatCurrentTime() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function renderWeatherState(viewState) {
    if (!weatherBodyEl) return;
    weatherBodyEl.innerHTML = "";

    if (viewState.status === "loading") {
      if (weatherUpdatedLabelEl) weatherUpdatedLabelEl.textContent = "Загружаем прогноз...";
      const s1 = document.createElement("div");
      s1.className = "skeleton-line skeleton-line--lg";
      const s2 = document.createElement("div");
      s2.className = "skeleton-line skeleton-line--md";
      weatherBodyEl.append(s1, s2);
      return;
    }

    if (viewState.status === "empty") {
      if (weatherUpdatedLabelEl) weatherUpdatedLabelEl.textContent = "Данных нет";
      const msg = document.createElement("p");
      msg.className = "weather-meta";
      msg.textContent = "Сервер вернул пустой прогноз на завтра. Попробуйте обновить чуть позже.";
      weatherBodyEl.appendChild(msg);
      return;
    }

    if (viewState.status === "error") {
      if (weatherUpdatedLabelEl) weatherUpdatedLabelEl.textContent = "Нет ответа от сервера";
      const msg = document.createElement("p");
      msg.className = "weather-meta";
      msg.textContent = "Не удалось загрузить прогноз погоды.";
      weatherBodyEl.appendChild(msg);
      return;
    }

    const data = viewState.data;
    const tempText = formatSignedTemp(data.tmax);
    const tminText = Number.isFinite(data.tmin) ? formatSignedTemp(data.tmin) : null;

    if (weatherUpdatedLabelEl) {
      weatherUpdatedLabelEl.textContent =
        viewState.status === "fallback"
          ? "Офлайн-резерв"
          : `Обновлено в ${data.updatedAt}`;
    }

    if (headerWeatherTextEl) {
      headerWeatherTextEl.textContent = tempText;
    }
    if (headerWeatherIconEl) {
      const useEl = headerWeatherIconEl.querySelector("use");
      if (useEl) useEl.setAttribute("href", `#${data.icon}`);
    }

    const mainRow = document.createElement("div");
    mainRow.className = "weather-main";

    const tempBox = document.createElement("div");
    tempBox.className = "weather-temp-box";
    tempBox.append(createSvgIcon(data.icon, "weather-hero-icon"));
    const tempVal = document.createElement("span");
    tempVal.className = "weather-temp";
    tempVal.textContent = tempText;
    tempBox.appendChild(tempVal);

    const details = document.createElement("div");
    details.className = "weather-details";
    const desc = document.createElement("p");
    desc.className = "weather-desc";
    desc.textContent = data.description;
    const meta = document.createElement("p");
    meta.className = "weather-meta";
    const metaParts = [];
    if (tminText !== null) metaParts.push(`ночью до ${tminText}`);
    if (Number.isFinite(data.precipProb)) metaParts.push(`вероятность осадков ${data.precipProb}%`);
    meta.textContent = metaParts.join(" · ") || "Прогноз на завтра по Москве";
    details.append(desc, meta);

    mainRow.append(tempBox, details);

    const verdict = document.createElement("div");
    verdict.className = data.yardOk ? "status-pill status-pill--ok" : "status-pill status-pill--warn";
    verdict.textContent = data.yardOk
      ? "Линейка во дворе: погода подходит"
      : "Линейку лучше провести в актовом зале";

    weatherBodyEl.append(mainRow, verdict);

    if (viewState.status === "fallback") {
      const fbBanner = document.createElement("div");
      fbBanner.className = "fallback-banner";
      fbBanner.append(createSvgIcon("icon-wifi-off", "icon--sm"));
      const fbText = document.createElement("span");
      fbText.textContent = "Данные из сохранённой копии (нет подключения к сети).";
      fbBanner.appendChild(fbText);
      weatherBodyEl.appendChild(fbBanner);
    }
  }

  function renderQuoteState(viewState) {
    if (!quoteBodyEl) return;
    quoteBodyEl.innerHTML = "";

    if (viewState.status === "loading") {
      const s = document.createElement("div");
      s.className = "skeleton-line skeleton-line--md";
      quoteBodyEl.appendChild(s);
      return;
    }

    if (viewState.status === "empty") {
      const msg = document.createElement("p");
      msg.className = "quote-source";
      msg.textContent = "Цитата дня пока не пришла.";
      quoteBodyEl.appendChild(msg);
      return;
    }

    const quoteText = document.createElement("p");
    quoteText.className = "quote-text";
    quoteText.textContent = `«${viewState.text}»`;
    const quoteSource = document.createElement("p");
    quoteSource.className = "quote-source";
    quoteSource.textContent =
      viewState.status === "fallback"
        ? "Из сохранённой копии (нет сети)"
        : "Источник: Advice Slip API";
    quoteBodyEl.append(quoteText, quoteSource);
  }

  async function loadLocalFallbackJson() {
    try {
      const response = await fetch("data/fallback.json", { cache: "no-store" });
      if (!response.ok) return null;
      return await response.json();
    } catch (err) {
      return null;
    }
  }

  function buildWeatherViewFromCompact(compact) {
    const tmax = Number.isFinite(Number(compact?.tmax)) ? Number(compact.tmax) : FALLBACK_WEATHER.tmax;
    const tmin = Number.isFinite(Number(compact?.tmin)) ? Number(compact.tmin) : NaN;
    const code = Number.isFinite(Number(compact?.code)) ? Number(compact.code) : FALLBACK_WEATHER.code;
    const precipProb = Number.isFinite(Number(compact?.precipProb))
      ? Number(compact.precipProb)
      : NaN;
    const wmo = describeWmoCode(code);
    const yardOk = tmax >= 5 && code <= 3 && (!Number.isFinite(precipProb) || precipProb < 40);
    return {
      tmax,
      tmin,
      code,
      precipProb,
      description: wmo.label,
      icon: wmo.icon,
      yardOk,
      updatedAt: formatCurrentTime()
    };
  }

  async function loadWeather() {
    if (weatherRefreshBtn) weatherRefreshBtn.disabled = true;
    renderWeatherState({ status: "loading" });

    const lat = state.settings.lat;
    const lon = state.settings.lon;
    const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2`;

    try {
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`Open-Meteo HTTP ${response.status}`);
      }
      const raw = await response.json();
      const daily = raw && raw.daily;
      if (!daily || !Array.isArray(daily.temperature_2m_max) || daily.temperature_2m_max.length === 0) {
        renderWeatherState({ status: "empty" });
        return;
      }

      const idx = daily.temperature_2m_max.length > 1 ? 1 : 0;
      const tmax = Number(daily.temperature_2m_max[idx]);
      const tmin = Array.isArray(daily.temperature_2m_min) ? Number(daily.temperature_2m_min[idx]) : NaN;
      const code = Array.isArray(daily.weathercode) ? Number(daily.weathercode[idx]) : 2;
      const precipProb = Array.isArray(daily.precipitation_probability_max)
        ? Number(daily.precipitation_probability_max[idx])
        : NaN;

      if (!Number.isFinite(tmax)) {
        renderWeatherState({ status: "empty" });
        return;
      }

      renderWeatherState({
        status: "ready",
        data: buildWeatherViewFromCompact({ tmax, tmin, code, precipProb })
      });
    } catch (err) {
      console.warn("Сбой запроса Open-Meteo, переключаемся на фолбэк:", err);
      const fileFallback = await loadLocalFallbackJson();
      const compact =
        fileFallback && fileFallback.weather ? fileFallback.weather : FALLBACK_WEATHER;
      renderWeatherState({
        status: "fallback",
        data: buildWeatherViewFromCompact(compact)
      });
    } finally {
      if (weatherRefreshBtn) weatherRefreshBtn.disabled = false;
    }
  }

  async function loadQuote() {
    if (quoteRefreshBtn) quoteRefreshBtn.disabled = true;
    renderQuoteState({ status: "loading" });

    try {
      const response = await fetch("https://api.adviceslip.com/advice", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Advice Slip HTTP ${response.status}`);
      }
      const raw = await response.json();
      const text = raw && raw.slip && typeof raw.slip.advice === "string" ? raw.slip.advice.trim() : "";
      if (!text) {
        renderQuoteState({ status: "empty" });
        return;
      }
      renderQuoteState({ status: "ready", text });
    } catch (err) {
      console.warn("Сбой запроса Advice Slip, переключаемся на фолбэк:", err);
      const fileFallback = await loadLocalFallbackJson();
      const list =
        fileFallback && Array.isArray(fileFallback.quotes) && fileFallback.quotes.length > 0
          ? fileFallback.quotes.map((q) => q.text).filter(Boolean)
          : FALLBACK_QUOTES;
      const text = list[fallbackQuoteCursor % list.length] || FALLBACK_QUOTES[0];
      fallbackQuoteCursor += 1;
      renderQuoteState({ status: "fallback", text });
    } finally {
      if (quoteRefreshBtn) quoteRefreshBtn.disabled = false;
    }
  }

  if (weatherRefreshBtn) weatherRefreshBtn.addEventListener("click", loadWeather);
  if (quoteRefreshBtn) quoteRefreshBtn.addEventListener("click", loadQuote);

  populateMonthSelects();
  renderAll();
  loadWeather();
  loadQuote();
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initApp);
}
