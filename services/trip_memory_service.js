import { APP_CONFIG } from "../utils/app_config.js";
import { compactDestinationLabel, normalizeAddressText, toAsciiMatch } from "../utils/address_utils.js";
import { getHourContext } from "../utils/time_utils.js";
import { extractHouseNumber, matchStreetCandidate, normalizeStreetName } from "./street_index_service.js";
import { loadTripMemoryEntries, persistTripMemoryEntries } from "../data/trip_memory_store.js";
import {
  buildTripFeedbackScore,
  getTripFeedbackLabel,
  normalizeTripMemoryEntry,
  normalizeTripFeedbackList,
} from "../data/trip_memory_schema.js";
import {
  buildRouteFingerprint,
  buildRouteStrategyLabel,
  chooseRecommendedRoute,
  computeReliabilityScore,
  scoreRouteForRider,
  summarizeAlternativeRoute,
} from "./route_scoring_service.js";

export function saveTripMemory(entry) {
  const normalizedEntry = normalizeTripMemoryEntry(entry);

  if (!normalizedEntry) {
    return null;
  }

  const nextEntries = persistTripMemoryEntries([normalizedEntry, ...loadTripMemoryEntries()]);
  return nextEntries[0] || null;
}

export function getTripMemories() {
  return loadTripMemoryEntries();
}

export function getMemoriesByNormalizedAddress(address) {
  const profile = resolveAddressProfile(address);

  if (!profile.normalizedKey) {
    return [];
  }

  return getTripMemories().filter((memory) => memory.normalizedKey === profile.normalizedKey);
}

export function getMemoriesByStreet(streetName) {
  const streetKey = normalizeStreetName(streetName) || toAsciiMatch(streetName);

  if (!streetKey) {
    return [];
  }

  return getTripMemories().filter((memory) => memory.streetKey === streetKey);
}

export function getMemoriesByZone(zoneLabel) {
  const zoneKey = toAsciiMatch(zoneLabel);

  if (!zoneKey) {
    return [];
  }

  return getTripMemories().filter((memory) => memory.zoneKey === zoneKey || memory.sectorKey === zoneKey);
}

export function getSimilarDestinationMemories(address) {
  const profile = resolveAddressProfile(address);

  if (!profile.normalizedKey && !profile.streetKey && !profile.zoneKey) {
    return [];
  }

  return getTripMemories()
    .map((memory) => {
      const match = scoreMemoryMatch(memory, profile);
      return match ? { ...memory, ...match } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.similarityConfidence - left.similarityConfidence);
}

export function summarizeMemoryForDestination(address, strategy, hourContext = getHourContext()) {
  const profile = resolveAddressProfile(address);
  const matches = getSimilarDestinationMemories(profile);

  if (!matches.length) {
    return {
      profile,
      hasHistory: false,
      sampleSize: 0,
      confidence: 0,
      historicalPerformanceScore: 0,
      reliabilityScore: 0.5,
      feedbackScore: 0,
      label: "Sin experiencia previa suficiente",
      detail: "Todavia no hay viajes parecidos guardados para esta direccion, calle o zona.",
      bestStrategy: "",
      relevantMatches: [],
    };
  }

  const historyScore = getHistoricalPerformanceScore({
    matches,
    strategy,
    hourContext,
  });

  const bestStrategy = determineBestStrategy(matches, hourContext);
  const relevantMatches = matches.slice(0, 8);

  return {
    profile,
    hasHistory: historyScore.sampleSize > 0,
    sampleSize: historyScore.sampleSize,
    confidence: historyScore.confidence,
    historicalPerformanceScore: historyScore.performanceScore,
    reliabilityScore: historyScore.reliabilityScore,
    feedbackScore: historyScore.feedbackScore,
    label: buildMemoryHeadline(historyScore),
    detail: buildMemoryDetail(historyScore, bestStrategy, hourContext),
    bestStrategy,
    relevantMatches,
  };
}

export function getHistoricalPerformanceScore({
  matches = [],
  strategy = "balanced",
  hourContext = getHourContext(),
  provider = "",
  routeFingerprint = "",
}) {
  const relevantMatches = matches
    .map((match) => buildWeightedHistoricalMatch(match, { strategy, hourContext, provider, routeFingerprint }))
    .filter((item) => item.weight > 0);

  if (!relevantMatches.length) {
    return createEmptyHistoryScore();
  }

  const totalWeight = relevantMatches.reduce((total, item) => total + item.weight, 0);
  const weightedPerformance = relevantMatches.reduce((total, item) => total + item.performance * item.weight, 0);
  const avgDeltaRatio = relevantMatches.reduce((total, item) => total + item.memory.deltaRatio * item.weight, 0) / totalWeight;
  const detourRate =
    relevantMatches.reduce((total, item) => total + (item.memory.hadDetour ? 1 : 0) * item.weight, 0) / totalWeight;
  const positiveRate =
    relevantMatches.reduce((total, item) => total + (item.performance > 0.12 ? 1 : 0) * item.weight, 0) / totalWeight;
  const negativeRate =
    relevantMatches.reduce((total, item) => total + (item.performance < -0.12 ? 1 : 0) * item.weight, 0) / totalWeight;
  const feedbackScore =
    relevantMatches.reduce((total, item) => total + item.feedbackNormalized * item.weight, 0) / totalWeight;
  const confidence = clamp01(totalWeight / 5.2);
  const performanceScore = clampBetween(weightedPerformance / totalWeight, -1, 1) * confidence;
  const sameHourMatches = relevantMatches.filter((item) => item.memory.hourContext === hourContext);
  const nightStrength =
    hourContext === "night" &&
    sameHourMatches.length >= 2 &&
    sameHourMatches.reduce((total, item) => total + item.performance, 0) / sameHourMatches.length > 0.18;
  const routeMatchConfidence =
    relevantMatches.reduce((best, item) => Math.max(best, item.memory.routeFingerprint === routeFingerprint ? 1 : item.weight), 0) /
    Math.max(1, totalWeight);
  const providerScore = provider
    ? relevantMatches
        .filter((item) => item.memory.provider === provider)
        .reduce((total, item) => total + item.performance, 0) /
      Math.max(1, relevantMatches.filter((item) => item.memory.provider === provider).length)
    : 0;

  const reliabilityScore = computeReliabilityScore({
    sampleSize: relevantMatches.length,
    avgDeltaRatio,
    detourRate,
    positiveRate,
    negativeRate,
    providerScore: Number.isFinite(providerScore) ? providerScore : 0,
    routeMatchConfidence,
  });

  return {
    sampleSize: relevantMatches.length,
    confidence,
    performanceScore,
    avgDeltaRatio,
    detourRate,
    positiveRate,
    negativeRate,
    feedbackScore,
    reliabilityScore,
    exactCount: relevantMatches.filter((item) => item.matchType === "exact").length,
    streetCount: relevantMatches.filter((item) => item.matchType === "similar-address" || item.matchType === "same-street").length,
    zoneCount: relevantMatches.filter((item) => item.matchType === "same-zone" || item.matchType === "same-sector").length,
    similarityConfidence:
      relevantMatches.reduce((total, item) => total + item.memory.similarityConfidence, 0) / relevantMatches.length,
    nightStrength,
  };
}

export function rankRoutesWithMemory({
  routes = [],
  destinationProfile,
  preferredStrategy = "balanced",
  hourContext = getHourContext(),
}) {
  const profile = resolveAddressProfile(destinationProfile);
  const destinationSummary = summarizeMemoryForDestination(profile, preferredStrategy, hourContext);
  const relevantMatches = destinationSummary.relevantMatches || getSimilarDestinationMemories(profile);

  const routesWithHistory = routes.map((route) => {
    const displayStrategy = chooseDisplayStrategy(route.availableStrategies, preferredStrategy);
    const routeFingerprint = buildRouteFingerprint(route);
    const historyMetrics = getHistoricalPerformanceScore({
      matches: relevantMatches,
      strategy: displayStrategy,
      hourContext,
      provider: route.provider,
      routeFingerprint,
    });

    return {
      ...route,
      strategy: displayStrategy,
      displayStrategy,
      routeFingerprint,
      historyMetrics,
    };
  });

  const stats = buildRouteSetStats(routesWithHistory);

  const scoredRoutes = routesWithHistory
    .map((route) => {
      const routeScore = scoreRouteForRider({
        route,
        preferredStrategy,
        stats,
      });

      return {
        ...route,
        riderScore: routeScore.finalScore,
        riderScoreBreakdown: routeScore.breakdown,
      };
    })
    .sort((left, right) => right.riderScore - left.riderScore);

  const recommendedRoute = chooseRecommendedRoute(scoredRoutes);
  const context = {
    recommendedRouteId: recommendedRoute?.id || "",
    fastestRouteId: [...scoredRoutes].sort((left, right) => left.durationSeconds - right.durationSeconds)[0]?.id || "",
    lowestRiskRouteId: [...scoredRoutes].sort(
      (left, right) => (left.operationalRisk?.score || 0) - (right.operationalRisk?.score || 0)
    )[0]?.id || "",
    historicalBestRouteId: [...scoredRoutes].sort(
      (left, right) => (right.historyMetrics?.performanceScore || 0) - (left.historyMetrics?.performanceScore || 0)
    )[0]?.id || "",
  };

  return {
    destinationProfile: profile,
    destinationSummary,
    recommendedRouteId: context.recommendedRouteId,
    routes: scoredRoutes.map((route) => {
      const alternative = summarizeAlternativeRoute(route, context);
      return {
        ...route,
        alternativeTitle: alternative.title,
        alternativeLabels: alternative.labels,
        recommendation: alternative.recommendation,
        historyLabel: buildMemoryHeadline(route.historyMetrics),
        historyDetail: buildMemoryDetail(route.historyMetrics, route.displayStrategy, hourContext),
        baseSummary:
          route.baseSummary ||
          `Ruta ${buildRouteStrategyLabel(route.displayStrategy).toLowerCase()} con ${buildRiskToneCopy(route)}.`,
      };
    }),
  };
}

export function buildDestinationMemoryProfile({ rawAddress = "", destination = null, addressAnalysis = null, operationalRisk = null }) {
  return resolveAddressProfile({
    rawAddress,
    destination,
    addressAnalysis,
    operationalRisk,
  });
}

export function buildTripMemoryEntry({
  activeTrip,
  feedback = [],
  observation = "",
  hadDetour = false,
  completedTrip,
}) {
  const finalTrip = completedTrip || activeTrip;

  if (!finalTrip) {
    return null;
  }

  const safeFeedback = normalizeTripFeedbackList(feedback);
  const feedbackScore = buildTripFeedbackScore(safeFeedback);
  const delta = finalTrip.delta || {
    deltaSeconds: Number(finalTrip.actualDurationSeconds || 0) - Number(finalTrip.estimatedDurationSeconds || 0),
    ratio:
      Number(finalTrip.estimatedDurationSeconds || 0) > 0
        ? Number(finalTrip.actualDurationSeconds || 0) / Number(finalTrip.estimatedDurationSeconds || 0)
        : 0,
  };
  const inferredDetour = delta.ratio > 1.32;

  return {
    id: String(finalTrip.id || `trip-${Date.now()}`),
    createdAt: finalTrip.startedAt || new Date().toISOString(),
    startedAt: finalTrip.startedAt || new Date().toISOString(),
    completedAt: finalTrip.completedAt || new Date().toISOString(),
    originalAddress: String(finalTrip.originalAddress || "").trim(),
    normalizedAddress: finalTrip.destinationProfile?.normalizedAddress || "",
    normalizedKey: finalTrip.destinationProfile?.normalizedKey || "",
    streetName: finalTrip.destinationProfile?.streetName || "",
    streetKey: finalTrip.destinationProfile?.streetKey || "",
    houseNumber: finalTrip.destinationProfile?.houseNumber || "",
    zoneLabel: finalTrip.destinationProfile?.zoneLabel || APP_CONFIG.cityDisplay,
    zoneKey: finalTrip.destinationProfile?.zoneKey || "",
    sectorLabel: finalTrip.destinationProfile?.sectorLabel || finalTrip.destinationProfile?.zoneLabel || APP_CONFIG.cityDisplay,
    sectorKey: finalTrip.destinationProfile?.sectorKey || finalTrip.destinationProfile?.zoneKey || "",
    hourContext: finalTrip.hourContext || getHourContext(finalTrip.startedAt),
    provider: finalTrip.provider || "",
    strategy: finalTrip.strategy || "balanced",
    routeId: finalTrip.routeId || "",
    routeFingerprint: finalTrip.routeFingerprint || buildRouteFingerprint(finalTrip.route || {}),
    routeSummary: finalTrip.routeSummary || "",
    alternatives: Array.isArray(finalTrip.alternatives)
      ? finalTrip.alternatives.map((alternative) => ({
          id: alternative.id,
          label: alternative.label,
          strategy: alternative.strategy,
          durationSeconds: alternative.durationSeconds,
          distanceMeters: alternative.distanceMeters,
          riskLabel: alternative.riskLabel,
        }))
      : [],
    estimatedDurationSeconds: Number(finalTrip.estimatedDurationSeconds || 0),
    actualDurationSeconds: Number(finalTrip.actualDurationSeconds || 0),
    deltaSeconds: Number(delta.deltaSeconds || 0),
    deltaRatio: Number(delta.ratio || 0),
    distanceMeters: Number(finalTrip.distanceMeters || 0),
    hadDetour: Boolean(hadDetour || inferredDetour),
    detourSource: hadDetour ? "manual" : inferredDetour ? "heuristic" : "none",
    destinationRiskLabel: String(finalTrip.destinationRiskLabel || "").trim(),
    routeRiskLabel: String(finalTrip.routeRiskLabel || "").trim(),
    operationalRiskLabel: String(finalTrip.operationalRiskLabel || "").trim(),
    riskScore: Number(finalTrip.riskScore || 0),
    feedback: safeFeedback,
    feedbackScore,
    observation: String(observation || "").trim(),
  };
}

export function buildTripMemoryPreview(memoryEntry) {
  if (!memoryEntry) {
    return "";
  }

  const feedbackLabels = normalizeTripFeedbackList(memoryEntry.feedback).map(getTripFeedbackLabel);
  const feedbackCopy = feedbackLabels.length ? feedbackLabels.join(" | ") : "Sin feedback extra";

  return `${buildRouteStrategyLabel(memoryEntry.strategy)} | ${feedbackCopy}`;
}

function resolveAddressProfile(address) {
  if (address?.normalizedKey && address?.streetKey && address?.zoneKey) {
    return address;
  }

  const rawAddress =
    typeof address === "string"
      ? address
      : address?.normalizedAddress || address?.destination?.label || address?.addressAnalysis?.interpretedLine || address?.rawAddress || "";
  const normalizedAddress = compactDestinationLabel(normalizeAddressText(rawAddress));
  const normalizedKey = toAsciiMatch(normalizedAddress);
  const houseNumber = extractHouseNumber(normalizedAddress);
  const streetCandidate =
    address?.addressAnalysis?.interpretedStreet ||
    address?.destination?.streetMatch?.street?.canonical ||
    matchStreetCandidate(normalizedAddress).street?.canonical ||
    normalizedAddress.replace(/\b\d{1,5}\b/g, " ").split(",")[0].trim();
  const streetName = normalizeAddressText(streetCandidate || "");
  const streetKey = normalizeStreetName(streetName) || toAsciiMatch(streetName);
  const zoneLabel = normalizeAddressText(
    address?.destination?.properties?.district ||
      address?.destination?.properties?.suburb ||
      address?.destination?.properties?.city ||
      APP_CONFIG.cityDisplay
  );
  const zoneKey = toAsciiMatch(zoneLabel);
  const sectorLabel = normalizeAddressText(address?.operationalRisk?.matchedZones?.[0] || zoneLabel);
  const sectorKey = toAsciiMatch(sectorLabel);

  return {
    normalizedAddress,
    normalizedKey,
    houseNumber,
    streetName,
    streetKey,
    zoneLabel,
    zoneKey,
    sectorLabel,
    sectorKey,
  };
}

function scoreMemoryMatch(memory, profile) {
  if (!memory || !profile) {
    return null;
  }

  if (memory.normalizedKey && profile.normalizedKey && memory.normalizedKey === profile.normalizedKey) {
    return {
      matchType: "exact",
      similarityConfidence: 1,
    };
  }

  if (memory.streetKey && profile.streetKey && memory.streetKey === profile.streetKey) {
    const numericDistance = compareHouseNumbers(memory.houseNumber, profile.houseNumber);

    if (Number.isFinite(numericDistance) && numericDistance <= 250) {
      return {
        matchType: "similar-address",
        similarityConfidence: 0.88,
      };
    }

    return {
      matchType: "same-street",
      similarityConfidence: 0.74,
    };
  }

  if (memory.sectorKey && profile.sectorKey && memory.sectorKey === profile.sectorKey) {
    return {
      matchType: "same-sector",
      similarityConfidence: 0.56,
    };
  }

  if (memory.zoneKey && profile.zoneKey && memory.zoneKey === profile.zoneKey) {
    return {
      matchType: "same-zone",
      similarityConfidence: 0.48,
    };
  }

  return null;
}

function buildWeightedHistoricalMatch(match, { strategy, hourContext, provider, routeFingerprint }) {
  const sameStrategy = match.strategy === strategy;
  const sameHour = match.hourContext === hourContext;
  const sameProvider = provider && match.provider === provider;
  const sameRoute = routeFingerprint && match.routeFingerprint === routeFingerprint;
  const similarityConfidence = clamp01(match.similarityConfidence || 0);
  const feedbackNormalized = clampBetween(Number(match.feedbackScore || 0) / 4, -1, 1);
  const deltaPerformance = scoreDeltaRatio(match.deltaRatio || 0);
  const detourAdjustment = match.hadDetour ? -0.34 : 0.08;
  const performance = clampBetween(deltaPerformance * 0.45 + feedbackNormalized * 0.4 + detourAdjustment * 0.15, -1, 1);
  let weight = similarityConfidence;

  if (sameStrategy) {
    weight *= 1.18;
  } else {
    weight *= 0.9;
  }

  if (sameHour) {
    weight *= 1.08;
  }

  if (sameProvider) {
    weight *= 1.04;
  }

  if (sameRoute) {
    weight *= 1.18;
  }

  return {
    memory: match,
    performance,
    feedbackNormalized,
    weight,
  };
}

function buildRouteSetStats(routes) {
  return {
    durationRange: buildNumericRange(routes.map((route) => route.durationSeconds)),
    distanceRange: buildNumericRange(routes.map((route) => route.distanceMeters)),
  };
}

function buildNumericRange(values) {
  const safeValues = values.map((value) => Number(value || 0)).filter((value) => Number.isFinite(value) && value >= 0);
  return {
    min: safeValues.length ? Math.min(...safeValues) : 0,
    max: safeValues.length ? Math.max(...safeValues) : 0,
  };
}

function chooseDisplayStrategy(availableStrategies, preferredStrategy) {
  const safeStrategies = Array.isArray(availableStrategies) && availableStrategies.length
    ? availableStrategies
    : [preferredStrategy || "balanced"];

  if (safeStrategies.length === 1) {
    return safeStrategies[0];
  }

  if (safeStrategies.length === APP_CONFIG.strategyOrder.length) {
    return preferredStrategy || "balanced";
  }

  if (safeStrategies.includes("cautious") && !safeStrategies.includes("fast")) {
    return "cautious";
  }

  if (safeStrategies.includes("balanced")) {
    return "balanced";
  }

  if (safeStrategies.includes(preferredStrategy)) {
    return preferredStrategy;
  }

  return safeStrategies[0];
}

function determineBestStrategy(matches, hourContext) {
  const grouped = new Map();

  matches.forEach((match) => {
    const existing = grouped.get(match.strategy) || {
      total: 0,
      weight: 0,
    };
    const performance = scoreDeltaRatio(match.deltaRatio || 0) * 0.55 + clampBetween(match.feedbackScore / 4, -1, 1) * 0.45;
    const hourWeight = match.hourContext === hourContext ? 1.08 : 0.92;
    const totalWeight = (match.similarityConfidence || 0.5) * hourWeight;

    existing.total += performance * totalWeight;
    existing.weight += totalWeight;
    grouped.set(match.strategy, existing);
  });

  const ranked = [...grouped.entries()]
    .filter(([, entry]) => entry.weight >= 1.1)
    .map(([strategy, entry]) => ({
      strategy,
      score: entry.total / entry.weight,
    }))
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.strategy || "";
}

function buildMemoryHeadline(score) {
  if (!score || !score.sampleSize) {
    return "Sin experiencia previa suficiente";
  }

  if (score.performanceScore > 0.42) {
    return score.exactCount ? "Buena experiencia previa" : "Buen rendimiento en esta zona";
  }

  if (score.performanceScore > 0.16) {
    return "Antecedentes razonables";
  }

  if (score.performanceScore < -0.22) {
    return "Antecedentes flojos";
  }

  return "Historial mixto";
}

function buildMemoryDetail(score, bestStrategy, hourContext) {
  if (!score || !score.sampleSize) {
    return "Sin viajes parecidos suficientes para darle peso fuerte a la memoria.";
  }

  const pieces = [`${score.sampleSize} viaje${score.sampleSize === 1 ? "" : "s"} parecidos`];

  if (bestStrategy && score.performanceScore > 0.08) {
    pieces.push(`mejor con ${buildRouteStrategyLabel(bestStrategy).toLowerCase()}`);
  }

  if (score.nightStrength && hourContext === "night") {
    pieces.push("buen resultado historico de noche");
  }

  if (score.detourRate >= 0.34) {
    pieces.push("con desvios frecuentes");
  }

  return pieces.join(" | ");
}

function buildRiskToneCopy(route) {
  const label = route?.operationalRisk?.overallLabel || "riesgo normal";
  return label.toLowerCase();
}

function scoreDeltaRatio(deltaRatio) {
  if (!deltaRatio || !Number.isFinite(deltaRatio)) {
    return 0;
  }

  if (deltaRatio <= 0.95) {
    return 0.7;
  }

  if (deltaRatio <= 1.08) {
    return 0.42;
  }

  if (deltaRatio <= 1.18) {
    return 0.12;
  }

  if (deltaRatio <= 1.35) {
    return -0.18;
  }

  return -0.52;
}

function compareHouseNumbers(left, right) {
  const safeLeft = Number(left);
  const safeRight = Number(right);

  if (!Number.isFinite(safeLeft) || !Number.isFinite(safeRight)) {
    return Number.NaN;
  }

  return Math.abs(safeLeft - safeRight);
}

function createEmptyHistoryScore() {
  return {
    sampleSize: 0,
    confidence: 0,
    performanceScore: 0,
    avgDeltaRatio: 1,
    detourRate: 0,
    positiveRate: 0,
    negativeRate: 0,
    feedbackScore: 0,
    reliabilityScore: 0.5,
    exactCount: 0,
    streetCount: 0,
    zoneCount: 0,
    similarityConfidence: 0,
    nightStrength: false,
  };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function clampBetween(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}
