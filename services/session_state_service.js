import { APP_CONFIG } from "../utils/app_config.js";
import { readJsonStorage, writeJsonStorage } from "../utils/storage_utils.js";

const SESSION_VERSION = 2;

export function loadSessionState() {
  const session = readJsonStorage(APP_CONFIG.storageKeys.sessionState, null);

  if (!session || session.version !== SESSION_VERSION) {
    return null;
  }

  return {
    savedAt: String(session.savedAt || ""),
    addressInput: String(session.addressInput || "").trim(),
    selectedStrategy: String(session.selectedStrategy || "balanced").trim(),
    origin: normalizePoint(session.origin),
    destination: normalizeDestination(session.destination),
    addressAnalysis: normalizeObject(session.addressAnalysis),
    routes: normalizeRoutes(session.routes),
    activeRouteId: String(session.activeRouteId || "").trim(),
    recommendedRouteId: String(session.recommendedRouteId || "").trim(),
    activeProvider: String(session.activeProvider || "").trim(),
    activeProviderNote: String(session.activeProviderNote || "").trim(),
    destinationProfile: normalizeObject(session.destinationProfile),
    destinationMemorySummary: normalizeObject(session.destinationMemorySummary),
    placeMemorySummary: normalizeObject(session.placeMemorySummary),
    lastSearchInput: String(session.lastSearchInput || "").trim(),
    routeError: String(session.routeError || "").trim(),
    activeTrip: normalizeTrip(session.activeTrip),
    pendingTripReview: normalizeTrip(session.pendingTripReview),
    deviationAlert: normalizeObject(session.deviationAlert),
    routeRecalcFailure: normalizeObject(session.routeRecalcFailure),
    lastStableRouting: normalizeRoutingSnapshot(session.lastStableRouting),
  };
}

export function saveSessionState(session) {
  return writeJsonStorage(APP_CONFIG.storageKeys.sessionState, {
    version: SESSION_VERSION,
    savedAt: new Date().toISOString(),
    ...session,
  });
}

export function clearSessionState() {
  return writeJsonStorage(APP_CONFIG.storageKeys.sessionState, null);
}

function normalizeDestination(destination) {
  if (!destination?.coordinates) {
    return null;
  }

  const coordinates = normalizePoint(destination.coordinates);

  if (!coordinates) {
    return null;
  }

  return {
    ...normalizeObject(destination),
    coordinates,
  };
}

function normalizePoint(point) {
  if (!Number.isFinite(point?.lng) || !Number.isFinite(point?.lat)) {
    return null;
  }

  return {
    lng: Number(point.lng),
    lat: Number(point.lat),
    label: String(point.label || "").trim(),
    isApproximate: Boolean(point.isApproximate),
    accuracy: Number(point.accuracy || 0),
    capturedAt: String(point.capturedAt || "").trim(),
  };
}

function normalizeRoutes(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((route) => {
      if (!route?.id || !route?.geometry) {
        return null;
      }

      return normalizeObject(route);
    })
    .filter(Boolean);
}

function normalizeTrip(trip) {
  if (!trip || typeof trip !== "object") {
    return null;
  }

  const currentLocation = normalizePoint(trip.currentLocation);
  const trackPoints = Array.isArray(trip.trackPoints)
    ? trip.trackPoints.map(normalizePoint).filter(Boolean)
    : [];

  return {
    ...normalizeObject(trip),
    currentLocation,
    trackPoints,
    lastCenteredPoint: normalizePoint(trip.lastCenteredPoint),
    navigationSnapshot: normalizeNavigationSnapshot(trip.navigationSnapshot),
  };
}

function normalizeNavigationSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  return {
    progressRatio: Number(snapshot.progressRatio || 0),
    completedDistanceMeters: Number(snapshot.completedDistanceMeters || 0),
    remainingDistanceMeters: Number(snapshot.remainingDistanceMeters || 0),
    remainingDurationSeconds: Number(snapshot.remainingDurationSeconds || 0),
    totalDistanceMeters: Number(snapshot.totalDistanceMeters || 0),
    distanceFromRouteMeters: Number(snapshot.distanceFromRouteMeters || 0),
    snappedPoint: normalizePoint(snapshot.snappedPoint),
  };
}

function normalizeRoutingSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  const routes = normalizeRoutes(snapshot.routes);

  if (!routes.length) {
    return null;
  }

  return {
    ...normalizeObject(snapshot),
    routes,
    activeRouteId: String(snapshot.activeRouteId || "").trim(),
    recommendedRouteId: String(snapshot.recommendedRouteId || "").trim(),
    activeProvider: String(snapshot.activeProvider || "").trim(),
    activeProviderNote: String(snapshot.activeProviderNote || "").trim(),
  };
}

function normalizeObject(value) {
  return value && typeof value === "object" ? value : null;
}
