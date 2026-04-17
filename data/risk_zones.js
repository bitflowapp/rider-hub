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
        recommendation: "Conviene bajar carga cognitiva y minimizar detenciones largas.",
      },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-68.0738, -38.9498],
          [-68.0514, -38.9498],
          [-68.0514, -38.9369],
          [-68.0738, -38.9369],
          [-68.0738, -38.9498],
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
        reason: "Transito rapido, sobrepasos cerrados y margen lateral irregular.",
        recommendation: "Si puedes, entra y sal rapido sin espera innecesaria.",
      },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-68.1005, -38.9678],
          [-68.0789, -38.9678],
          [-68.0789, -38.9492],
          [-68.1005, -38.9492],
          [-68.1005, -38.9678],
        ]],
      },
    },
    {
      type: "Feature",
      properties: {
        id: "costanera-baja-luz",
        name: "Costanera con baja luz",
        level: "night",
        weight: 6,
        summary: "No recomendado de noche",
        reason: "Iluminacion irregular y tramos con visibilidad baja al anochecer.",
        recommendation: "Evita este borde de noche o elige un corredor mas contenido.",
      },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-68.0868, -38.9722],
          [-68.0599, -38.9722],
          [-68.0599, -38.9571],
          [-68.0868, -38.9571],
          [-68.0868, -38.9722],
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
        recommendation: "Mantiene atencion alta en cruces y cambios de mano.",
      },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-68.0829, -38.9374],
          [-68.0567, -38.9374],
          [-68.0567, -38.9239],
          [-68.0829, -38.9239],
          [-68.0829, -38.9374],
        ]],
      },
    },
    {
      type: "Feature",
      properties: {
        id: "mosconi-expuesto",
        name: "Mosconi expuesto",
        level: "high",
        weight: 4,
        summary: "Alta precaucion",
        reason: "Velocidad sostenida y maniobras laterales de vehiculos pesados.",
        recommendation: "Si hay alternativa equivalente, conviene evitarlo.",
      },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-68.1088, -38.9519],
          [-68.0708, -38.9519],
          [-68.0708, -38.9421],
          [-68.1088, -38.9421],
          [-68.1088, -38.9519],
        ]],
      },
    },
    {
      type: "Feature",
      properties: {
        id: "sur-espera-corta",
        name: "Sector sur de espera corta",
        level: "caution",
        weight: 2,
        summary: "Precaucion",
        reason: "Paradas incomodas y menor margen para esperar quieto.",
        recommendation: "Conviene minimizar la espera una vez en destino.",
      },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-68.0755, -38.9838],
          [-68.0486, -38.9838],
          [-68.0486, -38.9644],
          [-68.0755, -38.9644],
          [-68.0755, -38.9838],
        ]],
      },
    },
  ],
};
