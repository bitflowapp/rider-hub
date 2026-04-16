export function getActiveEngine() {
  return "none";
}

export function processAddressInput(text) {
  return String(text ?? "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function analyzeOrder() {
  return null;
}
