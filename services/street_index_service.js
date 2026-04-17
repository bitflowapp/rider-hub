import { NEUQUEN_STREETS } from "../data/neuquen_streets.js";
import {
  findBlockedLocality,
  formatLocalityLabel,
  normalizeAddressText,
  toAsciiMatch,
} from "../utils/address_utils.js";
import { APP_CONFIG } from "../utils/app_config.js";

const STREET_FILLERS = new Set([
  "calle",
  "pasaje",
  "pje",
  "ruta",
  "altura",
  "numero",
  "nro",
  "num",
  "n",
  "no",
  "neuquen",
  "capital",
  "provincia",
  "dto",
  "dpto",
  "piso",
  "pb",
  "barrio",
  "mz",
  "mza",
  "manzana",
  "casa",
]);

const ABBREVIATION_RULES = [
  [/\bavda?\.?\b/g, "avenida"],
  [/\bgral\.?\b/g, "general"],
  [/\bcnel\.?\b/g, "coronel"],
  [/\bdr\.?\b/g, "doctor"],
  [/\bgdor\.?\b/g, "gobernador"],
  [/\bpte\.?\b/g, "presidente"],
  [/\bsta\.?\b/g, "santa"],
  [/\bsgo\.?\b/g, "santiago"],
  [/\bjb\b/g, "juan b"],
  [/\bcba\b/g, "cordoba"],
  [/\bmza\b/g, "mendoza"],
  [/\bnqn\b/g, "neuquen"],
  [/\barg\b/g, "argentina"],
];

const STREET_INDEX = NEUQUEN_STREETS.map((street) => {
  const aliases = [street.canonical, ...(street.aliases || [])];
  const normalizedAliases = aliases.map((alias) => normalizeStreetKey(alias));

  return {
    ...street,
    aliases,
    normalizedAliases,
  };
});

export function normalizeStreetName(text) {
  return normalizeStreetKey(text);
}

export function matchStreetCandidate(text) {
  const streetFragment = extractStreetFragment(text);

  if (!streetFragment) {
    return {
      ok: false,
      score: 0,
      confidence: "none",
      street: null,
      alternatives: [],
    };
  }

  const normalizedInput = normalizeStreetKey(streetFragment);
  const ranked = STREET_INDEX.map((street) => {
    const bestAliasScore = street.normalizedAliases.reduce((bestScore, alias) => {
      return Math.max(bestScore, scoreStreetAlias(normalizedInput, alias));
    }, 0);

    return {
      street,
      score: clampScore(bestAliasScore + street.importance * 0.002),
    };
  })
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

  const best = ranked[0];
  const confidence = classifyConfidence(best?.score || 0);

  return {
    ok: confidence === "strong" || confidence === "medium",
    score: best?.score || 0,
    confidence,
    street: confidence === "none" ? null : best?.street || null,
    input: streetFragment,
    normalizedInput,
    alternatives: ranked,
  };
}

export function validateStreetAgainstNeuquenIndex(text) {
  const locality = findBlockedLocality(text);

  if (locality) {
    return {
      ok: false,
      status: "outside",
      reason: `La direccion parece pertenecer a ${formatLocalityLabel(locality)}.`,
      houseNumber: extractHouseNumber(text),
      street: null,
    };
  }

  const streetMatch = matchStreetCandidate(text);
  const houseNumber = extractHouseNumber(text);
  const hasUsefulHeight = houseNumber.length >= 1;

  if (!streetMatch.street) {
    return {
      ok: false,
      status: "doubtful",
      reason: "No pude validar la calle contra la base local.",
      houseNumber,
      street: null,
      streetMatch,
    };
  }

  if (streetMatch.confidence === "low" || streetMatch.confidence === "none") {
    return {
      ok: false,
      status: "doubtful",
      reason: `El match con ${streetMatch.street.canonical} es demasiado flojo para corregir solo.`,
      houseNumber,
      street: streetMatch.street,
      streetMatch,
    };
  }

  return {
    ok: hasUsefulHeight,
    status: hasUsefulHeight ? "valid" : "doubtful",
    reason: hasUsefulHeight ? "Direccion validable con base local." : "Falta altura para validar mejor.",
    houseNumber,
    street: streetMatch.street,
    streetMatch,
  };
}

export function enrichAddressWithNeuquenCapital(text) {
  const cleanedInput = normalizeAddressText(text);

  if (!cleanedInput) {
    return {
      ok: false,
      status: "empty",
      reason: "Ingresa una direccion antes de buscar.",
      cleanedInput,
      notes: [],
      queryCandidates: [],
    };
  }

  const blockedLocality = findBlockedLocality(cleanedInput);

  if (blockedLocality) {
    return {
      ok: false,
      status: "outside",
      reason: `La direccion parece estar en ${formatLocalityLabel(blockedLocality)}. Solo se aceptan destinos en ${APP_CONFIG.cityDisplay}.`,
      cleanedInput,
      notes: [],
      queryCandidates: [],
    };
  }

  const houseNumber = extractHouseNumber(cleanedInput);
  const streetFragment = extractStreetFragment(cleanedInput);
  const streetMatch = matchStreetCandidate(streetFragment);
  const interpretedStreet = streetMatch.street?.canonical || toDisplayStreet(streetFragment);
  const interpretedCore = [interpretedStreet, houseNumber].filter(Boolean).join(" ").trim();
  const interpretedLine = interpretedCore
    ? `${interpretedCore}, ${APP_CONFIG.cityQuery}`
    : `${cleanedInput}, ${APP_CONFIG.cityQuery}`;
  const notes = [];

  if (cleanedInput !== String(text || "").trim()) {
    notes.push("Limpie simbolos y ruido visual.");
  }

  if (streetMatch.street && toAsciiMatch(streetFragment) !== toAsciiMatch(streetMatch.street.canonical)) {
    notes.push(`Interprete la calle como ${streetMatch.street.canonical}.`);
  }

  if (!houseNumber) {
    notes.push("Falta altura numerica.");
  }

  if (!streetMatch.street) {
    notes.push("No pude validar la calle contra la base local.");
  } else if (streetMatch.confidence === "low" || streetMatch.confidence === "none") {
    notes.push("La coincidencia de calle es dudosa.");
  }

  const status =
    !streetMatch.street || streetMatch.confidence === "low" || streetMatch.confidence === "none" || !houseNumber
      ? "doubtful"
      : "valid";
  const queryCandidates = uniqueCompact([
    interpretedCore ? `${interpretedCore}, ${APP_CONFIG.cityQuery}` : "",
    `${cleanedInput}, ${APP_CONFIG.cityQuery}`,
  ]);

  return {
    ok: true,
    status,
    confidence: streetMatch.confidence,
    cleanedInput,
    streetFragment,
    houseNumber,
    interpretedStreet,
    interpretedCore,
    interpretedLine,
    streetMatch,
    notes,
    queryCandidates,
    reason:
      status === "valid"
        ? "Direccion interpretada con buena confianza."
        : "No pude validarla con suficiente confianza; muestro una lectura prudente.",
  };
}

export function extractHouseNumber(text) {
  const normalized = normalizeAddressText(text);
  const match = normalized.match(/\b(\d{1,5})\b/);
  return match ? match[1] : "";
}

function extractStreetFragment(text) {
  const normalized = normalizeAddressText(text)
    .replace(/\b\d{1,5}\b/g, " ")
    .replace(/\b(entre|esquina|y)\b.+$/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return normalized
    .split(",")
    .filter(Boolean)
    .map((part) => part.trim())
    .find(Boolean) || "";
}

function normalizeStreetKey(text) {
  let value = toAsciiMatch(text)
    .replace(/[.,-]/g, " ")
    .replace(/\bneuquen(?: capital)?\b/g, " ")
    .replace(/\bant\.?\b/g, "antartida");

  ABBREVIATION_RULES.forEach(([pattern, replacement]) => {
    value = value.replace(pattern, replacement);
  });

  return value
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !STREET_FILLERS.has(token))
    .join(" ")
    .trim();
}

function scoreStreetAlias(input, alias) {
  if (!input || !alias) {
    return 0;
  }

  if (input === alias) {
    return 1;
  }

  const compactInput = input.replace(/\s+/g, "");
  const compactAlias = alias.replace(/\s+/g, "");

  if (compactInput === compactAlias) {
    return 0.99;
  }

  const containmentScore = compactInput.includes(compactAlias) || compactAlias.includes(compactInput) ? 0.16 : 0;
  const tokenScore = computeTokenOverlap(input, alias);
  const editDistance = levenshtein(compactInput, compactAlias);
  const editScore = 1 - editDistance / Math.max(compactInput.length, compactAlias.length, 1);

  return clampScore(Math.max(tokenScore * 0.92 + containmentScore, editScore * 0.86 + containmentScore));
}

function computeTokenOverlap(left, right) {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const allTokens = new Set([...leftTokens, ...rightTokens]);
  let hits = 0;

  allTokens.forEach((token) => {
    if (leftTokens.has(token) && rightTokens.has(token)) {
      hits += 1;
    }
  });

  return hits / Math.max(allTokens.size, 1);
}

function levenshtein(left, right) {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    matrix[row][0] = row;
  }

  for (let col = 0; col < cols; col += 1) {
    matrix[0][col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

function classifyConfidence(score) {
  if (score >= 0.92) {
    return "strong";
  }

  if (score >= 0.82) {
    return "medium";
  }

  if (score >= 0.7) {
    return "low";
  }

  return "none";
}

function toDisplayStreet(text) {
  return String(text || "")
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function uniqueCompact(items) {
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
}

function clampScore(value) {
  return Math.max(0, Math.min(1, value));
}
