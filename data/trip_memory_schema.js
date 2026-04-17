export const TRIP_MEMORY_VERSION = 1;

export const TRIP_FEEDBACK_TYPES = [
  {
    id: "good",
    label: "Buena",
    impact: 2.2,
  },
  {
    id: "awkward",
    label: "Incomoda",
    impact: -1.3,
  },
  {
    id: "time_loss",
    label: "Me hizo perder tiempo",
    impact: -2.5,
  },
  {
    id: "zone_issue",
    label: "Zona complicada",
    impact: -2.1,
  },
  {
    id: "reuse",
    label: "La volveria a usar",
    impact: 1.8,
  },
];

export const TRIP_FEEDBACK_MAP = TRIP_FEEDBACK_TYPES.reduce((accumulator, entry) => {
  accumulator[entry.id] = entry;
  return accumulator;
}, {});

export const HOUR_CONTEXT_LABELS = {
  morning: "Manana",
  midday: "Mediodia",
  afternoon: "Tarde",
  night: "Noche",
};

export function normalizeTripFeedbackList(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  const seen = new Set();

  return items
    .map((item) => String(item || "").trim())
    .filter((item) => TRIP_FEEDBACK_MAP[item] && !seen.has(item) && seen.add(item));
}

export function getTripFeedbackLabel(type) {
  return TRIP_FEEDBACK_MAP[type]?.label || "Feedback";
}

export function getTripFeedbackImpact(type) {
  return Number(TRIP_FEEDBACK_MAP[type]?.impact || 0);
}

export function buildTripFeedbackScore(feedbackList) {
  return normalizeTripFeedbackList(feedbackList).reduce((total, type) => total + getTripFeedbackImpact(type), 0);
}

export function normalizeTripMemoryEntries(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return [...items]
    .map(normalizeTripMemoryEntry)
    .filter(Boolean)
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

export function normalizeTripMemoryEntry(item) {
  const createdAt = new Date(item?.createdAt || item?.completedAt || Date.now());
  const startedAt = new Date(item?.startedAt || item?.createdAt || Date.now());
  const completedAt = new Date(item?.completedAt || item?.endedAt || item?.createdAt || Date.now());
  const estimatedDurationSeconds = Number(item?.estimatedDurationSeconds || 0);
  const actualDurationSeconds = Number(item?.actualDurationSeconds || 0);
  const deltaSeconds = Number(item?.deltaSeconds || actualDurationSeconds - estimatedDurationSeconds);
  const deltaRatio = Number(
    item?.deltaRatio || (estimatedDurationSeconds > 0 ? actualDurationSeconds / estimatedDurationSeconds : 0)
  );
  const distanceMeters = Number(item?.distanceMeters || 0);
  const riskScore = Number(item?.riskScore || 0);
  const feedback = normalizeTripFeedbackList(item?.feedback || []);

  if (Number.isNaN(createdAt.getTime()) || Number.isNaN(startedAt.getTime()) || Number.isNaN(completedAt.getTime())) {
    return null;
  }

  if (!estimatedDurationSeconds || !actualDurationSeconds) {
    return null;
  }

  const normalizedAddress = String(item?.normalizedAddress || "").trim();
  const streetName = String(item?.streetName || "").trim();
  const zoneLabel = String(item?.zoneLabel || "").trim();

  if (!normalizedAddress || !streetName || !zoneLabel) {
    return null;
  }

  return {
    version: TRIP_MEMORY_VERSION,
    id: String(item?.id || `trip-${completedAt.getTime()}`),
    createdAt: createdAt.toISOString(),
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    originalAddress: String(item?.originalAddress || "").trim(),
    normalizedAddress,
    normalizedKey: String(item?.normalizedKey || "").trim(),
    streetName,
    streetKey: String(item?.streetKey || "").trim(),
    houseNumber: String(item?.houseNumber || "").trim(),
    zoneLabel,
    zoneKey: String(item?.zoneKey || "").trim(),
    sectorLabel: String(item?.sectorLabel || zoneLabel).trim(),
    sectorKey: String(item?.sectorKey || item?.zoneKey || "").trim(),
    hourContext: String(item?.hourContext || "midday").trim(),
    provider: String(item?.provider || "").trim(),
    strategy: String(item?.strategy || "balanced").trim(),
    routeId: String(item?.routeId || "").trim(),
    routeFingerprint: String(item?.routeFingerprint || "").trim(),
    routeSummary: String(item?.routeSummary || "").trim(),
    alternatives: normalizeAlternatives(item?.alternatives || []),
    estimatedDurationSeconds,
    actualDurationSeconds,
    deltaSeconds,
    deltaRatio: Number.isFinite(deltaRatio) && deltaRatio > 0 ? deltaRatio : 0,
    distanceMeters: Number.isFinite(distanceMeters) && distanceMeters > 0 ? distanceMeters : 0,
    hadDetour: Boolean(item?.hadDetour),
    detourSource: String(item?.detourSource || "").trim(),
    destinationRiskLabel: String(item?.destinationRiskLabel || "").trim(),
    routeRiskLabel: String(item?.routeRiskLabel || "").trim(),
    operationalRiskLabel: String(item?.operationalRiskLabel || "").trim(),
    riskScore: Number.isFinite(riskScore) ? riskScore : 0,
    feedback,
    feedbackScore: Number(item?.feedbackScore || buildTripFeedbackScore(feedback)),
    observation: String(item?.observation || "").trim(),
  };
}

function normalizeAlternatives(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => {
      const durationSeconds = Number(item?.durationSeconds || 0);
      const distanceMeters = Number(item?.distanceMeters || 0);

      if (!durationSeconds || !distanceMeters) {
        return null;
      }

      return {
        id: String(item?.id || "").trim(),
        label: String(item?.label || "").trim(),
        strategy: String(item?.strategy || "").trim(),
        durationSeconds,
        distanceMeters,
        riskLabel: String(item?.riskLabel || "").trim(),
      };
    })
    .filter(Boolean)
    .slice(0, 6);
}
