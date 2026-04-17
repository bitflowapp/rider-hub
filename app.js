import { getActiveEngine } from "./engine/engine.js";
import { exportCashEntriesExcel, exportCashEntriesPdf } from "./services/export_service.js";
import { geocodeAddress } from "./services/geocoding_service.js";
import { createMapService } from "./services/map_service.js";
import { evaluateRouteRisk, getRiskZones, scoreRouteForStrategy } from "./services/risk_service.js";
import { getRoute } from "./services/routing_service.js";
import { APP_CONFIG } from "./utils/app_config.js";
import {
  buildDestinationHistoryEntry,
  buildGoogleMapsUrl,
  compactDestinationLabel,
  normalizeDestinationHistory,
  prepareAddressSearch,
  toAsciiMatch,
} from "./utils/address_utils.js";
import {
  buildWeekRangeLabel,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatMoney,
  getDateTimeLocalValue,
  getWeekStart,
  isWithinRange,
  sortByNewest,
  startOfDay,
  addDays,
  sumBy,
} from "./utils/format_utils.js";
import { readJsonStorage, writeJsonStorage } from "./utils/storage_utils.js";

const VIEW_NAMES = ["maps", "cash"];

const state = {
  mapService: null,
  currentView: "maps",
  selectedStrategy: readJsonStorage(APP_CONFIG.storageKeys.lastStrategy, "balanced"),
  destinationHistory: normalizeDestinationHistory(
    readJsonStorage(APP_CONFIG.storageKeys.destinationHistory, readJsonStorage("riderHub.addressHistory.v1", []))
  ),
  routeFeedback: normalizeRouteFeedback(readJsonStorage(APP_CONFIG.storageKeys.routeFeedback, [])),
  cashEntries: [],
  origin: { ...APP_CONFIG.referenceOrigin },
  destination: null,
  routes: [],
  activeRouteId: "",
  activeProvider: "",
};

const elements = {
  views: Array.from(document.querySelectorAll(".view")),
  navButtons: Array.from(document.querySelectorAll(".nav-button")),
  strategyButtons: Array.from(document.querySelectorAll(".strategy-button")),
  feedbackButtons: Array.from(document.querySelectorAll(".feedback-button")),
  addressInput: document.querySelector("#address-input"),
  pasteAddressButton: document.querySelector("#paste-address-button"),
  searchAddressButton: document.querySelector("#search-address-button"),
  useLocationButton: document.querySelector("#use-location-button"),
  calculateRouteButton: document.querySelector("#calculate-route-button"),
  openExternalNavButton: document.querySelector("#open-external-nav-button"),
  mapStatus: document.querySelector("#map-status"),
  routeProviderLabel: document.querySelector("#route-provider-label"),
  routeSelectionCopy: document.querySelector("#route-selection-copy"),
  routeDistance: document.querySelector("#route-distance"),
  routeDuration: document.querySelector("#route-duration"),
  routeRiskValue: document.querySelector("#route-risk-value"),
  routeRiskLabel: document.querySelector("#route-risk-label"),
  routeReasons: document.querySelector("#route-reasons"),
  routeWarningBadge: document.querySelector("#route-warning-badge"),
  riskCallout: document.querySelector("#risk-callout"),
  routeList: document.querySelector("#route-list"),
  historyList: document.querySelector("#history-list"),
  feedbackList: document.querySelector("#feedback-list"),
  cashForm: document.querySelector("#cash-form"),
  cashAmount: document.querySelector("#cash-amount"),
  cashDateTime: document.querySelector("#cash-datetime"),
  cashAddress: document.querySelector("#cash-address"),
  cashNotes: document.querySelector("#cash-notes"),
  useLastAddressButton: document.querySelector("#use-last-address-button"),
  addressSuggestions: document.querySelector("#address-suggestions"),
  cashStatus: document.querySelector("#cash-status"),
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

async function init() {
  state.cashEntries = loadCashEntries();
  elements.cashDateTime.value = getDateTimeLocalValue();

  bindEvents();
  syncViewFromHash();
  updateStrategyButtons();
  renderAddressSuggestions();
  renderHistory();
  renderFeedback();
  renderCashView();
  renderRoutePanel();
  syncCashAddressWithLastDestination();

  try {
    state.mapService = await createMapService({
      containerId: "map",
      riskZones: getRiskZones(),
    });

    state.mapService.setOrigin(buildPointFeature(state.origin, { kind: "origin" }));
    setInlineStatus(elements.mapStatus, "Mapa listo. Busca un destino dentro de Neuquen Capital.", "success");
  } catch (error) {
    console.error(error);
    setInlineStatus(
      elements.mapStatus,
      "No pude inicializar el mapa embebido. Refresca la app o revisa la conexion.",
      "danger"
    );
  }

  registerServiceWorker();
  console.info(`Engine activo: ${getActiveEngine()}`);
}

function bindEvents() {
  elements.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      window.location.hash = button.dataset.view;
    });
  });

  window.addEventListener("hashchange", syncViewFromHash);

  elements.strategyButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedStrategy = button.dataset.strategy;
      writeJsonStorage(APP_CONFIG.storageKeys.lastStrategy, state.selectedStrategy);
      updateStrategyButtons();

      if (state.routes.length) {
        applyStrategyToRoutes();
      }
    });
  });

  elements.feedbackButtons.forEach((button) => {
    button.addEventListener("click", () => {
      saveRouteFeedback(button.dataset.feedback);
    });
  });

  elements.pasteAddressButton.addEventListener("click", handlePasteAddress);
  elements.searchAddressButton.addEventListener("click", handleSearchAddress);
  elements.calculateRouteButton.addEventListener("click", handleCalculateRoute);
  elements.useLocationButton.addEventListener("click", handleUseCurrentLocation);
  elements.openExternalNavButton.addEventListener("click", openExternalNavigation);

  elements.cashForm.addEventListener("submit", handleCashSubmit);
  elements.useLastAddressButton.addEventListener("click", applyLastDestinationToCashForm);
  elements.exportPdfButton.addEventListener("click", handleExportPdf);
  elements.exportExcelButton.addEventListener("click", handleExportExcel);
}

function syncViewFromHash() {
  const hash = window.location.hash.replace("#", "").toLowerCase();
  state.currentView = VIEW_NAMES.includes(hash) ? hash : "maps";

  elements.views.forEach((view) => {
    const isActive = view.id === `view-${state.currentView}`;
    view.classList.toggle("is-active", isActive);
    view.hidden = !isActive;
  });

  elements.navButtons.forEach((button) => {
    const isActive = button.dataset.view === state.currentView;
    button.classList.toggle("is-active", isActive);

    if (isActive) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  if (state.currentView === "cash") {
    renderCashView();
  }
}

async function handlePasteAddress() {
  try {
    if (!navigator.clipboard || !window.isSecureContext) {
      throw new Error("Clipboard no disponible");
    }

    const text = await navigator.clipboard.readText();
    const prepared = prepareAddressSearch(text);

    if (!prepared.ok) {
      setInlineStatus(elements.mapStatus, prepared.reason, "warning");
      showToast(prepared.reason, "warning");
      return;
    }

    elements.addressInput.value = prepared.searchLabel;
    setInlineStatus(elements.mapStatus, "Direccion pegada. Ahora toca Buscar.", "success");
    showToast("Direccion pegada desde el portapapeles.", "success");
  } catch (error) {
    setInlineStatus(
      elements.mapStatus,
      "No pude leer el portapapeles. Pega la direccion manualmente.",
      "warning"
    );
    showToast("Fallo la lectura del portapapeles.", "warning");
  }
}

async function handleSearchAddress() {
  try {
    setInlineStatus(elements.mapStatus, "Buscando una coincidencia confiable en Neuquen Capital...", "default");

    const result = await geocodeAddress(elements.addressInput.value);

    if (!result.ok) {
      setInlineStatus(elements.mapStatus, result.reason, "danger");
      showToast(result.reason, "danger");
      return;
    }

    elements.addressInput.value = compactDestinationLabel(result.destination.label);
    setDestination(result.destination);
    pushDestinationHistory(result.destination);
    renderHistory();
    renderAddressSuggestions();
    syncCashAddressWithLastDestination();

    if (state.mapService) {
      state.mapService.setDestination(buildPointFeature(result.destination.coordinates, { kind: "destination" }));
      state.mapService.flyTo(result.destination.coordinates.lng, result.destination.coordinates.lat, 15.4);
    }

    state.routes = [];
    state.activeRouteId = "";
    renderRoutePanel();
    setInlineStatus(elements.mapStatus, "Destino encontrado. Ya puedes calcular la ruta.", "success");
    showToast("Destino ubicado dentro de Neuquen Capital.", "success");
  } catch (error) {
    console.error(error);
    setInlineStatus(
      elements.mapStatus,
      "No pude resolver la direccion ahora. Revisa el texto e intenta de nuevo.",
      "danger"
    );
    showToast("Fallo la busqueda de direccion.", "danger");
  }
}

async function handleUseCurrentLocation() {
  if (!navigator.geolocation) {
    const message = "Este navegador no ofrece geolocalizacion.";
    setInlineStatus(elements.mapStatus, message, "warning");
    showToast(message, "warning");
    return;
  }

  setInlineStatus(elements.mapStatus, "Buscando tu ubicacion actual...", "default");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.origin = {
        lng: position.coords.longitude,
        lat: position.coords.latitude,
        label: "Mi ubicacion actual",
        isApproximate: false,
      };

      setOriginFeature(state.origin);
      setInlineStatus(elements.mapStatus, "Ubicacion actual lista para rutear.", "success");
      showToast("Ubicacion actual fijada.", "success");

      if (state.destination) {
        handleCalculateRoute();
      }
    },
    (error) => {
      const message = "No pude acceder a tu ubicacion. Sigo con origen de referencia.";
      console.error(error);
      setInlineStatus(elements.mapStatus, message, "warning");
      showToast(message, "warning");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000,
    }
  );
}

async function handleCalculateRoute() {
  if (!state.destination) {
    const message = "Busca primero un destino valido dentro de Neuquen Capital.";
    setInlineStatus(elements.mapStatus, message, "warning");
    showToast(message, "warning");
    return;
  }

  try {
    setInlineStatus(elements.mapStatus, "Calculando variantes de ruta en bici...", "default");

    const routeResponse = await getRoute({
      origin: state.origin,
      destination: state.destination.coordinates,
      strategy: state.selectedStrategy,
    });

    state.activeProvider = routeResponse.provider;
    state.routes = routeResponse.routes.map((route) => {
      const risk = evaluateRouteRisk({
        type: "Feature",
        geometry: route.geometry,
      });

      return {
        ...route,
        risk,
        strategyScore: scoreRouteForStrategy(route, risk, state.selectedStrategy),
      };
    });

    applyStrategyToRoutes();

    const successMessage = state.origin.isApproximate
      ? "Ruta calculada usando el centro de Neuquen como referencia. Toca Mi ubicacion para mejorar precision."
      : "Ruta calculada. Ya puedes revisar riesgo y abrir navegacion externa.";

    setInlineStatus(elements.mapStatus, successMessage, "success");
    showToast("Ruta calculada.", "success");
  } catch (error) {
    console.error(error);
    state.routes = [];
    state.activeRouteId = "";
    renderRoutePanel();
    setInlineStatus(
      elements.mapStatus,
      "No pude calcular la ruta en este momento. Intenta de nuevo en unos segundos.",
      "danger"
    );
    showToast("Fallo el calculo de ruta.", "danger");
  }
}

function applyStrategyToRoutes() {
  if (!state.routes.length) {
    renderRoutePanel();
    return;
  }

  state.routes = state.routes.map((route) => ({
    ...route,
    strategyScore: scoreRouteForStrategy(route, route.risk, state.selectedStrategy),
  }));

  const sortedRoutes = [...state.routes].sort((left, right) => left.strategyScore - right.strategyScore);
  state.activeRouteId = sortedRoutes[0].id;
  renderRoutePanel();
}

function openExternalNavigation() {
  const activeRoute = getActiveRoute();

  if (!activeRoute || !state.destination) {
    return;
  }

  const url = buildGoogleMapsUrl({
    origin: state.origin,
    destination: state.destination,
  });

  const externalWindow = window.open(url, "_blank", "noopener,noreferrer");

  if (!externalWindow) {
    window.location.assign(url);
  }
}

function setDestination(destination) {
  state.destination = destination;

  if (state.mapService) {
    state.mapService.setDestination(buildPointFeature(destination.coordinates, { kind: "destination" }));
  }
}

function setOriginFeature(origin) {
  if (state.mapService) {
    state.mapService.setOrigin(buildPointFeature(origin, { kind: "origin" }));

    if (!origin.isApproximate) {
      state.mapService.flyTo(origin.lng, origin.lat, 14.8);
    }
  }
}

function renderRoutePanel() {
  const activeRoute = getActiveRoute();

  elements.routeProviderLabel.textContent = buildProviderLabel(state.activeProvider);
  elements.openExternalNavButton.disabled = !activeRoute || !state.destination;
  elements.feedbackButtons.forEach((button) => {
    button.disabled = !activeRoute;
  });

  if (!activeRoute) {
    elements.routeSelectionCopy.textContent = state.destination
      ? `Destino listo: ${compactDestinationLabel(state.destination.label)}. Calcula la ruta para comparar variantes.`
      : "Define un destino y calcula la ruta para ver distancia, tiempo, riesgo y variantes.";
    elements.routeDistance.textContent = "Sin ruta";
    elements.routeDuration.textContent = "Sin ruta";
    elements.routeRiskValue.textContent = "Sin evaluar";
    elements.routeRiskLabel.textContent = "Normal";
    elements.routeReasons.textContent =
      "La evaluacion cruza la ruta con una base local de riesgo operativo semilla.";
    elements.routeWarningBadge.hidden = true;
    setRiskCalloutTone("normal");
    if (state.mapService) {
      state.mapService.setRoutes([], "");
    }
    renderRouteList([]);
    return;
  }

  elements.routeSelectionCopy.textContent = `${compactDestinationLabel(state.destination.label)} · ${buildOriginCopy()}`;
  elements.routeDistance.textContent = formatDistance(activeRoute.distanceMeters);
  elements.routeDuration.textContent = formatDuration(activeRoute.durationSeconds);
  elements.routeRiskValue.textContent = activeRoute.risk.label;
  elements.routeRiskLabel.textContent = activeRoute.risk.label;
  elements.routeReasons.textContent = activeRoute.risk.reasons.length
    ? activeRoute.risk.reasons.join(" ")
    : "No detecte cruces con zonas cargadas como mas delicadas.";

  const shouldWarn = activeRoute.risk.label !== "Normal";
  elements.routeWarningBadge.hidden = !shouldWarn;
  elements.routeWarningBadge.textContent = shouldWarn ? "Atencion" : "";
  setRiskCalloutTone(activeRoute.risk.label);
  renderRouteList(state.routes);

  if (state.mapService) {
    state.mapService.setRoutes(state.routes, state.activeRouteId);
  }
}

function renderRouteList(routes) {
  elements.routeList.replaceChildren();

  if (!routes.length) {
    elements.routeList.append(
      createEmptyState("Todavia no hay rutas calculadas. Busca un destino y toca Calcular ruta.")
    );
    return;
  }

  [...routes]
    .sort((left, right) => left.strategyScore - right.strategyScore)
    .forEach((route, index) => {
      const button = document.createElement("button");
      const topLine = document.createElement("div");
      const title = document.createElement("strong");
      const subtitle = document.createElement("span");
      const metrics = document.createElement("div");

      button.type = "button";
      button.className = "route-card";

      if (route.id === state.activeRouteId) {
        button.classList.add("is-active");
      }

      button.addEventListener("click", () => {
        state.activeRouteId = route.id;
        renderRoutePanel();
      });

      topLine.className = "route-card-top";
      title.textContent = index === 0 ? "Recomendada" : `Alternativa ${index + 1}`;
      subtitle.className = "history-meta";
      subtitle.textContent = `${formatDistance(route.distanceMeters)} · ${formatDuration(route.durationSeconds)}`;
      topLine.append(title, subtitle);

      metrics.className = "route-card-metrics";
      metrics.append(
        createTinyPill(route.risk.label, getRiskTone(route.risk.label)),
        createTinyPill(buildStrategyLabel(state.selectedStrategy), "accent")
      );

      button.append(topLine, metrics);
      elements.routeList.append(button);
    });
}

function renderHistory() {
  elements.historyList.replaceChildren();

  if (!state.destinationHistory.length) {
    elements.historyList.append(
      createEmptyState("Tus destinos buscados van a quedar aqui para reusar en segundos.")
    );
    return;
  }

  state.destinationHistory.forEach((entry) => {
    const button = document.createElement("button");
    const title = document.createElement("strong");
    const meta = document.createElement("span");

    button.type = "button";
    button.className = "history-button";
    button.addEventListener("click", () => {
      elements.addressInput.value = compactDestinationLabel(entry.label);
      setDestination(entry);
      renderRoutePanel();

      if (state.mapService) {
        state.mapService.setDestination(buildPointFeature(entry.coordinates, { kind: "destination" }));
        state.mapService.flyTo(entry.coordinates.lng, entry.coordinates.lat, 15.4);
      }

      setInlineStatus(elements.mapStatus, "Destino cargado desde historial. Ya puedes rutear.", "success");
    });

    title.className = "history-address";
    title.textContent = compactDestinationLabel(entry.label);
    meta.className = "history-meta";
    meta.textContent = formatDateTime(entry.createdAt);

    button.append(title, meta);
    elements.historyList.append(button);
  });
}

function renderFeedback() {
  elements.feedbackList.replaceChildren();

  if (!state.routeFeedback.length) {
    elements.feedbackList.append(
      createEmptyState("Cuando marques una ruta como buena o incomoda, el registro aparece aqui.")
    );
    return;
  }

  state.routeFeedback.slice(0, APP_CONFIG.recentFeedbackLimit).forEach((entry) => {
    const item = document.createElement("article");
    const topLine = document.createElement("div");
    const label = document.createElement("strong");
    const meta = document.createElement("span");
    const copy = document.createElement("p");

    item.className = "feedback-item";
    topLine.className = "feedback-topline";
    label.textContent = buildFeedbackLabel(entry.type);
    meta.className = "feedback-meta";
    meta.textContent = formatDateTime(entry.createdAt);
    copy.className = "route-card-copy";
    copy.textContent = `${entry.destinationLabel} · ${entry.strategyLabel}`;

    topLine.append(label, meta);
    item.append(topLine, copy);
    elements.feedbackList.append(item);
  });
}

function renderAddressSuggestions() {
  elements.addressSuggestions.replaceChildren();

  state.destinationHistory.forEach((entry) => {
    const option = document.createElement("option");
    option.value = compactDestinationLabel(entry.label);
    elements.addressSuggestions.append(option);
  });
}

function saveRouteFeedback(type) {
  const activeRoute = getActiveRoute();

  if (!activeRoute || !state.destination) {
    return;
  }

  const entry = {
    id: `feedback-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    type,
    createdAt: new Date().toISOString(),
    destinationLabel: compactDestinationLabel(state.destination.label),
    strategy: state.selectedStrategy,
    strategyLabel: buildStrategyLabel(state.selectedStrategy),
    routeRisk: activeRoute.risk.label,
  };

  state.routeFeedback = sortByNewest([entry, ...state.routeFeedback]);
  writeJsonStorage(APP_CONFIG.storageKeys.routeFeedback, state.routeFeedback);
  renderFeedback();
  showToast("Feedback guardado.", "success");
}

function pushDestinationHistory(destination) {
  const nextHistory = state.destinationHistory.filter(
    (entry) => toAsciiMatch(entry.label) !== toAsciiMatch(destination.label)
  );

  nextHistory.unshift(buildDestinationHistoryEntry(destination));
  state.destinationHistory = normalizeDestinationHistory(nextHistory);
  writeJsonStorage(APP_CONFIG.storageKeys.destinationHistory, state.destinationHistory);
}

function handleCashSubmit(event) {
  event.preventDefault();

  const formData = new FormData(elements.cashForm);
  const amount = parsePositiveNumber(formData.get("amount"));
  const createdAtValue = String(formData.get("createdAt") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  const rawAddress = String(formData.get("address") || "").trim();

  if (amount == null) {
    setInlineStatus(elements.cashStatus, "Ingresa un monto valido mayor a cero.", "danger");
    showToast("Revisa el monto.", "danger");
    elements.cashAmount.focus();
    return;
  }

  if (!createdAtValue) {
    setInlineStatus(elements.cashStatus, "La fecha y hora son obligatorias.", "danger");
    showToast("Completa fecha y hora.", "danger");
    elements.cashDateTime.focus();
    return;
  }

  const createdAt = new Date(createdAtValue);

  if (Number.isNaN(createdAt.getTime())) {
    setInlineStatus(elements.cashStatus, "La fecha y hora no son validas.", "danger");
    showToast("Fecha u hora invalidas.", "danger");
    elements.cashDateTime.focus();
    return;
  }

  let address = "";

  if (rawAddress) {
    const preparedAddress = prepareAddressSearch(rawAddress);

    if (!preparedAddress.ok) {
      setInlineStatus(elements.cashStatus, preparedAddress.reason, "danger");
      showToast(preparedAddress.reason, "danger");
      elements.cashAddress.focus();
      return;
    }

    address = `${preparedAddress.searchLabel}, ${APP_CONFIG.cityQuery}`;
  }

  const entry = {
    id: `cash-${createdAt.getTime()}-${Math.random().toString(16).slice(2, 8)}`,
    amount,
    createdAt: createdAt.toISOString(),
    address,
    notes,
  };

  state.cashEntries = sortByNewest([entry, ...state.cashEntries]);
  writeJsonStorage(APP_CONFIG.storageKeys.cashEntries, state.cashEntries);

  if (address && state.destination && compactDestinationLabel(state.destination.label) === compactDestinationLabel(address)) {
    pushDestinationHistory({
      id: entry.id,
      label: address,
      displayName: address,
      coordinates: state.destination.coordinates,
    });
    renderHistory();
    renderAddressSuggestions();
  }

  elements.cashForm.reset();
  elements.cashDateTime.value = getDateTimeLocalValue();
  syncCashAddressWithLastDestination();

  setInlineStatus(elements.cashStatus, "Registro de efectivo guardado.", "success");
  showToast("Efectivo guardado.", "success");
  renderCashView();
}

function applyLastDestinationToCashForm() {
  if (!state.destinationHistory.length) {
    setInlineStatus(
      elements.cashStatus,
      "Todavia no hay destinos recientes para reutilizar.",
      "warning"
    );
    showToast("No hay destino reciente.", "warning");
    return;
  }

  elements.cashAddress.value = compactDestinationLabel(state.destinationHistory[0].label);
  elements.cashAddress.focus();
}

function syncCashAddressWithLastDestination() {
  if (elements.cashAddress.value.trim() || !state.destinationHistory.length) {
    return;
  }

  elements.cashAddress.value = compactDestinationLabel(state.destinationHistory[0].label);
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
  elements.summaryRange.textContent = buildWeekRangeLabel();

  renderCashList();
}

function renderCashList() {
  elements.cashList.replaceChildren();

  if (!state.cashEntries.length) {
    elements.cashList.append(
      createEmptyState("Todavia no guardaste efectivo. Registra un cobro y aparecera aqui.")
    );
    return;
  }

  state.cashEntries.slice(0, 10).forEach((entry) => {
    const item = document.createElement("article");
    const topLine = document.createElement("div");
    const amount = document.createElement("strong");
    const meta = document.createElement("span");

    item.className = "entry-item";
    topLine.className = "entry-topline";
    amount.className = "entry-amount";
    meta.className = "entry-meta";
    amount.textContent = formatMoney(entry.amount);
    meta.textContent = formatDateTime(entry.createdAt);
    topLine.append(amount, meta);
    item.append(topLine);

    if (entry.address) {
      const address = document.createElement("p");
      address.className = "entry-address";
      address.textContent = compactDestinationLabel(entry.address);
      item.append(address);
    }

    if (entry.notes) {
      const notes = document.createElement("p");
      notes.className = "entry-notes";
      notes.textContent = entry.notes;
      item.append(notes);
    }

    elements.cashList.append(item);
  });
}

function handleExportPdf() {
  try {
    if (!state.cashEntries.length) {
      throw new Error("No hay registros para exportar en PDF.");
    }

    exportCashEntriesPdf(state.cashEntries);
    setInlineStatus(elements.exportStatus, "PDF exportado correctamente.", "success");
    showToast("PDF exportado.", "success");
  } catch (error) {
    setInlineStatus(elements.exportStatus, error.message, "danger");
    showToast(error.message, "danger");
  }
}

function handleExportExcel() {
  try {
    if (!state.cashEntries.length) {
      throw new Error("No hay registros para exportar en Excel.");
    }

    exportCashEntriesExcel(state.cashEntries);
    setInlineStatus(elements.exportStatus, "Excel exportado correctamente.", "success");
    showToast("Excel exportado.", "success");
  } catch (error) {
    setInlineStatus(elements.exportStatus, error.message, "danger");
    showToast(error.message, "danger");
  }
}

function loadCashEntries() {
  const cachedEntries = normalizeCashEntries(readJsonStorage(APP_CONFIG.storageKeys.cashEntries, null));

  if (cachedEntries.length) {
    return cachedEntries;
  }

  const migratedEntries = migrateLegacyOrders(readJsonStorage(APP_CONFIG.storageKeys.legacyOrders, []));

  if (migratedEntries.length) {
    writeJsonStorage(APP_CONFIG.storageKeys.cashEntries, migratedEntries);
  }

  return migratedEntries;
}

function migrateLegacyOrders(items) {
  return sortByNewest(
    (Array.isArray(items) ? items : [])
      .map((item) => {
        const amount = Number(item?.amount);
        const createdAt = new Date(item?.createdAt);

        if (!Number.isFinite(amount) || amount <= 0 || Number.isNaN(createdAt.getTime())) {
          return null;
        }

        if (String(item?.paymentMethod || "").toLowerCase() === "transferencia") {
          return null;
        }

        return {
          id: String(item?.id || `cash-${createdAt.getTime()}`),
          amount,
          createdAt: createdAt.toISOString(),
          address: "",
          notes: String(item?.notes || "").trim(),
        };
      })
      .filter(Boolean)
  );
}

function normalizeCashEntries(items) {
  return sortByNewest(
    (Array.isArray(items) ? items : [])
      .map((item) => {
        const amount = Number(item?.amount);
        const createdAt = new Date(item?.createdAt);

        if (!Number.isFinite(amount) || amount <= 0 || Number.isNaN(createdAt.getTime())) {
          return null;
        }

        let address = "";
        const rawAddress = String(item?.address || "").trim();

        if (rawAddress) {
          const preparedAddress = prepareAddressSearch(rawAddress);
          address = preparedAddress.ok ? `${preparedAddress.searchLabel}, ${APP_CONFIG.cityQuery}` : "";
        }

        return {
          id: String(item?.id || `cash-${createdAt.getTime()}`),
          amount,
          createdAt: createdAt.toISOString(),
          address,
          notes: String(item?.notes || "").trim(),
        };
      })
      .filter(Boolean)
  );
}

function normalizeRouteFeedback(items) {
  return sortByNewest(
    (Array.isArray(items) ? items : [])
      .map((item) => {
        const createdAt = new Date(item?.createdAt);

        if (Number.isNaN(createdAt.getTime())) {
          return null;
        }

        return {
          id: String(item?.id || `feedback-${createdAt.getTime()}`),
          type: String(item?.type || "").trim(),
          createdAt: createdAt.toISOString(),
          destinationLabel: String(item?.destinationLabel || "").trim(),
          strategy: String(item?.strategy || "balanced"),
          strategyLabel: String(item?.strategyLabel || buildStrategyLabel(item?.strategy || "balanced")),
          routeRisk: String(item?.routeRisk || ""),
        };
      })
      .filter(Boolean)
  );
}

function updateStrategyButtons() {
  elements.strategyButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.strategy === state.selectedStrategy);
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
  const node = document.createElement("div");
  node.className = "empty-state";
  node.textContent = message;
  return node;
}

function setRiskCalloutTone(label) {
  elements.riskCallout.classList.remove("is-normal", "is-caution", "is-high", "is-night");
  elements.riskCallout.classList.add(`is-${getRiskTone(label)}`);
}

function createTinyPill(label, tone = "accent") {
  const pill = document.createElement("span");
  pill.className = "tiny-pill";
  pill.classList.add(`is-${tone}`);
  pill.textContent = label;
  return pill;
}

function getRiskTone(label) {
  if (label === "No recomendado de noche") {
    return "night";
  }

  if (label === "Alta precaucion") {
    return "danger";
  }

  if (label === "Precaucion") {
    return "warning";
  }

  return "accent";
}

function getActiveRoute() {
  return state.routes.find((route) => route.id === state.activeRouteId) || null;
}

function buildPointFeature(point, extraProperties = {}) {
  return {
    type: "Feature",
    properties: {
      ...extraProperties,
    },
    geometry: {
      type: "Point",
      coordinates: [point.lng, point.lat],
    },
  };
}

function buildProviderLabel(provider) {
  if (provider === "openrouteservice") {
    return "Provider: openrouteservice";
  }

  if (provider === "osrm-demo") {
    return "Provider: OSRM demo";
  }

  return "Provider: esperando";
}

function buildOriginCopy() {
  return state.origin.isApproximate
    ? "origen de referencia (centro)"
    : "origen con tu ubicacion actual";
}

function buildStrategyLabel(strategy) {
  if (strategy === "fast") {
    return "Rapida";
  }

  if (strategy === "cautious") {
    return "Prudente";
  }

  return "Equilibrada";
}

function buildFeedbackLabel(type) {
  if (type === "good") {
    return "Ruta buena";
  }

  if (type === "awkward") {
    return "Ruta incomoda";
  }

  return "Zona complicada";
}

function parsePositiveNumber(value) {
  const raw = String(value ?? "").trim().replace(",", ".");
  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
