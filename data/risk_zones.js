// TODO: reemplazar estos poligonos semilla por zonas validadas en calle con feedback real del rider.
export const RISK_ZONES = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        id: "centro-alto-flujo",
        name: "Centro con alto flujo",
        level: "caution",
        weight: 2,
        summary: "Precaucion",
        reason: "Cruces cerrados, semaforos cortos y maniobras frecuentes.",
      },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-68.0718, -38.9495],
          [-68.0536, -38.9495],
          [-68.0536, -38.9372],
          [-68.0718, -38.9372],
          [-68.0718, -38.9495],
        ]],
      },
    },
    {
      type: "Feature",
      properties: {
        id: "corredor-oeste-rapido",
        name: "Corredor oeste rapido",
        level: "high",
        weight: 4,
        summary: "Alta precaucion",
        reason: "Transito rapido, sobrepasos cerrados y poco margen lateral.",
      },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-68.097, -38.9655],
          [-68.0802, -38.9655],
          [-68.0802, -38.9488],
          [-68.097, -38.9488],
          [-68.097, -38.9655],
        ]],
      },
    },
    {
      type: "Feature",
      properties: {
        id: "costanera-baja-luz",
        name: "Borde con baja iluminacion",
        level: "night",
        weight: 6,
        summary: "No recomendado de noche",
        reason: "Iluminacion irregular y tramos con visibilidad baja al anochecer.",
      },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-68.0834, -38.9705],
          [-68.0608, -38.9705],
          [-68.0608, -38.958],
          [-68.0834, -38.958],
          [-68.0834, -38.9705],
        ]],
      },
    },
    {
      type: "Feature",
      properties: {
        id: "acceso-norte-cruces",
        name: "Acceso norte con cruces intensos",
        level: "caution",
        weight: 2,
        summary: "Precaucion",
        reason: "Incorporaciones y giros con visibilidad parcial.",
      },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-68.0795, -38.9368],
          [-68.0584, -38.9368],
          [-68.0584, -38.925],
          [-68.0795, -38.925],
          [-68.0795, -38.9368],
        ]],
      },
    },
  ],
};
