import { getActiveEngine } from "./engine/engine.js";
import { getPlaceMemoryTagLabel } from "./data/place_memory_schema.js";
import { exportCashEntriesExcel, exportCashEntriesPdf } from "./services/export_service.js";
import { geocodeAddress, reverseGeocode } from "./services/geocoding_service.js";
import {
  buildLiveNavigationMessage,
  computeNavigationSnapshot,
  getLocationErrorMessage,
  shouldFollowWithCamera,
  shouldRecalculateRoute,
  startLiveLocation,
  stopLiveLocation,
  updateUserLocation,
} from "./services/live_navigation_service.js";
import { createMapService } from "./services/map_service.js";
import {
  buildPlaceMemoryEntry,
  getPlaceMemories,
  savePlaceMemory,
  summarizePlaceMemoryForDestination,
} from "./services/place_memory_service.js";
import { evaluateOperationalRisk, getRiskTone, getRiskZones } from "./services/risk_service.js";
import { getAlternativeRoutes, getRouteOptions, summarizeRoute } from "./services/routing_service.js";
import { clearSessionState, loadSessionState, saveSessionState } from "./services/session_state_service.js";
import {
  buildDestinationMemoryProfile,
  buildTripMemoryEntry,
  buildTripMemoryPreview,
  getTripMemories,
  rankRoutesWithMemory,
  saveTripMemory,
} from "./services/trip_memory_service.js";
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
import { haversineDistanceMeters, isValidPoint } from "./utils/geo_utils.js";
import {
  calculateTripDelta,
  formatTripDelta,
  getElapsedTripSeconds,
  getHourContext,
  startTripTimer,
  stopTripTimer,
} from "./utils/time_utils.js";

const state = {
  mapService: null,
  mapInteractionCleanup: null,
  selectedStrategy: readJsonStorage(APP_CONFIG.storageKeys.lastStrategy, "balanced"),
  destinationHistory: normalizeDestinationHistory(
    readJsonStorage(APP_CONFIG.storageKeys.destinationHistory, readJsonStorage("riderHub.addressHistory.v1", []))
  ),
  routeFeedback: normalizeRouteFeedback(readJsonStorage(APP_CONFIG.storageKeys.routeFeedback, [])),
  tripMemories: getTripMemories(),
  placeMemories: getPlaceMemories(),
  cashEntries: [],
  origin: { ...APP_CONFIG.referenceOrigin },
  destination: null,
  addressAnalysis: null,
  routes: [],
  activeRouteId: "",
  recommendedRouteId: "",
  activeProvider: "",
  activeProviderNote: "",
  destinationProfile: null,
  destinationMemorySummary: null,
  placeMemorySummary: null,
  placeMemoryDraft: {
    tags: [],
    note: "",
  },
  activeTrip: null,
  pendingTripReview: null,
  tripTickerId: 0,
  trackingWatchId: 0,
  sessionPersistTimeoutId: 0,
  autoRecalcTimeoutId: 0,
  ignoreMapGestureUntil: 0,
  routeRecalcInProgress: false,
  deviationAlert: null,
  lastSearchInput: "",
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
  navigationHud: document.querySelector("#navigation-hud"),
  navigationHudState: document.querySelector("#navigation-hud-state"),
  navigationHudTitle: document.querySelector("#navigation-hud-title"),
  navigationHudCopy: document.querySelector("#navigation-hud-copy"),
  navigationRemainingTime: document.querySelector("#navigation-remaining-time"),
  navigationRemainingDistance: document.querySelector("#navigation-remaining-distance"),
  navigationProgressPill: document.querySelector("#navigation-progress-pill"),
  navigationProgressBar: document.querySelector("#navigation-progress-bar"),
  centerOnUserButton: document.querySelector("#center-on-user-button"),
  pauseNavigationButton: document.querySelector("#pause-navigation-button"),
  hudRecalculateButton: document.querySelector("#hud-recalculate-button"),
  finishNavigationButton: document.querySelector("#finish-navigation-button"),
  interpretedAddress: document.querySelector("#interpreted-address"),
  addressStateBadge: document.querySelector("#address-state-badge"),
  modeChips: Array.from(document.querySelectorAll("[data-trip-stage]")),
  resolutionStatus: document.querySelector("#resolution-status"),
  operationalRisk: document.querySelector("#operational-risk"),
  recommendedRoute: document.querySelector("#recommended-route"),
  recommendationTitle: document.querySelector("#recommendation-title"),
  recommendationCopy: document.querySelector("#recommendation-copy"),
  reasonList: document.querySelector("#reason-list"),
  routeDistance: document.querySelector("#route-distance"),
  routeDuration: document.querySelector("#route-duration"),
  tripLiveDuration: document.querySelector("#trip-live-duration"),
  routeHistorySummary: document.querySelector("#route-history-summary"),
  originSummary: document.querySelector("#origin-summary"),
  routeReliability: document.querySelector("#route-reliability"),
  routeHistoryDetail: document.querySelector("#route-history-detail"),
  routeWhy: document.querySelector("#route-why"),
  routeProviderNote: document.querySelector("#route-provider-note"),
  tripStrip: document.querySelector("#trip-strip"),
  tripStatusTitle: document.querySelector("#trip-status-title"),
  tripStatusCopy: document.querySelector("#trip-status-copy"),
  tripEstimatedPill: document.querySelector("#trip-estimated-pill"),
  tripDeltaPill: document.querySelector("#trip-delta-pill"),
  deviationAlert: document.querySelector("#deviation-alert"),
  deviationAlertTitle: document.querySelector("#deviation-alert-title"),
  deviationAlertCopy: document.querySelector("#deviation-alert-copy"),
  recalculateRouteButton: document.querySelector("#recalculate-route-button"),
  routeList: document.querySelector("#route-list"),
  historyList: document.querySelector("#history-list"),
  feedbackList: document.querySelector("#feedback-list"),
  tripMemoryList: document.querySelector("#trip-memory-list"),
  tripMemoryCount: document.querySelector("#trip-memory-count"),
  placeMemorySummary: document.querySelector("#place-memory-summary"),
  placeMemoryNoteInput: document.querySelector("#place-memory-note-input"),
  savePlaceMemoryButton: document.querySelector("#save-place-memory-button"),
  memoryTagButtons: Array.from(document.querySelectorAll(".memory-tag-button")),
  placeMemoryList: document.querySelector("#place-memory-list"),
  placeMemoryCount: document.querySelector("#place-memory-count"),
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
  postTripDialog: document.querySelector("#post-trip-dialog"),
  postTripForm: document.querySelector("#post-trip-form"),
  postTripSummary: document.querySelector("#post-trip-summary"),
  dismissTripDialogButton: document.querySelector("#dismiss-trip-dialog-button"),
  postTripDetour: document.querySelector("#post-trip-detour"),
  postTripObservation: document.querySelector("#post-trip-observation"),
  toastStack: document.querySelector("#toast-stack"),
};

let mapResizeFrameId = 0;
let mapResizeTimeoutId = 0;

init();

async function init() {
  state.cashEntries = loadCashEntries();
  restoreRecoveredState();
  elements.cashDateTime.value = getDateTimeLocalValue();
  elements.addressInput.value = state.lastSearchInput || compactDestinationLabel(state.destination?.label || "");

  bindEvents();
  updateStrategyButtons();
  renderAddressSuggestions();
  renderHistory();
  renderFeedback();
  renderTripMemories();
  renderPlaceMemoryList();
  renderPlaceMemoryComposer();
  renderCashView();
  renderOperationalPanel();
  syncCashAddressWithLastDestination();

  try {
    state.mapService = await createMapService({
      containerId: "map",
      riskZones: getRiskZones(),
    });
    state.mapInteractionCleanup = state.mapService.onMapInteraction(() => {
      handleMapNavigationGesture();
    });

    syncMapLayers();
    scheduleMapResizeBurst();
    setInlineStatus(elements.mapStatus, "Mapa listo. Busca un destino dentro de Neuquen Capital.", "success");

    if (state.activeTrip) {
      resumeRecoveredTrip();
    }

    if (state.pendingTripReview) {
      openPostTripDialog();
    }
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
      if (state.selectedStrategy === button.dataset.strategy || state.activeTrip) {
        return;
      }

      state.selectedStrategy = button.dataset.strategy;
      writeJsonStorage(APP_CONFIG.storageKeys.lastStrategy, state.selectedStrategy);
      updateStrategyButtons();

      if (state.destination && state.routes.length) {
        rerankCurrentRoutes("strategy");
      } else if (state.destination) {
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

  elements.memoryTagButtons.forEach((button) => {
    button.addEventListener("click", () => {
      togglePlaceMemoryTag(button.dataset.placeTag || "");
    });
  });

  elements.addressInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      await handleSearchAddress();
    }
  });

  elements.placeMemoryNoteInput.addEventListener("input", () => {
    state.placeMemoryDraft.note = elements.placeMemoryNoteInput.value.trim();
    renderPlaceMemoryComposer();
  });

  elements.pasteAddressButton.addEventListener("click", handlePasteAddress);
  elements.searchAddressButton.addEventListener("click", handleSearchAddress);
  elements.useLocationButton.addEventListener("click", handleUseCurrentLocation);
  elements.primaryActionButton.addEventListener("click", handlePrimaryAction);
  elements.showAlternativeButton.addEventListener("click", handleShowAlternativeRoute);
  elements.openExternalNavButton.addEventListener("click", openExternalNavigation);
  elements.centerOnUserButton.addEventListener("click", centerOnUser);
  elements.pauseNavigationButton.addEventListener("click", toggleLiveNavigationPause);
  elements.hudRecalculateButton.addEventListener("click", () => {
    void handleRecalculateRoute("manual");
  });
  elements.finishNavigationButton.addEventListener("click", finishActiveTrip);
  elements.recalculateRouteButton.addEventListener("click", () => {
    void handleRecalculateRoute("manual");
  });
  elements.savePlaceMemoryButton.addEventListener("click", handleSavePlaceMemory);
  elements.jumpHistoryButton.addEventListener("click", () => scrollToSection(elements.historyAnchor));
  elements.jumpCashButton.addEventListener("click", () => scrollToSection(elements.cashAnchor));
  elements.dismissTripDialogButton.addEventListener("click", closePostTripDialog);
  elements.postTripForm.addEventListener("submit", handlePostTripSubmit);
  elements.postTripDialog.addEventListener("close", () => {
    renderOperationalPanel();
  });

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

  if (state.activeTrip) {
    const message = "Finaliza el viaje actual antes de buscar otro destino.";
    setInlineStatus(elements.mapStatus, message, "warning");
    showToast(message, "warning");
    return;
  }

  if (state.pendingTripReview) {
    const message = "Cierra el viaje pendiente antes de cambiar de destino.";
    setInlineStatus(elements.mapStatus, message, "warning");
    showToast(message, "warning");
    return;
  }

  if (!rawInput) {
    const message = "Ingresa o pega una direccion para empezar.";
    setInlineStatus(elements.mapStatus, message, "warning");
    showToast(message, "warning");
    elements.addressInput.focus();
    return;
  }

  await withBusyState(async () => {
    state.lastSearchInput = rawInput;
    state.routeError = "";
    state.addressAnalysis = {
      status: "interpreting",
      interpretedLine: "Interpretando direccion...",
      notes: [],
      reason: "Estoy limpiando el texto y validando Neuquen Capital.",
    };
    state.routes = [];
    state.activeRouteId = "";
    state.recommendedRouteId = "";
    state.destinationProfile = null;
    state.destinationMemorySummary = null;
    state.placeMemorySummary = null;
    state.placeMemoryDraft = { tags: [], note: "" };
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
      state.activeProviderNote = "";
      state.placeMemorySummary = null;
      state.placeMemoryDraft = { tags: [], note: "" };
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
  if (state.activeTrip) {
    const message = "No cambio el origen mientras hay un viaje activo.";
    setInlineStatus(elements.mapStatus, message, "warning");
    showToast(message, "warning");
    return;
  }

  if (state.pendingTripReview) {
    const message = "Cierra el viaje pendiente antes de mover el origen.";
    setInlineStatus(elements.mapStatus, message, "warning");
    showToast(message, "warning");
    return;
  }

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

async function recalculateRouteForCurrentDestination(source, originOverride = null) {
  if (!state.destination) {
    return;
  }

  await withBusyState(async () => {
    await calculateRoutesForCurrentDestination(source, originOverride);
  });
}

async function calculateRoutesForCurrentDestination(source, originOverride = null) {
  if (!state.destination) {
    return;
  }

  const routeOrigin = originOverride || state.origin;
  const previousRouteId = state.activeTrip?.routeId || state.activeRouteId;
  const previousStrategy = state.activeTrip?.strategy || getActiveRoute()?.displayStrategy || "";

  setInlineStatus(
    elements.mapStatus,
    "Calculando rutas reales, comparando estrategias y evaluando riesgo operativo...",
    "default"
  );

  try {
    const routeResponse = await getRouteOptions({
      origin: routeOrigin,
      destination: state.destination.coordinates,
    });

    const destinationFeature = buildPointFeature(state.destination.coordinates, {
      kind: "destination",
    });
    state.activeProvider = routeResponse.provider;
    state.activeProviderNote = routeResponse.providerNote || "";

    const analyzedRoutes = routeResponse.routes.map((route) => {
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
        baseSummary: summarizeRoute({
          route,
          strategy: route.strategy,
          operationalRisk,
        }),
      };
    });

    state.destinationProfile = buildDestinationMemoryProfile({
      rawAddress: state.lastSearchInput,
      destination: state.destination,
      addressAnalysis: state.addressAnalysis,
      operationalRisk: analyzedRoutes[0]?.operationalRisk || null,
    });
    applyRouteLearning(analyzedRoutes);

    if (source === "manual-recalc" || source === "auto-recalc") {
      state.activeRouteId = state.recommendedRouteId || state.activeRouteId;
    }

    synchronizeActiveTripWithCurrentRoute();

    if (state.activeTrip && (source === "manual-recalc" || source === "auto-recalc")) {
      state.activeTrip.liveGuidance = buildLiveNavigationMessage({
        recalculated: true,
        offRoute: Boolean(state.deviationAlert),
        routeChanged: previousRouteId !== state.recommendedRouteId,
        recommendedStrategy: getSuggestedRoute()?.displayStrategy || getSuggestedRoute()?.strategy || "",
        currentStrategy: previousStrategy,
      });
    }

    clearDeviationAlert();
    state.routeRecalcInProgress = false;
    state.routeError = "";
    syncMapLayers();

    if (state.activeTrip?.currentLocation && state.activeTrip.followUser) {
      centerOnUser({ silent: true, force: true });
    }

    renderOperationalPanel();

    if (source === "strategy") {
      setInlineStatus(elements.mapStatus, "Ruta actualizada con la nueva prioridad elegida.", "success");
      showToast(`Ruta ${buildStrategyLabel(state.selectedStrategy).toLowerCase()} actualizada.`, "success");
    } else if (source === "manual-recalc") {
      setInlineStatus(elements.mapStatus, "Ruta recalculada desde tu posicion actual.", "success");
      showToast("Ruta recalculada desde tu posicion actual.", "success");
    } else if (source === "auto-recalc") {
      setInlineStatus(elements.mapStatus, "Ruta actualizada automaticamente por desvio.", "success");
      showToast("Ruta recalculada automaticamente por desvio.", "success");
    } else {
      setInlineStatus(elements.mapStatus, "Ruta lista para navegar.", "success");
    }
  } catch (error) {
    console.error(error);
    state.routes = [];
    state.activeRouteId = "";
    state.recommendedRouteId = "";
    state.activeProviderNote = "";
    state.routeRecalcInProgress = false;
    state.routeError = "No pude calcular una ruta usable en este momento.";
    syncMapLayers();
    renderOperationalPanel();
    setInlineStatus(elements.mapStatus, state.routeError, "danger");
    showToast("Fallo el calculo de ruta.", "danger");
  }
}

function rerankCurrentRoutes(source = "strategy") {
  if (!state.routes.length || !state.destinationProfile) {
    return;
  }

  applyRouteLearning(state.routes);
  syncMapLayers();
  renderOperationalPanel();

  if (source === "strategy") {
    showToast(`Prioridad ${buildStrategyLabel(state.selectedStrategy).toLowerCase()} actualizada.`, "success");
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
    if (state.routes.length) {
      rerankCurrentRoutes("strategy");
    } else {
      await recalculateRouteForCurrentDestination("strategy");
    }
    return;
  }

  if (uiState.primaryActionKind === "suggested") {
    selectSuggestedRoute();
    return;
  }

  if (uiState.primaryActionKind === "recalculate") {
    await handleRecalculateRoute("manual");
    return;
  }

  if (uiState.primaryActionKind === "start-trip") {
    startActiveTrip();
    return;
  }

  if (uiState.primaryActionKind === "finish-trip") {
    finishActiveTrip();
    return;
  }

  if (uiState.primaryActionKind === "open-closing") {
    openPostTripDialog();
  }
}

function handleShowAlternativeRoute() {
  if (state.activeTrip || state.pendingTripReview) {
    return;
  }

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
  if (state.activeTrip || state.pendingTripReview) {
    return;
  }

  const suggestedRoute = getSuggestedRoute();

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

  const activeLocation = state.activeTrip?.currentLocation || null;
  const trackingFeature = activeLocation ? buildPointFeature(activeLocation, { kind: "tracking" }) : null;

  state.mapService.setOrigin(buildPointFeature(state.origin, { kind: "origin" }));
  state.mapService.setDestination(
    state.destination ? buildPointFeature(state.destination.coordinates, { kind: "destination" }) : null
  );
  state.mapService.setRoutes(state.routes, state.activeRouteId, {
    origin: state.origin,
    destination: state.destination,
    trackingPoint: activeLocation,
    shouldFit: !state.activeTrip,
    bottomInset: getNavigationHudInset(),
  });
  state.mapService.setTracking(trackingFeature, buildTrackingTrailFeature());
  state.mapService.setUserLocation(activeLocation, {
    heading: activeLocation?.heading,
    paused: Boolean(state.activeTrip?.liveLocationPaused),
    offRoute: Boolean(state.deviationAlert),
  });
  queueMapResize();
}

function syncTrackingLayersOnly() {
  if (!state.mapService) {
    return;
  }

  const activeLocation = state.activeTrip?.currentLocation || null;
  state.mapService.setTracking(
    activeLocation ? buildPointFeature(activeLocation, { kind: "tracking" }) : null,
    buildTrackingTrailFeature()
  );
  state.mapService.setUserLocation(activeLocation, {
    heading: activeLocation?.heading,
    paused: Boolean(state.activeTrip?.liveLocationPaused),
    offRoute: Boolean(state.deviationAlert),
  });
}

function centerOnUser(options = {}) {
  const currentPoint = options.point || state.activeTrip?.currentLocation;

  if (!state.mapService || !isValidPoint(currentPoint)) {
    if (!options.silent) {
      showToast("Todavia no tengo una posicion confiable para recentrar.", "warning");
    }
    return false;
  }

  const safeBearing = Number.isFinite(currentPoint.heading)
    ? Number(currentPoint.heading)
    : undefined;
  const verticalOffset = -Math.round(Math.min(148, Math.max(72, getNavigationHudInset() * 0.34)));

  state.ignoreMapGestureUntil = Date.now() + APP_CONFIG.navigationCameraDurationMs + 220;
  state.mapService.centerOnUser(currentPoint, {
    bearing: safeBearing,
    offset: [0, verticalOffset],
    duration: options.force ? Math.max(220, APP_CONFIG.navigationCameraDurationMs - 180) : APP_CONFIG.navigationCameraDurationMs,
  });

  if (state.activeTrip) {
    state.activeTrip.followUser = true;
    state.activeTrip.lastCenteredAt = new Date().toISOString();
    state.activeTrip.lastCenteredPoint = { ...currentPoint };
  }

  if (!options.silent) {
    showToast("Mapa recentrado en tu posicion.", "success");
  }

  return true;
}

function toggleLiveNavigationPause() {
  if (!state.activeTrip) {
    return;
  }

  state.activeTrip.liveLocationPaused = !state.activeTrip.liveLocationPaused;

  if (state.activeTrip.liveLocationPaused) {
    stopTrackingWatch();
    cancelAutoRecalc();
    state.activeTrip.followUser = false;
    state.activeTrip.liveGuidance = "Seguimiento en pausa. Conservando la ultima posicion confiable.";
    setInlineStatus(elements.mapStatus, "Seguimiento pausado. Mantengo la ultima posicion confiable.", "warning");
    showToast("Seguimiento en pausa.", "warning");
  } else {
    state.activeTrip.liveGuidance = "Ruta actual todavia conveniente.";
    setInlineStatus(elements.mapStatus, "Seguimiento reanudado desde tu posicion actual.", "success");
    startTrackingWatch();
    centerOnUser({ silent: true, force: true });
    showToast("Seguimiento reanudado.", "success");
  }

  syncTrackingLayersOnly();
  renderOperationalPanel();
}

function handleMapNavigationGesture() {
  if (!state.activeTrip || state.activeTrip.liveLocationPaused) {
    return;
  }

  if (Date.now() < Number(state.ignoreMapGestureUntil || 0)) {
    return;
  }

  const wasFollowing = state.activeTrip.followUser;
  state.activeTrip.followUser = false;

  if (wasFollowing && !state.deviationAlert && !state.routeRecalcInProgress) {
    state.activeTrip.liveGuidance = "Mapa libre. Toca Recentrar para volver a seguir tu avance.";
  }

  renderOperationalPanel();
}

function maybeFollowUserOnMap(currentPoint) {
  if (!state.activeTrip || state.activeTrip.liveLocationPaused) {
    return;
  }

  const shouldCenter = shouldFollowWithCamera({
    followUser: state.activeTrip.followUser,
    previousCenteredPoint: state.activeTrip.lastCenteredPoint,
    currentPoint,
    lastCenteredAt: state.activeTrip.lastCenteredAt,
  });

  if (!shouldCenter) {
    return;
  }

  centerOnUser({
    point: currentPoint,
    silent: true,
    force: true,
  });
}

function getNavigationHudInset() {
  const shouldReserveSpace = Boolean(getActiveRoute() || state.activeTrip);

  if (!shouldReserveSpace) {
    return 0;
  }

  const measuredHeight = Number(elements.navigationHud?.offsetHeight || 0);

  if (measuredHeight > 0) {
    return measuredHeight + 28;
  }

  return window.matchMedia("(max-width: 739px)").matches ? 216 : 196;
}

function renderNavigationHud(uiState, activeRoute) {
  const activeTrip = state.activeTrip;
  const snapshot = activeTrip?.navigationSnapshot || computeNavigationSnapshot(activeRoute, activeTrip?.currentLocation);
  const stageTone =
    uiState.modeStage === "off-route"
      ? "warning"
      : uiState.modeStage === "recalculating"
        ? "accent"
        : uiState.badgeTone === "danger"
          ? "danger"
          : uiState.badgeTone === "warning"
            ? "warning"
            : "success";
  const progressRatio = activeTrip ? snapshot.progressRatio || 0 : activeRoute ? 0 : 0;
  const remainingDurationLabel = activeTrip
    ? snapshot.remainingDurationSeconds > 0
      ? formatDuration(snapshot.remainingDurationSeconds)
      : "Calculando"
    : activeRoute
      ? formatDuration(activeRoute.durationSeconds)
      : "Sin dato";
  const remainingDistanceLabel = activeTrip
    ? snapshot.remainingDistanceMeters > 15
      ? formatDistance(snapshot.remainingDistanceMeters)
      : "Muy cerca"
    : activeRoute
      ? formatDistance(activeRoute.distanceMeters)
      : "Sin dato";
  const title = activeTrip
    ? `Hacia ${compactDestinationLabel(state.destination?.label || state.lastSearchInput || "destino")}`
    : activeRoute
      ? `${buildStrategyLabel(activeRoute.displayStrategy || activeRoute.strategy)} lista para salir`
      : "Listo para navegar";
  const progressText = activeTrip
    ? `${Math.round(progressRatio * 100)}% hecho`
    : activeRoute
      ? "Lista para salir"
      : "En preparacion";
  const copy = activeTrip
    ? activeTrip.liveGuidance || buildNavigationReference()
    : activeRoute?.recommendation || activeRoute?.baseSummary || "Busca una ruta para activar la navegacion.";

  elements.navigationHud.hidden = !activeRoute && !activeTrip;
  elements.navigationHudState.textContent = buildNavigationStateLabel(uiState.modeStage, activeTrip?.liveLocationPaused);
  elements.navigationHudState.className = `tiny-pill is-${stageTone}`;
  elements.navigationHudTitle.textContent = title;
  elements.navigationHudCopy.textContent = copy;
  elements.navigationRemainingTime.textContent = remainingDurationLabel;
  elements.navigationRemainingDistance.textContent = remainingDistanceLabel;
  elements.navigationProgressPill.textContent = progressText;
  elements.navigationProgressBar.style.width = `${Math.max(0, Math.min(100, progressRatio * 100))}%`;
  elements.centerOnUserButton.disabled = !activeTrip?.currentLocation;
  elements.hudRecalculateButton.disabled =
    !activeTrip?.currentLocation || !state.destination || Boolean(state.routeRecalcInProgress);
  elements.pauseNavigationButton.disabled = !activeTrip;
  elements.pauseNavigationButton.textContent = activeTrip?.liveLocationPaused ? "Reanudar" : "Pausar";
  elements.finishNavigationButton.disabled = !activeTrip;
}

function buildNavigationReference() {
  const parts = [
    state.destinationProfile?.streetName || state.addressAnalysis?.streetName || "",
    state.destinationProfile?.zoneLabel || "",
  ].filter(Boolean);

  if (parts.length) {
    return `Referencia principal: ${parts.join(" | ")}`;
  }

  return `Referencia principal: ${compactDestinationLabel(state.destination?.label || "Neuquen Capital")}`;
}

function buildNavigationStateLabel(stage, isPaused = false) {
  if (isPaused) {
    return "Pausada";
  }

  if (stage === "recalculating") {
    return "Recalculando";
  }

  if (stage === "off-route") {
    return "Desvio";
  }

  if (stage === "tracking") {
    return "Navegando";
  }

  return "Ruta lista";
}

function renderOperationalPanel() {
  const uiState = deriveUiState();
  const activeRoute = getActiveRoute();
  const navigationSnapshot =
    state.activeTrip?.navigationSnapshot || computeNavigationSnapshot(activeRoute, state.activeTrip?.currentLocation);
  const elapsedSeconds = state.activeTrip ? getElapsedTripSeconds(state.activeTrip) : 0;

  elements.appStatusPill.textContent = uiState.headerBadge;
  setBadgeTone(elements.appStatusPill, uiState.badgeTone);
  renderModeStrip(uiState.modeStage);

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
  elements.tripLiveDuration.textContent = state.activeTrip ? formatDuration(elapsedSeconds) : "Sin seguimiento";
  elements.routeHistorySummary.textContent =
    activeRoute?.historyLabel || state.destinationMemorySummary?.label || "Sin experiencia";
  elements.originSummary.textContent = buildOriginCopy();
  elements.routeReliability.textContent = activeRoute
    ? `Confiabilidad ${formatReliabilityLabel(activeRoute.historyMetrics?.reliabilityScore || 0.5)}`
    : "Confiabilidad inicial";
  elements.routeHistoryDetail.textContent =
    activeRoute?.historyDetail ||
    state.destinationMemorySummary?.detail ||
    "Sin experiencia previa suficiente para darle peso fuerte a la memoria.";
  elements.routeWhy.textContent = activeRoute?.recommendation || activeRoute?.baseSummary || state.routeError || "Todavia no hay una ruta activa.";
  elements.routeProviderNote.textContent = state.activeProviderNote || buildProviderLabel(state.activeProvider);
  elements.tripStrip.hidden = !state.activeTrip;
  elements.tripStatusTitle.textContent = state.activeTrip
    ? `Navegando hacia ${compactDestinationLabel(state.destination?.label || state.lastSearchInput || "destino")}`
    : "Sin viaje activo";
  elements.tripStatusCopy.textContent = state.activeTrip
    ? `${state.activeTrip.liveGuidance || "Ruta actual todavia conveniente."} | ${buildNavigationReference()}`
    : "Cuando inicies una ruta, comparo estimado vs real y lo guardo para futuras recomendaciones.";
  elements.tripEstimatedPill.textContent = state.activeTrip
    ? `Restante: ${navigationSnapshot.remainingDurationSeconds > 0 ? formatDuration(navigationSnapshot.remainingDurationSeconds) : "calculando"}`
    : "Estimado: sin dato";
  elements.tripDeltaPill.textContent = state.activeTrip
    ? `${formatTripDelta(state.activeTrip.delta)} | ${navigationSnapshot.remainingDistanceMeters > 0 ? formatDistance(navigationSnapshot.remainingDistanceMeters) : "Sin dato"}`
    : "Delta: pendiente";
  elements.deviationAlert.hidden = !state.deviationAlert;
  elements.deviationAlertTitle.textContent = state.deviationAlert?.title || "Sigues en ruta";
  elements.deviationAlertCopy.textContent =
    state.deviationAlert?.copy ||
    "Si te alejas de la ruta activa, te voy a ofrecer recalcular sin spamear.";
  elements.recalculateRouteButton.disabled = Boolean(state.isBusy || !state.activeTrip);
  elements.placeMemorySummary.textContent =
    state.placeMemorySummary?.hasMemory
      ? `${state.placeMemorySummary.headline} | ${state.placeMemorySummary.detail}`
      : "Todavia no guardaste favoritas ni observaciones para este destino, calle o zona.";

  elements.primaryActionButton.textContent = uiState.primaryActionLabel;
  elements.primaryActionButton.disabled = uiState.primaryActionDisabled;
  elements.showAlternativeButton.disabled =
    state.activeTrip || state.pendingTripReview || getAlternativeRoutes(state.routes, state.activeRouteId).length === 0;
  elements.openExternalNavButton.disabled = !state.destination || Boolean(state.pendingTripReview);

  elements.feedbackButtons.forEach((button) => {
    button.disabled = !activeRoute || Boolean(state.pendingTripReview);
  });

  elements.strategyButtons.forEach((button) => {
    button.disabled = Boolean(state.activeTrip || state.pendingTripReview);
  });

  renderNavigationHud(uiState, activeRoute);
  renderPlaceMemoryComposer();
  renderPlaceMemoryList();
  renderReasonList(buildReasonItems());
  renderRouteList(getSortedRoutes());
  queueMapResize(40);
  scheduleSessionSave();
}

function deriveUiState() {
  const activeRoute = getActiveRoute();
  const stage = getOperationalStage();
  const suggestedRoute = getSuggestedRoute();
  const suggestedLabel = buildStrategyLabel(
    suggestedRoute?.displayStrategy || suggestedRoute?.strategy || state.selectedStrategy
  );
  const currentLabel = buildStrategyLabel(activeRoute?.displayStrategy || activeRoute?.strategy || state.selectedStrategy);
  const suggestedTitle =
    suggestedRoute?.alternativeTitle && suggestedRoute.alternativeTitle !== "Sugerida"
      ? suggestedRoute.alternativeTitle
      : suggestedLabel;
  const hasSuggestedAlternative = Boolean(suggestedRoute && activeRoute && suggestedRoute.id !== activeRoute.id);
  const base = {
    headerBadge: "Esperando",
    addressBadge: "Esperando",
    badgeTone: "neutral",
    modeStage: "waiting",
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
      modeStage: "waiting",
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
      modeStage: "waiting",
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
      modeStage: "waiting",
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
      modeStage: "waiting",
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

  if (stage === "recalculating") {
    return {
      ...base,
      headerBadge: "Recalculando",
      addressBadge: "Recalculando",
      badgeTone: "warning",
      modeStage: "recalculating",
      resolutionStatus: "Recalculando desde tu posicion",
      operationalRisk: activeRoute?.operationalRisk?.overallLabel || "En revision",
      recommendedRoute: currentLabel,
      recommendationTitle: "Buscando mejor opcion desde donde vas",
      recommendationCopy:
        state.activeTrip?.liveGuidance ||
        "Estoy evaluando una nueva ruta sin perder el hilo del viaje.",
      primaryActionLabel: "Finalizar viaje",
      primaryActionKind: "finish-trip",
      primaryActionDisabled: false,
    };
  }

  if (stage === "off-route") {
    return {
      ...base,
      headerBadge: "Desvio",
      addressBadge: "Desvio",
      badgeTone: "warning",
      modeStage: "off-route",
      resolutionStatus: "Desvio detectado",
      operationalRisk: activeRoute?.operationalRisk?.overallLabel || "Precaucion",
      recommendedRoute: currentLabel,
      recommendationTitle: "Conviene revisar desde tu posicion actual",
      recommendationCopy:
        state.deviationAlert?.copy ||
        state.activeTrip?.liveGuidance ||
        "Puedo recalcular desde la calle en la que estas ahora.",
      primaryActionLabel: "Recalcular",
      primaryActionKind: "recalculate",
      primaryActionDisabled: false,
    };
  }

  if (stage === "tracking") {
    return {
      ...base,
      headerBadge: state.activeTrip?.liveLocationPaused ? "Pausada" : "En viaje",
      addressBadge: state.activeTrip?.liveLocationPaused ? "Pausada" : "Siguiendo",
      badgeTone: state.activeTrip?.liveLocationPaused ? "warning" : "success",
      modeStage: "tracking",
      resolutionStatus: state.activeTrip?.liveLocationPaused ? "Seguimiento en pausa" : "Seguimiento activo",
      operationalRisk: activeRoute?.operationalRisk?.overallLabel || "Sin evaluar",
      recommendedRoute: currentLabel,
      recommendationTitle: "Viaje en curso",
      recommendationCopy:
        state.activeTrip?.liveGuidance ||
        `Estoy comparando ${formatDuration(
          activeRoute?.durationSeconds || 0
        )} estimados contra el tiempo real para aprender de este destino.`,
      primaryActionLabel: "Finalizar viaje",
      primaryActionKind: "finish-trip",
      primaryActionDisabled: false,
    };
  }

  if (stage === "closing") {
    return {
      ...base,
      headerBadge: "Finalizado",
      addressBadge: "Guardar",
      badgeTone: "warning",
      modeStage: "closing",
      resolutionStatus: "Viaje finalizado",
      operationalRisk: activeRoute?.operationalRisk?.overallLabel || "Sin evaluar",
      recommendedRoute: currentLabel,
      recommendationTitle: "Falta cerrar este viaje",
      recommendationCopy:
        state.pendingTripReview?.delta
          ? `Real ${formatDuration(state.pendingTripReview.actualDurationSeconds)} | ${formatTripDelta(state.pendingTripReview.delta)}`
          : "Guarda feedback breve para consolidar el aprendizaje de este viaje.",
      primaryActionLabel: "Abrir cierre",
      primaryActionKind: "open-closing",
      primaryActionDisabled: false,
    };
  }

  if (stage === "night") {
    return {
      ...base,
      headerBadge: "Noche",
      addressBadge: "Nocturno",
      badgeTone: "night",
      modeStage: "route-ready",
      resolutionStatus: "No recomendado de noche",
      operationalRisk: activeRoute?.operationalRisk?.overallLabel || "No recomendado de noche",
      recommendedRoute: suggestedRoute ? suggestedLabel : currentLabel,
      recommendationTitle: hasSuggestedAlternative ? "Conviene pasar a la sugerida" : "Precaucion nocturna",
      recommendationCopy:
        state.placeMemorySummary?.shouldAvoidAtNight
          ? state.placeMemorySummary.detail
          : suggestedRoute?.recommendation ||
            activeRoute?.operationalRisk?.recommendation ||
            "Conviene bajar exposicion o revisar horario.",
      primaryActionLabel: hasSuggestedAlternative ? "Usar ruta sugerida" : "Seguir esta ruta",
      primaryActionKind: hasSuggestedAlternative ? "suggested" : "start-trip",
      primaryActionDisabled: false,
    };
  }

  if (stage === "attention") {
    return {
      ...base,
      headerBadge: "Atencion",
      addressBadge: "Atencion",
      badgeTone: "warning",
      modeStage: "route-ready",
      resolutionStatus: "Ruta con atencion",
      operationalRisk: activeRoute?.operationalRisk?.overallLabel || "Precaucion",
      recommendedRoute: suggestedRoute ? suggestedLabel : currentLabel,
      recommendationTitle: hasSuggestedAlternative ? "Conviene usar la mejor balanceada" : "Ruta lista con atencion",
      recommendationCopy:
        suggestedRoute?.recommendation ||
        activeRoute?.operationalRisk?.recommendation ||
        "La ruta toca un sector que requiere mas cuidado operativo.",
      primaryActionLabel: hasSuggestedAlternative ? "Usar ruta sugerida" : "Seguir esta ruta",
      primaryActionKind: hasSuggestedAlternative ? "suggested" : "start-trip",
      primaryActionDisabled: false,
    };
  }

  if (stage === "route-ready") {
    return {
      ...base,
      headerBadge: "Lista",
      addressBadge: "Ruta lista",
      badgeTone: "success",
      modeStage: "route-ready",
      resolutionStatus: "Ruta lista",
      operationalRisk: activeRoute?.operationalRisk?.overallLabel || "Normal",
      recommendedRoute: suggestedRoute ? suggestedLabel : currentLabel,
      recommendationTitle: hasSuggestedAlternative ? `Conviene ${suggestedTitle.toLowerCase()}` : `Ruta ${currentLabel.toLowerCase()} lista`,
      recommendationCopy:
        suggestedRoute?.recommendation || activeRoute?.recommendation || activeRoute?.baseSummary || "Ruta lista para salir.",
      primaryActionLabel: hasSuggestedAlternative ? "Usar ruta sugerida" : "Seguir esta ruta",
      primaryActionKind: hasSuggestedAlternative ? "suggested" : "start-trip",
      primaryActionDisabled: false,
    };
  }

  return base;
}

function getOperationalStage() {
  const activeRoute = getActiveRoute();

  if (state.activeTrip && state.routeRecalcInProgress) {
    return "recalculating";
  }

  if (state.activeTrip && state.deviationAlert) {
    return "off-route";
  }

  if (state.isBusy) {
    return "interpreting";
  }

  if (state.pendingTripReview) {
    return "closing";
  }

  if (state.addressAnalysis?.status === "outside") {
    return "outside";
  }

  if (!state.destination && state.addressAnalysis?.status === "doubtful") {
    return "doubtful";
  }

  if (state.activeTrip && activeRoute) {
    return "tracking";
  }

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
      if (state.activeTrip || state.pendingTripReview) {
        return;
      }

      state.activeRouteId = route.id;
      syncMapLayers();
      renderOperationalPanel();
    });

    topLine.className = "route-card-top";
    title.textContent =
      route.id === state.recommendedRouteId ? "Sugerida" : route.alternativeTitle || `Alternativa ${index + 1}`;
    subtitle.className = "history-meta";
    subtitle.textContent = `${formatDistance(route.distanceMeters)} | ${formatDuration(route.durationSeconds)}`;
    topLine.append(title, subtitle);

    copy.textContent = route.recommendation || route.baseSummary;
    tags.className = "route-card-tags";
    tags.append(
      createTinyPill(route.operationalRisk.overallLabel, getRiskTone(route.operationalRisk.overallLabel)),
      createTinyPill(buildStrategyLabel(route.displayStrategy || route.strategy), "accent")
    );

    if (route.historyMetrics?.sampleSize) {
      tags.append(createTinyPill(route.historyLabel, getMemoryTone(route.historyMetrics?.performanceScore || 0)));
    }

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
    state.destinationMemorySummary?.hasHistory ? state.destinationMemorySummary.label : "",
    state.placeMemorySummary?.hasMemory ? state.placeMemorySummary.headline : "",
    activeRoute?.historyMetrics?.nightStrength ? "Mejor rendimiento historico en este horario." : "",
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
      createEmptyState("Cuando marques una ruta como buena, incomoda o sensible, el registro aparece aqui.")
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

function renderTripMemories() {
  elements.tripMemoryList.replaceChildren();
  elements.tripMemoryCount.textContent = `${state.tripMemories.length} viaje${state.tripMemories.length === 1 ? "" : "s"}`;

  if (!state.tripMemories.length) {
    elements.tripMemoryList.append(
      createEmptyState("Cuando cierres viajes con seguimiento, la memoria operativa aparecera aqui.")
    );
    return;
  }

  state.tripMemories.slice(0, APP_CONFIG.recentTripMemoryLimit).forEach((entry) => {
    const item = document.createElement("article");
    const topLine = document.createElement("div");
    const label = document.createElement("strong");
    const meta = document.createElement("span");
    const copy = document.createElement("p");

    item.className = "feedback-item";
    topLine.className = "feedback-topline";
    label.textContent = compactDestinationLabel(entry.normalizedAddress);
    meta.className = "feedback-meta";
    meta.textContent = formatDateTime(entry.completedAt);
    copy.textContent = `${buildTripMemoryPreview(entry)} | ${formatDuration(entry.actualDurationSeconds)} real vs ${formatDuration(entry.estimatedDurationSeconds)} estimado`;

    topLine.append(label, meta);
    item.append(topLine, copy);
    elements.tripMemoryList.append(item);
  });
}

function renderPlaceMemoryList() {
  elements.placeMemoryList.replaceChildren();
  elements.placeMemoryCount.textContent = `${state.placeMemories.length} guardada${state.placeMemories.length === 1 ? "" : "s"}`;

  if (!state.placeMemories.length) {
    elements.placeMemoryList.append(
      createEmptyState("Tus favoritas, accesos y notas del lugar van a quedar aqui.")
    );
    return;
  }

  state.placeMemories.slice(0, APP_CONFIG.recentPlaceMemoryLimit).forEach((entry) => {
    const item = document.createElement("article");
    const topLine = document.createElement("div");
    const label = document.createElement("strong");
    const meta = document.createElement("span");
    const copy = document.createElement("p");

    item.className = "feedback-item";
    topLine.className = "feedback-topline";
    label.textContent = compactDestinationLabel(entry.normalizedAddress);
    meta.className = "feedback-meta";
    meta.textContent = formatDateTime(entry.updatedAt);
    copy.textContent = [
      entry.tags.slice(0, 3).map(getPlaceMemoryTagLabel).join(" | "),
      entry.note,
    ]
      .filter(Boolean)
      .join(" | ");

    topLine.append(label, meta);
    item.append(topLine, copy);
    elements.placeMemoryList.append(item);
  });
}

function renderPlaceMemoryComposer() {
  const safeDraft = state.placeMemoryDraft || { tags: [], note: "" };

  elements.memoryTagButtons.forEach((button) => {
    const isActive = safeDraft.tags.includes(button.dataset.placeTag || "");
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
    button.disabled = !state.destinationProfile;
  });

  if (elements.placeMemoryNoteInput.value !== safeDraft.note) {
    elements.placeMemoryNoteInput.value = safeDraft.note;
  }

  elements.placeMemoryNoteInput.disabled = !state.destinationProfile;
  elements.savePlaceMemoryButton.disabled =
    !state.destinationProfile || (!safeDraft.tags.length && !safeDraft.note.trim());
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
    strategy: activeRoute.displayStrategy || activeRoute.strategy || state.selectedStrategy,
    strategyLabel: buildStrategyLabel(activeRoute.displayStrategy || activeRoute.strategy || state.selectedStrategy),
    routeRisk: activeRoute.operationalRisk?.overallLabel,
  };

  state.routeFeedback = sortByNewest([entry, ...state.routeFeedback]);
  writeJsonStorage(APP_CONFIG.storageKeys.routeFeedback, state.routeFeedback);
  renderFeedback();
  showToast("Feedback guardado.", "success");
}

function togglePlaceMemoryTag(tagId) {
  if (!tagId || !state.destinationProfile) {
    return;
  }

  const nextTags = state.placeMemoryDraft.tags.includes(tagId)
    ? state.placeMemoryDraft.tags.filter((tag) => tag !== tagId)
    : [...state.placeMemoryDraft.tags, tagId];

  state.placeMemoryDraft = {
    ...state.placeMemoryDraft,
    tags: nextTags,
  };
  renderPlaceMemoryComposer();
}

function handleSavePlaceMemory() {
  if (!state.destinationProfile) {
    return;
  }

  const entry = buildPlaceMemoryEntry({
    destinationProfile: state.destinationProfile,
    tags: state.placeMemoryDraft.tags,
    note: state.placeMemoryDraft.note,
  });

  const savedEntry = savePlaceMemory(entry);

  if (!savedEntry) {
    showToast("No pude guardar esta memoria local.", "danger");
    return;
  }

  state.placeMemories = getPlaceMemories();
  refreshPlaceMemoryContext();
  renderPlaceMemoryList();
  renderOperationalPanel();
  showToast("Memoria local guardada.", "success");
}

function refreshPlaceMemoryContext(shouldResetDraft = true) {
  state.placeMemorySummary = state.destinationProfile
    ? summarizePlaceMemoryForDestination(state.destinationProfile, getHourContext())
    : null;

  if (shouldResetDraft) {
    state.placeMemoryDraft = {
      tags: [...(state.placeMemorySummary?.exactEntry?.tags || [])],
      note: state.placeMemorySummary?.exactEntry?.note || "",
    };
  }
}

function applyRouteLearning(routes) {
  const previousActiveRouteId = state.activeTrip ? state.activeRouteId : "";
  const intelligence = rankRoutesWithMemory({
    routes,
    destinationProfile: state.destinationProfile,
    preferredStrategy: state.selectedStrategy,
    hourContext: getHourContext(),
  });

  state.routes = intelligence.routes;
  state.destinationProfile = intelligence.destinationProfile;
  state.destinationMemorySummary = intelligence.destinationSummary;
  state.recommendedRouteId = intelligence.recommendedRouteId;
  refreshPlaceMemoryContext();

  const stillHasPreviousRoute = previousActiveRouteId && intelligence.routes.some((route) => route.id === previousActiveRouteId);
  state.activeRouteId = stillHasPreviousRoute ? previousActiveRouteId : intelligence.recommendedRouteId || intelligence.routes[0]?.id || "";

  applyPlaceMemoryBias();
}

function startActiveTrip() {
  const activeRoute = getActiveRoute();

  if (!activeRoute || !state.destination || state.activeTrip) {
    return;
  }

  clearPendingReview();
  state.activeTrip = startTripTimer({
    estimatedDurationSeconds: activeRoute.durationSeconds,
    provider: state.activeProvider,
    strategy: activeRoute.displayStrategy || activeRoute.strategy || state.selectedStrategy,
    routeId: activeRoute.id,
    routeFingerprint: activeRoute.routeFingerprint,
    routeSummary: activeRoute.recommendation || activeRoute.baseSummary,
    distanceMeters: activeRoute.distanceMeters,
    destinationProfile: state.destinationProfile,
    originalAddress: state.lastSearchInput,
    hourContext: getHourContext(),
    destinationRiskLabel: activeRoute.operationalRisk?.destinationRisk,
    routeRiskLabel: activeRoute.operationalRisk?.routeRisk,
    operationalRiskLabel: activeRoute.operationalRisk?.overallLabel,
    riskScore: activeRoute.operationalRisk?.score || 0,
    route: activeRoute,
    alternatives: getSortedRoutes()
      .filter((route) => route.id !== activeRoute.id)
      .slice(0, 4)
      .map((route) => ({
        id: route.id,
        label: route.alternativeTitle || buildStrategyLabel(route.displayStrategy || route.strategy),
        strategy: route.displayStrategy || route.strategy,
        durationSeconds: route.durationSeconds,
        distanceMeters: route.distanceMeters,
        riskLabel: route.operationalRisk?.overallLabel,
      })),
  });
  state.activeTrip.followUser = true;
  state.activeTrip.liveLocationPaused = false;
  state.activeTrip.lastCenteredAt = "";
  state.activeTrip.lastCenteredPoint = null;
  state.activeTrip.liveGuidance = "Ruta lista para navegar desde tu posicion actual.";
  state.activeTrip.currentLocation = !state.origin.isApproximate
    ? updateUserLocation(
        null,
        {
          longitude: state.origin.lng,
          latitude: state.origin.lat,
          accuracy: Number(state.origin.accuracy || 18),
          speed: 0,
          heading: Number.NaN,
        },
        activeRoute
      )
    : null;
  state.activeTrip.trackPoints = state.activeTrip.currentLocation ? [{ ...state.activeTrip.currentLocation }] : [];
  state.activeTrip.lastAutoRecalcAt = "";
  state.activeTrip.delta = calculateTripDelta(state.activeTrip.estimatedDurationSeconds, 0);
  state.activeTrip.navigationSnapshot = computeNavigationSnapshot(activeRoute, state.activeTrip.currentLocation);
  state.activeTrip.liveGuidance = buildLiveNavigationMessage({
    currentStrategy: state.activeTrip.strategy,
  });
  startTrackingWatch();
  startTripTicker();
  clearDeviationAlert();
  syncMapLayers();
  centerOnUser({ silent: true, force: true });
  setInlineStatus(elements.mapStatus, "Navegacion activa. Voy siguiendo tu ubicacion en tiempo real.", "success");
  renderOperationalPanel();
  showToast("Seguimiento iniciado. Voy a comparar estimado vs real.", "success");
}

function finishActiveTrip() {
  if (!state.activeTrip) {
    return;
  }

  state.pendingTripReview = stopTripTimer(state.activeTrip);
  state.activeTrip = null;
  state.routeRecalcInProgress = false;
  stopTrackingWatch();
  stopTripTicker();
  cancelAutoRecalc();
  clearDeviationAlert();
  syncTrackingLayersOnly();
  setInlineStatus(elements.mapStatus, "Viaje finalizado. Falta cerrar el feedback breve.", "success");
  renderOperationalPanel();
  openPostTripDialog();
}

function startTripTicker() {
  stopTripTicker();

  state.tripTickerId = window.setInterval(() => {
    if (!state.activeTrip) {
      stopTripTicker();
      return;
    }

    const elapsedSeconds = getElapsedTripSeconds(state.activeTrip);
    state.activeTrip.delta = calculateTripDelta(state.activeTrip.estimatedDurationSeconds, elapsedSeconds);
    renderOperationalPanel();
  }, 1000);
}

function stopTripTicker() {
  if (state.tripTickerId) {
    window.clearInterval(state.tripTickerId);
    state.tripTickerId = 0;
  }
}

function openPostTripDialog() {
  if (!state.pendingTripReview) {
    return;
  }

  if (elements.postTripDialog.open) {
    return;
  }

  elements.postTripSummary.textContent = `Estimado ${formatDuration(
    state.pendingTripReview.estimatedDurationSeconds
  )} | real ${formatDuration(state.pendingTripReview.actualDurationSeconds)} | ${formatTripDelta(
    state.pendingTripReview.delta
  )}`;

  if (elements.postTripDialog.showModal) {
    elements.postTripDialog.showModal();
  } else {
    elements.postTripDialog.setAttribute("open", "open");
  }
}

function closePostTripDialog() {
  if (elements.postTripDialog.close) {
    elements.postTripDialog.close();
  } else {
    elements.postTripDialog.removeAttribute("open");
  }
}

function handlePostTripSubmit(event) {
  event.preventDefault();

  if (!state.pendingTripReview) {
    closePostTripDialog();
    return;
  }

  const formData = new FormData(elements.postTripForm);
  const feedback = formData.getAll("tripFeedback").map((value) => String(value));
  const hadDetour = Boolean(formData.get("hadDetour"));
  const observation = String(formData.get("observation") || "").trim();
  const memoryEntry = buildTripMemoryEntry({
    activeTrip: state.pendingTripReview,
    feedback,
    observation,
    hadDetour,
    completedTrip: state.pendingTripReview,
  });

  const savedEntry = saveTripMemory(memoryEntry);

  if (!savedEntry) {
    showToast("No pude guardar el aprendizaje de este viaje.", "danger");
    return;
  }

  state.tripMemories = getTripMemories();
  renderTripMemories();
  discardPendingReview();

  if (state.routes.length && state.destinationProfile) {
    rerankCurrentRoutes("memory");
  }

  showToast("Viaje guardado en memoria operativa.", "success");
}

function synchronizeActiveTripWithCurrentRoute() {
  if (!state.activeTrip) {
    return;
  }

  const activeRoute = getActiveRoute();

  if (!activeRoute) {
    return;
  }

  state.activeTrip = {
    ...state.activeTrip,
    estimatedDurationSeconds: activeRoute.durationSeconds,
    provider: state.activeProvider,
    strategy: activeRoute.displayStrategy || activeRoute.strategy || state.selectedStrategy,
    routeId: activeRoute.id,
    routeFingerprint: activeRoute.routeFingerprint,
    routeSummary: activeRoute.recommendation || activeRoute.baseSummary,
    distanceMeters: activeRoute.distanceMeters,
    destinationProfile: state.destinationProfile,
    destinationRiskLabel: activeRoute.operationalRisk?.destinationRisk,
    routeRiskLabel: activeRoute.operationalRisk?.routeRisk,
    operationalRiskLabel: activeRoute.operationalRisk?.overallLabel,
    riskScore: activeRoute.operationalRisk?.score || 0,
    navigationSnapshot: computeNavigationSnapshot(activeRoute, state.activeTrip.currentLocation),
    alternatives: getSortedRoutes()
      .filter((route) => route.id !== activeRoute.id)
      .slice(0, 4)
      .map((route) => ({
        id: route.id,
        label: route.alternativeTitle || buildStrategyLabel(route.displayStrategy || route.strategy),
        strategy: route.displayStrategy || route.strategy,
        durationSeconds: route.durationSeconds,
        distanceMeters: route.distanceMeters,
        riskLabel: route.operationalRisk?.overallLabel,
      })),
  };
}

function startTrackingWatch() {
  if (!state.activeTrip || state.activeTrip.liveLocationPaused) {
    return;
  }

  stopTrackingWatch();

  try {
    state.trackingWatchId = startLiveLocation({
      onPosition: (position) => {
        handleTrackingPosition(position);
      },
      onError: (error) => {
        const message = getLocationErrorMessage(error);
        console.warn("No pude actualizar seguimiento GPS.", error);
        setInlineStatus(elements.mapStatus, message, "warning");
        showToast(message, "warning");
      },
    });
  } catch (error) {
    const message = error.message || "No pude iniciar la ubicacion en tiempo real.";
    setInlineStatus(elements.mapStatus, message, "warning");
    showToast(message, "warning");
  }
}

function stopTrackingWatch() {
  if (state.trackingWatchId) {
    stopLiveLocation(state.trackingWatchId);
    state.trackingWatchId = 0;
  }
}

function handleTrackingPosition(position) {
  if (!state.activeTrip) {
    return;
  }

  if (
    Number.isFinite(position.coords?.accuracy) &&
    Number(position.coords.accuracy) > APP_CONFIG.trackingMinAccuracyMeters
  ) {
    setInlineStatus(
      elements.mapStatus,
      "GPS con precision floja. Mantengo la ultima posicion confiable.",
      "warning"
    );
    return;
  }

  const activeRoute = getActiveRoute();
  const nextPoint = updateUserLocation(state.activeTrip.currentLocation, position.coords, activeRoute);

  if (!nextPoint) {
    return;
  }

  state.activeTrip.currentLocation = nextPoint;
  state.activeTrip.trackPoints = appendTrackingPoint(state.activeTrip.trackPoints, nextPoint);
  state.activeTrip.navigationSnapshot = nextPoint.navigationSnapshot || computeNavigationSnapshot(activeRoute, nextPoint);
  state.activeTrip.delta = calculateTripDelta(
    state.activeTrip.estimatedDurationSeconds,
    getElapsedTripSeconds(state.activeTrip)
  );
  maybeHandleDeviation(nextPoint);
  if (!state.routeRecalcInProgress) {
    state.activeTrip.liveGuidance = buildLiveNavigationMessage({
      offRoute: Boolean(state.deviationAlert),
      currentStrategy: state.activeTrip.strategy,
    });
  }
  maybeFollowUserOnMap(nextPoint);
  syncTrackingLayersOnly();
  renderOperationalPanel();
}

function appendTrackingPoint(existingPoints, nextPoint) {
  const points = Array.isArray(existingPoints) ? [...existingPoints] : [];
  const lastPoint = points[points.length - 1];
  const distanceFromLast = lastPoint ? haversineDistanceMeters(lastPoint, nextPoint) : Number.POSITIVE_INFINITY;

  if (distanceFromLast < APP_CONFIG.trackingPointSpacingMeters) {
    if (points.length) {
      points[points.length - 1] = nextPoint;
    } else {
      points.push(nextPoint);
    }
  } else {
    points.push(nextPoint);
  }

  return points.slice(-APP_CONFIG.trackingPathLimit);
}

function maybeHandleDeviation(currentPoint) {
  const activeRoute = getActiveRoute();

  if (!state.activeTrip || !activeRoute || !isValidPoint(currentPoint)) {
    clearDeviationAlert();
    return;
  }

  const recalculation = shouldRecalculateRoute({
    currentCoords: currentPoint,
    activeRoute,
    elapsedSeconds: getElapsedTripSeconds(state.activeTrip),
    lastRecalculatedAt: state.activeTrip.lastAutoRecalcAt,
  });

  state.activeTrip.offRouteMetrics = recalculation;

  if (!recalculation.isOffRoute) {
    clearDeviationAlert();
    return;
  }

  const distanceMeters = Math.round(recalculation.distanceMeters || 0);
  state.deviationAlert = {
    distanceMeters,
    title: `Te alejaste ${distanceMeters} m de la ruta`,
    copy: recalculation.shouldRecalculate
      ? "Nueva ruta sugerida desde tu posicion actual. Puedo recalcular en breve o lo haces ahora."
      : recalculation.reason || "Desvio detectado. Mantengo la ruta actual mientras confirmo mejor opcion.",
    detectedAt: recalculation.detectedAt || new Date().toISOString(),
    canAutoRecalc: Boolean(recalculation.shouldRecalculate),
  };
  state.activeTrip.liveGuidance = buildLiveNavigationMessage({
    offRoute: true,
    currentStrategy: state.activeTrip.strategy,
  });

  if (recalculation.shouldRecalculate && !state.routeRecalcInProgress) {
    scheduleAutoRecalc();
    return;
  }

  cancelAutoRecalc();
}

function scheduleAutoRecalc() {
  if (state.autoRecalcTimeoutId || !state.activeTrip?.currentLocation) {
    return;
  }

  state.autoRecalcTimeoutId = window.setTimeout(() => {
    state.autoRecalcTimeoutId = 0;

    if (!state.deviationAlert?.canAutoRecalc) {
      return;
    }

    void handleRecalculateRoute("auto");
  }, APP_CONFIG.deviationAutoRecalcDelayMs);
}

function cancelAutoRecalc() {
  if (state.autoRecalcTimeoutId) {
    window.clearTimeout(state.autoRecalcTimeoutId);
    state.autoRecalcTimeoutId = 0;
  }
}

async function handleRecalculateRoute(mode) {
  if (!state.activeTrip?.currentLocation || !state.destination) {
    return;
  }

  cancelAutoRecalc();
  state.routeRecalcInProgress = true;
  state.activeTrip.liveGuidance = "Nueva ruta sugerida desde tu posicion actual.";
  setInlineStatus(elements.mapStatus, "Recalculando desde tu posicion actual...", "warning");
  renderOperationalPanel();

  if (mode === "auto") {
    state.activeTrip.lastAutoRecalcAt = new Date().toISOString();
  }

  await recalculateRouteForCurrentDestination(
    mode === "auto" ? "auto-recalc" : "manual-recalc",
    state.activeTrip.currentLocation
  );
}

function clearDeviationAlert() {
  state.deviationAlert = null;
  cancelAutoRecalc();
}

function clearPendingReview() {
  if (!state.pendingTripReview) {
    return;
  }

  state.pendingTripReview = null;
  elements.postTripForm.reset();
}

function discardPendingReview() {
  clearPendingReview();
  closePostTripDialog();
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

function renderModeStrip(stage) {
  const stageOrder = ["waiting", "route-ready", "tracking", "off-route", "recalculating", "closing"];
  const activeIndex = stageOrder.indexOf(stage);

  elements.modeChips.forEach((chip) => {
    const chipStage = chip.dataset.tripStage || "";
    const chipIndex = stageOrder.indexOf(chipStage);
    chip.classList.toggle("is-active", chipStage === stage);
    chip.classList.toggle("is-complete", chipIndex !== -1 && chipIndex < activeIndex);
  });
}

function getActiveRoute() {
  return state.routes.find((route) => route.id === state.activeRouteId) || null;
}

function getSuggestedRoute() {
  return state.routes.find((route) => route.id === state.recommendedRouteId) || getSortedRoutes()[0] || null;
}

function getSortedRoutes() {
  return [...state.routes].sort((left, right) => (right.riderScore || 0) - (left.riderScore || 0));
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

function buildLineFeature(points, extraProperties = {}) {
  const safePoints = Array.isArray(points)
    ? points.filter((point) => Number.isFinite(point?.lng) && Number.isFinite(point?.lat))
    : [];

  if (safePoints.length < 2) {
    return null;
  }

  return {
    type: "Feature",
    properties: {
      ...extraProperties,
    },
    geometry: {
      type: "LineString",
      coordinates: safePoints.map((point) => [point.lng, point.lat]),
    },
  };
}

function buildTrackingTrailFeature() {
  return buildLineFeature(state.activeTrip?.trackPoints || [], { kind: "tracking-trail" });
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
  if (state.activeTrip?.currentLocation) {
    return "Origen: seguimiento actual";
  }

  return state.origin.isApproximate
    ? "Origen: centro de Neuquen (referencia)"
    : `Origen: ${compactDestinationLabel(state.origin.label || "Mi ubicacion actual")}`;
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

  if (type === "time_loss") {
    return "Me hizo perder tiempo";
  }

  if (type === "reuse") {
    return "La volveria a usar";
  }

  return "Zona complicada";
}

function formatReliabilityLabel(score) {
  if (score >= 0.76) {
    return "alta";
  }

  if (score >= 0.58) {
    return "media";
  }

  return "inicial";
}

function getMemoryTone(score) {
  if (score > 0.24) {
    return "normal";
  }

  if (score < -0.18) {
    return "danger";
  }

  return "warning";
}

function applyPlaceMemoryBias() {
  if (!state.placeMemorySummary?.shouldAvoidAtNight || !state.routes.length) {
    return;
  }

  const cautiousRoute = state.routes.find((route) => route.displayStrategy === "cautious");

  if (!cautiousRoute) {
    return;
  }

  state.routes = state.routes
    .map((route) => {
      if (route.id === cautiousRoute.id) {
        return {
          ...route,
          riderScore: route.riderScore + 4,
          recommendation: "Memoria local: mejor evitar este punto de noche. Conviene la prudente.",
        };
      }

      if (route.displayStrategy !== "cautious") {
        return {
          ...route,
          riderScore: route.riderScore - 2.4,
        };
      }

      return route;
    })
    .sort((left, right) => right.riderScore - left.riderScore);

  state.recommendedRouteId = state.routes[0]?.id || state.recommendedRouteId;

  if (!state.activeTrip) {
    state.activeRouteId = state.recommendedRouteId || state.activeRouteId;
  }
}

function restoreRecoveredState() {
  const session = loadSessionState();

  if (session) {
    state.selectedStrategy = session.selectedStrategy || state.selectedStrategy;
    state.origin = session.origin || state.origin;
    state.destination = session.destination;
    state.addressAnalysis = session.addressAnalysis;
    state.routes = Array.isArray(session.routes) ? session.routes : [];
    state.activeRouteId = session.activeRouteId || "";
    state.recommendedRouteId = session.recommendedRouteId || "";
    state.activeProvider = session.activeProvider || "";
    state.activeProviderNote = session.activeProviderNote || "";
    state.destinationProfile = session.destinationProfile || null;
    state.destinationMemorySummary = session.destinationMemorySummary || null;
    state.placeMemorySummary = session.placeMemorySummary || null;
    state.lastSearchInput = session.lastSearchInput || session.addressInput || "";
    state.routeError = session.routeError || "";
    state.activeTrip = session.activeTrip || null;
    state.pendingTripReview = session.pendingTripReview || null;
    state.deviationAlert = session.deviationAlert || null;
    refreshPlaceMemoryContext();
    return;
  }

  const lastResolvedAddress = readJsonStorage(APP_CONFIG.storageKeys.lastResolvedAddress, null);

  if (!lastResolvedAddress?.ok) {
    return;
  }

  state.lastSearchInput = String(lastResolvedAddress.rawInput || "").trim();
  state.addressAnalysis = lastResolvedAddress.analysis || null;
  state.destination = lastResolvedAddress.destination || null;

  if (state.destination) {
    state.destinationProfile = buildDestinationMemoryProfile({
      rawAddress: state.lastSearchInput,
      destination: state.destination,
      addressAnalysis: state.addressAnalysis,
    });
    refreshPlaceMemoryContext();
  }
}

function resumeRecoveredTrip() {
  if (!state.activeTrip) {
    return;
  }

  if (!Array.isArray(state.activeTrip.trackPoints) || !state.activeTrip.trackPoints.length) {
    state.activeTrip.trackPoints = state.activeTrip.currentLocation ? [{ ...state.activeTrip.currentLocation }] : [];
  }

  state.activeTrip.followUser = state.activeTrip.followUser !== false;
  state.activeTrip.liveLocationPaused = Boolean(state.activeTrip.liveLocationPaused);
  state.activeTrip.navigationSnapshot = computeNavigationSnapshot(getActiveRoute(), state.activeTrip.currentLocation);
  state.activeTrip.liveGuidance =
    state.activeTrip.liveGuidance || buildLiveNavigationMessage({ currentStrategy: state.activeTrip.strategy });
  state.activeTrip.delta = calculateTripDelta(
    state.activeTrip.estimatedDurationSeconds,
    getElapsedTripSeconds(state.activeTrip)
  );
  startTrackingWatch();
  startTripTicker();
  syncMapLayers();
  if (state.activeTrip.currentLocation && state.activeTrip.followUser && !state.activeTrip.liveLocationPaused) {
    centerOnUser({ silent: true, force: true });
  }
  setInlineStatus(elements.mapStatus, "Recupere tu viaje activo. Puedes seguir desde donde quedaste.", "success");
}

function scheduleSessionSave() {
  if (state.sessionPersistTimeoutId) {
    return;
  }

  state.sessionPersistTimeoutId = window.setTimeout(() => {
    state.sessionPersistTimeoutId = 0;
    const sessionSnapshot = buildSessionSnapshot();

    if (!sessionSnapshot) {
      clearSessionState();
      return;
    }

    saveSessionState(sessionSnapshot);
  }, APP_CONFIG.trackingSessionSaveDebounceMs);
}

function buildSessionSnapshot() {
  const hasRecoverableState =
    Boolean(state.destination) || Boolean(state.activeTrip) || Boolean(state.pendingTripReview) || Boolean(state.routes.length);

  if (!hasRecoverableState) {
    return null;
  }

  return {
    addressInput: elements.addressInput.value.trim(),
    selectedStrategy: state.selectedStrategy,
    origin: state.origin,
    destination: state.destination,
    addressAnalysis: state.addressAnalysis,
    routes: state.routes.map(serializeRouteForSession).filter(Boolean),
    activeRouteId: state.activeRouteId,
    recommendedRouteId: state.recommendedRouteId,
    activeProvider: state.activeProvider,
    activeProviderNote: state.activeProviderNote,
    destinationProfile: state.destinationProfile,
    destinationMemorySummary: state.destinationMemorySummary,
    placeMemorySummary: state.placeMemorySummary,
    lastSearchInput: state.lastSearchInput,
    routeError: state.routeError,
    activeTrip: serializeTripForSession(state.activeTrip),
    pendingTripReview: serializeTripForSession(state.pendingTripReview),
    deviationAlert: state.deviationAlert,
  };
}

function serializeRouteForSession(route) {
  if (!route) {
    return null;
  }

  const { raw, ...safeRoute } = route;
  return safeRoute;
}

function serializeTripForSession(trip) {
  if (!trip) {
    return null;
  }

  const { route, ...safeTrip } = trip;
  return safeTrip;
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
