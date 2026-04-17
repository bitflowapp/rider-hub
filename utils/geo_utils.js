export function haversineDistanceMeters(fromPoint, toPoint) {
  if (!isValidPoint(fromPoint) || !isValidPoint(toPoint)) {
    return Number.POSITIVE_INFINITY;
  }

  const earthRadiusMeters = 6371000;
  const fromLat = toRadians(fromPoint.lat);
  const toLat = toRadians(toPoint.lat);
  const deltaLat = toRadians(toPoint.lat - fromPoint.lat);
  const deltaLng = toRadians(toPoint.lng - fromPoint.lng);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getRouteLengthMeters(geometry) {
  const coordinates = extractLineCoordinates(geometry);

  if (coordinates.length < 2) {
    return 0;
  }

  let totalDistance = 0;

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = toPointObject(coordinates[index]);
    const end = toPointObject(coordinates[index + 1]);

    if (!start || !end) {
      continue;
    }

    totalDistance += haversineDistanceMeters(start, end);
  }

  return totalDistance;
}

export function getPointToRouteDistanceMeters(point, geometry) {
  if (!isValidPoint(point)) {
    return Number.POSITIVE_INFINITY;
  }

  const coordinates = extractLineCoordinates(geometry);

  if (coordinates.length < 2) {
    return Number.POSITIVE_INFINITY;
  }

  const referenceLat = point.lat;
  const pointXY = projectToLocalMeters(point.lng, point.lat, referenceLat);
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];

    if (!Array.isArray(start) || !Array.isArray(end)) {
      continue;
    }

    const startXY = projectToLocalMeters(Number(start[0]), Number(start[1]), referenceLat);
    const endXY = projectToLocalMeters(Number(end[0]), Number(end[1]), referenceLat);
    bestDistance = Math.min(bestDistance, distancePointToSegment(pointXY, startXY, endXY));
  }

  return bestDistance;
}

export function getRouteProgressMetrics(point, geometry) {
  if (!isValidPoint(point)) {
    return createEmptyProgressMetrics();
  }

  const coordinates = extractLineCoordinates(geometry);

  if (coordinates.length < 2) {
    return createEmptyProgressMetrics();
  }

  const referenceLat = point.lat;
  const pointXY = projectToLocalMeters(point.lng, point.lat, referenceLat);
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestCompletedDistance = 0;
  let bestSnappedPoint = null;
  let totalDistanceMeters = 0;

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    const startPoint = toPointObject(start);
    const endPoint = toPointObject(end);

    if (!startPoint || !endPoint) {
      continue;
    }

    const startXY = projectToLocalMeters(startPoint.lng, startPoint.lat, referenceLat);
    const endXY = projectToLocalMeters(endPoint.lng, endPoint.lat, referenceLat);
    const projection = projectPointToSegment(pointXY, startXY, endXY);
    const segmentDistance = haversineDistanceMeters(startPoint, endPoint);

    if (projection.distanceMeters < bestDistance) {
      bestDistance = projection.distanceMeters;
      bestCompletedDistance = totalDistanceMeters + segmentDistance * projection.ratio;
      bestSnappedPoint = {
        lng: startPoint.lng + (endPoint.lng - startPoint.lng) * projection.ratio,
        lat: startPoint.lat + (endPoint.lat - startPoint.lat) * projection.ratio,
      };
    }

    totalDistanceMeters += segmentDistance;
  }

  if (!Number.isFinite(bestDistance)) {
    return createEmptyProgressMetrics();
  }

  const completedDistanceMeters = clamp(bestCompletedDistance, 0, totalDistanceMeters);
  const remainingDistanceMeters = Math.max(0, totalDistanceMeters - completedDistanceMeters);

  return {
    totalDistanceMeters,
    completedDistanceMeters,
    remainingDistanceMeters,
    progressRatio: totalDistanceMeters > 0 ? completedDistanceMeters / totalDistanceMeters : 0,
    distanceFromRouteMeters: bestDistance,
    snappedPoint: bestSnappedPoint,
  };
}

export function calculateHeadingDegrees(fromPoint, toPoint) {
  if (!isValidPoint(fromPoint) || !isValidPoint(toPoint)) {
    return Number.NaN;
  }

  const fromLat = toRadians(fromPoint.lat);
  const toLat = toRadians(toPoint.lat);
  const deltaLng = toRadians(toPoint.lng - fromPoint.lng);
  const y = Math.sin(deltaLng) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLng);
  const heading = (Math.atan2(y, x) * 180) / Math.PI;

  return normalizeHeadingDegrees(heading);
}

export function normalizeHeadingDegrees(value) {
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }

  return ((Number(value) % 360) + 360) % 360;
}

export function isValidPoint(point) {
  return Number.isFinite(point?.lng) && Number.isFinite(point?.lat);
}

function extractLineCoordinates(geometry) {
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

function projectToLocalMeters(lng, lat, referenceLat) {
  const metersPerDegLat = 111320;
  const metersPerDegLng = Math.cos(toRadians(referenceLat)) * 111320;

  return {
    x: lng * metersPerDegLng,
    y: lat * metersPerDegLat,
  };
}

function distancePointToSegment(point, start, end) {
  return projectPointToSegment(point, start, end).distanceMeters;
}

function projectPointToSegment(point, start, end) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (!segmentLengthSquared) {
    return {
      ratio: 0,
      distanceMeters: Math.hypot(point.x - start.x, point.y - start.y),
    };
  }

  const projection =
    ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / segmentLengthSquared;
  const clampedProjection = Math.max(0, Math.min(1, projection));
  const closestX = start.x + segmentX * clampedProjection;
  const closestY = start.y + segmentY * clampedProjection;

  return {
    ratio: clampedProjection,
    distanceMeters: Math.hypot(point.x - closestX, point.y - closestY),
  };
}

function toPointObject(coordinate) {
  if (!Array.isArray(coordinate) || coordinate.length < 2) {
    return null;
  }

  const lng = Number(coordinate[0]);
  const lat = Number(coordinate[1]);

  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null;
  }

  return { lng, lat };
}

function toRadians(value) {
  return (Number(value || 0) * Math.PI) / 180;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function createEmptyProgressMetrics() {
  return {
    totalDistanceMeters: 0,
    completedDistanceMeters: 0,
    remainingDistanceMeters: 0,
    progressRatio: 0,
    distanceFromRouteMeters: Number.POSITIVE_INFINITY,
    snappedPoint: null,
  };
}
