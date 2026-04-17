import {
  formatDateTimeForExport,
  formatMoney,
  sumBy,
} from "../utils/format_utils.js";
import { compactDestinationLabel } from "../utils/address_utils.js";

export function exportCashEntriesPdf(entries) {
  const jsPdfNamespace = globalThis.jspdf;

  if (!jsPdfNamespace || typeof jsPdfNamespace.jsPDF !== "function") {
    throw new Error("La libreria PDF no esta disponible.");
  }

  const { jsPDF } = jsPdfNamespace;
  const document = new jsPDF({
    unit: "pt",
    format: "a4",
  });

  if (typeof document.autoTable !== "function") {
    throw new Error("La tabla PDF no esta disponible.");
  }

  const exportedAt = new Date();
  const totalGeneral = sumBy(entries, (entry) => entry.amount);

  document.setFillColor(9, 10, 13);
  document.rect(0, 0, 595.28, 108, "F");
  document.setTextColor(245, 247, 250);
  document.setFont("helvetica", "bold");
  document.setFontSize(20);
  document.text("Rider Maps Neuquen", 40, 40);
  document.setFontSize(12);
  document.text("Reporte de efectivo", 40, 62);
  document.setFont("helvetica", "normal");
  document.setFontSize(10);
  document.setTextColor(196, 202, 211);
  document.text(`Exportado: ${formatDateTimeForExport(exportedAt)}`, 40, 82);
  document.text(`Total general: ${formatMoney(totalGeneral)}`, 40, 96);

  document.autoTable({
    startY: 128,
    head: [["Fecha y hora", "Monto", "Direccion", "Observacion"]],
    body: entries.map((entry) => [
      formatDateTimeForExport(entry.createdAt),
      formatMoney(entry.amount),
      compactDestinationLabel(entry.address || "") || "Sin direccion",
      entry.notes || "-",
    ]),
    theme: "grid",
    headStyles: {
      fillColor: [17, 19, 22],
      textColor: [245, 247, 250],
      lineColor: [38, 42, 48],
      fontStyle: "bold",
    },
    styles: {
      fillColor: [255, 255, 255],
      textColor: [22, 24, 28],
      lineColor: [220, 225, 232],
      cellPadding: 8,
      fontSize: 9.5,
      overflow: "linebreak",
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 110 },
      1: { cellWidth: 82 },
      2: { cellWidth: 165 },
      3: { cellWidth: 150 },
    },
    margin: {
      left: 40,
      right: 40,
    },
  });

  document.save(buildExportFileName("pdf"));
}

export function exportCashEntriesExcel(entries) {
  if (!globalThis.XLSX) {
    throw new Error("La libreria Excel no esta disponible.");
  }

  const rows = entries.map((entry) => ({
    "Fecha y hora": formatDateTimeForExport(entry.createdAt),
    Monto: Number(entry.amount),
    Direccion: compactDestinationLabel(entry.address || ""),
    Observacion: entry.notes || "",
  }));

  const workbook = globalThis.XLSX.utils.book_new();
  const sheet = globalThis.XLSX.utils.json_to_sheet(rows);

  sheet["!cols"] = [
    { wch: 18 },
    { wch: 12 },
    { wch: 34 },
    { wch: 28 },
  ];

  globalThis.XLSX.utils.book_append_sheet(workbook, sheet, "Efectivo");
  globalThis.XLSX.writeFile(workbook, buildExportFileName("xlsx"), {
    compression: true,
  });
}

function buildExportFileName(extension) {
  const dateStamp = new Date().toISOString().slice(0, 10);
  return `rider-maps-neuquen-efectivo-${dateStamp}.${extension}`;
}
