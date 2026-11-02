# PAPERCRASH — Dirección de arte para Meshy AI

Guía para producir los modelos del juego con un estilo coherente.
Tres direcciones posibles, todas compatibles con la mecánica procedural, el
crecimiento incremental y la progresión musical.

---

## 0. La esencia que hay que transmitir

Antes de cualquier prompt, esto es lo que el juego **tiene que sentirse**:

- **Vuelo limpio y veloz.** El avión no es un objeto pesado: es una silueta que
  corta el aire. Todo lo que se modele tiene que leerse **en menos de un segundo**,
  a veces a 110 m/s y con el avión ocupando un 8% de la pantalla.
- **Misterio oscuro, no miedo.** El cielo es casi negro, las formas del terreno
  son siluetas. La belleza está en el contraste y en lo que brilla, no en el detalle.
- **Futurismo sereno.** Nada de ciberpunk sucio ni neones saturados. Poco, grande
  y preciso.
- **La simpleza es el lujo.** "HD en la simpleza" = formas de pocos polígonos, pero
  con **materiales ricos**: emisivos limpios, metales pulidos, vidrio, papel con
  cuerpo. El detalle viene del material y la luz, **no de la malla**.

### Regla de oro del estilo

> Si un objeto no se distingue como silueta a 200 m de distancia, está mal modelado.

### Paleta base del juego (respetar)

| Rol | Color | Hex |
|---|---|---|
| Fondo / cielo | azul noche casi negro | `#080C16` |
| Acento del jugador | cian eléctrico | `#00E5FF` |
| Peligro / derrota | naranja quemado | `#FF6B2C` |
| Terreno temprano | verde salvia apagado | `#8FA894` |
| Terreno tardío | pizarra fría | `#2A3440` |
| Siluetas de obstáculo | casi negro azulado | `#11161F` |
| Premio raro | violeta | `#8B5CF6` |
| Premio épico | dorado | `#F5C542` |

---

## 1. Cómo usar Meshy sin que los modelos salgan dispares

Estas reglas valen para los tres estilos:

1. **Una sola referencia por lote.** Generá primero 3-4 objetos nuevos del mismo
   estilo y usá uno como *reference image* para el resto (Image-to-3D). La
   consistencia entre objetos sale de ahí, no del texto.
2. **Topología baja y decidida.** Obstáculos: 300-1.200 triángulos. Aeronaves:
   2.000-6.000. Decorado de fondo: menos de 300.
3. **Sin texturas horneadas para el detalle.** El juego colorea por vértice y por
   material. Pedí `flat shading` y `clean UV`, no mapas de alta frecuencia.
4. **Simetría.** Toda aeronave se modela simétrica en el eje longitudinal; Meshy lo
   respeta mejor si se lo pedís explícito.
5. **Materiales separados por función.** Un material para el casco, uno para las
   partes emisivas. Así el juego puede animar el brillo sin repintar nada.
6. **Prompt negativo siempre igual.** Está al final del documento.
7. **Escala real.** Todo se modela a escala 1 unidad = 1 metro. El avión mide ~3 m
   de envergadura; una aguja, 8-25 m de alto.

---

## 2. PROMPT MAESTRO (usar como contexto en todas las generaciones)

> Copiá esto como prefijo cuando la herramienta permita describir el mundo.

```
Stylized low-poly game asset for a fast-paced endless flight game.
Art direction: "HD simplicity" — very few, very deliberate polygons, but rich
materials. Clean geometric silhouettes that read instantly from far away.
Calm futuristic mood, dark near-black sky, strong figure-ground contrast.
Matte surfaces with a single glossy or emissive accent.
No noisy surface detail, no baked grunge, no photoreal textures.
Flat shading, crisp hard edges, clean topology, game-ready, real-world scale
(1 unit = 1 meter). Hand-crafted look, not procedural nor AI-fuzzy.
Palette anchored on deep navy black, muted sage green terrain, and electric cyan
as the only saturated accent.
```

---

## 3. Estilo A — ORIGAMI TECH

### Concepto
El juego nació de un avión de papel. Este estilo lleva esa idea al futuro sin
traicionarla: **papel plegado con precisión de ingeniería**, con juntas que brillan
como circuitos. Es el estilo más identificable y el que mejor cuenta la historia
del juego (empezás con algo frágil y lo convertís en una máquina).

### A quién le habla
Jugadores que quieren sentir que construyen algo. Encaja perfecto con el
**incremental**: cada mejora puede verse como un pliegue o una junta nueva.

### Prompt base (Meshy, inglés)

```
Low-poly origami-inspired futuristic aircraft, folded paper hull with razor-sharp
creases and visible panel seams, matte off-white paper material with subtle fiber
grain, thin electric-cyan light seams tracing the folds, brushed titanium joints
at the wing roots, compact jet nozzles at the rear, angular swept wings,
minimal geometric cockpit as a single dark glass facet.
Stylized, flat shading, clean topology, 3000 triangles, symmetric, game-ready,
real-world scale, no textures, no decals, isolated on transparent background,
front three-quarter view.
```

### Aplicado a cada pieza

| Pieza | Cómo se ve |
|---|---|
| **Avión** | Cuerpo de papel plegado, juntas de titanio, costuras de luz cian |
| **Agujas / mesas** | Roca oscura con **planos de corte** como pliegues; aristas que atrapan la luz |
| **Árboles** | Conos de papel plegado, sin hojas; tronco de una sola pieza |
| **Aros** | Anillo de papel grueso con borde cian encendido |
| **Vendaval** | Columna facetada translúcida, como papel de calcar |
| **Estela** | Línea de luz cian que sale de las costuras |

### Animación / vida
- El **pliegue respira**: el casco se flexiona ±2° con la aceleración.
- Las **costuras emisivas laten** con el combo de aros.
- Nada de partes sueltas: todo se mueve como **un solo cuerpo plegado**.

### Riesgo
Es el más difícil de mantener consistente: las juntas tienen que seguir la misma
lógica en todas las aeronaves o se nota el desorden.

---

## 4. Estilo B — AERO CHROME

### Concepto
**Aviación de precisión llevada al minimalismo.** Metal pulido, paneles grandes y
limpios, geometría de ingeniería. Es el estilo más "premium" y el que mejor se ve
en movimiento, porque los reflejos del metal cambian con el giro.

### A quién le habla
Jugadores que valoran la sensación de velocidad y el pulido técnico. Es el que
mejor rinde con la música psytrance: se siente **máquina**.

### Prompt base (Meshy, inglés)

```
Low-poly futuristic aerospace interceptor, polished dark gunmetal hull with broad
flat panels and minimal panel lines, single elongated cyan light strip along the
spine, twin flush engine intakes, faceted canopy of dark smoked glass, sharply
tapered nose, thin shoulder-mounted stabilizers.
Hard-surface stylized, flat shading, crisp bevels, clean topology, 4000 triangles,
perfectly symmetric, game-ready, real-world scale, no textures, no decals,
isolated on transparent background, side three-quarter view.
```

### Aplicado a cada pieza

| Pieza | Cómo se ve |
|---|---|
| **Avión** | Fuselaje de paneles planos, una única franja de luz cian |
| **Agujas / mesas** | Monolitos de pizarra pulida con caras perfectas, sin ruido |
| **Árboles** | Postes verticales afilados, abstractos, casi arquitectónicos |
| **Aros** | Toro de metal oscuro con el interior encendido en cian |
| **Vendaval** | Cilindro de vidrio esmerilado con luz ascendente |
| **Estela** | Dos hilos de luz desde las toberas |

### Animación / vida
- Los **paneles se separan** levemente al acelerar (efecto de admisión).
- El metal **refleja el cielo** y se vuelve más frío al entrar en biomas oscuros.
- Las toberas encienden **una luz de llama corta** en cada propulsión.

### Riesgo
Sin detalle, el metal puede verse **plástico**. Hay que forzar contraste de valores:
caras claras arriba, casi negras abajo.

---

## 5. Estilo C — VOID BLOOM (vacío bioluminiscente)

### Concepto
Un mundo **oscuro y orgánico-tecnológico**: el terreno es silueta, y lo único que
brilla son formas vivas o minerales que responden a tu paso. Es el estilo que mejor
acompaña el crescendo musical, porque **puede oscurecerse de verdad** sin perder
legibilidad: en vez de subir la luz, se multiplican los puntos brillantes.

### A quién le habla
Jugadores que quieren asombro y exploración. Es el más "espacial" de los tres y el
que escala mejor a 15.000 m sin repetirse.

### Prompt base (Meshy, inglés)

```
Low-poly dark bioluminescent aircraft, matte obsidian-black hull with sharp
faceted panels, organic vein-like cyan glow lines running along the fuselage,
clusters of small glowing nodes at the wingtips, translucent crystalline
stabilizers, single large emissive eye-like sensor at the nose.
Stylized dark sci-fi, flat shading, strong silhouette, clean topology, 3500
triangles, symmetric, game-ready, real-world scale, no textures, no decals,
isolated on transparent background, dramatic rim lighting, three-quarter view.
```

### Aplicado a cada pieza

| Pieza | Cómo se ve |
|---|---|
| **Avión** | Casco negro obsidiana con venas de luz, cristales en las puntas |
| **Agujas / mesas** | Formaciones de cristal oscuro con incubaciones luminosas |
| **Árboles** | Corales negros altos, con puntas que brillan tenue |
| **Aros** | Anillo orgánico irregular, luz cian en el borde interior |
| **Vendaval** | Columna de esporas luminosas que ascienden |
| **Estela** | Rastro de partículas encendidas que se apagan lento |

### Animación / vida
- Los puntos brillantes **se encienden al pasar cerca**, como si el mundo reaccionara.
- El terreno **pulsa muy lento**, casi imperceptible, como respiración.
- En los biomas finales las luces pasan de cian a **violeta** y el fondo se come
  las siluetas.

### Riesgo
Es el que menos "HD" parece si se abusa del negro. La regla: **nunca más del 70%
del cuadro en negro puro**; siempre una silueta recortada contra algo apenas más claro.

---

## 6. Comparación rápida

| | A. Origami Tech | B. Aero Chrome | C. Void Bloom |
|---|---|---|---|
| Se lee a alta velocidad | Muy bien | Excelente | Bien |
| Cuenta la historia del juego | **La mejor** | Neutra | Misteriosa |
| Encaja con el incremental | **Sí, visualmente** | Sí, como prestigio | Sí, como desbloqueo |
| Rinde con psytrance | Bien | **Muy bien** | Excelente |
| Riesgo de producir | Medio | Bajo | Alto |
| Costo de assets | Medio | **Bajo** | Alto |

### Recomendación

**Empezá por B (Aero Chrome)** para tener el juego entero con un estilo cerrado en
pocas horas, y usá **A (Origami Tech)** como capa de identidad: la primera
aeronave y los desbloqueos tempranos en origami, migrando a chrome a medida que
mejorás. **C (Void Bloom)** queda para los biomas finales, donde la oscuridad es la
recompensa.

Eso además se corresponde con las tres pistas de música: Amanecer → Travesía →
Abismo.

---

## 7. Prompt negativo (usar en TODOS)

```
photorealistic, realistic skin, fabric wrinkles, high-frequency noise detail,
grunge, dirt, rust, scratches, decals, text, logos, graffiti, anime, cartoon
outlines, cel shading outlines, cartoon proportions, chibi, organic character,
human, face, hands, soft blurry edges, melted geometry, non-manifold, high
polygon count, dense topology, baked ambient occlusion texture, UV seams visible,
oversaturated rainbow neon, neon signs, cyberpunk city, lens flare, depth of field,
motion blur, watermark, signature
```

---

## 8. Especificaciones técnicas por tipo de objeto

| Tipo | Triángulos | Material | Notas |
|---|---|---|---|
| Aeronave jugable | 2.000-6.000 | Emisivo + metal (2 materiales) | Simétrica, sin partes móviles |
| Aguja / mesa | 300-800 | Pizarra mate, 1 emisivo opcional | Base plana, apoyada en el suelo |
| Árbol / coral | 150-400 | Mate + punta emisiva | Sin ramas finas: se pierden a distancia |
| Roca / tronco | 80-300 | Mate | Nunca más ancho que alto |
| Aro | 400-900 | Emisivo en el borde | Debe leerse como **hueco** |
| Vendaval | 200-500 | Translúcido (`opacity 0.16`) | Forma simple: se repite cada 250 m |
| Decorado de fondo | < 300 | Matte, sin emisivo | Se instancia en masa |

---

## 9. Cómo pedir las animaciones

Meshy puede animar, pero el juego **no necesita animaciones de esqueleto**: todo el
movimiento es transformación de la pieza completa. Pedí:

- **Aeronaves**: `static mesh, no rig, no skeleton, pivots at geometric center`.
  El alabeo, el cabeceo y la guiñada los aplica el juego sobre el mesh entero.
- **Aros**: `single static ring, no animation, emissive material separated`.
  El pulso de luz lo hace el código.
- **Vendaval**: `static translucent column, tileable vertically`.
- **Obstáculos**: `static mesh`, sin animación. La variedad sale de rotación y
  escala al instanciarlos.

Pedir animaciones horneadas **no sirve** y encarece el asset.

---

## 10. Checklist antes de dar un modelo por bueno

- [ ] ¿Se reconoce como silueta en miniatura de 64 px?
- [ ] ¿Tiene menos triángulos que el presupuesto de su tipo?
- [ ] ¿Los materiales están separados entre casco y emisivo?
- [ ] ¿La simetría está intacta?
- [ ] ¿Está a escala real (avión ~3 m, aguja 8-25 m)?
- [ ] ¿Funciona **sin texturas**, sólo con color por material?
- [ ] ¿Se ve bien contra un cielo casi negro **y** contra terreno claro?
