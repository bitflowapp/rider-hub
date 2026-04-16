import {
  analyzeOrder as analyzeWithNone,
  getActiveEngine as getNoneEngine,
  processAddressInput as normalizeAddressWithNone,
} from "./none.js";

export function getActiveEngine() {
  return getNoneEngine();
}

export function processAddressInput(text) {
  return normalizeAddressWithNone(text);
}

export function analyzeOrder(order) {
  return analyzeWithNone(order);
}
