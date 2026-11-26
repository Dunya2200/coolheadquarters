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

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    initLiquidGlassEngine();
  });
}
