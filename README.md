# PaperCrash — Low Poly Flight

Juego incremental de lanzamiento: cargás una resortera, lanzás un avión low poly
y esquivás obstáculos a lo largo de un corredor juntando monedas y boosters. Con
las monedas comprás mejoras que cambian la física del vuelo.

---

## El bucle de juego

El avión **no llega lejos solo**. Sale con un presupuesto de planeo corto
(`PROPULSION.BASE_GLIDE`) y los **boosters** son los que lo sostienen: cada uno
**carga una propulsión** y recarga un poco de planeo. Cuando el presupuesto se
agota, el avión baja y se cae.

## La propulsión es una habilidad, no un premio

Recoger un booster **no empuja** al avión: carga una unidad. El jugador decide
cuándo gastarla apretando `Espacio` en el aire, y ahí aparece la decisión
táctica —¿la uso para llegar a ese aro, o la guardo para el tramo difícil?

- El empuje es una fracción de la **velocidad de lanzamiento de ese vuelo**, no
  un valor fijo: así sigue pesando lo mismo después de comprar mejoras.
- Hay un tope de cargas (`MAX_CHARGES`) y un enfriamiento entre usos: sin ellos
  un vuelo largo acumularía propulsiones infinitas.
- **`Espacio` + `W` da un envión vertical.** Después el avión sigue planeando
  con la velocidad que traía, porque el envión es un impulso y no un cambio de
  modo.

Por eso la distancia total la decide **cuántos boosters juntás esquivando
obstáculos**, no el ángulo de salida. Medido: sin recoger nada el vuelo dura
~150 m; encadenando boosters pasa de 250 m.

Las **monedas** son el premio económico. Las de **50** escasean a propósito y
vuelan más alto que la línea de vuelo: exigen arquea el tiro, o sea sacrificar
parte de la cadena de boosters. Ése es el compromiso.

---

## Cómo ejecutarlo

El proyecto usa **módulos ES**, así que el navegador exige servirlo por HTTP
(`file://` está bloqueado por CORS: el juego no arranca si abrís el HTML directo).

### Opción recomendada: servidor propio en Node

Node es una dependencia que el proyecto ya necesita para las pruebas, así que no
hay que instalar nada más:

```bash
node tools/serve.mjs          # http://127.0.0.1:8765
node tools/serve.mjs 3000     # otro puerto, si el 8765 está ocupado
node tools/serve.mjs 0        # puerto libre, lo informa al arrancar
```

Sirve la carpeta del proyecto, resuelve `/` a `index.html`, manda los tipos MIME
correctos (importante: si un `.js` se sirviera como `text/plain`, el navegador
rechaza el módulo) y va sin caché, que es lo que querés mientras desarrollás.

También sirve cualquier otra herramienta:

```bash
npx serve .                   # si preferís no usar el script
```

### Si querés usar `python -m http.server`

En Windows puede fallar con:

> no se encontró Python; ejecutar sin argumentos para instalar desde el Microsoft
> Store…

Eso **no** significa que te falte instalar algo: significa que el comando
`python` de tu PATH no es un intérprete sino el **alias de ejecución de la
Microsoft Store** (`%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe`), un lanzador
que abre la tienda cuando no encuentra un Python real. Se arregla de tres formas:

1. **Usar el script de Node** (arriba). Es lo más simple y no depende de Python.
2. **Desactivar el alias**: Configuración → Aplicaciones → Configuración avanzada
   de aplicaciones → Alias de ejecución de aplicaciones → apagá `python.exe` y
   `python3.exe`. Después de eso `python` deja de existir y el error se vuelve
   claro (`command not found`) en vez de confuso.
3. **Llamar al intérprete por ruta completa**, si tenés uno instalado. Para
   averiguar cuál es de verdad, sin que el alias te mienta:

   ```bash
   where python          # en cmd
   which -a python       # en bash
   ```

   Si la única ruta que aparece está dentro de `WindowsApps`, es el alias.

Ojo: `python` y `python3` son alias **distintos**, y desactivar uno no desactiva
el otro.

### Después de levantarlo

Abrí <http://127.0.0.1:8765/index.html>.

Requiere conexión a internet la primera vez: **Three.js r128 se carga desde CDN**
y la tipografía desde Google Fonts. Si el CDN no carga, el juego muestra un
cartel de error explicando el problema en vez de quedar en negro.

---

## Controles

| Gesto | Efecto |
| --- | --- |
| **Clic / `Enter` / `Espacio`** | Pasa a la **segunda etapa** (cámara detrás del lanzador) |
| `A` / `D` **en vuelo** | Mover el planeo de izquierda a derecha |
| `W` / `S` **en vuelo** | Subir o bajar la punta del avión |
| `Espacio` **en vuelo** | **Propulsión**: gasta una carga y acelera |
| `Espacio` + `W` | Propulsión con envión hacia arriba, y después sigue planeando |
| Arrastrar **arriba / abajo** | **Forma del vuelo**: arriba = rasante, abajo = con arco |
| **Cuánto** arrastrás | **Potencia**, o sea la distancia |
| Arrastrar **izquierda / derecha** | Dirección del avión (azimut ±35°) |
| Soltar (o clic seco ya en modo lanzamiento) | Lanza el avión |
| `Esc` | Vuelve a la primera etapa |
| `M` | Silencia / activa el sonido |

Mientras arrastrás, una **línea punteada blanca translúcida** muestra la
trayectoria prevista y el panel superior indica dirección, altura, potencia,
**alcance previsto** y ápice.

### Qué control manda en qué

- **La potencia manda en la distancia.** La velocidad de salida entra al cuadrado
  en la sustentación, así que su efecto es mucho mayor: medido, la potencia
  cambia el alcance **x3.6** mientras el ángulo lo cambia sólo **x1.25**
  (`node tools/calibrate-flight.mjs power`).
- **El ángulo elige la forma del vuelo**, no la distancia. Arrastrar arriba
  aplana la salida (tiro rasante que aprovecha el planeo); arrastrar abajo
  levanta el morro (arco con más altura y ápice).
- **Potencia y ángulo son ejes separados**: la misma distancia de arrastre da la
  misma potencia sin importar hacia dónde arrastres, así que se puede planificar
  el tiro — forma y fuerza — de a uno.

El rango de ángulo es angosto a propósito (18° a 52°). La zona útil va de 23° a
55°, pero por encima de 45° el ápice crece muchísimo mientras el alcance ya no
mejora: se suben 60 m para ganar 5 m de distancia. Recortarlo evita ese rango
inútil.

---

## Las dos etapas

```
STANDBY ──(clic / Enter / arrastrar)──▶ AIM ──(soltar)──▶ PLAYING
   ▲                                     │                  │
   └──────────(Esc: volver atrás)────────┘                  ▼
                                                         RESULT
                                                       (repetir →
                                                        STANDBY)
```

**1 · STANDBY** — vista lateral de tres cuartos. Es la pantalla de llegada:
título, tienda, monedas e instrucciones a la vista.

**2 · AIM (modo lanzamiento)** — al hacer clic, `Enter` o empezar a arrastrar,
la cámara **viaja** hasta ponerse detrás del lanzador y **más alta** que el plano
de tiro, para que la línea punteada se lea completa hacia adelante. La pantalla
queda limpia (solo el cartel de la nave activa).

Ahí el avión queda **quieto en la resortera, listo para planificar**: se regula
la dirección, se elige la altura de salida y se carga la potencia viendo la
trayectoria prevista. Recién al soltar el avión sale. `Esc` vuelve a standby.

### La transición ocurre al ENTRAR, nunca al lanzar

Es la distinción central del flujo: la animación de cámara pertenece a
`enterLaunchMode()` y se termina antes de que el jugador toque la puntería.
Lanzar es solo soltar, sin que se mueva la cámara.

Si la transición se disparara al lanzar, se vería como si la cámara se moviera
sola justo cuando el avión sale, y además habría que congelar el avión y esperar
la animación para soltarlo. Todo ese mecanismo de "lanzamiento armado" existió
mientras el orden estuvo mal y ya no hace falta: se eliminó.

### Detalles de implementación que importan

- La transición es un **tween reversible** (`CameraRig.blend`, 0↔1, con
  `smoothstep`), no un suavizado exponencial: ida y vuelta usan el mismo camino,
  la duración es exacta y hay un aviso claro al terminar.
- La etapa en la que **arrancó** el gesto se recuerda aparte (`gestureStage`):
  entrar en modo lanzamiento ocurre durante el mismo gesto, así que sin ese dato
  un clic seco en standby se leería como clic ya en modo lanzamiento y el avión
  saldría solo al entrar.
- La pista de instrucciones se **apaga** en modo lanzamiento: tapaba justo el
  avión y la línea punteada, que es lo que hay que mirar en esa etapa.
- `Game.launch()` no anima nada. Solo tiene una guarda defensiva: si llegara una
  orden de lanzar estando todavía en standby, salta a la vista de lanzamiento sin
  animar, para que el avión nunca salga desde el ángulo lateral.

---

## Tienda

Vive **debajo del contador de monedas**, arriba a la derecha, y tiene dos
secciones:

- **Hangar** — el selector de aeronave. Por ahora **las 4 son gratis**. El
  precio ya se lee de `spec.price` en `js/physics/specs.js`, y la UI ya sabe
  mostrar el costo, el estado "faltan X monedas" y bloquear la tarjeta, así que
  poner precios más adelante es cambiar esos números.
- **Mejoras** — las 8 mejoras. Se muestran solo cuando hay monedas ganadas, es
  decir al terminar un vuelo.

Las mejoras se compran desde el resultado (botón "COMPRAR MEJORAS"), donde se
ve cuánto se ganó. Así el panel de la tienda queda compacto durante la partida.

---

### El juego es VERTICAL

El juego pasó de apaisado a retrato. No fue sólo cambiar el manifiesto: en
vertical el corredor se ve como un pasillo angosto, así que hubo que rediseñar.

| Qué | Antes | Ahora |
| --- | --- | --- |
| Cámara: FOV vertical | 65° fijo | **82°** cuando el aspecto es vertical |
| Cámara: distancia y altura | ×1 | **×1.35** en vertical |
| Rueda táctica | 168 px (43% del ancho) | **128 px** (33%) |
| Botón de boost | 104 px | **84 px** |
| Botón volver | 52 px | **44 px** |
| Padding del HUD | 66 px | **14 px** |

El FOV se recalcula con la cuenta inversa: se conserva el campo horizontal de
referencia (16:9) y se despeja el vertical. Está acotado a 82° porque más que eso
deforma la perspectiva.

También se movió el indicador de viento (se pisaba con el boost) y el título del
lobby (se cortaba contra las monedas y la tienda).

### Respuesta de los mandos

El control lateral es lo que hace maniobrable el vuelo, así que su respuesta está
medida y no estimada:

| | Antes | Ahora |
| --- | --- | --- |
| Tiempo en llegar al tope lateral | 0.56 s | **0.11 s** |
| Avance durante un giro de 10 m | 34 m | **25 m** |

Con 0.56 s el avión recorría 16 m hacia adelante antes de completar el giro: el
mando se sentía tarde y obligaba a corregir de nuevo en cada curva. El cambio fue
subir `LATERAL_ACCEL` de 15 a 90 y la amortiguación de 2.2 a 4.5 — sigue habiendo
rampa, no es un teletransporte, pero deja de sentirse como un retardo.

Se mide con `node tools/measure-steering.mjs [classic|frenetic]`.

## Un solo modo: frenético

El modo es una **capa de configuración**, no una rama de código. Los dos
comparten física, mundo, render y reglas; lo que cambia son los números de
`modes/classic.js` y `modes/frenetic.js`. Se cambia en caliente desde la barra
de arriba, sin recargar.

| | Clásico | Frenético |
| --- | --- | --- |
| Apuntado | 18°..52°, se apunta a un objetivo | 8°..34°, se elige una DIRECCIÓN |
| Movilidad | x1 | **x2.4** |
| Planeo | 5.5 s (el recurso central) | 2.2 s (sólo para reaccionar) |
| Combustible | no | **60 s**, 2.5 s por propulsión |
| Dirección | línea punteada | **flechas detrás de la nave** |
| Recolectables | violeta + azul | violeta + azul + **emergencia** |
| Caminos | 1 por tramo | **3 por tramo** |
| Obstáculos | 128 | **353** (árboles y barreras) |

### Modo Frenético

Vuelo dirigido y de reacción. Las diferencias no son cosméticas:

- **No se puede apuntar hacia arriba** (tope 34°) y el vuelo tiene un techo de
  100 m. El lanzamiento es de dirección, no de objetivo: se elige por dónde
  salir, no a qué altura llegar.
- **La movilidad es la herramienta.** Con los mandos a x2.4 la curva se corrige
  volando. En el clásico se corrige apuntando mejor; acá no hay tiempo.
- **Flechas de ORIENTACIÓN, no de trayectoria.** Marcan hacia dónde va a salir el
  avión y nada más: no dibujan el arco ni el punto de impacto. Se ven mientras
  apuntás y desaparecen al lanzar. La diferencia con la línea punteada no es
  estética: la línea promete por dónde vas a pasar, las flechas sólo dicen hacia
  dónde apuntás.
- **El combustible es el recurso.** Baja solo con el tiempo y cada propulsión
  cuesta 2.5 s. La decisión constante es gastar ahora o aguantar.

### Los aros no son obstáculos

Un aro es una **oportunidad**, no un peligro. Cruzarlo limpio por el centro da
monedas; rozar el borde no hace nada. Antes el borde colisionaba, y eso castigaba
justamente al jugador que se animaba a apuntarle.

### El planeo se gasta por energía

El presupuesto de planeo se descuenta según cuánta sustentación se está pidiendo,
no según si el avión baja. Un planeo normal cuesta ~1×; forzarlo a subir contra
la gravedad cuesta más.

**Esto arregla un exploit concreto:** antes el descuento sólo ocurría con
`vy < 0`, así que mantener (o bombear) W subía el avión sin gastar nada y se
podían volar cientos de metros con el marcador congelado. Además, la autoridad
del morro ahora se escala con el planeo que queda: sin presupuesto, W no tiene
fuerza y gana la gravedad.

### Respuesta del analógico

El mando táctil tenía dos problemas medibles:

| | Antes | Ahora |
| --- | --- | --- |
| Zona muerta | 16% del radio | **8%** |
| Curva de respuesta | lineal | **potencia 0.72** |

Con la zona muerta en 16% había que recorrer un sexto del radio antes de que el
avión hiciera algo: ~10 px a ciegas en una rueda de 128 px. La curva amplifica los
movimientos chicos sobre la magnitud y conserva la dirección, así que un toque
suave corrige de a poco y un empujón da el máximo.

### Hitboxes

Las cajas de colisión siguen la SILUETA, no el espacio que deja la geometría:

| Objeto | Antes | Ahora |
| --- | --- | --- |
| Pino | 1.1-2.2 m de semiancho, hasta la punta | **0.55-0.95 m**, hasta el 88% del alto |
| Roca | radio completo | **82%** del radio |
| Tronco | 1.6× el radio | **1.15×** el radio |
| Booster | 12 m de semialtura | **8 m** |
| Radio de recogida | 5.5 m | **4.5 m** |

El caso del pino era el peor: la copa es un cono que se afina hacia arriba, así que
la caja dejaba aire de sobra a los costados y por encima de la punta. Medido, se
chocaba "al lado" del árbol sin tocarlo. Con la caja ajustada se puede volar bien
bajo y bien cerca con confianza.

### Los boosters, por color

| Color | Qué hace |
| --- | --- |
| 🟣 **Violeta** | Se guarda. Se activa con `Espacio` cuando querés. |
| 🔵 **Azul** | **Instantáneo**: empuja en el momento del contacto. |
| 🟠 **Ámbar** | **Emergencia**: sólo aparece cuando queda poco combustible. |

Los tres son un octaedro con una "B" adentro, dibujada sobre un canvas en vez de
modelada en 3D: una geometría de texto costaría cientos de triángulos por booster
y esto son dos.

### Herramientas y desafíos del entorno

Los tramos avanzados son difíciles pero tienen recursos para sortearlos:

- **Árboles** — vegetación que hace legible la llanura. Sin ellos un tramo plano
  es una sábana vacía donde no hay referencia de velocidad. Son finos: se pasan
  de costado.
- **Rocas** — aglomeraciones de 2 a 4 piedras que bloquean un LADO del corredor,
  nunca el centro: siempre queda un camino. Reemplazaron a las barreras-bloque,
  que se sacaron porque un muro artificial encima del paisaje ensucia la escena.
- **Troncos caídos** — el "árbol gigante semi caído". Alargados y con un extremo
  levantado, así que obligan a subir o a rodearlos: atacan el eje vertical, que
  es distinto de lo que ataca una roca.
- **Aros** — recompensa por volar bien.

## Tramos: el corredor cambia cada 500 m

El corredor son **2500 m** divididos en cinco tramos de 500. Cada uno cambia de
aspecto y de dificultad, y los dos ejes crecen por separado:

| Tramo | Relieve | Altura de crucero | Obstáculos |
| --- | --- | --- | --- |
| 1 | casi plano (0.10) | 15 m | 17 |
| 2 | 0.37 | 19 m | 22 |
| 3 | 0.54 | 25 m | 27 |
| 4 | 0.75 | 33 m | 30 |
| 5 | 0.98 | 41 m | 32 |

**Los primeros tramos son rasantes a propósito.** El pedido era que la
experiencia inicial se sienta esquivando obstáculos a baja altura, y que la
altura sea algo que aparece más adelante. Con relieve desde el arranque, el tiro
plano chocaba contra una loma a los 90 m y el arco ganaba por goleada, que es
justo lo contrario de lo que se busca.

La **paleta** de cada tramo tiñe cielo, niebla y luces con una transición suave,
y el HUD anuncia el nombre al entrar.

**El perfil de vuelo es la fuente única.** `game/flightProfile.js` define una
función de distancia → altura deseada, y de ahí salen tres cosas que antes vivían
descoordinadas: dónde se colocan los recolectables, cuánto relieve tiene el
terreno, y a qué altura apunta la puntería neutra. Cuando esas tres se
desincronizan, el avión pasa por al lado de todo sin recoger nada — y ya pasó
una vez.

## Recolectables

Viven en `js/world/collectibles.js` (lógica pura) y `js/world/pickupMeshes.js`
(mallas). Son un módulo aparte de los obstáculos porque **los obstáculos se
evitan y los recolectables se buscan**: mezclarlos obligaría a cada consumidor a
filtrar por tipo. Lo único que comparten es no superponerse, y eso se resuelve
pasando la lista de obstáculos al generar.

### Monedas

Tres valores, con pesos distintos:

| Valor | Peso | Forma | Para qué |
| --- | --- | --- | --- |
| **5** | 50% | hilera recta | el grueso de la recolección |
| **10** | 32% | zigzag | obliga a corregir la dirección |
| **50** | 18% | en ascenso | hay que arquea el tiro |

El valor se suma **entero** a la recompensa del vuelo, aparte de la fórmula por
desempeño. Promediarlo diluiría el premio por arriesgar una línea de vuelo, que
es justamente lo que hace interesante ir a buscar una de 50.

### Boosters

Aparecen cada `SPACING` metros y son el motor de la distancia:

- **Empuje**: un 50% de la *velocidad de lanzamiento de ese vuelo*
  (`SPEED_FRACTION`), repartido en `BURN_TIME` segundos. No es un valor fijo, así
  que el booster sigue pesando lo mismo después de comprar mejoras.
- **Recarga de planeo**: suma `GLIDE_BONUS` segundos al presupuesto, con tope.
  Sin esta parte el booster sería sólo un pico de velocidad y el avión se caería
  igual.

Cada booster es una **columna vertical**, no un punto. El motivo es geométrico:
cada ángulo de salida produce su propia línea de vuelo y entre 20° y 24° hay unos
9 m de diferencia vertical a media distancia. Un blanco puntual sólo se podía
recoger apuntando casi exactamente a su altura, así que la mecánica dependía de
un grado de puntería.

### Colocación: la línea nominal

### Caminos aleatorios

Los recolectables no se colocan de a uno: se arman **caminos completos** por
tramo —trazados coherentes de monedas y boosters— y en cada partida se elige uno
al azar. El mapa es fijo, pero la ruta que conviene volar no, así que cada
lanzamiento se juega distinto sin regenerar el mundo.

Un camino es una secuencia coherente: si lo seguís, juntás todo. Colocar puntos
sueltos al azar daría racimos inalcanzables, porque cada punto necesita estar
sobre alguna línea de vuelo posible. **Un camino ES esa línea.**

### Anclaje a la línea de vuelo

Todos los recolectables se anclan a la **línea objetivo** del perfil, no a una
altura sobre el suelo, y la línea nunca baja de `suelo + TERRAIN_CLEARANCE`.

Fue el error más caro de esta parte: el avión vuela a alturas **absolutas** y el
terreno del corredor va subiendo (0 m al principio, 8 m a los 200 m), así que un
recolectable "a 11 m del suelo" queda a 12,5 m absolutos al principio y a 16,5 m
al final, mientras el avión va bajando. Resultado: pasaba 8 m por encima de todo
y no recogía nada.

---

## Naves: se desbloquean y se sienten distintas

Las cuatro naves no son el mismo avión con otro dibujo. Cada una tiene un perfil
propio, y la tienda lo muestra con barras para que se pueda comparar de un
vistazo:

| Nave | Desde | Alcance | Estabilidad | Maniobra | Su defecto |
| --- | --- | --- | --- | --- | --- |
| **Papel** | inicio | alto | muy baja | alta | el viento lo lleva **x3** |
| **Pasajeros** | 400 m | bajo | máxima | baja | pierde sustentación a 14 m/s |
| **Jet** | 900 m | máximo | baja | media | nervioso y la pierde a 20 m/s |
| **Helicóptero** | 1500 m | corto | alta | máxima | casi no avanza |

El desbloqueo es por **récord de distancia** (`spec.unlockAt`): volar lejos abre
naves nuevas, y la tarjeta bloqueada dice cuánto falta. No hay que comprarlas.

Tres parámetros nuevos en la ficha producen esas diferencias:

- `windFactor` — cuánto la desvía el viento. Un papel lo lleva el triple que un
  avión de pasajeros; es la diferencia más fácil de sentir.
- `stallSpeed` — por debajo de esa velocidad pierde sustentación y el morro se
  cae solo. Es lo que hace al jet "rápido pero difícil".
- `control` — multiplicador de los mandos. El helicóptero gira donde querés; el
  de pasajeros tiene inercia.

## Alpha 1.0 en el teléfono

El juego se instala como **PWA**: se abre en el navegador del móvil, se elige
"Agregar a pantalla de inicio" y queda con su icono, a pantalla completa y sin
conexión. No necesita Android SDK ni genera un `.apk`.

### Controles táctiles

En el móvil aparece un juego de mandos distinto al del escritorio:

| Control | Qué hace |
| --- | --- |
| **Arrastrar en la pantalla** | Apuntar y lanzar |
| **Rueda analógica (izq.)** | Las cuatro direcciones: izquierda/derecha el rumbo, arriba/abajo el morro |
| **Botón ⚡ (der.)** | Propulsión |
| **Botón ← (arriba izq.)** | Volver, el equivalente a `Esc` |

**Una sola rueda gobierna todo el vuelo.** Un dedo lleva el rumbo Y el morro a la
vez, así que el otro pulgar queda libre para la propulsión sin levantar la mano.
Es analógica y no un pad de botones porque el vuelo necesita valores intermedios:
con todo o nada no se corrige la curva con suavidad, que es lo que hace el modo
frenético. Tiene zona muerta en el centro para poder apoyar el pulgar sin desviar
el avión.

El desplazamiento se recorta a un **círculo**, no a un cuadrado: el mando máximo es
el mismo en cualquier dirección, así que empujar en diagonal no da más autoridad
que empujar en cruz. Sin ese recorte el avión giraría más rápido en diagonal.

El botón de volver está **pegado al borde superior**, lejos del recorrido del
pulgar: antes estaba arriba de la rueda y un movimiento amplio abortaba el vuelo
sin querer.

Sólo se construyen en dispositivos táctiles: en escritorio no aparecen ni ocupan
lugar, así que la misma build sirve para los dos.

### Cómo se levanta el servidor

**Doble clic en `arrancar-servidor.cmd`**, en la raíz del proyecto. Imprime las
dos direcciones: la de la PC y la del móvil.

**No hace falta ejecutar como administrador.** El servidor escucha en un puerto
local y sólo lee archivos de esta carpeta: no toca el sistema, no instala nada y
no necesita permisos elevados. Tampoco hay que instalar Node si ya lo tenés
(el lanzador lo busca primero en el sistema y después en el que trae el harness).

También se puede levantar a mano:

```
node tools/serve.mjs 8765 --lan
```

| Comando | Qué hace |
| --- | --- |
| `node tools/serve.mjs` | Sólo desde esta PC (`127.0.0.1`) |
| `node tools/serve.mjs 8765 --lan` | También desde el móvil, en la misma WiFi |
| `node tools/serve.mjs 0` | Puerto libre, lo informa al arrancar |

Sin `--lan` el servidor escucha SÓLO en `127.0.0.1`, que es lo correcto para
desarrollar: nada de la red local ve el proyecto. Pero eso hace imposible abrirlo
desde el teléfono, así que para probar los mandos táctiles hace falta `--lan`.

⚠️ Con `--lan` es un servidor de archivos **sin autenticación**: cualquiera en la
misma red puede leer el proyecto mientras esté levantado. Cerralo (Ctrl+C) al
terminar.

### Cómo se instala en el teléfono

1. Levantar el servidor con `--lan` (el `.cmd` ya lo hace).
2. Desde el móvil, entrar a la dirección que imprime — algo como
   `http://192.168.0.151:8765/index.html`.
3. Menú del navegador → **Agregar a pantalla de inicio**.

Si el móvil no carga, casi siempre es el **Firewall de Windows** bloqueando las
conexiones entrantes de Node, no el servidor.

El service worker cachea los 52 archivos del juego (1.7 MB), así que después
abre sin conexión.

### Generar un .apk

Requiere **JDK 17 + Android SDK + Gradle**, que no vienen con el proyecto. El
camino es envolver esta misma carpeta con Capacitor: no hay que cambiar código,
porque la app ya es una web autocontenida.

```
npm i -D @capacitor/cli @capacitor/core @capacitor/android
npx cap init PaperCrash com.tuempresa.papercrash --web-dir=.
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug
```

### Herramientas de verificación móvil

| Comando | Qué comprueba |
| --- | --- |
| `node tools/check-mobile.mjs` | Layout en 3 teléfonos + escritorio, con emulación de dispositivo real |
| `node tools/check-touch.mjs` | Los joysticks con **dedos emulados de verdad** (`Input.dispatchTouchEvent`) |
| `node tools/sync-sw.mjs` | Sincroniza la lista de archivos del service worker con el disco |
| `node tools/make-icons.mjs` | Regenera los iconos de la PWA |

`sync-sw.mjs` existe porque la primera versión de `sw.js` listaba los módulos a
mano y estaba mal: un solo archivo inexistente hace fallar la instalación ENTERA
del service worker, y la app deja de ser instalable sin ningún error visible.

## Arquitectura

```
index.html            Entrada única. Carga Three.js (CDN) y js/main.js (módulo)
style.css             Estilos, organizados por capas de UI
js/
  main.js             Arranque, validaciones previas y manejo de errores
  config.js           TODOS los números de diseño y balance del juego
  core/
    engine.js         Renderer, escena, cámara base, luces, resize, calidad adaptativa
    input.js          Entrada unificada (mouse / touch / Pointer Events / teclado)
    math.js           Utilidades puras (clamp, remap, damp, RNG determinista)
    storage.js        Persistencia en localStorage, con saneado y versionado
    audio.js          Audio procedural con WebAudio (sin archivos externos)
  physics/
    specs.js          Ficha técnica de las 4 aeronaves (modelo de vuelo)
    flightModel.js    NÚCLEO de física: integración con sub-pasos adaptativos
    trajectory.js     Previsualización, usando el MISMO núcleo que el vuelo
  world/
    terrainField.js   Función de altura del suelo (fuente única de verdad)
    environment.js    Cielo, estrellas, terreno, cordillera
    obstacles.js      Generación determinista del corredor + colisiones
    obstacleMeshes.js Mallas de los obstáculos
    collectibles.js   Monedas y boosters: generación y recolección (puro)
    pickupMeshes.js   Mallas de monedas y boosters
    launchpad.js      Plataforma de la resortera
  aircraft/
    index.js          Registro de constructores; de `type` a Object3D
    shared.js         Helpers de malla facetada
    paperPlane.js  passengerPlane.js  fighterJet.js  helicopter.js
    launcher.js       La resortera y los ganchos de la banda
  game/
    Game.js           Orquestador: cablea entrada, reglas, UI y bucle
    RunController.js  Máquina de estados de la partida y reglas del vuelo
    AircraftView.js   Presentación del avión (posición, actitud, rotores)
    aiming.js         Sistema de puntería y previsualización
    cameraRig.js      Cámara: apuntado, lanzamiento y persecución
    slingshotBand.js  Banda elástica
    trail.js          Estela de vuelo
    effects.js        Partículas y destellos (con pool, sin asignar por frame)
    state.js          Estado persistente, mejoras y economía
  ui/
    dom.js            Acceso centralizado al DOM (valida ids al arrancar)
    hud.js            HUD de vuelo
    aimFeedback.js    Panel de apuntado
    overlays.js       Coordinación de pantallas y fundidos
    resultScreen.js   Pantalla de resultado
    shop.js           Panel de tienda (hangar + mejoras)
    aircraftSelector.js Hangar: elegir aeronave
tools/
  serve.mjs              Servidor de desarrollo en Node, sin dependencias
  calibrate-flight.mjs   Banco de calibración de la física (exploración, no prueba)
  verify-physics.mjs     Arnés del modelo de vuelo (Node, sin navegador)
  verify-game-logic.mjs  Lógica pura: obstáculos, colisiones, economía, guardado
  browser-smoke.mjs      Prueba de humo real en Chrome headless (CDP)
```

### Principios que sigue el código

- **`config.js` es la única fuente de números.** Si un valor afecta al *feel*
  del juego, vive ahí. Ningún otro módulo tiene literales mágicos de diseño.
- **La física y la previsualización son el mismo código.** `trajectory.js`
  llama a `flightModel.js`. Por construcción, la línea punteada no puede mentir.
- **El vuelo tiene un recurso que se agota.** El presupuesto de planeo
  (`glideBudget`) es lo que convierte a los boosters en la mecánica central: sin
  él, el avión planea solo y la distancia vuelve a depender del ángulo.
- **El suelo tiene una sola definición.** `terrainField.js` la provee; la malla
  del terreno, la colisión y la previsualización la consumen.
- **La entrada se interpreta una sola vez**, en `RunController`, consultando la
  fase real. Ningún atajo "atraviesa" una pantalla de UI.
- **Los sistemas no se conocen entre sí.** El orquestador (`Game.js`) los
  conecta. Eso permite testear la física y la lógica sin navegador.
- **Los módulos puros no importan Three.js ni el DOM**, para poder verificarlos
  desde Node.

---

## Verificación

Tres suites, ~200 comprobaciones en total:

```bash
node tools/verify-physics.mjs      # 29 checks: modelo de vuelo y terreno
node tools/verify-game-logic.mjs   # 64 checks: obstáculos, colisiones, guardado
node tools/browser-smoke.mjs       # 107 checks: el juego real en Chrome
```

La de navegador necesita el proyecto servido por HTTP en el puerto 8765
(`python -m http.server 8765`) y lanza Chrome headless con el protocolo DevTools.
No usa dependencias externas: aprovecha el cliente WebSocket nativo de Node 24.
Si no encuentra Chrome ni Edge, se saltea sola.

### Qué cubre cada suite

- **Física:** que el arrastre tenga el signo correcto y no *acelere* el avión,
  que la sustentación no explote a alta velocidad, que el integrador sea estable,
  que el óptimo de ángulo esté entre 25° y 50°, que el azimut desvíe de forma
  simétrica, que la progresión de mejoras quepa en el corredor y que las 4
  aeronaves se comporten distinto.
- **Lógica:** determinismo del corredor, justicia de los obstáculos, colisiones
  (incluido atravesar aros huecos), saneado del guardado ante datos corruptos,
  economía, y las **guardas de fase** que impiden relanzar el avión desde la
  pantalla de resultado.
- **Tramos y caminos (Node):** que la amplitud del relieve y la altura de crucero
  crezcan por tramo, que el primero sea rasante, que el terreno nunca tape la
  línea de vuelo, que los caminos cambien con la semilla y que las monedas de 50
  vuelen más alto que las de 5 pero sigan siendo alcanzables.
- **Recolectables y boosters (Node):** que existan los tres valores de moneda y
  que las de 50 escaseen, que el reparto sea determinista, que nada quede
  enterrado ni fuera del corredor, y **la mecánica central**: que cada booster
  recogido alargue el vuelo y que juntarlos sea la diferencia entre un vuelo
  corto y uno largo.
- **Navegador:** carga sin errores, tienda y hangar (aeronaves gratis, apertura
  y cierre del panel), las **dos etapas** (entrar en modo lanzamiento no lanza,
  la nave queda quieta y lista para planificar, apuntar no mueve la cámara,
  lanzar **no** dispara ninguna transición, `Esc` vuelve), la transición de
  cámara reversible, la previsualización punteada blanca, los **controles
  desacoplados con el mapeo nuevo** (arriba aplana, abajo levanta el morro,
  potencia = distancia e independiente del ángulo), un vuelo completo de punta a
  punta, y la **regresión del bug de reentrada** (clic o `Espacio` con el
  resultado abierto, `Espacio` durante el arrastre, y que el reintento no
  dispare la transición de cámara solo). Incluye la **recolección en vivo**: que
  el vuelo junte monedas, que recoger un booster recargue el presupuesto de
  planeo y que el aviso aparezca en el HUD.

---

## Balance

Calibrado con `tools/verify-physics.mjs`, y los números están en `config.js`:

| Estadio | Alcance (potencia 100%, 30°) |
| --- | --- |
| Sin mejoras | ~114 m |
| ~50% de la tienda | ~228 m |
| Todo al máximo | ~508 m |

El corredor mide 600 m, así que el build máximo queda dentro del mapa.

---

## Notas de diseño

**Por qué el balance se validó con un arnés y no a ojo.** El modelo de vuelo es
cuadrático en la velocidad, así que cambios pequeños se amplifican. Los valores
originales de la tienda (`dragMult` 0.15, empuje ×3.1) llevaban el build máximo a
2.9 km, muy fuera del corredor. Los actuales se eligieron midiendo.

**Por qué los controles usan ejes de pantalla.** Se probaron tres enfoques:
proyectar sobre la base de la cámara, sobre el rumbo del avión, y sobre los ejes
de pantalla. Los dos primeros acoplaban los ejes (arrastrar hacia atrás movía
también la dirección) porque la cámara mira el corredor en diagonal. En pantalla
"derecha" y "arriba" son perpendiculares por construcción, así que la
descomposición es exacta.

**Por qué el helicóptero devuelve sus rotores.** Antes eran variables globales
(`activeHelicopterRotor`), así que al cambiar de nave quedaban apuntando a una
malla destruida. Ahora el modelo publica `userData.rotors` y `AircraftView` los
anima.

**Por qué hay un `paused` en `Game`.** Sin poder congelar el avance de la lógica,
una prueba que mide una secuencia de entradas ve el estado cambiado por detrás
(el avión ya voló y chocó solo). Es una capacidad de instrumentación, no una
funcionalidad de juego.

**Por qué el lanzamiento no anima nada.** `Game.launch()` sólo llama a
`RunController.launch()`. La transición de cámara pertenece a
`enterLaunchMode()`: cuando el avión sale, la cámara ya está quieta detrás del
lanzador y la vista pasa directo a persecución. Mientras el orden estuvo al
revés hizo falta un "lanzamiento armado" que congelara el avión y esperara la
animación; al corregir el orden, ese mecanismo quedó sin uso y se eliminó.

**Por qué el vuelo se ve en tercera persona sostenida.** La cámara no sigue el
vector velocidad sin más: ese vector, en picada, apunta al suelo y se lleva la
cámara con él, así que el vuelo terminaba viéndose **desde abajo**. Se mezcla la
dirección de vuelo con el "arriba del mundo" (`FOLLOW_VERTICAL_BLEND`) y además
se impone un mínimo de metros por encima del avión
(`FOLLOW_MIN_ABOVE`), medido contra la posición real y no contra el objetivo
amortiguado. La cámara también se inclina al girar (`FOLLOW_ROLL`), que es lo
que hace visible el viraje sin mirar el HUD.

**Por qué el ángulo tiene el signo invertido.** En la primera versión, arrastrar
arriba empinaba el tiro. Como el alcance depende sobre todo de la potencia, el
resultado era que "apuntar lejos" obligaba a subir muchísimo y avanzar poco.
Ahora arrastrar arriba aplana la salida, que además es lo intuitivo: la línea
punteada se estira hacia el horizonte.

**Por qué el modelo tiene descenso terminal.** Antes, apenas la resistencia
frenaba el avión la gravedad quedaba como única fuerza y el vuelo terminaba en
una caída vertical: subía con un arco y bajaba de golpe. La velocidad de
descenso terminal (`glideSink`) convierte esa última parte en un planeo. El
límite **no es constante**: en caída rápida la resistencia le gana a la
sustentación, así que se afloja con el cuadrado de la velocidad de descenso. Con
un tope fijo, un lanzamiento muy fuerte subía muchísimo y después flotaba, y el
alcance se disparaba por encima de los mil metros.

**Por qué la previsualización simula por tiempo y no por puntos.** El bucle de
`computeTrajectory` estaba limitado por `MAX_POINTS`, o sea unos 10 s de vuelo.
Alcanzaba para un tiro tenso, pero con el planeo un lanzamiento alto seguía en
el aire al agotarse el bucle, nunca se detectaba el impacto y el alcance quedaba
en **0 m**. Ahora la simulación corre por tiempo (`MAX_SIM_TIME`) y el muestreo
se adapta para no pasar de `MAX_POINTS` puntos.

**Por qué el terreno se extiende hacia atrás.** La malla arrancaba en x = 0 y la
cámara veía el borde del mundo justo detrás de la resortera.
`WORLD.BEHIND_LENGTH` (420 m) y `WORLD.FOG_DENSITY` están elegidos en conjunto:
con esa niebla, a ~180 m ya no se ve nada, así que el borde queda siempre oculto
mire donde mire la cámara.
