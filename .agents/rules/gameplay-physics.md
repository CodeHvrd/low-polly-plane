# Reglas de Físicas, Mecánicas de Juego y Controles

## 1. El Bucle de Vuelo y el Modelo Físico

- **Presupuesto de Planeo (`glideBudget`)**:
  - El avión no planea infinitamente. Consume su presupuesto de planeo en función de la sustentación requerida (gasto energético real).
  - Nunca permitir que levantar el morro (`W`) o bombear controles mantenga el avión suspendido sin coste de planeo. Sin presupuesto de planeo, la sustentación cae y la gravedad domina.
- **Velocidad y Sustentación**:
  - El modelo aerodinámico calcula sustentación y arrastre proporcional al cuadrado de la velocidad ($v^2$).
  - Cambios en coeficientes aerodinámicos deben ser calibrados rigurosamente; pequeños incrementos pueden desbordar el alcance del corredor (el mapa total mide 2500 m).
- **Descenso Terminal**:
  - La velocidad terminal de descenso evita caídas puramente verticales y mantiene la sensación de planeo final sin permitir flotaciones no físicas a gran altura.

## 2. Propulsión y Boosters

- **La propulsión es una habilidad táctica**:
  - Los boosters no empujan automáticamente al avión (salvo tipos específicos instantáneos). Otorgan una unidad/carga de propulsión y recargan segundos al presupuesto de planeo.
  - El jugador decide cuándo consumir su propulsión con `Espacio`.
  - El empuje es proporcional a la velocidad de salida de ese vuelo en particular (`SPEED_FRACTION`), garantizando que la mejora de potencia inicial siga teniendo impacto constante.
  - Respetar siempre el número máximo de cargas (`MAX_CHARGES`) y el enfriamiento (`cooldown`) entre pulsos.
  - `Espacio + W` aplica un envión vertical hacia arriba antes de estabilizar el planeo normal.

## 3. Controles, Puntería y Cámara

- **Ejes Desacoplados en Pantalla**:
  - El arrastre de puntería se proyecta sobre ejes de pantalla directos (no sobre el vector oblicuo de cámara):
    - **Eje Vertical**: Forma del tiro / ángulo de pitch (arrastrar arriba = tiro rasante/plano; arrastrar abajo = arco más alto).
    - **Eje Horizontal**: Azimut / dirección lateral (±35°).
    - **Distancia de arrastre**: Potencia de salida (distancia total del tiro).
- **Transición de Cámara**:
  - La animación de cámara al apuntar pertenece a `enterLaunchMode()` y se completa **antes** de que el jugador ajuste el tiro.
  - Al soltar el disparo (`launch()`), la cámara **NO** debe iniciar ninguna animación de transición hacia atrás; el avión sale de inmediato y la cámara pasa a seguimiento en 3ra persona con smoothstep.
- **Cámara en 3ra Persona**:
  - Mezclar el vector de avance con el vector vertical del mundo (`FOLLOW_VERTICAL_BLEND`) y mantener una altura mínima sobre el avión (`FOLLOW_MIN_ABOVE`) para evitar enfocar el avión desde abajo en picadas.

## 4. Colisiones, Obstáculos y Recolectables

- **Hitboxes Ceñidas a la Silueta**:
  - Las cajas de colisión deben respetar la silueta estrecha de los modelos (copa de pinos, rocas, troncos), no los cubos delimitadores máximos.
  - Nunca castigar al jugador con colisiones invisibles o aire que bloquea.
- **Aros**:
  - Los aros son premios, no peligros. Cruzar por el hueco otorga recompensa. Rozar o atravesar el borde exterior **NO debe destruir el avión**.
- **Separación entre Obstáculos y Recolectables**:
  - Los obstáculos se evitan y los recolectables se buscan. Sus estructuras de datos deben mantenerse separadas.
  - Monedas: 5 (comunes, rectas), 10 (zigzag medio), 50 (raras, elevadas por encima de la línea promedio).
  - Ningún recolectable ni obstáculo debe quedar enterrado bajo el terreno ni salir de los márgenes laterales del corredor.
