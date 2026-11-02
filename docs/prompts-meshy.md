# PAPERCRASH — 21 prompts listos para Meshy AI

Siete objetos × tres estilos. Cada prompt está pensado para **pegarse tal cual**.
El bloque de estilo se repite idéntico en todos los objetos de un mismo estilo: es
lo que mantiene la coherencia.

---

## Antes de empezar

**Configuración de la herramienta:**

- **Simetría:** ON en aeronaves, aros y vendavales.
- **Textura / PBR:** **OFF**. El juego colorea por material y vértice; una textura
  horneada rompe el estilo y pesa al pedo.
- **Conteo de polígonos:** el que indica cada objeto.

**Prompt negativo (pegalo en todos):**

```
photorealistic, high-frequency noise detail, grunge, dirt, rust, scratches,
decals, text, logos, anime, cartoon outlines, chibi, human, face, hands,
blurry edges, melted geometry, non-manifold, dense topology, baked ambient
occlusion texture, oversaturated rainbow neon, cyberpunk city, lens flare,
depth of field, motion blur, watermark
```

**Orden de trabajo recomendado:**

1. Generá **4 variantes de la aeronave** del estilo elegido.
2. Elegí la mejor y guardala.
3. Para el resto de los objetos, usá esa como **imagen de referencia**.
4. Recién entonces seguí con los otros dos estilos, si vas a hacerlos.

---

# ESTILO A — ORIGAMI TECH

**Bloque de estilo (se repite en los 7):**

```
Low-poly origami-inspired stylized asset, folded paper surfaces with razor-sharp
creases, matte paper material with subtle fiber grain, thin electric-cyan emissive
seams tracing the folds, brushed titanium joints, flat shading, clean topology,
perfectly symmetric, game-ready, real-world scale (1 unit = 1 meter), no textures,
no decals, isolated on transparent background, three-quarter view.
```

### A1 · Aeronave — 3.000 triángulos

```
Futuristic origami aircraft, folded paper hull with visible crease lines, swept
angular wings, compact jet nozzles at the rear, small dark glass cockpit facet,
titanium wing-root joints.
```

### A2 · Aguja — 400-600 triángulos

```
Tall jagged stone spire, sharp folded planes like creased paper, narrow tapered
column, flat base on the ground, no surface noise.
```

### A3 · Mesa — 400-600 triángulos

```
Wide flat-topped stone mesa, steep folded sides, three large creased planes,
monolithic silhouette, base flat on the ground.
```

### A4 · Roca — 200-300 triángulos

```
Chunky faceted boulder, large angular planes with crisp creases, low to the
ground, wide and squat.
```

### A5 · Árbol — 200-300 triángulos

```
Abstract folded paper tree, sharp tapered cone shape, single geometric trunk,
no branches, no leaves, clean crease lines.
```

### A6 · Aro — 500-900 triángulos

```
Perfect torus ring, thick folded paper body with creased edges, continuous
emissive groove on the inner edge, must read clearly as a large open HOLE.
```

### A7 · Vendaval — 300 triángulos

```
Simple faceted vertical column, translucent tracing-paper look, open top and
bottom, straight vertical sides, tileable vertically.
```

---

# ESTILO B — AERO CHROME

**Bloque de estilo (se repite en los 7):**

```
Stylized low-poly hard-surface asset, polished dark gunmetal with broad flat
panels and minimal panel lines, single cyan emissive accent, flat shading, crisp
bevels, clean topology, perfectly symmetric, game-ready, real-world scale
(1 unit = 1 meter), no textures, no decals, isolated on transparent background,
three-quarter view.
```

### B1 · Aeronave — 4.000 triángulos

```
Futuristic aerospace interceptor, broad flat hull panels, single long emissive
strip along the spine, twin flush engine intakes, faceted smoked-glass canopy,
sharply tapered nose, thin shoulder stabilizers.
```

### B2 · Aguja — 300-500 triángulos

```
Tall dark slate monolith spire, narrow tapered column, perfectly flat facets,
sharp vertical edges, flat base on the ground, no detail noise.
```

### B3 · Mesa — 300-500 triángulos

```
Dark slate mesa formation, wide perfectly flat top, steep straight sides, three
or four large flat faces, monolithic and geometric.
```

### B4 · Roca — 150-250 triángulos

```
Dark faceted boulder, chunky angular block, five or six large flat faces, low to
the ground, wide and squat.
```

### B5 · Árbol — 150-250 triángulos

```
Abstract dark vertical post, sharp tapered cone silhouette, no branches, single
geometric trunk column, almost architectural.
```

### B6 · Aro — 500-900 triángulos

```
Perfect torus ring, thick dark metal body, continuous emissive groove on the inner
edge, must read clearly as a large open HOLE, clean and symmetrical.
```

### B7 · Vendaval — 300 triángulos

```
Simple vertical cylinder column, frosted glass look, open top and bottom, thin
emissive vertical accent line, tileable vertically.
```

---

# ESTILO C — VOID BLOOM

**Bloque de estilo (se repite en los 7):**

```
Stylized low-poly dark sci-fi asset, matte obsidian-black faceted surfaces,
organic vein-like cyan emissive glow lines, small glowing nodes, flat shading,
strong silhouette, clean topology, game-ready, real-world scale (1 unit = 1 meter),
no textures, no decals, isolated on transparent background, dramatic rim lighting,
three-quarter view.
```

### C1 · Aeronave — 3.500 triángulos

```
Dark bioluminescent aircraft, sharp faceted hull, vein-like glow lines along the
fuselage, clusters of small glowing nodes at the wingtips, translucent crystalline
stabilizers, single large emissive sensor at the nose.
```

### C2 · Aguja — 400-700 triángulos

```
Tall dark crystal spire, angular translucent shards, deep glowing cracks between
the facets, narrow tapered column, base flat on the ground.
```

### C3 · Mesa — 400-700 triángulos

```
Dark crystal mesa formation, wide flat top, faceted sides with glowing seams,
monolithic silhouette, base flat on the ground.
```

### C4 · Roca — 200-350 triángulos

```
Chunky dark rock with crystalline inclusions, angular facets, faint glowing veins
between the planes, low to the ground, wide and squat.
```

### C5 · Árbol — 200-350 triángulos

```
Abstract black coral growth, tall vertical tapered form, no branches, faintly
glowing tips, organic but geometric.
```

### C6 · Aro — 500-900 triángulos

```
Perfect torus ring, dark organic-looking body, bright continuous emissive glow on
the inner edge, must read clearly as a large open HOLE.
```

### C7 · Vendaval — 300 triángulos

```
Simple vertical column of ascending glowing particles and translucent facets, open
top and bottom, faint cyan spore-like nodes rising along it, tileable vertically.
```

---

## Presupuesto de polígonos (resumen)

| Objeto | Triángulos | Se instancia |
|---|---|---|
| Aeronave | 3.000-4.000 | 1 a la vez |
| Aguja | 300-700 | decenas |
| Mesa | 300-700 | decenas |
| Roca | 150-350 | decenas |
| Árbol | 150-350 | centenares |
| Aro | 500-900 | puñados |
| Vendaval | 300 | pocos |

Los árboles y rocas se instancian en masa: **pasarse de polígonos ahí es lo que
hunde los FPS**, no en el avión.

---

## Checklist por objeto

- [ ] ¿Se reconoce como silueta a 64 px de alto?
- [ ] ¿Entra en el presupuesto de polígonos?
- [ ] ¿Está a escala real? (avión ~3 m de envergadura, aguja 8-25 m de alto)
- [ ] ¿Simetría intacta?
- [ ] ¿Sin textura? Sólo color de material
- [ ] ¿Se ve bien contra cielo casi negro **y** contra terreno claro?
- [ ] Si es aro: ¿el agujero es grande y limpio?
- [ ] Si es vendaval: ¿se ve bien repetido 40 veces?

---

## Errores típicos de Meshy en este tipo de assets

**Exceso de detalle en las caras.** La herramienta tiende a agregar pequeños
relieves. Si aparece ruido, agregá al prompt negativo `surface noise, small relief
details, subdivided faces` y volvé a pedir.

**Aros con el cuerpo demasiado grueso.** El agujero queda chico y el jugador no
puede apuntarle. Pedí explícito `large open HOLE` y revisá la proporción: el
diámetro interior tiene que ser al menos **4 veces** el grosor del anillo.

**Aeronaves asimétricas.** Aun con simetría activada, a veces una punta sale
distinta. Giralas en el visor y descartá sin dudar: una asimetría en un objeto que
el jugador mira todo el tiempo se nota enseguida.

**Escala inconsistente.** Dos rocas del mismo prompt pueden salir de 0,5 m y de 5 m.
Tomá la medida con la herramienta de medición y normalizá antes de exportar.
