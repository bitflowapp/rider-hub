import { APP_CONFIG } from "../utils/app_config.js";
import {
  calculateHeadingDegrees,
  getPointToRouteDistanceMeters,
  getRouteProgressMetrics,
  haversineDistanceMeters,
  isValidPoint,
  normalizeHeadingDegrees,
} from "../utils/geo_utils.js";

const FOLLOW_CAMERA_MIN_INTERVAL_MS = 900;
const FOLLOW_CAMERA_MIN_MOVE_METERS = 10;
const MIN_HEADING_SPEED_MPS = 1.35;
const MIN_HEADING_MOVE_METERS = 7;

export function startLiveLocation({ onPosition, onError }) {
  if (!navigator.geolocation) {
    throw new Error("Este navegador no ofrece geolocalizacion continua.");
  }

  return navigator.geolocation.watchPosition(
    (position) => {
      onPosition?.(position);
    },
    (error) => {
      onError?.(error);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 2500,
      timeout: 12000,
    }
  );
}

export function stopLiveLocation(watchId) {
  if (!watchId || !navigator.geolocation) {
    return;
  }

  navigator.geolocation.clearWatch(watchId);
}

export function updateUserLocation(previousPoint, coords, activeRoute = null) {
  const rawPoint = {
    lng: Number(coords?.longitude),
    lat: Number(coords?.latitude),
    accuracy: Number(coords?.accuracy || 0),
    altitude: Number(coords?.altitude || 0),
    speed: Number(coords?.speed || 0),
    heading: Number(coords?.heading),
    capturedAt: new Date().toISOString(),
  };

  if (!isValidPoint(rawPoint)) {
    return null;
  }

  if (!previousPoint) {
    return finalizeNavigationPoint(rawPoint, rawPoint, activeRoute);
  }

  const distanceFromPrevious = haversineDistanceMeters(previousPoint, rawPoint);
  const smoothingWeight = resolveSmoothingWeight(distanceFromPrevious, rawPoint.accuracy);
  const smoothedPoint = blendPoints(previousPoint, rawPoint, smoothingWeight);
  const nextHeading = resolveHeading(previousPoint, rawPoint, smoothedPoint);

  return finalizeNavigationPoint(
    {
      ...smoothedPoint,
      heading: nextHeading,
      rawHeading: Number(rawPoint.heading),
      speed: rawPoint.speed,
      accuracy: rawPoint.accuracy,
      capturedAt: rawPoint.capturedAt,
    },
    rawPoint,
    activeRoute
  );
}

export function detectOffRoute(currentCoords, activeRoute, options = {}) {
  if (!activeRoute?.geometry || !isValidPoint(currentCoords)) {
    return createOffRouteMetrics();
  }

  const distanceMeters = getPointToRouteDistanceMeters(currentCoords, activeRoute.geometry);
  const thresholdMeters = Number(options.thresholdMeters || APP_CONFIG.deviationThresholdMeters);
  const accuracyLimitMeters = Number(options.accuracyLimitMeters || APP_CONFIG.deviationAccuracyLimitMeters);
  const isReliable =
    !Number.isFinite(currentCoords.accuracy) || currentCoords.accuracy <= accuracyLimitMeters;

  return {
    distanceMeters,
    thresholdMeters,
    accuracyLimitMeters,
    isReliable,
    isOffRoute: isReliable && Number.isFinite(distanceMeters) && distanceMeters > thresholdMeters,
  };
}

export function shouldRecalculateRoute({
  currentCoords,
  activeRoute,
  elapsedSeconds = 0,
  lastRecalculatedAt = "",
  thresholdMeters = APP_CONFIG.deviationThresholdMeters,
  accuracyLimitMeters = APP_CONFIG.deviationAccuracyLimitMeters,
  gracePeriodSeconds = APP_CONFIG.deviationGracePeriodSeconds,
  debounceMs = APP_CONFIG.deviationAutoRecalcDebounceMs,
} = {}) {
  if (!activeRoute?.geometry || !isValidPoint(currentCoords)) {
    return {
      shouldRecalculate: false,
      reason: "Sin ruta o sin posicion valida.",
      distanceMeters: Number.POSITIVE_INFINITY,
    };
  }

  const metrics = detectOffRoute(currentCoords, activeRoute, {
    thresholdMeters,
    accuracyLimitMeters,
  });

  if (!metrics.isReliable) {
    return {
      shouldRecalculate: false,
      reason: "GPS sin precision suficiente.",
      ...metrics,
    };
  }

  if (elapsedSeconds < gracePeriodSeconds) {
    return {
      shouldRecalculate: false,
      reason: "Todavia dentro de la gracia inicial.",
      ...metrics,
    };
  }

  const lastAutoRecalcAt = new Date(lastRecalculatedAt || 0).getTime();
  const now = Date.now();
  const passesDebounce = !lastAutoRecalcAt || now - lastAutoRecalcAt >= debounceMs;

  return {
    shouldRecalculate: Boolean(metrics.isOffRoute && passesDebounce),
    reason: metrics.isOffRoute
      ? passesDebounce
        ? "Desvio suficiente para recalcular."
        : "Desvio detectado, pero sigo frenando el recálculo."
      : "Ruta actual todavia conveniente.",
    passesDebounce,
    detectedAt: new Date(now).toISOString(),
    ...metrics,
  };
}

export function computeNavigationSnapshot(activeRoute, currentPoint) {
  if (!activeRoute?.geometry || !isValidPoint(currentPoint)) {
    return createEmptyNavigationSnapshot();
  }

  const routeProgress = getRouteProgressMetrics(currentPoint, activeRoute.geometry);
  const routeDistanceMeters = Number(activeRoute.distanceMeters || routeProgress.totalDistanceMeters || 0);
  const estimatedDurationSeconds = Number(activeRoute.durationSeconds || 0);
  const remainingDistanceMeters = Math.max(
    0,
    Math.min(routeProgress.remainingDistanceMeters || routeDistanceMeters, routeDistanceMeters)
  );
  const estimatedRemainingDurationSeconds =
    routeDistanceMeters > 0 && estimatedDurationSeconds > 0
      ? (remainingDistanceMeters / routeDistanceMeters) * estimatedDurationSeconds
      : 0;
  const liveSpeed = Number(currentPoint.speed || 0);
  const liveRemainingDurationSeconds =
    liveSpeed > MIN_HEADING_SPEED_MPS && remainingDistanceMeters > 18
      ? remainingDistanceMeters / liveSpeed
      : 0;
  const remainingDurationSeconds =
    liveRemainingDurationSeconds > 0
      ? Math.round(liveRemainingDurationSeconds * 0.42 + estimatedRemainingDurationSeconds * 0.58)
      : Math.round(estimatedRemainingDurationSeconds);

  return {
    progressRatio: clamp01(routeProgress.progressRatio || 0),
    completedDistanceMeters: routeProgress.completedDistanceMeters || 0,
    remainingDistanceMeters,
    remainingDurationSeconds: Math.max(0, remainingDurationSeconds),
    totalDistanceMeters: routeDistanceMeters,
    snappedPoint: routeProgress.snappedPoint,
    distanceFromRouteMeters: routeProgress.distanceFromRouteMeters,
  };
}

export function buildLiveNavigationMessage({
  routeChanged = false,
  recommendedStrategy = "",
  currentStrategy = "",
  offRoute = false,
  recalculated = false,
} = {}) {
  if (recalculated && routeChanged) {
    return "Nueva ruta sugerida desde tu posicion actual.";
  }

  if (recalculated && recommendedStrategy && recommendedStrategy !== currentStrategy) {
    return `Segui por la ${mapStrategyLabel(recommendedStrategy).toLowerCase()} desde tu posicion actual.`;
  }

  if (offRoute) {
    return "Te conviene recalcular desde esta calle.";
  }

  return "Ruta actual todavia conveniente.";
}

export function shouldFollowWithCamera({
  followUser = false,
  previousCenteredPoint = null,
  currentPoint = null,
  lastCenteredAt = "",
} = {}) {
  if (!followUser || !isValidPoint(currentPoint)) {
    return false;
  }

  const now = Date.now();
  const lastCenteredMs = new Date(lastCenteredAt || 0).getTime();
  const distanceFromPreviousCenter = previousCenteredPoint
    ? haversineDistanceMeters(previousCenteredPoint, currentPoint)
    : Number.POSITIVE_INFINITY;

  return (
    !lastCenteredMs ||
    now - lastCenteredMs >= FOLLOW_CAMERA_MIN_INTERVAL_MS ||
    distanceFromPreviousCenter >= FOLLOW_CAMERA_MIN_MOVE_METERS
  );
}

export function getLocationErrorMessage(error) {
  const code = Number(error?.code || 0);

  if (code === 1) {
    return "No me diste permiso para seguir tu ubicacion en tiempo real.";
  }

  if (code === 2) {
    return "No pude resolver tu ubicacion actual. Puede ser señal floja o GPS inestable.";
  }

  if (code === 3) {
    return "La actualizacion de ubicacion tardó demasiado. Intento seguir con la ultima posicion confiable.";
  }

  return "No pude actualizar la ubicacion en vivo en este momento.";
}

function finalizeNavigationPoint(point, rawPoint, activeRoute) {
  const navigationSnapshot = computeNavigationSnapshot(activeRoute, point);

  return {
    ...point,
    rawLng: rawPoint.lng,
    rawLat: rawPoint.lat,
    navigationSnapshot,
  };
}

function blendPoints(previousPoint, nextPoint, weight) {
  const safeWeight = clamp(weight, 0.16, 0.78);

  return {
    lng: previousPoint.lng + (nextPoint.lng - previousPoint.lng) * safeWeight,
    lat: previousPoint.lat + (nextPoint.lat - previousPoint.lat) * safeWeight,
  };
}

function resolveSmoothingWeight(distanceMeters, accuracyMeters) {
  const safeDistance = Number.isFinite(distanceMeters) ? distanceMeters : 0;
  const safeAccuracy = Number.isFinite(accuracyMeters) && accuracyMeters > 0 ? accuracyMeters : 18;

  if (safeDistance >= 52) {
    return 0.78;
  }

  if (safeDistance >= 24) {
    return safeAccuracy <= 22 ? 0.58 : 0.5;
  }

  if (safeDistance >= 10) {
    return safeAccuracy <= 20 ? 0.42 : 0.34;
  }

  return safeAccuracy <= 18 ? 0.28 : 0.22;
}

function resolveHeading(previousPoint, rawPoint, smoothedPoint) {
  const rawHeading =
    Number.isFinite(rawPoint.heading) && Number(rawPoint.speed || 0) >= MIN_HEADING_SPEED_MPS
      ? normalizeHeadingDegrees(rawPoint.heading)
      : Number.NaN;

  const derivedHeading =
    haversineDistanceMeters(previousPoint, rawPoint) >= MIN_HEADING_MOVE_METERS
      ? calculateHeadingDegrees(previousPoint, smoothedPoint)
      : Number.NaN;
  const candidateHeading = Number.isFinite(rawHeading) ? rawHeading : derivedHeading;

  if (!Number.isFinite(candidateHeading)) {
    return Number.isFinite(previousPoint.heading) ? previousPoint.heading : Number.NaN;
  }

  if (!Number.isFinite(previousPoint.heading)) {
    return candidateHeading;
  }

  return smoothHeading(previousPoint.heading, candidateHeading, 0.24);
}

function smoothHeading(previousHeading, nextHeading, weight) {
  const start = normalizeHeadingDegrees(previousHeading);
  const end = normalizeHeadingDegrees(nextHeading);

  if (!Number.isFinite(start)) {
    return end;
  }

  if (!Number.isFinite(end)) {
    return start;
  }

  const delta = ((((end - start) % 360) + 540) % 360) - 180;
  return normalizeHeadingDegrees(start + delta * clamp(weight, 0.08, 0.4));
}

function mapStrategyLabel(strategy) {
  if (strategy === "fast") {
    return "rapida";
  }

  if (strategy === "cautious") {
    return "prudente";
  }

  return "equilibrada";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function createOffRouteMetrics() {
  return {
    distanceMeters: Number.POSITIVE_INFINITY,
    thresholdMeters: APP_CONFIG.deviationThresholdMeters,
    accuracyLimitMeters: APP_CONFIG.deviationAccuracyLimitMeters,
    isReliable: false,
    isOffRoute: false,
  };
}

function createEmptyNavigationSnapshot() {
  return {
    progressRatio: 0,
    completedDistanceMeters: 0,
    remainingDistanceMeters: 0,
    remainingDurationSeconds: 0,
    totalDistanceMeters: 0,
    snappedPoint: null,
    distanceFromRouteMeters: Number.POSITIVE_INFINITY,
  };
}
