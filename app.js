import { analyzeOrder, getActiveEngine, processAddressInput } from "./engine/engine.js";

const STORAGE_KEYS = {
  addressHistory: "riderHub.addressHistory.v1",
  orders: "riderHub.orders.v1",
};

const MAX_HISTORY_ITEMS = 10;
const EMPTY_SUMMARY = "Sin datos";
const VIEW_NAMES = ["inicio", "registrar", "resumen"];

const currencyFormatter = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const dateTimeFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
});

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

const state = {
  addressHistory: normalizeAddressHistory(readStorage(STORAGE_KEYS.addressHistory, [])),
  orders: normalizeOrders(readStorage(STORAGE_KEYS.orders, [])),
};

const elements = {
  enginePill: document.querySelector("#engine-pill"),
  views: Array.from(document.querySelectorAll(".view")),
  navButtons: Array.from(document.querySelectorAll(".nav-button")),
  addressInput: document.querySelector("#address-input"),
  clipboardOpenButton: document.querySelector("#clipboard-open-button"),
  openMapsButton: document.querySelector("#open-maps-button"),
  reopenLastButton: document.querySelector("#reopen-last-button"),
  historyList: document.querySelector("#history-list"),
  mapStatus: document.querySelector("#map-status"),
  orderForm: document.querySelector("#order-form"),
  orderStatus: document.querySelector("#order-status"),
  orderDateTime: document.querySelector("#order-datetime"),
  summaryRange: document.querySelector("#summary-range"),
  recentOrders: document.querySelector("#recent-orders"),
  statDayTotal: document.querySelector("#stat-day-total"),
  statDayCount: document.querySelector("#stat-day-count"),
  statDayAverage: document.querySelector("#stat-day-average"),
  statDayCash: document.querySelector("#stat-day-cash"),
  statDayTransfer: document.querySelector("#stat-day-transfer"),
  statWeekTotal: document.querySelector("#stat-week-total"),
  statHourly: document.querySelector("#stat-hourly"),
  toastStack: document.querySelector("#toast-stack"),
};

init();

function init() {
  elements.enginePill.textContent = `Engine: ${getActiveEngine()}`;
  elements.orderDateTime.value = getDateTimeLocalValue();

  bindEvents();
  syncViewFromHash();
  renderHistory();
  renderSummary();
  registerServiceWorker();
}

function bindEvents() {
  elements.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      window.location.hash = button.dataset.view;
    });
  });

  window.addEventListener("hashchange", syncViewFromHash);

  elements.addressInput.addEventListener("blur", () => {
    elements.addressInput.value = processAddressInput(elements.addressInput.value);
  });

  elements.clipboardOpenButton.addEventListener("click", handleClipboardOpen);
  elements.openMapsButton.addEventListener("click", () => openMapsForAddress(elements.addressInput.value));
  elements.reopenLastButton.addEventListener("click", reopenLastAddress);
  elements.orderForm.addEventListener("submit", handleOrderSubmit);
}

function syncViewFromHash() {
  const hash = window.location.hash.replace("#", "").toLowerCase();
  const activeView = VIEW_NAMES.includes(hash) ? hash : "inicio";

  elements.views.forEach((view) => {
    const isActive = view.id === `view-${activeView}`;
    view.classList.toggle("is-active", isActive);
    view.hidden = !isActive;
  });

  elements.navButtons.forEach((button) => {
    const isActive = button.dataset.view === activeView;
    button.classList.toggle("is-active", isActive);

    if (isActive) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  if (activeView === "resumen") {
    renderSummary();
  }
}

async function handleClipboardOpen() {
  try {
    if (!navigator.clipboard || !window.isSecureContext) {
      throw new Error("Clipboard API no disponible");
    }

    const clipboardText = await navigator.clipboard.readText();
    const cleanedAddress = processAddressInput(clipboardText);

    if (!cleanedAddress) {
      setInlineStatus(elements.mapStatus, "El portapapeles no trae una dirección usable.", "warning");
      showToast("No encontré una dirección en el portapapeles.", "warning");
      elements.addressInput.focus();
      return;
    }

    elements.addressInput.value = cleanedAddress;
    setInlineStatus(elements.mapStatus, "Dirección leída del portapapeles.", "success");
    showToast("Dirección cargada desde el portapapeles.", "success");
    openMapsForAddress(cleanedAddress);
  } catch (error) {
    setInlineStatus(
      elements.mapStatus,
      "No pude leer el portapapeles. Pegá la dirección manualmente.",
      "warning"
    );
    showToast("Falló la lectura del portapapeles.", "warning");
    elements.addressInput.focus();
  }
}

function openMapsForAddress(inputText) {
  const cleanedAddress = processAddressInput(inputText);

  if (!cleanedAddress) {
    setInlineStatus(elements.mapStatus, "No hay una dirección para abrir.", "warning");
    showToast("Ingresá o pegá una dirección antes de abrir Maps.", "warning");
    elements.addressInput.focus();
    return;
  }

  elements.addressInput.value = cleanedAddress;

  const mapsUrl =
    "https://www.google.com/maps/dir/?api=1&destination=" +
    encodeURIComponent(cleanedAddress) +
    "&travelmode=bicycling";

  pushAddressToHistory(cleanedAddress);
  renderHistory();
  setInlineStatus(elements.mapStatus, "Abriendo Google Maps en modo bicicleta...", "success");
  showToast("Google Maps abierto en modo bicicleta.", "success");

  const externalWindow = window.open(mapsUrl, "_blank", "noopener,noreferrer");

  if (!externalWindow) {
    window.location.assign(mapsUrl);
  }
}

function reopenLastAddress() {
  const [lastAddress] = state.addressHistory;

  if (!lastAddress) {
    setInlineStatus(elements.mapStatus, "Todavía no abriste ninguna dirección.", "warning");
    showToast("No hay una dirección previa para reabrir.", "warning");
    return;
  }

  openMapsForAddress(lastAddress.address);
}

function pushAddressToHistory(address) {
  const loweredAddress = address.toLowerCase();
  const nextHistory = state.addressHistory.filter((item) => item.address.toLowerCase() !== loweredAddress);

  nextHistory.unshift({
    address,
    openedAt: new Date().toISOString(),
  });

  state.addressHistory = nextHistory.slice(0, MAX_HISTORY_ITEMS);
  writeStorage(STORAGE_KEYS.addressHistory, state.addressHistory);
}

function renderHistory() {
  elements.historyList.replaceChildren();
  elements.reopenLastButton.disabled = !state.addressHistory.length;

  if (!state.addressHistory.length) {
    elements.historyList.append(
      createEmptyState(
        "Todavía no abriste direcciones. Cuando uses Maps desde Rider Hub, van a aparecer acá."
      )
    );
    return;
  }

  state.addressHistory.forEach((item) => {
    const button = document.createElement("button");
    const content = document.createElement("span");
    const timestamp = document.createElement("span");

    button.type = "button";
    button.className = "history-button";
    button.addEventListener("click", () => openMapsForAddress(item.address));

    content.className = "history-address";
    content.textContent = item.address;

    timestamp.className = "history-time";
    timestamp.textContent = dateTimeFormatter.format(new Date(item.openedAt));

    button.append(content, timestamp);
    elements.historyList.append(button);
  });
}

function handleOrderSubmit(event) {
  event.preventDefault();

  const formData = new FormData(elements.orderForm);
  const amount = parseNumber(formData.get("amount"), { required: true, allowZero: false });
  const estimatedKm = parseNumber(formData.get("estimatedKm"));
  const estimatedMinutes = parseNumber(formData.get("estimatedMinutes"));
  const paymentMethod = sanitizeText(formData.get("paymentMethod"));
  const zone = sanitizeText(formData.get("zone"));
  const notes = sanitizeText(formData.get("notes"));
  const orderDateTime = sanitizeText(formData.get("orderDateTime"));

  if (amount == null || amount === false) {
    setInlineStatus(elements.orderStatus, "Ingresá un monto válido mayor a cero.", "danger");
    showToast("Revisá el monto del pedido.", "danger");
    elements.orderForm.querySelector("#amount").focus();
    return;
  }

  if (estimatedKm === false) {
    setInlineStatus(elements.orderStatus, "Los kilómetros deben ser un número válido.", "danger");
    showToast("Revisá los kilómetros estimados.", "danger");
    elements.orderForm.querySelector("#estimated-km").focus();
    return;
  }

  if (estimatedMinutes === false) {
    setInlineStatus(elements.orderStatus, "Los minutos deben ser un número válido.", "danger");
    showToast("Revisá los minutos estimados.", "danger");
    elements.orderForm.querySelector("#estimated-minutes").focus();
    return;
  }

  if (!["efectivo", "transferencia"].includes(paymentMethod)) {
    setInlineStatus(elements.orderStatus, "Elegí una forma de cobro válida.", "danger");
    showToast("Seleccioná una forma de cobro.", "danger");
    elements.orderForm.querySelector("#payment-method").focus();
    return;
  }

  if (!orderDateTime) {
    setInlineStatus(elements.orderStatus, "La fecha y hora son obligatorias.", "danger");
    showToast("Completá la fecha y hora del pedido.", "danger");
    elements.orderForm.querySelector("#order-datetime").focus();
    return;
  }

  const createdAt = new Date(orderDateTime);

  if (Number.isNaN(createdAt.getTime())) {
    setInlineStatus(elements.orderStatus, "La fecha y hora no tienen un formato válido.", "danger");
    showToast("La fecha y hora no son válidas.", "danger");
    elements.orderForm.querySelector("#order-datetime").focus();
    return;
  }

  const order = {
    id: `order-${createdAt.getTime()}-${Math.random().toString(16).slice(2, 8)}`,
    amount,
    estimatedKm: estimatedKm === false ? null : estimatedKm,
    estimatedMinutes: estimatedMinutes === false ? null : estimatedMinutes,
    zone,
    paymentMethod,
    notes,
    createdAt: createdAt.toISOString(),
  };

  const analysis = analyzeOrder(order);

  if (analysis && typeof analysis === "object" && Object.keys(analysis).length > 0) {
    order.analysis = analysis;
  }

  state.orders = sortOrdersDescending([order, ...state.orders]);
  writeStorage(STORAGE_KEYS.orders, state.orders);

  elements.orderForm.reset();
  elements.orderDateTime.value = getDateTimeLocalValue();
  setInlineStatus(elements.orderStatus, "Pedido guardado correctamente.", "success");
  showToast("Pedido guardado en el registro local.", "success");
  renderSummary();
}

function renderSummary() {
  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = addDays(dayStart, 1);
  const weekStart = getWeekStart(now);
  const weekEnd = addDays(weekStart, 7);

  const dayOrders = state.orders.filter((order) => isWithinRange(order.createdAt, dayStart, dayEnd));
  const weekOrders = state.orders.filter((order) => isWithinRange(order.createdAt, weekStart, weekEnd));

  const dayTotal = sumBy(dayOrders, (order) => order.amount);
  const dayCount = dayOrders.length;
  const dayAverage = dayCount ? dayTotal / dayCount : 0;
  const dayCash = sumBy(dayOrders, (order) =>
    order.paymentMethod === "efectivo" ? order.amount : 0
  );
  const dayTransfer = sumBy(dayOrders, (order) =>
    order.paymentMethod === "transferencia" ? order.amount : 0
  );
  const weekTotal = sumBy(weekOrders, (order) => order.amount);
  const totalDayMinutes = sumBy(dayOrders, (order) => order.estimatedMinutes || 0);
  const hourlyRate = totalDayMinutes > 0 ? dayTotal / (totalDayMinutes / 60) : null;

  elements.statDayTotal.textContent = formatMoney(dayTotal);
  elements.statDayCount.textContent = String(dayCount);
  elements.statDayAverage.textContent = formatMoney(dayAverage);
  elements.statDayCash.textContent = formatMoney(dayCash);
  elements.statDayTransfer.textContent = formatMoney(dayTransfer);
  elements.statWeekTotal.textContent = formatMoney(weekTotal);
  elements.statHourly.textContent = hourlyRate == null ? EMPTY_SUMMARY : formatMoney(hourlyRate);
  elements.summaryRange.textContent =
    `Semana actual · ${dateFormatter.format(weekStart)} al ${dateFormatter.format(addDays(weekEnd, -1))}`;

  renderRecentOrders();
}

function renderRecentOrders() {
  elements.recentOrders.replaceChildren();

  if (!state.orders.length) {
    elements.recentOrders.append(
      createEmptyState(
        "Todavía no guardaste pedidos. Empezá desde Registrar para construir tu resumen del día y de la semana."
      )
    );
    return;
  }

  state.orders.slice(0, 8).forEach((order) => {
    const item = document.createElement("article");
    const topLine = document.createElement("div");
    const amount = document.createElement("span");
    const badge = document.createElement("span");
    const meta = document.createElement("p");
    const details = document.createElement("p");
    const notes = document.createElement("p");

    item.className = "order-item";
    topLine.className = "order-topline";
    amount.className = "order-amount";
    badge.className = "order-badge";
    meta.className = "order-meta";
    details.className = "order-meta";
    notes.className = "order-notes";

    amount.textContent = formatMoney(order.amount);
    badge.textContent = order.paymentMethod === "efectivo" ? "Efectivo" : "Transferencia";
    meta.textContent =
      `${dateTimeFormatter.format(new Date(order.createdAt))} · ${order.zone || "Sin zona"}`;

    const detailTokens = [];

    if (Number.isFinite(order.estimatedKm)) {
      detailTokens.push(`${formatNumber(order.estimatedKm)} km`);
    }

    if (Number.isFinite(order.estimatedMinutes)) {
      detailTokens.push(`${formatNumber(order.estimatedMinutes)} min`);
    }

    details.textContent = detailTokens.length ? detailTokens.join(" · ") : "Sin métricas cargadas";

    if (order.notes) {
      notes.textContent = order.notes;
    }

    topLine.append(amount, badge);
    item.append(topLine, meta, details);

    if (order.notes) {
      item.append(notes);
    }

    elements.recentOrders.append(item);
  });
}

function setInlineStatus(element, message, tone = "default") {
  element.textContent = message;
  element.classList.remove("is-success", "is-warning", "is-danger");

  if (tone === "success") {
    element.classList.add("is-success");
  }

  if (tone === "warning") {
    element.classList.add("is-warning");
  }

  if (tone === "danger") {
    element.classList.add("is-danger");
  }
}

function showToast(message, tone = "default") {
  const toast = document.createElement("div");

  toast.className = "toast";

  if (tone !== "default") {
    toast.classList.add(`is-${tone}`);
  }

  toast.textContent = message;
  elements.toastStack.append(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 2800);
}

function createEmptyState(message) {
  const stateBlock = document.createElement("div");

  stateBlock.className = "empty-state";
  stateBlock.textContent = message;

  return stateBlock;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", async () => {
    try {
      const serviceWorkerUrl = new URL("./sw.js", window.location.href);
      const scopeUrl = new URL("./", window.location.href);

      await navigator.serviceWorker.register(serviceWorkerUrl.toString(), {
        scope: scopeUrl.pathname,
      });
    } catch (error) {
      console.error("No se pudo registrar el service worker.", error);
    }
  });
}

function readStorage(key, fallback) {
  try {
    const rawValue = window.localStorage.getItem(key);

    if (!rawValue) {
      return fallback;
    }

    const parsedValue = JSON.parse(rawValue);
    return Array.isArray(fallback) && Array.isArray(parsedValue) ? parsedValue : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    showToast("No pude guardar en el almacenamiento local de este navegador.", "warning");
    return false;
  }
}

function normalizeAddressHistory(items) {
  const seenAddresses = new Set();

  return items
    .map((item) => {
      const address = processAddressInput(item?.address);
      const openedAt = new Date(item?.openedAt);

      if (!address || Number.isNaN(openedAt.getTime())) {
        return null;
      }

      const lookupKey = address.toLowerCase();

      if (seenAddresses.has(lookupKey)) {
        return null;
      }

      seenAddresses.add(lookupKey);

      return {
        address,
        openedAt: openedAt.toISOString(),
      };
    })
    .filter(Boolean)
    .slice(0, MAX_HISTORY_ITEMS);
}

function normalizeOrders(items) {
  return sortOrdersDescending(
    items
      .map((item) => {
        const amount = Number(item?.amount);
        const createdAt = new Date(item?.createdAt);

        if (!Number.isFinite(amount) || amount <= 0 || Number.isNaN(createdAt.getTime())) {
          return null;
        }

        return {
          id: sanitizeText(item?.id) || `order-${createdAt.getTime()}`,
          amount,
          estimatedKm: normalizeOptionalNumber(item?.estimatedKm),
          estimatedMinutes: normalizeOptionalNumber(item?.estimatedMinutes),
          zone: sanitizeText(item?.zone),
          paymentMethod: item?.paymentMethod === "transferencia" ? "transferencia" : "efectivo",
          notes: sanitizeText(item?.notes),
          createdAt: createdAt.toISOString(),
        };
      })
      .filter(Boolean)
  );
}

function parseNumber(value, options = {}) {
  const normalizedValue = sanitizeText(value);

  if (!normalizedValue) {
    return options.required ? null : null;
  }

  const parsedNumber = Number(normalizedValue.replace(",", "."));
  const allowZero = options.allowZero !== false;

  if (!Number.isFinite(parsedNumber)) {
    return false;
  }

  if (allowZero ? parsedNumber < 0 : parsedNumber <= 0) {
    return false;
  }

  return parsedNumber;
}

function sanitizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : null;
}

function formatMoney(value) {
  return `$ ${currencyFormatter.format(value || 0)}`;
}

function formatNumber(value) {
  return currencyFormatter.format(value);
}

function startOfDay(date) {
  const nextDate = new Date(date);

  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function addDays(date, days) {
  const nextDate = new Date(date);

  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function getWeekStart(date) {
  const localStart = startOfDay(date);
  const day = localStart.getDay();
  const diff = day === 0 ? -6 : 1 - day;

  localStart.setDate(localStart.getDate() + diff);
  return localStart;
}

function isWithinRange(value, start, end) {
  const date = new Date(value);

  return date >= start && date < end;
}

function sumBy(collection, iteratee) {
  return collection.reduce((total, item) => total + Number(iteratee(item) || 0), 0);
}

function sortOrdersDescending(orders) {
  return [...orders].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

function getDateTimeLocalValue(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}
