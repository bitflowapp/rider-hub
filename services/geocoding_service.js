import { APP_CONFIG } from "../utils/app_config.js";
import {
  compactDestinationLabel,
  findBlockedLocality,
  formatLocalityLabel,
  isWithinNeuquenBounds,
  normalizeAddressText,
  toAsciiMatch,
} from "../utils/address_utils.js";
import {
  enrichAddressWithNeuquenCapital,
  extractHouseNumber,
  matchStreetCandidate,
} from "./street_index_service.js";

export async function geocodeAddress(rawText) {
  const interpretation = enrichAddressWithNeuquenCapital(rawText);

  if (!interpretation.ok) {
    return {
      ok: false,
      status: interpretation.status,
      reason: interpretation.reason,
      interpretation,
    };
  }

  const candidateGroups = await Promise.all(
    buildGeocodeQueries(interpretation).map(async (query) => {
      const url = new URL(APP_CONFIG.providers.geocoding.photonUrl);
      url.searchParams.set("q", query);
      url.searchParams.set("limit", "6");
      url.searchParams.set("bbox", APP_CONFIG.geocodeBBox.join(","));

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`No pude consultar el geocoder (${response.status}).`);
      }

      const payload = await response.json();
      return (payload.features || []).map((feature) => mapPhotonFeature(feature, interpretation));
    })
  );

  const matches = candidateGroups
    .flat()
    .filter((candidate) => candidate.validation.ok && candidate.streetMatch?.street)
    .sort((left, right) => right.matchScore - left.matchScore);

  if (!matches.length || matches[0].matchScore < 11) {
    return {
      ok: false,
      provider: "photon",
      status: interpretation.status === "valid" ? "doubtful" : interpretation.status,
      reason: "No pude validar con suficiente confianza esa direccion dentro de Neuquen Capital.",
      interpretation: {
        ...interpretation,
        status: "doubtful",
      },
    };
  }

  return {
    ok: true,
    provider: "photon",
    interpretation: {
      ...interpretation,
      status:
        matches[0].hasExactHouseMatch && matches[0].matchScore >= 15 && interpretation.status === "valid"
          ? "valid"
          : "doubtful",
      notes: mergeNotes(interpretation.notes, matches[0].notes),
    },
    destination: matches[0],
    matches,
  };
}

export async function reverseGeocode(coords) {
  const url = new URL(APP_CONFIG.providers.geocoding.photonReverseUrl);
  url.searchParams.set("lon", String(coords.lng));
  url.searchParams.set("lat", String(coords.lat));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`No pude resolver origen (${response.status}).`);
  }

  const payload = await response.json();
  const feature = payload.features?.[0];

  if (!feature) {
    return null;
  }

  const candidate = mapPhotonFeature(feature, {
    interpretedStreet: "",
    houseNumber: "",
    cleanedInput: "",
    notes: [],
  });

  return candidate.validation.ok ? candidate : null;
}

export function validateNeuquenCapital(result) {
  if (!result || !result.coordinates) {
    return {
      ok: false,
      reason: "Sin coordenadas validas.",
    };
  }

  if (!isWithinNeuquenBounds(result.coordinates.lng, result.coordinates.lat)) {
    return {
      ok: false,
      reason: "La ubicacion queda fuera del perimetro de Neuquen Capital.",
    };
  }

  const blockedLocality = findBlockedLocality(
    [result.label, result.displayName, result.properties?.city, result.properties?.district].join(" ")
  );

  if (blockedLocality) {
    return {
      ok: false,
      reason: `La coincidencia parece pertenecer a ${formatLocalityLabel(blockedLocality)}.`,
    };
  }

  const metadata = toAsciiMatch(
    [
      result.properties?.city,
      result.properties?.district,
      result.properties?.county,
      result.properties?.state,
      result.properties?.country,
      result.displayName,
    ]
      .filter(Boolean)
      .join(" ")
  );

  const isArgentina = (result.properties?.countrycode || "").toLowerCase() === "ar";
  const referencesNeuquen = /\bneuquen\b/.test(metadata) || /\bconfluencia\b/.test(metadata);

  return {
    ok: isArgentina && referencesNeuquen,
    reason: isArgentina && referencesNeuquen ? "" : "La coincidencia no queda claramente dentro de Neuquen Capital.",
  };
}

function mapPhotonFeature(feature, interpretation) {
  const properties = feature.properties || {};
  const geometry = feature.geometry || {};
  const coordinates = geometry.coordinates || [];
  const rawStreet = normalizeAddressText(properties.street || properties.name || "");
  const rawHouseNumber = normalizeAddressText(properties.housenumber || "");
  const houseNumber = rawHouseNumber || interpretation.houseNumber || extractHouseNumber(interpretation.cleanedInput);
  const streetMatch = matchStreetCandidate(rawStreet || interpretation.interpretedStreet);
  const canonicalStreet = streetMatch.street?.canonical || interpretation.interpretedStreet || rawStreet;
  const labelBase = [canonicalStreet, houseNumber].filter(Boolean).join(" ").trim();
  const label = labelBase
    ? `${labelBase}, ${APP_CONFIG.cityQuery}`
    : normalizeAddressText(properties.name || interpretation.cleanedInput);
  const displayName = normalizeAddressText(
    [
      labelBase || properties.name || rawStreet,
      properties.district,
      properties.city || APP_CONFIG.cityDisplay,
      APP_CONFIG.provinceDisplay,
      APP_CONFIG.countryDisplay,
    ]
      .filter(Boolean)
      .join(", ")
  );

  const candidate = {
    id: `photon-${properties.osm_type || "x"}-${properties.osm_id || Math.random().toString(16).slice(2, 8)}`,
    label,
    displayName,
    coordinates: {
      lng: Number(coordinates[0]),
      lat: Number(coordinates[1]),
    },
    properties,
  };

  const validation = validateNeuquenCapital(candidate);
  const candidateWithValidation = {
    ...candidate,
    validation,
  };

  return {
    ...candidateWithValidation,
    streetMatch,
    hasExactHouseMatch: Boolean(houseNumber && interpretation.houseNumber && houseNumber === interpretation.houseNumber),
    matchScore: buildMatchScore({
      interpretation,
      candidate: candidateWithValidation,
      streetMatch,
      houseNumber,
    }),
    notes: buildCandidateNotes({
      interpretation,
      candidate,
      streetMatch,
      houseNumber,
    }),
  };
}

function buildMatchScore({ interpretation, candidate, streetMatch, houseNumber }) {
  let score = 0;

  if (candidate.validation.ok) {
    score += 4;
  }

  if (streetMatch.street) {
    score += streetMatch.score * 7;
  }

  if (
    interpretation.streetMatch?.street &&
    streetMatch.street &&
    interpretation.streetMatch.street.canonical === streetMatch.street.canonical
  ) {
    score += 5;
  }

  if (houseNumber && interpretation.houseNumber && houseNumber === interpretation.houseNumber) {
    score += 4;
  }

  if (compactDestinationLabel(candidate.label) === compactDestinationLabel(interpretation.interpretedLine)) {
    score += 3;
  }

  if (toAsciiMatch(candidate.displayName).includes(toAsciiMatch(interpretation.cleanedInput))) {
    score += 2;
  }

  return score;
}

function buildCandidateNotes({ interpretation, candidate, streetMatch, houseNumber }) {
  const notes = [];

  if (streetMatch.street && interpretation.streetMatch?.street?.canonical === streetMatch.street.canonical) {
    notes.push("La calle coincide con la base local.");
  }

  if (houseNumber && interpretation.houseNumber && houseNumber === interpretation.houseNumber) {
    notes.push("La altura coincide.");
  } else if (interpretation.houseNumber && !houseNumber) {
    notes.push("No pude validar la altura exacta; ubico el tramo de calle.");
  }

  if (candidate.properties?.district) {
    notes.push(`Zona geocodificada: ${candidate.properties.district}.`);
  }

  return notes;
}

function mergeNotes(base, extra) {
  return [...new Set([...(base || []), ...(extra || [])])].slice(0, 4);
}

function buildGeocodeQueries(interpretation) {
  return [
    interpretation.interpretedCore ? `${interpretation.interpretedCore}, Neuquen` : "",
    interpretation.cleanedInput ? `${interpretation.cleanedInput}, Neuquen` : "",
    interpretation.interpretedStreet ? `${interpretation.interpretedStreet}, Neuquen` : "",
    ...interpretation.queryCandidates,
  ].filter(Boolean);
}
