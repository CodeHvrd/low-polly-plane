# Compila el APK de PAPERCRASH usando el toolchain portable.
#
# Uso:  pwsh -File native\build.ps1
#
# ── Por qué NO se usa Gradle ──
# Gradle + el plugin de Android obligarían a bajar el wrapper y ~400 MB de
# dependencias, y a mantener un `build.gradle` que sólo hace cinco pasos. Las
# herramientas del SDK (`aapt2`, `d8`, `zipalign`, `apksigner`) hacen exactamente
# lo mismo y ya están en `.android-build/`.
#
# ── Los cinco pasos ──
#   1. aapt2 compile   → compila los recursos (XML, íconos) a .flat
#   2. aapt2 link      → empaqueta recursos + manifiesto en un APK base
#   3. javac           → compila el Java contra android.jar
#   4. d8              → convierte las clases a DEX (lo que Android ejecuta)
#   5. zipalign + apksigner → alinea y firma el APK

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$native = Join-Path $raiz "native"
$build = Join-Path $native "build"
$tool = Join-Path $raiz ".android-build"

# ── Toolchain ────────────────────────────────────────────────
$jdkHome = (Get-ChildItem (Join-Path $tool "jdk") -Directory | Select-Object -First 1).FullName
$sdk = Join-Path $tool "sdk"
$bt = Join-Path $sdk "build-tools\34.0.0"
$androidJar = Join-Path $sdk "platforms\android-34\android.jar"

$env:JAVA_HOME = $jdkHome
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk

$java = Join-Path $jdkHome "bin\java.exe"
$javac = Join-Path $jdkHome "bin\javac.exe"
$keytool = Join-Path $jdkHome "bin\keytool.exe"

foreach ($t in @($androidJar, (Join-Path $bt "aapt2.exe"), (Join-Path $bt "d8.bat"), (Join-Path $bt "zipalign.exe"), (Join-Path $bt "apksigner.bat"))) {
    if (-not (Test-Path $t)) { throw "Falta una herramienta: $t" }
}

Write-Host "`n=== Compilando PAPERCRASH ===" -ForegroundColor Cyan
Write-Host "  JDK: $jdkHome"

# ── Limpieza ─────────────────────────────────────────────────
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
foreach ($d in @("compiled", "classes", "dex")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $build $d) | Out-Null
}

# ── 1. Recursos ──────────────────────────────────────────────
Write-Host "`n  1/5 recursos (aapt2 compile)"
$res = Join-Path $native "res"
& (Join-Path $bt "aapt2.exe") compile --dir $res -o (Join-Path $build "compiled\res.zip")
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile falló" }

# ── 2. Link ──────────────────────────────────────────────────
Write-Host "  2/5 empaquetado (aapt2 link)"
$apkSinFirmar = Join-Path $build "app-unsigned.apk"
$assets = Join-Path $native "assets"
& (Join-Path $bt "aapt2.exe") link `
    -o $apkSinFirmar `
    -I $androidJar `
    --manifest (Join-Path $native "AndroidManifest.xml") `
    --min-sdk-version 24 `
    --target-sdk-version 34 `
    --version-code 1 `
    --version-name "1.0.0" `
    -A $assets `
    (Join-Path $build "compiled\res.zip")
if ($LASTEXITCODE -ne 0) { throw "aapt2 link falló" }

# ── 3. Java ──────────────────────────────────────────────────
Write-Host "  3/5 java (javac)"
$src = Join-Path $native "src"
$fuentes = Get-ChildItem $src -Recurse -Filter *.java | ForEach-Object { $_.FullName }
& $javac -source 8 -target 8 -bootclasspath $androidJar -classpath $androidJar -d (Join-Path $build "classes") @fuentes 2>&1 |
    Where-Object { $_ -notmatch "bootstrap class path|source value 8|target value 8|deprecat" } |
    ForEach-Object { "     $_" }
if ($LASTEXITCODE -ne 0) { throw "javac falló" }

# ── 4. DEX ───────────────────────────────────────────────────
Write-Host "  4/5 dex (d8)"
$clases = Get-ChildItem (Join-Path $build "classes") -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& (Join-Path $bt "d8.bat") --lib $androidJar --min-api 24 --output (Join-Path $build "dex") @clases 2>&1 |
    ForEach-Object { "     $_" }
if ($LASTEXITCODE -ne 0) { throw "d8 falló" }

# El DEX se mete DENTRO del APK con `aapt2 link`... que ya corrió. Se agrega acá
# con la herramienta `zip` de Java, que no depende de nada externo.
Write-Host "     agregando classes.dex al APK"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($apkSinFirmar, "Update")
$entry = $zip.GetEntry("classes.dex")
if ($entry) { $entry.Delete() }
[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
    $zip, (Join-Path $build "dex\classes.dex"), "classes.dex", "Optimal") | Out-Null
$zip.Dispose()

# ── 5. Alinear y firmar ──────────────────────────────────────
Write-Host "  5/5 alinear y firmar (zipalign + apksigner)"

# Alinear ANTES de firmar: firmar primero e alinear después invalida la firma.
$alineado = Join-Path $build "app-aligned.apk"
& (Join-Path $bt "zipalign.exe") -f -p 4 $apkSinFirmar $alineado
if ($LASTEXITCODE -ne 0) { throw "zipalign falló" }

$keystore = Join-Path $build "papercrash.keystore"
$alias = "papercrash"
$clave = "papercrash"

if (-not (Test-Path $keystore)) {
    Write-Host "     generando keystore"
    & $keytool -genkeypair -v `
        -keystore $keystore `
        -alias $alias `
        -keyalg RSA -keysize 2048 -validity 10000 `
        -storepass $clave -keypass $clave `
        -dname "CN=PaperCrash, OU=Game, O=PaperCrash, L=, S=, C=AR" 2>&1 |
        Where-Object { $_ -notmatch "^Generating|^$" } | ForEach-Object { "       $_" }
    if ($LASTEXITCODE -ne 0) { throw "keytool falló" }
}

$apkFinal = Join-Path $build "PaperCrash-1.0.0.apk"
& (Join-Path $bt "apksigner.bat") sign `
    --ks $keystore --ks-key-alias $alias `
    --ks-pass "pass:$clave" --key-pass "pass:$clave" `
    --out $apkFinal $alineado 2>&1 | ForEach-Object { "     $_" }
if ($LASTEXITCODE -ne 0) { throw "apksigner falló" }

# ── Verificación ─────────────────────────────────────────────
Write-Host "`n  verificando la firma"
& (Join-Path $bt "apksigner.bat") verify --print-certs $apkFinal 2>&1 |
    Select-Object -First 4 | ForEach-Object { "     $_" }

$info = Get-Item $apkFinal
Write-Host "`n=== APK listo ===" -ForegroundColor Green
Write-Host "  $($info.FullName)"
Write-Host "  $([math]::Round($info.Length / 1MB, 2)) MB"
Write-Host ""
Write-Host "  Instalar en un telefono conectado por USB (depuracion activada):"
Write-Host "    `$env:PATH += ';$sdk\platform-tools'"
Write-Host "    adb install -r `"$apkFinal`""
Write-Host ""
Write-Host "  O copiar el archivo al telefono y abrirlo (hay que permitir"
Write-Host "  'instalar apps de origen desconocido')."
Write-Host ""
