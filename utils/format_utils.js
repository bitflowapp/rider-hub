const currencyFormatter = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const compactDateTimeFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
});

const exportDateTimeFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
});

const weekFormatter = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

export function formatMoney(value) {
  return `$ ${currencyFormatter.format(Number(value) || 0)}`;
}

export function formatDateTime(value) {
  return compactDateTimeFormatter.format(new Date(value));
}

export function formatDateTimeForExport(value) {
  return exportDateTimeFormatter.format(new Date(value));
}

export function formatDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return "Sin dato";
  }

  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }

  return `${(distanceMeters / 1000).toFixed(distanceMeters < 10000 ? 1 : 0)} km`;
}

export function formatDuration(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return "Sin dato";
  }

  const totalMinutes = Math.max(1, Math.round(durationSeconds / 60));

  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

export function getDateTimeLocalValue(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

export function startOfDay(date) {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

export function addDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

export function getWeekStart(date) {
  const localStart = startOfDay(date);
  const day = localStart.getDay();
  const diff = day === 0 ? -6 : 1 - day;

  localStart.setDate(localStart.getDate() + diff);
  return localStart;
}

export function isWithinRange(value, start, end) {
  const date = new Date(value);
  return date >= start && date < end;
}

export function sumBy(collection, iteratee) {
  return collection.reduce((total, item) => total + Number(iteratee(item) || 0), 0);
}

export function sortByNewest(items, dateKey = "createdAt") {
  return [...items].sort((left, right) => new Date(right[dateKey]) - new Date(left[dateKey]));
}

export function buildWeekRangeLabel(date = new Date()) {
  const weekStart = getWeekStart(date);
  const weekEnd = addDays(weekStart, 6);
  return `Semana actual | ${weekFormatter.format(weekStart)} al ${weekFormatter.format(weekEnd)}`;
}
