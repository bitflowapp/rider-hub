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
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (!segmentLengthSquared) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const projection =
    ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / segmentLengthSquared;
  const clampedProjection = Math.max(0, Math.min(1, projection));
  const closestX = start.x + segmentX * clampedProjection;
  const closestY = start.y + segmentY * clampedProjection;

  return Math.hypot(point.x - closestX, point.y - closestY);
}

function toRadians(value) {
  return (Number(value || 0) * Math.PI) / 180;
}
