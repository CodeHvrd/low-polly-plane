/**
 * Inspecciona un archivo GLB sin dependencias: lee el header y el chunk JSON.
 *
 * Reporta lo que importa para integrarlo al juego: cantidad de triángulos,
 * materiales, escala real (para detectar si vino en centímetros) y dónde está el
 * pivote (si está en el centro o en la base).
 *
 * Uso: node tools/inspect-glb.mjs <archivo.glb>
 */
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const ruta = process.argv[2];
if (!ruta) {
  console.log('  uso: node tools/inspect-glb.mjs <archivo.glb>');
  process.exit(1);
}

const buf = readFileSync(ruta);
const kb = (statSync(ruta).size / 1024).toFixed(1);

// Header: magia "glTF", versión, largo total.
const magia = buf.readUInt32LE(0);
if (magia !== 0x46546c67) {
  console.log('  NO es un GLB válido');
  process.exit(1);
}
const version = buf.readUInt32LE(4);
const total = buf.readUInt32LE(8);

// Primer chunk: JSON.
const chunkLargo = buf.readUInt32LE(12);
const chunkTipo = buf.readUInt32LE(16);
if (chunkTipo !== 0x4e4f534a) {
  console.log('  el primer chunk no es JSON');
  process.exit(1);
}
const json = JSON.parse(buf.slice(20, 20 + chunkLargo).toString('utf8'));

console.log('  archivo:      ' + basename(ruta));
console.log('  tamaño:       ' + kb + ' KB   (glTF v' + version + ')');
console.log('  generador:    ' + (json.asset?.generator ?? '—'));

/* ── Nodos y transformaciones ── */
const nodos = json.nodes ?? [];
console.log('\n  nodos:        ' + nodos.length);
for (const n of nodos.slice(0, 8)) {
  const t = n.translation ? 'traslación=' + n.translation.map((v) => +v.toFixed(2)).join(',') : '';
  const s = n.scale ? 'escala=' + n.scale.map((v) => +v.toFixed(3)).join(',') : '';
  const r = n.rotation ? 'rotación' : '';
  const extra = [t, s, r].filter(Boolean).join('  ') || 'sin transformar';
  console.log('    · ' + (n.name ?? '(sin nombre)') + '   ' + extra);
}
if (nodos.length > 8) console.log('    … y ' + (nodos.length - 8) + ' más');

/* ── Mallas y triángulos ── */
const mallas = json.meshes ?? [];
const accesores = json.accessors ?? [];
let triangulos = 0;
let vertices = 0;
const camposPorMalla = [];

for (const m of mallas) {
  for (const p of m.primitives ?? []) {
    const pos = accesores[p.attributes?.POSITION];
    if (pos) vertices += pos.count;
    const idx = accesores[p.indices];
    if (idx) triangulos += idx.count / 3;
    else if (pos) triangulos += pos.count / 3;
  }
  camposPorMalla.push((m.name ?? '(sin nombre)') + ' → ' + (m.primitives?.length ?? 0) + ' primitiva(s)');
}

console.log('\n  mallas:       ' + mallas.length);
for (const c of camposPorMalla) console.log('    · ' + c);
console.log('  vértices:     ' + vertices);
console.log('  TRIÁNGULOS:   ' + Math.round(triangulos));

/* ── Materiales ── */
const mats = json.materials ?? [];
console.log('\n  materiales:   ' + mats.length);
for (const m of mats) {
  const pbr = m.pbrMetallicRoughness ?? {};
  const color = pbr.baseColorFactor
    ? '#' + pbr.baseColorFactor.slice(0, 3).map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')
    : '—';
  const emisivo = m.emissiveFactor && m.emissiveFactor.some((v) => v > 0)
    ? '  emisivo=#' + m.emissiveFactor.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')
    : '';
  const metal = pbr.metallicFactor ?? 1;
  const rug = pbr.roughnessFactor ?? 1;
  const textura = pbr.baseColorTexture ? '  CON TEXTURA' : '';
  console.log('    · ' + (m.name ?? '(sin nombre)') + '  color=' + color + '  metal=' + metal + '  rug=' + rug + emisivo + textura);
}

/* ── Caja envolvente: escala y pivote ── */
let min = [Infinity, Infinity, Infinity];
let max = [-Infinity, -Infinity, -Infinity];
for (const m of mallas) {
  for (const p of m.primitives ?? []) {
    const pos = accesores[p.attributes?.POSITION];
    if (!pos?.min || !pos?.max) continue;
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], pos.min[i]);
      max[i] = Math.max(max[i], pos.max[i]);
    }
  }
}

if (Number.isFinite(min[0])) {
  const tam = max.map((v, i) => v - min[i]);
  console.log('\n  caja envolvente (unidades del archivo):');
  console.log('    ancho  X: ' + tam[0].toFixed(2));
  console.log('    alto   Y: ' + tam[1].toFixed(2));
  console.log('    largo  Z: ' + tam[2].toFixed(2));
  console.log('    centro:   ' + min.map((v, i) => ((v + max[i]) / 2).toFixed(2)).join(', '));
  console.log('    piso:     ' + min[1].toFixed(2) + '   (0 = apoyado en el suelo)');

  const mayor = Math.max(...tam);
  console.log('\n  diagnóstico de escala:');
  if (mayor < 0.05) console.log('    ¡OJO! Muy chico. Probablemente en otra unidad; va a necesitar escalado.');
  else if (mayor > 500) console.log('    ¡OJO! Muy grande. Probablemente en centímetros: hay que dividir por 100.');
  else if (mayor > 40) console.log('    Grande para una aeronave: revisá si es un obstáculo o si vino en otra escala.');
  else console.log('    Razonable para una aeronave (unos metros). Coincide con 1 unidad = 1 metro.');

  console.log('\n  diagnóstico de pivote:');
  const centro = min.map((v, i) => (v + max[i]) / 2);
  if (Math.abs(centro[0]) < 0.5 && Math.abs(centro[2]) < 0.5) {
    if (Math.abs(centro[1]) < 0.5) console.log('    Centrado en el origen: ideal para AERONAVES (se rotan enteras).');
    else console.log('    Centrado en X/Z pero elevado en Y: revisar.');
  } else {
    console.log('    Descentrado en X/Z: hay que recentrarlo antes de usarlo.');
  }
  if (Math.abs(min[1]) < 0.5) console.log('    Base en y=0: ideal para OBSTÁCULOS (se apoyan en el terreno).');
}

console.log('\n  texturas:     ' + (json.images?.length ?? 0));
console.log('  animaciones:  ' + (json.animations?.length ?? 0));
