# Prompts de generación de modelos (Meshy)

Referencia: el jet actual (`plane_chrome.glb`) tiene 4530 triángulos y 80 KB. Los presupuestos de abajo están pensados para móvil (decenas de instancias en pantalla).

## Reglas comunes (pegar al final de TODOS los prompts)

```
Low poly faceted style, flat shading, hard edges, no smooth normals, stylized game asset,
chrome/metallic look, single mesh, no textures required, no background, no ground, no base/stand,
centered at origin, symmetrical, clean topology, no interior geometry, no tiny floating parts.
Target exactly <N> triangles (hard maximum <N*1.15>).
```

En Meshy: poner **Polycount = N** (modo manual / "Target Polycount") y topología **Triangle**. Exportar `.glb`, nombre `<nombre>_chrome.glb`, sin textura PBR pesada.

## Presupuestos de triángulos

| Modelo | Archivo | Triángulos | Instancias en pantalla |
| --- | --- | --- | --- |
| Avión de papel | `paper_chrome.glb` | **800** | 1 |
| Avión de pasajeros | `airliner_chrome.glb` | **4000** | 1 |
| Helicóptero (cuerpo + rotores separados) | `heli_chrome.glb` | **4000** | 1 |
| Árbol (pino) | `tree_chrome.glb` | **300** | decenas |
| Tronco caído | `log_chrome.glb` | **350** | pocas |
| Booster | `booster_chrome.glb` | **150** | varias |
| Moneda | `coin_chrome.glb` | **100** | decenas |
| Resortera / lanzador | `launcher_chrome.glb` | **2500** | 1 |

## Prompts

### Avión de papel — 800 triángulos
```
A folded paper airplane, classic dart shape, sharp creased wings with a central fold line, pointed nose, nose pointing along +Z forward, wings flat and horizontal, thin but with visible thickness, 
```
+ reglas comunes (N = 800).

### Avión de pasajeros — 4000 triángulos
```
A commercial passenger jet airliner, long cylindrical fuselage, swept wings with two engine nacelles, vertical tail fin and horizontal stabilizers, row of small window bumps, nose pointing along +Z forward, landing gear retracted,
```
+ reglas comunes (N = 4000).

### Helicóptero — 4000 triángulos
```
A compact light helicopter, bubble cockpit, tail boom with small tail rotor, skids, main rotor as a SEPARATE flat blade assembly (separate node named "rotor") so it can spin, nose pointing along +Z forward,
```
+ reglas comunes (N = 4000). Pedir rotor principal y de cola como nodos separados (`rotor`, `tailRotor`) para animarlos; si Meshy no lo permite, generar el cuerpo sin rotores y los rotores aparte (150 tris c/u).

### Pino — 300 triángulos
```
A single low poly pine tree, 3 stacked cone tiers narrowing toward a sharp top, short thin trunk, silhouette narrow (height about 4x the width of the widest tier), 
```
+ reglas comunes (N = 300). Importante: silueta cónica angosta (las hitboxes la usan).

### Tronco caído — 350 triángulos
```
A fallen giant tree trunk lying on the ground, long cylinder shape with one end raised upward at an angle, broken jagged end with splintered edges, two short stub branches, bark with chunky faceted ridges, 
```
+ reglas comunes (N = 350). Largo aprox. 5x el diámetro.

### Booster — 150 triángulos
```
A glowing energy booster pickup, octahedron crystal shape, with a chunky letter "B" embossed on the front, sharp facets, 
```
+ reglas comunes (N = 150). Se tiñe por color en el juego (violeta/azul/ámbar), así que generar en gris claro/neutro.

### Moneda — 100 triángulos
```
A thick game coin, octagonal low poly disc with raised rim and a star symbol embossed on both faces, standing upright facing +Z, 
```
+ reglas comunes (N = 100). Gris/dorado neutro; el valor 5/10/50 se tiñe y escala en el juego.

### Resortera / lanzador — 2500 triángulos
```
A large slingshot launcher, Y-shaped fork frame mounted on a small compact base, two hooks at the tips of the fork for an elastic band, sturdy chunky proportions, fork opening facing +Z,
```
+ reglas comunes (N = 2500). Sin banda elástica (se dibuja en código por `slingshotBand.js`).

## Después de generar

1. Copiar los `.glb` a `assets/models/`.
2. `node tools/inspect-glb.mjs assets/models/<archivo>` — verificar triángulos (≤ presupuesto +15%), tamaño y orientación.
3. Avisarme: los conecto con respaldo procedural, hitbox según silueta, `sync-sw` y las suites de pruebas.

