# Deploy a GitHub Pages

El repo ya está configurado: `CodeHvrd/low-polly-plane`. Falta **un solo paso
manual** que no se puede automatizar sin permiso de administrador del repo.

## El paso que falta (30 segundos)

1. Entrá a https://github.com/CodeHvrd/low-polly-plane/settings/pages
2. En **Source**, elegí **GitHub Actions** (no "Deploy from a branch")
3. Listo. No hay que guardar nada más.

Después de eso, el workflow que ya está en el repo corre solo en cada push y
publica en:

**https://CodeHvrd.github.io/low-polly-plane/**

Para que corra la primera vez sin esperar un push: pestaña **Actions** → "Deploy a
GitHub Pages" → botón **Run workflow**.

## Por qué falla hasta que habilites Pages

El workflow falló en el paso "Configurar Pages" con este error implícito:

```
Get Pages site failed. Please verify that the repository has Pages enabled
and configured to build using GitHub Actions
```

Es esperado: GitHub no deja publicar en un sitio que todavía no existe. Una vez
habilitado, el mismo workflow pasa sin tocar nada.

## Cómo actualizar el juego

```bash
node tools/sync-sw.mjs --bump   # sube la versión del cache del service worker
git add -A
git commit -m "lo que cambiaste"
git push
```

En ~1 minuto está publicado. **No hace falta reinstalar nada en el teléfono**: se
abre la URL y ya está.

### Lo del `--bump` es importante

El service worker cachea el juego para que funcione offline. Si no cambiás la
versión, el teléfono sigue mostrando la copia vieja aunque el servidor tenga la
nueva. `sync-sw.mjs --bump` sube el número y fuerza la actualización.

## Qué se publica

El workflow copia sólo lo que el juego necesita:

```
index.html  style.css  manifest.webmanifest  sw.js
icons/  js/  fonts/
```

`tools/`, `native/`, `.android-build/` y los `.md` quedan afuera. Así el sitio
pesa ~2 MB y no expone archivos de desarrollo.

## Alternativa más simple (sin workflow)

Si preferís no usar Actions: en Settings → Pages elegí **Deploy from a branch**,
rama `main`, carpeta `/ (root)`. GitHub sirve el repo tal cual.

Funciona igual, pero publica también `tools/` y `native/`. El juego anda igual;
es sólo prolijidad.

## El APK sigue siendo aparte

GitHub Pages no reemplaza al APK. Son dos caminos:

| | Web (Pages) | APK |
| --- | --- | --- |
| Actualizar | `git push` | Recompilar e instalar |
| Instalar | Abrir la URL | Copiar el `.apk` |
| Offline | Sí (service worker) | Sí (archivos adentro) |
| Cuándo usarlo | **Para iterar** | Para probar el instalable |

Como dijiste, el actualizador remoto del APK lo vemos en la beta.
