import { getRouteProgressMetrics, haversineDistanceMeters, isValidPoint, calculateHeadingDegrees } from "../utils/geo_utils.js";

const MIN_SIGNIFICANT_TURN_DEGREES = 28;
const MIN_INFERRED_STEP_DISTANCE_METERS = 55;

export function buildRouteGuidance(route) {
  const providerSteps = normalizeProviderSteps(route?.guidanceSteps, route?.geometry);

  if (providerSteps.length) {
    return {
      source: "provider",
      steps: finalizeGuidanceSteps(providerSteps, route?.distanceMeters || 0),
    };
  }

  const inferredSteps = inferGuidanceStepsFromGeometry(route?.geometry);
  return {
    source: "geometry",
    steps: finalizeGuidanceSteps(inferredSteps, route?.distanceMeters || 0),
  };
}

export function getCurrentGuidanceState({
  route,
  currentPosition,
  destinationProfile = null,
  offRoute = false,
  recalculating = false,
  recalcFailed = false,
  deviationAlert = null,
} = {}) {
  const guidance = route?.guidance || buildRouteGuidance(route);

  if (!route?.geometry || !isValidPoint(currentPosition)) {
    return createEmptyGuidanceState(destinationProfile);
  }

  const progress = currentPosition.navigationSnapshot || getRouteProgressMetrics(currentPosition, route.geometry);
  const completedDistanceMeters = Number(progress.completedDistanceMeters || 0);
  const remainingDistanceMeters = Number(progress.remainingDistanceMeters || 0);
  const currentStepIndex = findCurrentStepIndex(guidance.steps, completedDistanceMeters);
  const currentStep = guidance.steps[currentStepIndex] || null;
  const nextStep = findNextSignificantStep(guidance.steps, currentStepIndex, completedDistanceMeters);
  const distanceToNextManeuverMeters = nextStep
    ? Math.max(0, Math.round((nextStep.cumulativeStartMeters || 0) - completedDistanceMeters))
    : Math.max(0, Math.round(remainingDistanceMeters));
  const maneuversRemaining = countRemainingManeuvers(guidance.steps, currentStepIndex, completedDistanceMeters);
  const currentStreet = resolveCurrentStreetName(guidance.steps, currentStepIndex, destinationProfile);
  const nextReference = resolveNextReference(nextStep, destinationProfile);

  if (recalculating) {
    return {
      ...createBaseGuidanceState(currentStreet, nextReference, distanceToNextManeuverMeters, maneuversRemaining),
      instruction: "Recalculando desde tu posicion",
      secondaryInstruction: "Buscando una mejor opcion sin perder el hilo del viaje.",
    };
  }

  if (recalcFailed) {
    return {
      ...createBaseGuidanceState(currentStreet, nextReference, distanceToNextManeuverMeters, maneuversRemaining),
      instruction: "Segui por la ruta actual",
      secondaryInstruction:
        deviationAlert?.copy || "No pude recalcular. Seguis con la ultima ruta valida.",
    };
  }

  if (offRoute) {
    return buildDeviationGuidance({
      distanceFromRouteMeters: Number(progress.distanceFromRouteMeters || deviationAlert?.distanceMeters || 0),
      currentStreet,
      nextReference,
      deviationAlert,
      maneuversRemaining,
    });
  }

  if (remainingDistanceMeters <= 45 || nextStep?.maneuverType === "arrive") {
    return {
      ...createBaseGuidanceState(currentStreet, nextReference, distanceToNextManeuverMeters, maneuversRemaining),
      instruction: "Llegando al destino",
      secondaryInstruction: destinationProfile?.streetName
        ? `Ultima referencia: ${destinationProfile.streetName}`
        : "Mantene la ruta actual hasta llegar.",
    };
  }

  const instruction = formatGuidanceInstruction({
    currentStep,
    nextStep,
    currentStreet,
    distanceToNextManeuverMeters,
    remainingDistanceMeters,
  });
  const secondaryInstruction = buildSecondaryInstruction({
    currentStreet,
    nextReference,
    distanceToNextManeuverMeters,
    maneuversRemaining,
  });

  return {
    ...createBaseGuidanceState(currentStreet, nextReference, distanceToNextManeuverMeters, maneuversRemaining),
    instruction,
    secondaryInstruction,
  };
}

export function formatGuidanceInstruction({
  currentStep = null,
  nextStep = null,
  currentStreet = "",
  distanceToNextManeuverMeters = 0,
  remainingDistanceMeters = 0,
} = {}) {
  const nextTurn = nextStep && isSignificantManeuver(nextStep) ? nextStep : null;

  if (!nextTurn) {
    const followDistance = Math.max(35, Math.min(distanceToNextManeuverMeters || remainingDistanceMeters || 0, remainingDistanceMeters || 0));
    return currentStreet
      ? `Segui ${formatShortDistance(followDistance)} por ${currentStreet}`
      : `Segui ${formatShortDistance(followDistance || remainingDistanceMeters)}`;
  }

  if (distanceToNextManeuverMeters <= 35) {
    return buildImmediateTurnInstruction(nextTurn);
  }

  return `En ${formatShortDistance(distanceToNextManeuverMeters)}, ${buildTurnInstruction(nextTurn)}`;
}

function createEmptyGuidanceState(destinationProfile) {
  return {
    instruction: "Segui la ruta sugerida",
    secondaryInstruction: destinationProfile?.streetName
      ? `Referencia principal: ${destinationProfile.streetName}`
      : "Mantene la ruta actual.",
    currentStreetLabel: "",
    nextReferenceLabel: "",
    distanceToManeuverLabel: "",
    maneuversRemaining: 0,
  };
}

function createBaseGuidanceState(currentStreet, nextReference, distanceToNextManeuverMeters, maneuversRemaining) {
  return {
    currentStreetLabel: currentStreet ? `Estas por ${currentStreet}` : "",
    nextReferenceLabel: nextReference ? `Proxima: ${nextReference}` : "",
    distanceToManeuverLabel:
      Number.isFinite(distanceToNextManeuverMeters) && distanceToNextManeuverMeters > 0
        ? `En ${formatShortDistance(distanceToNextManeuverMeters)}`
        : "",
    maneuversRemaining,
  };
}

function buildSecondaryInstruction({ currentStreet, nextReference, distanceToNextManeuverMeters, maneuversRemaining }) {
  const pieces = [];

  if (currentStreet) {
    pieces.push(`Estas por ${currentStreet}`);
  }

  if (nextReference) {
    const prefix = distanceToNextManeuverMeters > 0 ? `Proxima: ${nextReference}` : `Referencia: ${nextReference}`;
    pieces.push(prefix);
  }

  if (maneuversRemaining > 0) {
    pieces.push(
      `${maneuversRemaining} maniobra${maneuversRemaining === 1 ? "" : "s"} importante${maneuversRemaining === 1 ? "" : "s"}`
    );
  }

  return pieces.join(" | ") || "Mantene la ruta actual.";
}

function buildDeviationGuidance({ distanceFromRouteMeters, currentStreet, nextReference, deviationAlert, maneuversRemaining }) {
  const roundedDistance = Math.max(0, Math.round(distanceFromRouteMeters || deviationAlert?.distanceMeters || 0));
  const instruction =
    roundedDistance <= 120 ? "Volve a la ruta sugerida" : "Conviene recalcular ahora";
  const baseCopy =
    roundedDistance <= 120
      ? "Segui una cuadra para retomar la ruta."
      : "Nueva ruta sugerida desde tu posicion actual.";
  const referenceCopy = currentStreet
    ? `Estas por ${currentStreet}${nextReference ? ` | Proxima: ${nextReference}` : ""}`
    : nextReference
      ? `Referencia: ${nextReference}`
      : "";

  return {
    instruction,
    secondaryInstruction: [deviationAlert?.copy || baseCopy, referenceCopy].filter(Boolean).join(" | "),
    currentStreetLabel: currentStreet ? `Estas por ${currentStreet}` : "",
    nextReferenceLabel: nextReference ? `Proxima: ${nextReference}` : "",
    distanceToManeuverLabel: roundedDistance > 0 ? `${roundedDistance} m fuera de ruta` : "",
    maneuversRemaining,
  };
}

function normalizeProviderSteps(steps, geometry) {
  if (!Array.isArray(steps) || !steps.length) {
    return [];
  }

  const coordinates = extractCoordinates(geometry);
  return steps
    .map((step, index) => {
      const distanceMeters = Number(step.distanceMeters || step.distance || 0);
      const durationSeconds = Number(step.durationSeconds || step.duration || 0);
      const coordinate = normalizeCoordinate(step.coordinate || step.location || resolveGeometryCoordinate(step.geometryIndex, coordinates));

      return {
        index,
        maneuverType: normalizeManeuverType(step.maneuverType || step.type || "continue"),
        modifier: String(step.modifier || "").trim(),
        streetName: normalizeStreetName(step.streetName || step.name || step.ref || ""),
        instruction: String(step.instruction || "").trim(),
        distanceMeters,
        durationSeconds,
        coordinate,
      };
    })
    .filter((step) => step.distanceMeters > 0 || step.coordinate);
}

function inferGuidanceStepsFromGeometry(geometry) {
  const coordinates = extractCoordinates(geometry);

  if (coordinates.length < 2) {
    return [];
  }

  const steps = [];
  let traversedMeters = 0;
  let lastSignificantDistance = 0;

  for (let index = 1; index < coordinates.length - 1; index += 1) {
    const previousPoint = toPointObject(coordinates[index - 1]);
    const currentPoint = toPointObject(coordinates[index]);
    const nextPoint = toPointObject(coordinates[index + 1]);

    if (!previousPoint || !currentPoint || !nextPoint) {
      continue;
    }

    traversedMeters += haversineDistanceMeters(previousPoint, currentPoint);
    const turnDelta = computeTurnDelta(previousPoint, currentPoint, nextPoint);

    if (Math.abs(turnDelta) < MIN_SIGNIFICANT_TURN_DEGREES) {
      continue;
    }

    if (traversedMeters - lastSignificantDistance < MIN_INFERRED_STEP_DISTANCE_METERS) {
      continue;
    }

    steps.push({
      maneuverType: turnDelta > 0 ? "left" : "right",
      modifier: "",
      streetName: "",
      instruction: "",
      distanceMeters: 0,
      durationSeconds: 0,
      coordinate: currentPoint,
      inferredDistanceMeters: traversedMeters,
    });
    lastSignificantDistance = traversedMeters;
  }

  return steps;
}

function finalizeGuidanceSteps(steps, routeDistanceMeters) {
  const safeSteps = Array.isArray(steps) ? [...steps] : [];

  if (!safeSteps.length) {
    return [
      {
        index: 0,
        maneuverType: "continue",
        modifier: "",
        streetName: "",
        instruction: "",
        distanceMeters: Number(routeDistanceMeters || 0),
        durationSeconds: 0,
        coordinate: null,
        cumulativeStartMeters: 0,
        cumulativeEndMeters: Number(routeDistanceMeters || 0),
      },
      {
        index: 1,
        maneuverType: "arrive",
        modifier: "",
        streetName: "",
        instruction: "",
        distanceMeters: 0,
        durationSeconds: 0,
        coordinate: null,
        cumulativeStartMeters: Number(routeDistanceMeters || 0),
        cumulativeEndMeters: Number(routeDistanceMeters || 0),
      },
    ];
  }

  let cumulativeStartMeters = 0;
  const finalized = safeSteps.map((step, index) => {
    const nextDistance = Number(step.distanceMeters || 0);
    const inferredStart = Number.isFinite(step.inferredDistanceMeters) ? Number(step.inferredDistanceMeters) : cumulativeStartMeters;
    const startMeters = Math.max(cumulativeStartMeters, inferredStart);
    const endMeters = index === safeSteps.length - 1
      ? Math.max(startMeters, routeDistanceMeters || startMeters)
      : Math.max(startMeters + nextDistance, startMeters);

    cumulativeStartMeters = endMeters;

    return {
      ...step,
      index,
      cumulativeStartMeters: startMeters,
      cumulativeEndMeters: endMeters,
    };
  });

  if (finalized[0].cumulativeStartMeters > 0) {
    finalized.unshift({
      index: 0,
      maneuverType: "continue",
      modifier: "",
      streetName: finalized[0].streetName || "",
      instruction: "",
      distanceMeters: finalized[0].cumulativeStartMeters,
      durationSeconds: 0,
      coordinate: finalized[0].coordinate || null,
      cumulativeStartMeters: 0,
      cumulativeEndMeters: finalized[0].cumulativeStartMeters,
    });
  }

  const totalDistanceMeters = Math.max(routeDistanceMeters || 0, finalized[finalized.length - 1]?.cumulativeEndMeters || 0);
  const hasArrival = finalized.some((step) => step.maneuverType === "arrive");

  if (!hasArrival) {
    finalized.push({
      index: finalized.length,
      maneuverType: "arrive",
      modifier: "",
      streetName: "",
      instruction: "",
      distanceMeters: 0,
      durationSeconds: 0,
      coordinate: finalized[finalized.length - 1]?.coordinate || null,
      cumulativeStartMeters: totalDistanceMeters,
      cumulativeEndMeters: totalDistanceMeters,
    });
  }

  return finalized.map((step, index) => ({ ...step, index }));
}

function findCurrentStepIndex(steps, completedDistanceMeters) {
  if (!Array.isArray(steps) || !steps.length) {
    return 0;
  }

  const index = steps.findIndex(
    (step) => completedDistanceMeters >= Number(step.cumulativeStartMeters || 0) && completedDistanceMeters < Number(step.cumulativeEndMeters || 0)
  );

  if (index !== -1) {
    return index;
  }

  return Math.max(0, steps.length - 1);
}

function findNextSignificantStep(steps, currentStepIndex, completedDistanceMeters) {
  for (let index = Math.max(0, currentStepIndex); index < steps.length; index += 1) {
    const step = steps[index];

    if (!step) {
      continue;
    }

    if ((step.cumulativeStartMeters || 0) < completedDistanceMeters) {
      continue;
    }

    if (isSignificantManeuver(step) || step.maneuverType === "arrive") {
      return step;
    }
  }

  return steps[steps.length - 1] || null;
}

function countRemainingManeuvers(steps, currentStepIndex, completedDistanceMeters) {
  return steps
    .slice(Math.max(0, currentStepIndex))
    .filter((step) => (step.cumulativeStartMeters || 0) >= completedDistanceMeters && isSignificantManeuver(step)).length;
}

function resolveCurrentStreetName(steps, currentStepIndex, destinationProfile) {
  for (let index = currentStepIndex; index >= 0; index -= 1) {
    const streetName = normalizeStreetName(steps[index]?.streetName);

    if (streetName) {
      return streetName;
    }
  }

  return destinationProfile?.streetName || "";
}

function resolveNextReference(nextStep, destinationProfile) {
  return normalizeStreetName(nextStep?.streetName) || destinationProfile?.streetName || "";
}

function buildTurnInstruction(step) {
  const streetName = normalizeStreetName(step?.streetName);

  if (step?.maneuverType === "left") {
    return streetName ? `dobla a la izquierda en ${streetName}` : "dobla a la izquierda";
  }

  if (step?.maneuverType === "right") {
    return streetName ? `dobla a la derecha en ${streetName}` : "dobla a la derecha";
  }

  if (step?.maneuverType === "slight-left" || step?.maneuverType === "keep-left") {
    return streetName ? `mantenete por ${streetName}` : "mantenete hacia la izquierda";
  }

  if (step?.maneuverType === "slight-right" || step?.maneuverType === "keep-right") {
    return streetName ? `mantenete por ${streetName}` : "mantenete hacia la derecha";
  }

  if (step?.maneuverType === "arrive") {
    return "llegas al destino";
  }

  return streetName ? `segui por ${streetName}` : "segui por la ruta sugerida";
}

function buildImmediateTurnInstruction(step) {
  const instruction = buildTurnInstruction(step);
  return instruction.charAt(0).toUpperCase() + instruction.slice(1);
}

function isSignificantManeuver(step) {
  return ["left", "right", "slight-left", "slight-right", "keep-left", "keep-right", "uturn", "retake"].includes(
    step?.maneuverType
  );
}

function normalizeManeuverType(value) {
  const safeValue = String(value || "").trim().toLowerCase();

  if (!safeValue) {
    return "continue";
  }

  if (safeValue.includes("left")) {
    return safeValue.includes("slight") || safeValue.includes("keep") ? "slight-left" : "left";
  }

  if (safeValue.includes("right")) {
    return safeValue.includes("slight") || safeValue.includes("keep") ? "slight-right" : "right";
  }

  if (safeValue.includes("arrive") || safeValue.includes("destination") || safeValue.includes("finish")) {
    return "arrive";
  }

  if (safeValue.includes("uturn")) {
    return "uturn";
  }

  return safeValue;
}

function normalizeStreetName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatShortDistance(value) {
  const safeValue = Math.max(0, Math.round(Number(value || 0)));

  if (safeValue >= 1000) {
    return `${(safeValue / 1000).toFixed(safeValue >= 3000 ? 0 : 1).replace(".0", "")} km`;
  }

  return `${safeValue} m`;
}

function extractCoordinates(geometry) {
  if (!geometry?.coordinates) {
    return [];
  }

  if (geometry.type === "LineString") {
    return geometry.coordinates;
  }

  if (geometry.type === "MultiLineString") {
    return geometry.coordinates.flat();
  }

  return [];
}

function resolveGeometryCoordinate(index, coordinates) {
  if (!Number.isInteger(index) || !Array.isArray(coordinates) || !coordinates[index]) {
    return null;
  }

  return coordinates[index];
}

function normalizeCoordinate(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const lng = Number(value[0]);
    const lat = Number(value[1]);
    return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
  }

  if (value && Number.isFinite(value.lng) && Number.isFinite(value.lat)) {
    return { lng: Number(value.lng), lat: Number(value.lat) };
  }

  return null;
}

function toPointObject(value) {
  const coordinate = normalizeCoordinate(value);
  return coordinate ? { lng: coordinate.lng, lat: coordinate.lat } : null;
}

function computeTurnDelta(previousPoint, currentPoint, nextPoint) {
  const fromHeading = calculateHeadingDegrees(previousPoint, currentPoint);
  const toHeading = calculateHeadingDegrees(currentPoint, nextPoint);

  if (!Number.isFinite(fromHeading) || !Number.isFinite(toHeading)) {
    return 0;
  }

  const rawDelta = toHeading - fromHeading;
  return ((rawDelta + 540) % 360) - 180;
}
