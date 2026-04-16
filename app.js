import { getActiveEngine, processAddressInput } from "./engine/engine.js";

const STORAGE_KEYS = {
  addressHistory: "riderHub.addressHistory.v1",
  cashEntries: "riderHub.cashEntries.v2",
  legacyOrders: "riderHub.orders.v1",
};

const MAX_HISTORY_ITEMS = 10;
const CANONICAL_CITY = "Neuquén Capital, Neuquén, Argentina";
const VIEW_NAMES = ["maps", "efectivo"];
const RECENT_ENTRY_LIMIT = 10;
const FORBIDDEN_LOCALITIES = [
  { pattern: /\bcipolletti\b/, label: "Cipolletti" },
  { pattern: /\bplottier\b/, label: "Plottier" },
  { pattern: /\bcentenario\b/, label: "Centenario" },
  { pattern: /\bsenillosa\b/, label: "Senillosa" },
  { pattern: /\bfernandez oro\b/, label: "Fernández Oro" },
  { pattern: /\bcontralmirante cordero\b/, label: "Contralmirante Cordero" },
  { pattern: /\bcinco saltos\b/, label: "Cinco Saltos" },
  { pattern: /\ballen\b/, label: "Allen" },
  { pattern: /\bvista alegre\b/, label: "Vista Alegre" },
  { pattern: /\bel chocon\b/, label: "El Chocón" },
  { pattern: /\bcutral co\b/, label: "Cutral Co" },
  { pattern: /\bplaza huincul\b/, label: "Plaza Huincul" },
  { pattern: /\brio negro\b/, label: "Río Negro" },
  { pattern: /\bneuquen province\b/, label: "otra referencia fuera de la ciudad" },
  { pattern: /\bbuenos aires\b/, label: "Buenos Aires" },
  { pattern: /\bcaba\b/, label: "CABA" },
  { pattern: /\bcordoba\b/, label: "Córdoba" },
];

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
  cashEntries: [],
};

const elements = {
  views: Array.from(document.querySelectorAll(".view")),
  navButtons: Array.from(document.querySelectorAll(".nav-button")),
  addressInput: document.querySelector("#address-input"),
  clipboardOpenButton: document.querySelector("#clipboard-open-button"),
  openMapsButton: document.querySelector("#open-maps-button"),
  reopenLastButton: document.querySelector("#reopen-last-button"),
  historyList: document.querySelector("#history-list"),
  mapStatus: document.querySelector("#map-status"),
  cashForm: document.querySelector("#cash-form"),
  cashAmount: document.querySelector("#cash-amount"),
  cashDateTime: document.querySelector("#cash-datetime"),
  cashAddress: document.querySelector("#cash-address"),
  cashNotes: document.querySelector("#cash-notes"),
  cashStatus: document.querySelector("#cash-status"),
  useLastAddressButton: document.querySelector("#use-last-address-button"),
  addressSuggestions: document.querySelector("#address-suggestions"),
  summaryRange: document.querySelector("#cash-summary-range"),
  statDayTotal: document.querySelector("#stat-day-total"),
  statDayCount: document.querySelector("#stat-day-count"),
  statWeekTotal: document.querySelector("#stat-week-total"),
  cashList: document.querySelector("#cash-list"),
  exportPdfButton: document.querySelector("#export-pdf-button"),
  exportExcelButton: document.querySelector("#export-excel-button"),
  exportStatus: document.querySelector("#export-status"),
  toastStack: document.querySelector("#toast-stack"),
};

init();

function init() {
  state.cashEntries = loadCashEntries();
  elements.cashDateTime.value = getDateTimeLocalValue();

  bindEvents();
  syncViewFromHash();
  renderHistory();
  renderAddressSuggestions();
  renderCashView();
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

  elements.cashAddress.addEventListener("blur", () => {
    elements.cashAddress.value = processAddressInput(elements.cashAddress.value);
  });

  elements.clipboardOpenButton.addEventListener("click", handleClipboardOpen);
  elements.openMapsButton.addEventListener("click", () => openMapsForAddress(elements.addressInput.value));
  elements.reopenLastButton.addEventListener("click", reopenLastAddress);
  elements.useLastAddressButton.addEventListener("click", applyLastAddressToCashForm);
  elements.cashForm.addEventListener("submit", handleCashSubmit);
  elements.exportPdfButton.addEventListener("click", handleExportPdf);
  elements.exportExcelButton.addEventListener("click", handleExportExcel);
}

function syncViewFromHash() {
  const hash = window.location.hash.replace("#", "").toLowerCase();
  const activeView = VIEW_NAMES.includes(hash) ? hash : "maps";

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

  if (activeView === "efectivo") {
    renderCashView();
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

function openMapsForAddress(rawText) {
  const result = buildNeuqenDestination(rawText);

  if (!result.ok) {
    setInlineStatus(elements.mapStatus, result.reason, "danger");
    showToast(result.reason, "danger");
    elements.addressInput.focus();
    return false;
  }

  elements.addressInput.value = result.label;
  pushAddressToHistory(result.destination);
  renderHistory();
  renderAddressSuggestions();
  syncCashAddressWithLastOpened();

  const mapsUrl =
    "https://www.google.com/maps/dir/?api=1&destination=" +
    encodeURIComponent(result.destination) +
    "&travelmode=bicycling";

  setInlineStatus(elements.mapStatus, "Abriendo Google Maps en modo bicicleta...", "success");
  showToast("Google Maps abierto para Neuquén Capital.", "success");

  const externalWindow = window.open(mapsUrl, "_blank", "noopener,noreferrer");

  if (!externalWindow) {
    window.location.assign(mapsUrl);
  }

  return true;
}

function reopenLastAddress() {
  const [lastAddress] = state.addressHistory;

  if (!lastAddress) {
    const message = "Todavía no abriste ninguna dirección.";
    setInlineStatus(elements.mapStatus, message, "warning");
    showToast(message, "warning");
    return;
  }

  openMapsForAddress(lastAddress.address);
}

function applyLastAddressToCashForm() {
  const [lastAddress] = state.addressHistory;

  if (!lastAddress) {
    const message = "Todavía no hay una dirección reciente para reutilizar.";
    setInlineStatus(elements.cashStatus, message, "warning");
    showToast(message, "warning");
    return;
  }

  elements.cashAddress.value = lastAddress.address;
  elements.cashAddress.focus();
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
        "Todavía no abriste direcciones. Cuando uses Maps desde Rider Hub, las vas a tener acá."
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
    content.textContent = compactAddress(item.address);

    timestamp.className = "history-time";
    timestamp.textContent = dateTimeFormatter.format(new Date(item.openedAt));

    button.append(content, timestamp);
    elements.historyList.append(button);
  });
}

function renderAddressSuggestions() {
  elements.addressSuggestions.replaceChildren();

  state.addressHistory.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.address;
    elements.addressSuggestions.append(option);
  });
}

function syncCashAddressWithLastOpened() {
  const [lastAddress] = state.addressHistory;

  if (!lastAddress || processAddressInput(elements.cashAddress.value)) {
    return;
  }

  elements.cashAddress.value = lastAddress.address;
}

function handleCashSubmit(event) {
  event.preventDefault();

  const formData = new FormData(elements.cashForm);
  const amount = parseNumber(formData.get("amount"), { required: true, allowZero: false });
  const createdAtValue = processAddressInput(formData.get("createdAt"));
  const notes = processAddressInput(formData.get("notes"));
  const rawAddress = processAddressInput(formData.get("address"));

  if (amount == null || amount === false) {
    const message = "Ingresá un monto válido mayor a cero.";
    setInlineStatus(elements.cashStatus, message, "danger");
    showToast(message, "danger");
    elements.cashAmount.focus();
    return;
  }

  if (!createdAtValue) {
    const message = "La fecha y hora son obligatorias.";
    setInlineStatus(elements.cashStatus, message, "danger");
    showToast(message, "danger");
    elements.cashDateTime.focus();
    return;
  }

  const createdAt = new Date(createdAtValue);

  if (Number.isNaN(createdAt.getTime())) {
    const message = "La fecha y hora no son válidas.";
    setInlineStatus(elements.cashStatus, message, "danger");
    showToast(message, "danger");
    elements.cashDateTime.focus();
    return;
  }

  let address = "";

  if (rawAddress) {
    const addressResult = buildNeuqenDestination(rawAddress);

    if (!addressResult.ok) {
      setInlineStatus(elements.cashStatus, addressResult.reason, "danger");
      showToast(addressResult.reason, "danger");
      elements.cashAddress.focus();
      return;
    }

    address = addressResult.destination;
  }

  const entry = {
    id: `cash-${createdAt.getTime()}-${Math.random().toString(16).slice(2, 8)}`,
    amount,
    createdAt: createdAt.toISOString(),
    notes,
    address,
  };

  state.cashEntries = sortEntriesDescending([entry, ...state.cashEntries]);
  writeStorage(STORAGE_KEYS.cashEntries, state.cashEntries);

  if (address) {
    pushAddressToHistory(address);
    renderHistory();
    renderAddressSuggestions();
  }

  elements.cashForm.reset();
  elements.cashDateTime.value = getDateTimeLocalValue();
  syncCashAddressWithLastOpened();

  const message = "Registro de efectivo guardado.";
  setInlineStatus(elements.cashStatus, message, "success");
  showToast(message, "success");
  renderCashView();
}

function renderCashView() {
  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = addDays(dayStart, 1);
  const weekStart = getWeekStart(now);
  const weekEnd = addDays(weekStart, 7);

  const dayEntries = state.cashEntries.filter((entry) => isWithinRange(entry.createdAt, dayStart, dayEnd));
  const weekEntries = state.cashEntries.filter((entry) => isWithinRange(entry.createdAt, weekStart, weekEnd));

  elements.statDayTotal.textContent = formatMoney(sumBy(dayEntries, (entry) => entry.amount));
  elements.statDayCount.textContent = String(dayEntries.length);
  elements.statWeekTotal.textContent = formatMoney(sumBy(weekEntries, (entry) => entry.amount));
  elements.summaryRange.textContent =
    `Semana actual · ${dateFormatter.format(weekStart)} al ${dateFormatter.format(addDays(weekEnd, -1))}`;

  renderCashList();
}

function renderCashList() {
  elements.cashList.replaceChildren();

  if (!state.cashEntries.length) {
    elements.cashList.append(
      createEmptyState(
        "Todavía no guardaste efectivo. Registrá un cobro y vas a verlo enseguida en este resumen."
      )
    );
    return;
  }

  state.cashEntries.slice(0, RECENT_ENTRY_LIMIT).forEach((entry) => {
    const item = document.createElement("article");
    const topLine = document.createElement("div");
    const amount = document.createElement("span");
    const meta = document.createElement("p");
    const address = document.createElement("p");
    const notes = document.createElement("p");

    item.className = "entry-item";
    topLine.className = "entry-topline";
    amount.className = "entry-amount";
    meta.className = "entry-meta";
    address.className = "entry-address";
    notes.className = "entry-notes";

    amount.textContent = formatMoney(entry.amount);
    meta.textContent = dateTimeFormatter.format(new Date(entry.createdAt));

    topLine.append(amount, meta);
    item.append(topLine);

    if (entry.address) {
      address.textContent = compactAddress(entry.address);
      item.append(address);
    }

    if (entry.notes) {
      notes.textContent = entry.notes;
      item.append(notes);
    }

    elements.cashList.append(item);
  });
}

function handleExportPdf() {
  if (!state.cashEntries.length) {
    const message = "No hay registros para exportar en PDF.";
    setInlineStatus(elements.exportStatus, message, "warning");
    showToast(message, "warning");
    return;
  }

  const jsPdfNamespace = window.jspdf;

  if (!jsPdfNamespace || typeof jsPdfNamespace.jsPDF !== "function") {
    const message = "La librería de PDF no está disponible.";
    setInlineStatus(elements.exportStatus, message, "danger");
    showToast(message, "danger");
    return;
  }

  const { jsPDF } = jsPdfNamespace;
  const doc = new jsPDF({
    unit: "pt",
    format: "a4",
  });

  if (typeof doc.autoTable !== "function") {
    const message = "La tabla PDF no está disponible.";
    setInlineStatus(elements.exportStatus, message, "danger");
    showToast(message, "danger");
    return;
  }

  const exportDate = new Date();
  const totalGeneral = sumBy(state.cashEntries, (entry) => entry.amount);

  doc.setFillColor(9, 10, 13);
  doc.rect(0, 0, 595.28, 100, "F");
  doc.setTextColor(245, 247, 250);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Rider Hub · Efectivo", 40, 42);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(196, 202, 211);
  doc.text(`Exportado: ${dateTimeFormatter.format(exportDate)}`, 40, 64);
  doc.text(`Total general: ${formatMoney(totalGeneral)}`, 40, 80);

  const body = state.cashEntries.map((entry) => [
    dateTimeFormatter.format(new Date(entry.createdAt)),
    formatMoney(entry.amount),
    compactAddress(entry.address || "Sin dirección"),
    entry.notes || "—",
  ]);

  doc.autoTable({
    startY: 120,
    head: [["Fecha y hora", "Monto", "Dirección", "Observación"]],
    body,
    theme: "grid",
    headStyles: {
      fillColor: [17, 19, 22],
      textColor: [245, 247, 250],
      lineColor: [38, 42, 48],
      fontStyle: "bold",
    },
    styles: {
      fillColor: [255, 255, 255],
      textColor: [22, 24, 28],
      lineColor: [220, 225, 232],
      cellPadding: 8,
      fontSize: 9.5,
      overflow: "linebreak",
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 110 },
      1: { cellWidth: 80 },
      2: { cellWidth: 165 },
      3: { cellWidth: 150 },
    },
    margin: {
      left: 40,
      right: 40,
    },
  });

  doc.save(buildExportFileName("pdf"));

  const message = "PDF exportado correctamente.";
  setInlineStatus(elements.exportStatus, message, "success");
  showToast(message, "success");
}

function handleExportExcel() {
  if (!state.cashEntries.length) {
    const message = "No hay registros para exportar en Excel.";
    setInlineStatus(elements.exportStatus, message, "warning");
    showToast(message, "warning");
    return;
  }

  if (!window.XLSX) {
    const message = "La librería de Excel no está disponible.";
    setInlineStatus(elements.exportStatus, message, "danger");
    showToast(message, "danger");
    return;
  }

  const rows = state.cashEntries.map((entry) => ({
    "Fecha y hora": dateTimeFormatter.format(new Date(entry.createdAt)),
    Monto: Number(entry.amount),
    Dirección: compactAddress(entry.address || ""),
    Observación: entry.notes || "",
  }));

  const workbook = window.XLSX.utils.book_new();
  const sheet = window.XLSX.utils.json_to_sheet(rows);

  sheet["!cols"] = [
    { wch: 18 },
    { wch: 12 },
    { wch: 34 },
    { wch: 28 },
  ];

  window.XLSX.utils.book_append_sheet(workbook, sheet, "Efectivo");
  window.XLSX.writeFile(workbook, buildExportFileName("xlsx"), {
    compression: true,
  });

  const message = "Excel exportado correctamente.";
  setInlineStatus(elements.exportStatus, message, "success");
  showToast(message, "success");
}

function buildNeuqenDestination(rawText) {
  const cleaned = processAddressInput(rawText).replace(/\s*,\s*/g, ", ");

  if (!cleaned) {
    return {
      ok: false,
      reason: "No hay una dirección para abrir.",
    };
  }

  const normalized = normalizeMatchText(cleaned);
  const blockedLocality = FORBIDDEN_LOCALITIES.find((item) => item.pattern.test(normalized));

  if (blockedLocality) {
    return {
      ok: false,
      reason: `La dirección parece pertenecer a ${blockedLocality.label}. Rider Hub solo abre Neuquén Capital.`,
    };
  }

  let stripped = cleaned
    .replace(/\bNeuqu[eé]n(?:\s+Capital)?\b/gi, "")
    .replace(/\bNQN\b/gi, "")
    .replace(/\bArgentina\b/gi, "")
    .replace(/\bProvincia(?:\s+de|\s+del)?\s+Neuqu[eé]n\b/gi, "")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s{2,}/g, " ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/(?:^,\s*|\s*,\s*$)/g, "")
    .trim();

  if (stripped.length < 3) {
    return {
      ok: false,
      reason: "Sumá calle y altura antes de abrir Maps.",
    };
  }

  return {
    ok: true,
    label: stripped,
    destination: `${stripped}, ${CANONICAL_CITY}`,
  };
}

function loadCashEntries() {
  const cachedEntries = normalizeCashEntries(readStorage(STORAGE_KEYS.cashEntries, null));

  if (cachedEntries.length) {
    return cachedEntries;
  }

  const migratedEntries = migrateLegacyOrders(readStorage(STORAGE_KEYS.legacyOrders, []));

  if (migratedEntries.length) {
    writeStorage(STORAGE_KEYS.cashEntries, migratedEntries);
  }

  return migratedEntries;
}

function migrateLegacyOrders(items) {
  return sortEntriesDescending(
    items
      .map((item) => {
        const amount = Number(item?.amount);
        const createdAt = new Date(item?.createdAt);

        if (!Number.isFinite(amount) || amount <= 0 || Number.isNaN(createdAt.getTime())) {
          return null;
        }

        if (item?.paymentMethod === "transferencia") {
          return null;
        }

        return {
          id: processAddressInput(item?.id) || `cash-${createdAt.getTime()}`,
          amount,
          createdAt: createdAt.toISOString(),
          address: "",
          notes: processAddressInput(item?.notes),
        };
      })
      .filter(Boolean)
  );
}

function normalizeAddressHistory(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  const seenAddresses = new Set();

  return items
    .map((item) => {
      const address = processAddressInput(item?.address || item);
      const openedAt = new Date(item?.openedAt || Date.now());

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

function normalizeCashEntries(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return sortEntriesDescending(
    items
      .map((item) => {
        const amount = Number(item?.amount);
        const createdAt = new Date(item?.createdAt);

        if (!Number.isFinite(amount) || amount <= 0 || Number.isNaN(createdAt.getTime())) {
          return null;
        }

        const rawAddress = processAddressInput(item?.address);
        let normalizedAddress = "";

        if (rawAddress) {
          const addressResult = buildNeuqenDestination(rawAddress);
          normalizedAddress = addressResult.ok ? addressResult.destination : "";
        }

        return {
          id: processAddressInput(item?.id) || `cash-${createdAt.getTime()}`,
          amount,
          createdAt: createdAt.toISOString(),
          address: normalizedAddress,
          notes: processAddressInput(item?.notes),
        };
      })
      .filter(Boolean)
  );
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

    return JSON.parse(rawValue);
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

function parseNumber(value, options = {}) {
  const normalizedValue = processAddressInput(value);

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

function normalizeMatchText(value) {
  return processAddressInput(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function compactAddress(value) {
  const address = processAddressInput(value);

  if (!address) {
    return "";
  }

  const suffix = `, ${CANONICAL_CITY}`;
  return address.endsWith(suffix) ? address.slice(0, -suffix.length) : address;
}

function formatMoney(value) {
  return `$ ${currencyFormatter.format(value || 0)}`;
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

function sortEntriesDescending(entries) {
  return [...entries].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

function buildExportFileName(extension) {
  const dateStamp = new Date().toISOString().slice(0, 10);
  return `rider-hub-efectivo-${dateStamp}.${extension}`;
}

function getDateTimeLocalValue(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

console.info(`Engine activo: ${getActiveEngine()}`);
