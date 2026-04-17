import { getActiveEngine } from "./engine/engine.js";
import { exportCashEntriesExcel, exportCashEntriesPdf } from "./services/export_service.js";
import { geocodeAddress, reverseGeocode } from "./services/geocoding_service.js";
import { createMapService } from "./services/map_service.js";
import {
  evaluateOperationalRisk,
  getRiskTone,
  getRiskZones,
  scoreRouteForStrategy,
} from "./services/risk_service.js";
import { getAlternativeRoutes, getRoute, summarizeRoute } from "./services/routing_service.js";
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
  addDays,
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
  sumBy,
} from "./utils/format_utils.js";
import { readJsonStorage, writeJsonStorage } from "./utils/storage_utils.js";

const state = {
  mapService: null,
  selectedStrategy: readJsonStorage(APP_CONFIG.storageKeys.lastStrategy, "balanced"),
  destinationHistory: normalizeDestinationHistory(
    readJsonStorage(APP_CONFIG.storageKeys.destinationHistory, readJsonStorage("riderHub.addressHistory.v1", []))
  ),
  routeFeedback: normalizeRouteFeedback(readJsonStorage(APP_CONFIG.storageKeys.routeFeedback, [])),
  cashEntries: [],
  origin: { ...APP_CONFIG.referenceOrigin },
  destination: null,
  addressAnalysis: null,
  routes: [],
  activeRouteId: "",
  activeProvider: "",
  isBusy: false,
  routeError: "",
};

const elements = {
  appStatusPill: document.querySelector("#app-status-pill"),
  strategyButtons: Array.from(document.querySelectorAll(".strategy-button")),
  feedbackButtons: Array.from(document.querySelectorAll(".feedback-button")),
  layoutDrawers: Array.from(document.querySelectorAll(".insight-drawer, .secondary-drawer")),
  addressInput: document.querySelector("#address-input"),
  pasteAddressButton: document.querySelector("#paste-address-button"),
  searchAddressButton: document.querySelector("#search-address-button"),
  useLocationButton: document.querySelector("#use-location-button"),
  primaryActionButton: document.querySelector("#primary-action-button"),
  showAlternativeButton: document.querySelector("#show-alternative-button"),
  openExternalNavButton: document.querySelector("#open-external-nav-button"),
  jumpHistoryButton: document.querySelector("#jump-history-button"),
  jumpCashButton: document.querySelector("#jump-cash-button"),
  historyAnchor: document.querySelector("#history-anchor"),
  cashAnchor: document.querySelector("#cash-anchor"),
  mapStatus: document.querySelector("#map-status"),
  interpretedAddress: document.querySelector("#interpreted-address"),
  addressStateBadge: document.querySelector("#address-state-badge"),
  resolutionStatus: document.querySelector("#resolution-status"),
  operationalRisk: document.querySelector("#operational-risk"),
  recommendedRoute: document.querySelector("#recommended-route"),
  recommendationTitle: document.querySelector("#recommendation-title"),
  recommendationCopy: document.querySelector("#recommendation-copy"),
  reasonList: document.querySelector("#reason-list"),
  routeDistance: document.querySelector("#route-distance"),
  routeDuration: document.querySelector("#route-duration"),
  originSummary: document.querySelector("#origin-summary"),
  routeWhy: document.querySelector("#route-why"),
  routeProviderNote: document.querySelector("#route-provider-note"),
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

let mapResizeFrameId = 0;
let mapResizeTimeoutId = 0;

init();

async function init() {
  state.cashEntries = loadCashEntries();
  elements.cashDateTime.value = getDateTimeLocalValue();

  bindEvents();
  updateStrategyButtons();
  renderAddressSuggestions();
  renderHistory();
  renderFeedback();
  renderCashView();
  renderOperationalPanel();
  syncCashAddressWithLastDestination();

  try {
    state.mapService = await createMapService({
      containerId: "map",
      riskZones: getRiskZones(),
    });

    syncMapLayers();
    scheduleMapResizeBurst();
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
  elements.strategyButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      if (state.selectedStrategy === button.dataset.strategy) {
        return;
      }

      state.selectedStrategy = button.dataset.strategy;
      writeJsonStorage(APP_CONFIG.storageKeys.lastStrategy, state.selectedStrategy);
      updateStrategyButtons();

      if (state.destination) {
        await recalculateRouteForCurrentDestination("strategy");
      } else {
        renderOperationalPanel();
      }
    });
  });

  elements.feedbackButtons.forEach((button) => {
    button.addEventListener("click", () => {
      saveRouteFeedback(button.dataset.feedback);
    });
  });

  elements.addressInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      await handleSearchAddress();
    }
  });

  elements.pasteAddressButton.addEventListener("click", handlePasteAddress);
  elements.searchAddressButton.addEventListener("click", handleSearchAddress);
  elements.useLocationButton.addEventListener("click", handleUseCurrentLocation);
  elements.primaryActionButton.addEventListener("click", handlePrimaryAction);
  elements.showAlternativeButton.addEventListener("click", handleShowAlternativeRoute);
  elements.openExternalNavButton.addEventListener("click", openExternalNavigation);
  elements.jumpHistoryButton.addEventListener("click", () => scrollToSection(elements.historyAnchor));
  elements.jumpCashButton.addEventListener("click", () => scrollToSection(elements.cashAnchor));

  elements.cashForm.addEventListener("submit", handleCashSubmit);
  elements.useLastAddressButton.addEventListener("click", applyLastDestinationToCashForm);
  elements.exportPdfButton.addEventListener("click", handleExportPdf);
  elements.exportExcelButton.addEventListener("click", handleExportExcel);

  elements.layoutDrawers.forEach((drawer) => {
    drawer.addEventListener("toggle", () => {
      scheduleMapResizeBurst();
    });
  });

  window.addEventListener("resize", handleViewportResize, { passive: true });
  window.addEventListener("orientationchange", handleViewportResize, { passive: true });
  window.visualViewport?.addEventListener("resize", handleViewportResize, { passive: true });
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
    setInlineStatus(elements.mapStatus, "Direccion pegada. Toca Buscar para interpretar y rutear.", "success");
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
  const rawInput = elements.addressInput.value.trim();

  if (!rawInput) {
    const message = "Ingresa o pega una direccion para empezar.";
    setInlineStatus(elements.mapStatus, message, "warning");
    showToast(message, "warning");
    elements.addressInput.focus();
    return;
  }

  await withBusyState(async () => {
    state.routeError = "";
    state.addressAnalysis = {
      status: "interpreting",
      interpretedLine: "Interpretando direccion...",
      notes: [],
      reason: "Estoy limpiando el texto y validando Neuquen Capital.",
    };
    state.routes = [];
    state.activeRouteId = "";
    renderOperationalPanel();

    setInlineStatus(
      elements.mapStatus,
      "Interpretando direccion, validando Neuquen Capital y buscando la mejor coincidencia...",
      "default"
    );

    const result = await geocodeAddress(rawInput);

    if (!result.ok) {
      state.destination = null;
      state.activeProvider = result.provider || "";
      state.addressAnalysis = {
        ...(result.interpretation || {}),
        status: result.status || result.interpretation?.status || "doubtful",
        reason: result.reason,
      };
      writeJsonStorage(APP_CONFIG.storageKeys.lastResolvedAddress, {
        ok: false,
        rawInput,
        analysis: state.addressAnalysis,
      });
      syncMapLayers();
      renderOperationalPanel();

      const tone = result.status === "outside" ? "danger" : "warning";
      setInlineStatus(elements.mapStatus, result.reason, tone);
      showToast(result.reason, tone);
      return;
    }

    state.destination = result.destination;
    state.addressAnalysis = result.interpretation;
    state.activeProvider = result.provider;
    elements.addressInput.value = compactDestinationLabel(
      result.interpretation.interpretedLine || result.destination.label
    );
    pushDestinationHistory(result.destination);
    renderHistory();
    renderAddressSuggestions();
    syncCashAddressWithLastDestination();
    syncMapLayers();

    await calculateRoutesForCurrentDestination("search");

    writeJsonStorage(APP_CONFIG.storageKeys.lastResolvedAddress, {
      ok: true,
      rawInput,
      analysis: state.addressAnalysis,
      destination: state.destination,
    });

    const successMessage = state.routes.length
      ? "Direccion validada y ruta sugerida lista."
      : "Direccion validada. Falta resolver la ruta.";
    setInlineStatus(elements.mapStatus, successMessage, "success");
    showToast(successMessage, "success");
  });
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
    async (position) => {
      state.origin = {
        lng: position.coords.longitude,
        lat: position.coords.latitude,
        label: "Mi ubicacion actual",
        isApproximate: false,
      };

      try {
        const reverse = await reverseGeocode(state.origin);

        if (reverse?.label) {
          state.origin.label = reverse.label;
        }
      } catch (error) {
        console.warn("No pude resolver el origen por reverse geocoding.", error);
      }

      syncMapLayers();
      renderOperationalPanel();
      setInlineStatus(elements.mapStatus, "Ubicacion actual fijada para rutear mejor.", "success");
      showToast("Ubicacion actual lista.", "success");

      if (state.destination) {
        await recalculateRouteForCurrentDestination("location");
      }
    },
    (error) => {
      console.error(error);
      const message = "No pude acceder a tu ubicacion. Sigo con origen de referencia.";
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

async function recalculateRouteForCurrentDestination(source) {
  if (!state.destination) {
    return;
  }

  await withBusyState(async () => {
    await calculateRoutesForCurrentDestination(source);
  });
}

async function calculateRoutesForCurrentDestination(source) {
  if (!state.destination) {
    return;
  }

  setInlineStatus(elements.mapStatus, "Calculando rutas en bici y evaluando riesgo operativo...", "default");

  try {
    const routeResponse = await getRoute({
      origin: state.origin,
      destination: state.destination.coordinates,
      strategy: state.selectedStrategy,
    });

    const destinationFeature = buildPointFeature(state.destination.coordinates, { kind: "destination" });
    state.activeProvider = routeResponse.provider;
    state.routes = routeResponse.routes.map((route) => {
      const routeFeature = {
        type: "Feature",
        geometry: route.geometry,
      };
      const operationalRisk = evaluateOperationalRisk({
        destination: destinationFeature,
        routeFeature,
      });

      return {
        ...route,
        operationalRisk,
        strategyScore: scoreRouteForStrategy(route, operationalRisk, state.selectedStrategy),
        summary: summarizeRoute({
          route,
          strategy: state.selectedStrategy,
          operationalRisk,
        }),
      };
    });

    const sortedRoutes = getSortedRoutes();
    state.activeRouteId = sortedRoutes[0]?.id || "";
    state.routeError = "";
    syncMapLayers();
    renderOperationalPanel();

    if (source === "strategy") {
      showToast(`Ruta ${buildStrategyLabel(state.selectedStrategy).toLowerCase()} actualizada.`, "success");
    }
  } catch (error) {
    console.error(error);
    state.routes = [];
    state.activeRouteId = "";
    state.routeError = "No pude calcular una ruta usable en este momento.";
    syncMapLayers();
    renderOperationalPanel();
    setInlineStatus(elements.mapStatus, state.routeError, "danger");
    showToast("Fallo el calculo de ruta.", "danger");
  }
}

async function handlePrimaryAction() {
  const uiState = deriveUiState();

  if (uiState.primaryActionKind === "search") {
    await handleSearchAddress();
    return;
  }

  if (uiState.primaryActionKind === "route") {
    await recalculateRouteForCurrentDestination("primary");
    return;
  }

  if (uiState.primaryActionKind === "review") {
    elements.addressInput.focus();
    elements.addressInput.select();
    return;
  }

  if (uiState.primaryActionKind === "safer") {
    state.selectedStrategy = "cautious";
    writeJsonStorage(APP_CONFIG.storageKeys.lastStrategy, state.selectedStrategy);
    updateStrategyButtons();
    await recalculateRouteForCurrentDestination("strategy");
    return;
  }

  if (uiState.primaryActionKind === "suggested") {
    selectSuggestedRoute();
  }
}

function handleShowAlternativeRoute() {
  const sortedRoutes = getSortedRoutes();

  if (sortedRoutes.length < 2) {
    return;
  }

  const currentIndex = Math.max(
    0,
    sortedRoutes.findIndex((route) => route.id === state.activeRouteId)
  );
  const nextIndex = (currentIndex + 1) % sortedRoutes.length;

  state.activeRouteId = sortedRoutes[nextIndex].id;
  syncMapLayers();
  renderOperationalPanel();
  showToast("Mostrando otra alternativa.", "success");
}

function selectSuggestedRoute() {
  const suggestedRoute = getSortedRoutes()[0];

  if (!suggestedRoute) {
    return;
  }

  state.activeRouteId = suggestedRoute.id;
  syncMapLayers();
  renderOperationalPanel();
  showToast("Ruta sugerida enfocada.", "success");
}

function openExternalNavigation() {
  if (!state.destination) {
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

function syncMapLayers() {
  if (!state.mapService) {
    return;
  }

  state.mapService.setOrigin(buildPointFeature(state.origin, { kind: "origin" }));
  state.mapService.setDestination(
    state.destination ? buildPointFeature(state.destination.coordinates, { kind: "destination" }) : null
  );
  state.mapService.setRoutes(state.routes, state.activeRouteId, {
    origin: state.origin,
    destination: state.destination,
  });
  queueMapResize();
}

function renderOperationalPanel() {
  const uiState = deriveUiState();
  const activeRoute = getActiveRoute();

  elements.appStatusPill.textContent = uiState.headerBadge;
  setBadgeTone(elements.appStatusPill, uiState.badgeTone);

  elements.interpretedAddress.textContent =
    state.addressAnalysis?.interpretedLine || "Esperando direccion";
  elements.addressStateBadge.textContent = uiState.addressBadge;
  setBadgeTone(elements.addressStateBadge, uiState.badgeTone);

  elements.resolutionStatus.textContent = uiState.resolutionStatus;
  elements.operationalRisk.textContent = activeRoute?.operationalRisk?.overallLabel || uiState.operationalRisk;
  elements.recommendedRoute.textContent = uiState.recommendedRoute;
  elements.recommendationTitle.textContent = uiState.recommendationTitle;
  elements.recommendationCopy.textContent = uiState.recommendationCopy;
  elements.routeDistance.textContent = activeRoute ? formatDistance(activeRoute.distanceMeters) : "Sin ruta";
  elements.routeDuration.textContent = activeRoute ? formatDuration(activeRoute.durationSeconds) : "Sin ruta";
  elements.originSummary.textContent = buildOriginCopy();
  elements.routeWhy.textContent = activeRoute?.summary || state.routeError || "Todavia no hay una ruta activa.";
  elements.routeProviderNote.textContent = buildProviderLabel(state.activeProvider);

  elements.primaryActionButton.textContent = uiState.primaryActionLabel;
  elements.primaryActionButton.disabled = uiState.primaryActionDisabled;
  elements.showAlternativeButton.disabled = getAlternativeRoutes(state.routes, state.activeRouteId).length === 0;
  elements.openExternalNavButton.disabled = !state.destination;

  elements.feedbackButtons.forEach((button) => {
    button.disabled = !activeRoute;
  });

  renderReasonList(buildReasonItems());
  renderRouteList(getSortedRoutes());
  queueMapResize(40);
}

function deriveUiState() {
  const activeRoute = getActiveRoute();
  const stage = getOperationalStage();
  const base = {
    headerBadge: "Esperando",
    addressBadge: "Esperando",
    badgeTone: "neutral",
    resolutionStatus: "Esperando direccion",
    operationalRisk: "Sin evaluar",
    recommendedRoute: "Todavia no calculada",
    recommendationTitle: "Pega una direccion para empezar",
    recommendationCopy:
      "Voy a limpiarla, validar Neuquen Capital y sugerirte la mejor ruta para salir rapido.",
    primaryActionLabel: "Buscar destino",
    primaryActionKind: "search",
    primaryActionDisabled: state.isBusy,
  };

  if (stage === "interpreting") {
    return {
      ...base,
      headerBadge: "Interpretando",
      addressBadge: "Procesando",
      resolutionStatus: "Interpretando direccion",
      recommendedRoute: "Calculando",
      recommendationTitle: "Interpretando direccion",
      recommendationCopy: state.addressAnalysis?.reason || "Limpio el texto y valido la ciudad.",
    };
  }

  if (stage === "outside") {
    return {
      ...base,
      headerBadge: "Fuera",
      addressBadge: "Fuera de alcance",
      badgeTone: "danger",
      resolutionStatus: "Fuera de Neuquen Capital",
      recommendationTitle: "Direccion fuera de alcance",
      recommendationCopy: state.addressAnalysis?.reason || "Solo se aceptan destinos dentro de Neuquen Capital.",
      primaryActionLabel: "Revisar direccion",
      primaryActionKind: "review",
      primaryActionDisabled: false,
    };
  }

  if (stage === "doubtful") {
    return {
      ...base,
      headerBadge: "Dudosa",
      addressBadge: "Revisar",
      badgeTone: "warning",
      resolutionStatus: "Direccion dudosa",
      recommendationTitle: "Direccion necesita revision",
      recommendationCopy:
        state.addressAnalysis?.reason || "No pude validarla con suficiente confianza. Conviene revisar antes de salir.",
      primaryActionLabel: "Revisar direccion",
      primaryActionKind: "review",
      primaryActionDisabled: false,
    };
  }

  if (stage === "valid") {
    return {
      ...base,
      headerBadge: "Valida",
      addressBadge: "Valida",
      badgeTone: "success",
      resolutionStatus: "Direccion valida",
      recommendedRoute: `${buildStrategyLabel(state.selectedStrategy)} pendiente`,
      recommendationTitle: "Destino validado",
      recommendationCopy:
        state.routeError || "La direccion esta bien interpretada. Falta resolver la mejor ruta.",
      primaryActionLabel: "Buscar ruta sugerida",
      primaryActionKind: "route",
      primaryActionDisabled: false,
    };
  }

  if (stage === "night") {
    const canGoSafer = state.selectedStrategy !== "cautious";

    return {
      ...base,
      headerBadge: "Noche",
      addressBadge: "Nocturno",
      badgeTone: "night",
      resolutionStatus: "No recomendado de noche",
      operationalRisk: activeRoute?.operationalRisk?.overallLabel || "No recomendado de noche",
      recommendedRoute: `${buildStrategyLabel(state.selectedStrategy)} sugerida`,
      recommendationTitle: canGoSafer ? "Conviene pasar a ruta prudente" : "No recomendado de noche",
      recommendationCopy:
        activeRoute?.operationalRisk?.recommendation || "Conviene evitar esta ruta de noche.",
      primaryActionLabel: canGoSafer ? "Usar ruta prudente" : "No recomendado de noche",
      primaryActionKind: canGoSafer ? "safer" : "suggested",
      primaryActionDisabled: !canGoSafer,
    };
  }

  if (stage === "attention") {
    const canGoSafer = state.selectedStrategy !== "cautious";

    return {
      ...base,
      headerBadge: "Atencion",
      addressBadge: "Atencion",
      badgeTone: "warning",
      resolutionStatus: "Ruta con atencion",
      operationalRisk: activeRoute?.operationalRisk?.overallLabel || "Precaucion",
      recommendedRoute: `${buildStrategyLabel(state.selectedStrategy)} sugerida`,
      recommendationTitle: canGoSafer ? "Conviene bajar exposicion" : "Ruta lista con atencion",
      recommendationCopy:
        activeRoute?.operationalRisk?.recommendation || "La ruta toca un sector que requiere mas cuidado operativo.",
      primaryActionLabel: canGoSafer ? "Usar ruta prudente" : "Ir por ruta sugerida",
      primaryActionKind: canGoSafer ? "safer" : "suggested",
      primaryActionDisabled: false,
    };
  }

  if (stage === "route-ready") {
    return {
      ...base,
      headerBadge: "Lista",
      addressBadge: "Ruta lista",
      badgeTone: "success",
      resolutionStatus: "Ruta lista",
      operationalRisk: activeRoute?.operationalRisk?.overallLabel || "Normal",
      recommendedRoute: `${buildStrategyLabel(state.selectedStrategy)} sugerida`,
      recommendationTitle: `Ruta ${buildStrategyLabel(state.selectedStrategy).toLowerCase()} sugerida`,
      recommendationCopy: activeRoute?.summary || "Ruta lista para salir.",
      primaryActionLabel: "Ir por ruta sugerida",
      primaryActionKind: "suggested",
      primaryActionDisabled: false,
    };
  }

  return base;
}

function getOperationalStage() {
  if (state.isBusy) {
    return "interpreting";
  }

  if (state.addressAnalysis?.status === "outside") {
    return "outside";
  }

  if (!state.destination && state.addressAnalysis?.status === "doubtful") {
    return "doubtful";
  }

  const activeRoute = getActiveRoute();

  if (activeRoute?.operationalRisk?.overallLabel === "No recomendado de noche") {
    return "night";
  }

  if (activeRoute && activeRoute.operationalRisk?.overallLabel !== "Normal") {
    return "attention";
  }

  if (activeRoute) {
    return "route-ready";
  }

  if (state.destination) {
    return "valid";
  }

  if (state.addressAnalysis?.status === "doubtful") {
    return "doubtful";
  }

  return "waiting";
}

function renderRouteList(routes) {
  elements.routeList.replaceChildren();

  if (!routes.length) {
    elements.routeList.append(
      createEmptyState("Todavia no hay rutas activas. Busca una direccion valida para ver la sugerencia.")
    );
    return;
  }

  routes.slice(0, APP_CONFIG.maxRouteAlternatives).forEach((route, index) => {
    const button = document.createElement("button");
    const topLine = document.createElement("div");
    const title = document.createElement("strong");
    const subtitle = document.createElement("span");
    const copy = document.createElement("p");
    const tags = document.createElement("div");

    button.type = "button";
    button.className = "route-card";

    if (route.id === state.activeRouteId) {
      button.classList.add("is-active");
    }

    button.addEventListener("click", () => {
      state.activeRouteId = route.id;
      syncMapLayers();
      renderOperationalPanel();
    });

    topLine.className = "route-card-top";
    title.textContent = index === 0 ? "Sugerida" : `Alternativa ${index + 1}`;
    subtitle.className = "history-meta";
    subtitle.textContent = `${formatDistance(route.distanceMeters)} | ${formatDuration(route.durationSeconds)}`;
    topLine.append(title, subtitle);

    copy.textContent = route.summary;
    tags.className = "route-card-tags";
    tags.append(
      createTinyPill(route.operationalRisk.overallLabel, getRiskTone(route.operationalRisk.overallLabel)),
      createTinyPill(buildStrategyLabel(state.selectedStrategy), "accent")
    );

    button.append(topLine, copy, tags);
    elements.routeList.append(button);
  });
}

function renderReasonList(items) {
  elements.reasonList.replaceChildren();

  if (!items.length) {
    elements.reasonList.append(createReasonChip("Esperando informacion util para decidir."));
    return;
  }

  items.slice(0, 4).forEach((item) => {
    elements.reasonList.append(createReasonChip(item));
  });
}

function buildReasonItems() {
  const activeRoute = getActiveRoute();
  const reasons = [
    ...(state.addressAnalysis?.notes || []),
    state.destination ? "Destino dentro de Neuquen Capital." : "",
    ...(activeRoute?.operationalRisk?.reasons || []),
  ];

  return [...new Set(reasons.filter(Boolean))];
}

function renderHistory() {
  elements.historyList.replaceChildren();

  if (!state.destinationHistory.length) {
    elements.historyList.append(
      createEmptyState("Tus destinos validados van a quedar aqui para relanzar una busqueda en segundos.")
    );
    return;
  }

  state.destinationHistory.forEach((entry) => {
    const button = document.createElement("button");
    const title = document.createElement("strong");
    const meta = document.createElement("span");

    button.type = "button";
    button.className = "history-button";
    button.addEventListener("click", async () => {
      elements.addressInput.value = compactDestinationLabel(entry.label);
      await handleSearchAddress();
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
    copy.textContent = `${entry.destinationLabel} | ${entry.strategyLabel}`;

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
    routeRisk: activeRoute.operationalRisk?.overallLabel,
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
    meta.className = "history-meta";
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

function setBadgeTone(element, tone) {
  element.classList.remove("is-neutral", "is-success", "is-warning", "is-danger", "is-night");

  if (tone === "success") {
    element.classList.add("is-success");
    return;
  }

  if (tone === "warning") {
    element.classList.add("is-warning");
    return;
  }

  if (tone === "danger") {
    element.classList.add("is-danger");
    return;
  }

  if (tone === "night") {
    element.classList.add("is-night");
    return;
  }

  element.classList.add("is-neutral");
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

function createReasonChip(label) {
  const chip = document.createElement("span");
  chip.className = "reason-chip";
  chip.textContent = label;
  return chip;
}

function createTinyPill(label, tone = "accent") {
  const pill = document.createElement("span");
  pill.className = "tiny-pill";
  pill.classList.add(`is-${tone}`);
  pill.textContent = label;
  return pill;
}

function getActiveRoute() {
  return state.routes.find((route) => route.id === state.activeRouteId) || null;
}

function getSortedRoutes() {
  return [...state.routes].sort((left, right) => left.strategyScore - right.strategyScore);
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
    ? "Centro de Neuquen (referencia)"
    : compactDestinationLabel(state.origin.label || "Mi ubicacion actual");
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

function handleViewportResize() {
  scheduleMapResizeBurst();
}

function scheduleMapResizeBurst() {
  queueMapResize();
  window.setTimeout(() => {
    queueMapResize();
  }, 180);
}

function queueMapResize(delay = 0) {
  if (!state.mapService?.resize) {
    return;
  }

  if (mapResizeFrameId) {
    window.cancelAnimationFrame(mapResizeFrameId);
    mapResizeFrameId = 0;
  }

  if (mapResizeTimeoutId) {
    window.clearTimeout(mapResizeTimeoutId);
    mapResizeTimeoutId = 0;
  }

  const runResize = () => {
    mapResizeFrameId = window.requestAnimationFrame(() => {
      mapResizeFrameId = 0;
      state.mapService?.resize?.();
    });
  };

  if (delay > 0) {
    mapResizeTimeoutId = window.setTimeout(() => {
      mapResizeTimeoutId = 0;
      runResize();
    }, delay);
    return;
  }

  runResize();
}

function scrollToSection(node) {
  if (node instanceof HTMLDetailsElement && !node.open) {
    node.open = true;
  }

  node?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
  scheduleMapResizeBurst();
}

async function withBusyState(task) {
  if (state.isBusy) {
    return;
  }

  state.isBusy = true;
  renderOperationalPanel();

  try {
    await task();
  } finally {
    state.isBusy = false;
    renderOperationalPanel();
  }
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
