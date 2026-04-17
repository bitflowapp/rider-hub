export function startTripTimer(context = {}, now = new Date()) {
  return {
    id: String(context.id || `trip-${now.getTime()}-${Math.random().toString(16).slice(2, 8)}`),
    startedAt: now.toISOString(),
    estimatedDurationSeconds: Number(context.estimatedDurationSeconds || 0),
    ...context,
  };
}

export function stopTripTimer(activeTrip, now = new Date()) {
  const actualDurationSeconds = getElapsedTripSeconds(activeTrip, now);
  const delta = calculateTripDelta(activeTrip?.estimatedDurationSeconds, actualDurationSeconds);

  return {
    ...activeTrip,
    completedAt: now.toISOString(),
    actualDurationSeconds,
    delta,
  };
}

export function getElapsedTripSeconds(activeTrip, now = new Date()) {
  const startedAt = new Date(activeTrip?.startedAt || now);
  return Math.max(1, Math.round((now.getTime() - startedAt.getTime()) / 1000));
}

export function calculateTripDelta(estimatedDurationSeconds, actualDurationSeconds) {
  const safeEstimated = Math.max(0, Number(estimatedDurationSeconds || 0));
  const safeActual = Math.max(0, Number(actualDurationSeconds || 0));
  const deltaSeconds = safeActual - safeEstimated;
  const absSeconds = Math.abs(deltaSeconds);

  return {
    estimatedDurationSeconds: safeEstimated,
    actualDurationSeconds: safeActual,
    deltaSeconds,
    deltaMinutes: Math.round(deltaSeconds / 60),
    absMinutes: Math.round(absSeconds / 60),
    ratio: safeEstimated > 0 ? safeActual / safeEstimated : 0,
    trend: deltaSeconds > 60 ? "slower" : deltaSeconds < -60 ? "faster" : "on-target",
  };
}

export function formatTripDelta(delta) {
  if (!delta || !Number.isFinite(delta.deltaSeconds)) {
    return "Sin comparacion real";
  }

  if (delta.trend === "on-target") {
    return "Rindio casi igual a lo estimado";
  }

  const minutes = Math.max(1, Math.abs(delta.deltaMinutes));
  return delta.trend === "slower"
    ? `${minutes} min mas que lo estimado`
    : `${minutes} min menos que lo estimado`;
}

export function getHourContext(dateValue = new Date()) {
  const date = new Date(dateValue);
  const hour = date.getHours();

  if (hour >= 6 && hour < 11) {
    return "morning";
  }

  if (hour >= 11 && hour < 15) {
    return "midday";
  }

  if (hour >= 15 && hour < 21) {
    return "afternoon";
  }

  return "night";
}
