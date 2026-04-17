import { APP_CONFIG } from "../utils/app_config.js";

export const ROUTE_SCORING_WEIGHTS = {
  estimatedTime: 0.28,
  distance: 0.08,
  operationalRisk: 0.22,
  historicalPerformance: 0.18,
  reliability: 0.12,
  feedback: 0.08,
  similarity: 0.06,
  detour: 0.08,
  strategyPreference: 0.08,
};

export function buildRouteFingerprint(route) {
  const coordinates = extractRepresentativeCoordinates(route?.geometry);

  if (!coordinates.length) {
    return `${Math.round(Number(route?.distanceMeters || 0))}:${Math.round(Number(route?.durationSeconds || 0))}`;
  }

  return [
    ...coordinates.map(([lng, lat]) => `${lng.toFixed(4)},${lat.toFixed(4)}`),
    Math.round(Number(route?.distanceMeters || 0)),
    Math.round(Number(route?.durationSeconds || 0)),
  ].join("|");
}

export function computeReliabilityScore({
  sampleSize = 0,
  avgDeltaRatio = 1,
  detourRate = 0,
  positiveRate = 0,
  negativeRate = 0,
  providerScore = 0,
  routeMatchConfidence = 0,
}) {
  if (!sampleSize) {
    return 0.5;
  }

  const accuracyScore = clamp01(1 - Math.abs(avgDeltaRatio - 1) * 0.8);
  const detourScore = clamp01(1 - detourRate);
  const feedbackScore = clamp01(0.5 + (positiveRate - negativeRate) * 0.5);
  const providerReliability = clamp01(0.5 + providerScore * 0.4);
  const confidenceLift = clamp01(routeMatchConfidence);

  return clamp01(
    accuracyScore * 0.34 +
      detourScore * 0.22 +
      feedbackScore * 0.2 +
      providerReliability * 0.14 +
      confidenceLift * 0.1
  );
}

export function scoreRouteForRider({ route, preferredStrategy, stats }) {
  const durationPenalty = normalizeMetric(route.durationSeconds, stats.durationRange.min, stats.durationRange.max);
  const distancePenalty = normalizeMetric(route.distanceMeters, stats.distanceRange.min, stats.distanceRange.max);
  const riskPenalty = clamp01((route.operationalRisk?.score || 0) / 8);
  const historicalPenalty = 1 - clamp01((Number(route.historyMetrics?.performanceScore || 0) + 1) / 2);
  const reliabilityPenalty = 1 - clamp01(Number(route.historyMetrics?.reliabilityScore || 0.5));
  const feedbackPenalty = 1 - clamp01((Number(route.historyMetrics?.feedbackScore || 0) + 1) / 2);
  const similarityPenalty = 1 - clamp01(route.historyMetrics?.similarityConfidence || 0);
  const detourPenalty = clamp01(route.historyMetrics?.detourRate || 0);
  const preferencePenalty = computeStrategyPenalty(route, preferredStrategy);

  const weightedPenalty =
    durationPenalty * ROUTE_SCORING_WEIGHTS.estimatedTime +
    distancePenalty * ROUTE_SCORING_WEIGHTS.distance +
    riskPenalty * ROUTE_SCORING_WEIGHTS.operationalRisk +
    historicalPenalty * ROUTE_SCORING_WEIGHTS.historicalPerformance +
    reliabilityPenalty * ROUTE_SCORING_WEIGHTS.reliability +
    feedbackPenalty * ROUTE_SCORING_WEIGHTS.feedback +
    similarityPenalty * ROUTE_SCORING_WEIGHTS.similarity +
    detourPenalty * ROUTE_SCORING_WEIGHTS.detour +
    preferencePenalty * ROUTE_SCORING_WEIGHTS.strategyPreference;

  const finalScore = Math.round((1 - weightedPenalty) * 1000) / 10;

  return {
    finalScore,
    breakdown: {
      durationPenalty,
      distancePenalty,
      riskPenalty,
      historicalPenalty,
      reliabilityPenalty,
      feedbackPenalty,
      similarityPenalty,
      detourPenalty,
      preferencePenalty,
    },
  };
}

export function chooseRecommendedRoute(routes) {
  return [...routes].sort((left, right) => right.riderScore - left.riderScore)[0] || null;
}

export function summarizeAlternativeRoute(route, context = {}) {
  const labels = [];

  if (route.id === context.recommendedRouteId) {
    labels.push("Sugerida");
  }

  if (route.id === context.fastestRouteId) {
    labels.push("Mas rapida");
  }

  if (route.id === context.lowestRiskRouteId) {
    labels.push("Mas prudente");
  }

  if (route.id === context.historicalBestRouteId && (route.historyMetrics?.sampleSize || 0) > 1) {
    labels.push("Historicamente mejor");
  }

  if (!labels.length) {
    labels.push(buildRouteStrategyLabel(route.displayStrategy || route.strategy));
  }

  let recommendation = route.baseSummary || "Ruta real del provider.";

  if ((route.historyMetrics?.sampleSize || 0) > 0) {
    if (route.historyMetrics?.nightStrength && route.displayStrategy === "cautious") {
      recommendation = "Mejor resultado historico de noche.";
    } else if ((route.historyMetrics?.performanceScore || 0) > 0.28) {
      recommendation = "Ya te rindio bien antes.";
    } else if ((route.historyMetrics?.performanceScore || 0) < -0.2) {
      recommendation = "Antecedentes flojos para este tipo de viaje.";
    }
  }

  if (route.id === context.fastestRouteId && route.id !== context.lowestRiskRouteId && (route.operationalRisk?.score || 0) > 0) {
    recommendation = "Gana tiempo, pero toca un sector mas sensible.";
  }

  if (route.id === context.lowestRiskRouteId && route.id !== context.fastestRouteId) {
    recommendation = route.historyMetrics?.nightStrength
      ? "Mas estable y mejor apoyada por viajes nocturnos."
      : "Baja exposicion operativa frente a las otras opciones.";
  }

  return {
    title: labels[0],
    labels,
    recommendation,
  };
}

export function buildRouteStrategyLabel(strategy) {
  if (strategy === "fast") {
    return "Rapida";
  }

  if (strategy === "cautious") {
    return "Prudente";
  }

  return "Equilibrada";
}

function computeStrategyPenalty(route, preferredStrategy) {
  const safeStrategies = Array.isArray(route.availableStrategies) && route.availableStrategies.length
    ? route.availableStrategies
    : [route.strategy || "balanced"];
  const preferredIndex = APP_CONFIG.strategyOrder.indexOf(preferredStrategy);

  if (preferredIndex === -1) {
    return 0;
  }

  const bestDistance = safeStrategies.reduce((best, strategy) => {
    const strategyIndex = APP_CONFIG.strategyOrder.indexOf(strategy);

    if (strategyIndex === -1) {
      return best;
    }

    return Math.min(best, Math.abs(strategyIndex - preferredIndex));
  }, Number.POSITIVE_INFINITY);

  if (!Number.isFinite(bestDistance) || bestDistance <= 0) {
    return 0;
  }

  return bestDistance === 1 ? 0.45 : 0.88;
}

function normalizeMetric(value, min, max) {
  const safeValue = Number(value || 0);

  if (!Number.isFinite(safeValue) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return 0;
  }

  return clamp01((safeValue - min) / (max - min));
}

function extractRepresentativeCoordinates(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) {
    return [];
  }

  const coordinates = geometry.type === "MultiLineString" ? geometry.coordinates.flat() : geometry.coordinates;

  if (!coordinates.length) {
    return [];
  }

  const middleIndex = Math.floor(coordinates.length / 2);
  return [coordinates[0], coordinates[middleIndex], coordinates[coordinates.length - 1]].filter(Boolean);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}
