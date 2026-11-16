# PaperCrash — Guion de Desarrollo, Modelado 3D y Arquitectura del Modo Historia (Niveles 1 a 5)

Este documento define el diseño completo, el guion de tutoriales progresivos, las especificaciones de modelado 3D (Meshy / Low-Poly) y la arquitectura modular pura para implementar el **Modo Historia** de PaperCrash respetando todas las reglas del proyecto.

---

## 1. Visión y Filosofía de Diseño

* **Objetivo**: Convertir los primeros 5 vuelos/mapas en un **tutorial progresivo orgánico** donde cada nivel introduce una mecánica clave hasta graduar al jugador para el **Modo Endless** (que se desbloquea al completar el Nivel 5).
* **Arquitectura Pura (SSOT)**:
  * Los niveles **NO** crean ramas condicionales (`if (level === 3)`) dentro de `flightModel.js`, `RunController.js` ni `obstacles.js`.
  * Cada nivel vive como **configuración declarativa** en `js/modes/storyLevels.js` (análoga a `modes/classic.js` y `modes/frenetic.js`), inyectando sus parámetros en `terrainField.js`, `flightProfile.js` y `obstacles.js`.
* **Sistema de Progresión**:
  * Cada nivel tiene una **Meta de Distancia** (línea de llegada física en el mundo) y **3 Estrellas** de desempeño (1⭐ completar distancia, 2⭐ objetivo táctico secundario, 3⭐ maestría).
  * Completar un nivel otorga una inyección de monedas para incentivar mejoras en la tienda antes del siguiente reto.

---

## 2. Guion Detallado por Nivel (Tutoriales Progresivos)

### Nivel 1 — "El Primer Pliegue" (Pradera Matinal)
* **Aeronave**: Avión de Papel (`paper`).
* **Mecánica Enseñada**: Apuntado desacoplado en la resortera (eje de Potencia + eje de Ángulo), planeo natural y aterrizaje suave.
* **Diseño del Corredor**:
  * Largo: `180 m` (Meta visual en `x = 150 m`).
  * Relieve: Muy suave (`groundAmplitude: 0.04`).
  * Obstáculos: Desactivados en el centro; solo árboles decorativos en los márgenes (`|z| > 18`).
  * Recolectables: Línea guía de monedas de `5` marcando la parábola óptima de lanzamiento (~30°–35°).
* **Objetivos (Estrellas)**:
  * ⭐ Cruzar la meta a **150 m**.
  * ⭐⭐ Recoger al menos **8 monedas** siguiendo la curva.
  * ⭐⭐⭐ Aterrizar suavemente (`kind === 'landing'`) pasado los **170 m**.
* **Recompensa**: `80 🪙` + Desbloqueo de Nivel 2.
* **Prompt Contextual (UI)**: *"Arrastrá la resortera para ajustar potencia y ángulo. ¡Seguí el rastro de monedas!"*

---

### Nivel 2 — "Corrientes del Valle" (Cañón Dorado)
* **Aeronave**: Avión de Papel (se sugiere mejorar Alas Lv.1 en la tienda con las monedas del Nivel 1).
* **Mecánica Enseñada**: Presupuesto de planeo (`glideBudget`), **Boosters** de recarga y columnas de **Vendaval** ascendentes.
* **Diseño del Corredor**:
  * Largo: `320 m` (Meta visual en `x = 280 m`).
  * Relieve: Colinas suaves (`groundAmplitude: 0.09`).
  * Obstáculos: Rocas bajas fáciles de sobrevolar + **2 Vendavales** colocados estratégicamente en zonas donde cae la sustentación.
  * Recolectables: **3 Boosters** en línea central y monedas de `10` sobre los vendavales.
* **Objetivos (Estrellas)**:
  * ⭐ Cruzar la meta a **280 m**.
  * ⭐⭐ Recoger **2 boosters** durante el vuelo.
  * ⭐⭐⭐ Alcanzar **24 m de altitud** usando una corriente de viento.
* **Recompensa**: `120 🪙` + Desbloqueo de Nivel 3.
* **Prompt Contextual (UI)**: *"Los boosters recargan tu planeo y te dan propulsión. ¡Entrá en los vendavales para ganar altura!"*

---

### Nivel 3 — "El Circuito de Aros" (Meseta Turquesa)
* **Aeronave**: Avión de Pasajeros (`passenger`) o Papel mejorado.
* **Mecánica Enseñada**: Viraje lateral (`A/D`, D-pad táctil o cursor), paso por **Aros Celestes**, escala musical ascendente y **Combo de 4 Aros**.
* **Diseño del Corredor**:
  * Largo: `460 m` (Meta visual en `x = 400 m`).
  * Relieve: Mesetas laterales (`groundAmplitude: 0.14`).
  * Obstáculos: Mesas y árboles formando un pasillo amplio + secuencia guiada de **5 Aros** alternando suavemente izquierda/derecha (`z = ±8 m`).
  * Recolectables: Monedas de `50` flotando en ruta alta tras el 4.º aro (premio al combo).
* **Objetivos (Estrellas)**:
  * ⭐ Cruzar la meta a **400 m**.
  * ⭐⭐ Atravesar **3 aros** en el recorrido.
  * ⭐⭐⭐ Completar **1 Combo de 4 Aros** seguidos sin fallar.
* **Recompensa**: `160 🪙` + Desbloqueo de Nivel 4.
* **Prompt Contextual (UI)**: *"Girá con A/D para alinear el avión con los aros. ¡4 aros seguidos disparan un Súper Impulso!"*

---

### Nivel 4 — "Desfiladero Supersónico" (Crepúsculo Volcánico)
* **Aeronave**: Jet de Caza (`jet`) — mayor velocidad base y agilidad.
* **Mecánica Enseñada**: Uso táctico de **Propulsión (`Espacio`)**, combinación `Espacio + W` para trepar, sensación de velocidad (>55 m/s + *Speedlines*) y **Near Miss** (vuelo rasante).
* **Diseño del Corredor**:
  * Largo: `680 m` (Meta visual en `x = 600 m`).
  * Relieve: Cañón marcado (`groundAmplitude: 0.22`).
  * Obstáculos: Agujas (*spires*), rocas altas y troncos caídos en densidad media que invitan a esquivar al límite.
  * Recolectables: Boosters de carga rápida + monedas de `50` pegadas lateralmente a las agujas para provocar *Near Misses*.
* **Objetivos (Estrellas)**:
  * ⭐ Cruzar la meta a **600 m**.
  * ⭐⭐ Superar los **58 m/s** usando propulsión en picada.
  * ⭐⭐⭐ Realizar **2 Near Misses** (rozar obstáculos sin chocar).
* **Recompensa**: `220 🪙` + Desbloqueo de Nivel 5.
* **Prompt Contextual (UI)**: *"Presioná ESPACIO para activar tu propulsor. ¡Rozá las rocas a milímetros para sumar bonos!"*

---

### Nivel 5 — "La Prueba del Horizonte" (Tormenta Nocturna)
* **Aeronave**: Libre elección (todas disponibles, ideal Helicóptero `heli` o Jet mejorado).
* **Mecánica Enseñada**: Maestría total integrando gestión de combustible, planeo, aros, vendavales, near misses y selección de ruta de alto riesgo/recompensa.
* **Diseño del Corredor**:
  * Largo: `950 m` (Meta visual en `x = 850 m`).
  * Relieve: Ondulación pronunciada (`groundAmplitude: 0.30`).
  * Obstáculos: Mix completo de densidad alta (spires, mesas, rocas, árboles, logs) con rutas altas (aros + vendavales) y bajas (near misses + monedas).
* **Objetivos (Estrellas)**:
  * ⭐ Cruzar la meta final a **850 m**.
  * ⭐⭐ Atravesar **4 aros** y usar **2 propulsiones**.
  * ⭐⭐⭐ Alcanzar **950 m**, completar **1 combo** y **2 Near Misses**.
* **Recompensa**: `400 🪙` + **Desbloqueo oficial del Modo Endless** 🏆.
* **Prompt Contextual (UI)**: *"Demostrá todo lo aprendido. ¡Superá el horizonte para desbloquear el Modo Endless!"*

---

## 3. Guion de Modelado 3D y Assets (Meshy + Procedural)

Para mantener la estética *low-poly chrome/matte* del proyecto y el rendimiento en móvil (Android APK / WebGL):
* **Reglas de Normalización**: Todos los modelos GLB exportados desde Meshy deben normalizarse en caja de `~1.9` unidades, usar materiales compatibles con `MeshLambertMaterial` (`flatShading: true`), y mantenerse por debajo de **1.500 triángulos** por malla.
* **Respaldo Procedural Obligatorio**: Todo asset GLB debe tener un constructor geométrico de respaldo en `obstacleMeshes.js` o `environment.js`.

### Catálogo de Nuevos Modelos a Modelar

| Asset / Archivo | Uso en el Juego | Especificación Visual & Escala | Respaldo Procedural |
| --- | --- | --- | --- |
| `assets/models/finish_gate_chrome.glb` | **Portal de Meta** (Niveles 1–5) | Pórtico doble de arco futurista o banderines cruzados con franja central emisiva verde/dorada (`0x3ddc84` / `0xffd740`). Escala real en mundo: `18 m` ancho × `22 m` alto. | Dos pilares cilíndricos + viga superior con material emisivo. |
| `assets/models/milestone_chrome.glb` | **Boya / Hito de Distancia** | Baliza flotante o poste estilizado cada 100 m en los bordes del corredor (`z = ±24 m`). | Octaedro alargado sobre cilindro delgado. |
| `assets/models/cloud_chrome.glb` | **Nubes Low-Poly Ambientales** | Clúster facetado de 3–5 esferas/icosaedros achatados (`y = 38..65 m`) que refuerzan el paralaje a alta velocidad. | Grupo de 3 `IcosahedronGeometry(..., 0)` blancas semitransparentes. |
| `assets/models/arrow_beacon_chrome.glb` | **Baliza Direccional** (Niveles 1–3) | Flecha 3D flotante que apunta hacia el siguiente aro o vendaval en niveles tutoriales. | `ConeGeometry` + `CylinderGeometry` cian emisivo. |

---

## 4. Estructuración Técnica para Implementación

### A. Archivo de Datos de Niveles (`js/modes/storyLevels.js`)
Cada nivel se define como data pura compatible con la arquitectura del motor:
```javascript
export const STORY_LEVELS = [
  {
    id: 'story-1',
    number: 1,
    name: 'El Primer Pliegue',
    subtitle: 'Domina la resortera y el planeo',
    aircraft: 'paper', // o null para libre elección
    targetDistance: 150,
    courseLength: 220,
    paletteIndex: 0,
    groundAmplitude: 0.04,
    obstacleDensity: 0.15,
    allowedObstacles: ['tree'],
    hint: 'Arrastrá la resortera para ajustar potencia y ángulo.',
    stars: [
      { id: 'finish', label: 'Alcanzá 150 m', check: (r) => r.distance >= 150 },
      { id: 'coins',  label: 'Recogé 8 monedas', check: (r) => r.coinsCollected >= 8 },
      { id: 'land',   label: 'Aterrizaje suave pasado 170 m', check: (r) => r.distance >= 170 && r.kind === 'landing' },
    ],
    rewardCoins: 80,
  },
  // ... Niveles 2 a 5
];
```

### B. Persistencia en `storage.js` y `state.js`
Extender el objeto de guardado con:
```javascript
story: {
  unlockedLevel: 1, // 1..5
  endlessUnlocked: false,
  stars: {
    // 'story-1': 3, 'story-2': 2 ...
  },
}
```

### C. Integración sin Bifurcaciones en Motores
1. **Portal de Meta (`finish_gate_chrome.glb`)**: Se coloca como objeto visual decorativo en `x = level.targetDistance`. El vuelo **no** se corta abruptamente al cruzar la meta — el jugador puede seguir volando para buscar la 2.ª y 3.ª estrella hasta aterrizar o chocar.
2. **Evaluación Post-Vuelo (`finishRun`)**: Al terminar el vuelo en modo Historia, se evalúan los 3 criterios `stars[i].check(result)`. Si `result.distance >= level.targetDistance`, el nivel cuenta como superado, se otorgan las monedas de recompensa, se actualiza `unlockedLevel` y, tras el Nivel 5, se activa `endlessUnlocked = true`.
3. **Selector de Campaña (UI)**: Un mapa horizontal de 5 nodos conectados (Nivel 1 → 2 → 3 → 4 → 5 → Endless) mostrando las estrellas obtenidas (`⭐⭐⭐`) y el tutorial sugerido antes de despegar.

