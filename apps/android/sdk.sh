#!/usr/bin/env bash
# La app de Mimoia en Android: el SDK de Android y Gradle en el Mac que la construye, sin brew ni Android Studio.
# Todo va a ~/.cache/mimoia (o a $MIMOIA_CACHE): se puede borrar entero sin tocar nada más del Mac.
# Idempotente: lo que ya está no se baja otra vez. Cada descarga se comprueba con su suma antes de abrirla.
# Uso: apps/android/sdk.sh           → al acabar imprime ANDROID_HOME=… y GRADLE=…
set -euo pipefail

BASE="${MIMOIA_CACHE:-$HOME/.cache/mimoia}"
SDK="$BASE/android-sdk"
GRADLE_VER=8.14.6
GRADLE_SHA256=7988ed071b2a07900e2ec715fca15c6ab72bce6db433af301fa7fa7e9407bd24
# cmdline-tools 23.0 (repository2-3.xml de dl.google.com, 2026-10-23)
case "$(uname -m)" in
  arm64) HERR=commandlinetools-mac_arm64-16111833_latest.zip; HERR_SHA1=ad03dc49bfacfd52c110b14104ea548b8a07e830 ;;
  *) echo "sdk.sh: solo para un Mac con Apple Silicon (arm64)" >&2; exit 2 ;;
esac
# build-tools 35.0.0: la que pide el Android Gradle Plugin 8.13 (si falta, Gradle la baja sola)
PAQUETES=("platform-tools" "platforms;android-36" "build-tools;35.0.0")

JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 17)}"
export JAVA_HOME
export ANDROID_USER_HOME="${ANDROID_USER_HOME:-$BASE/android-user}"
mkdir -p "$BASE/descargas"

bajar() { # bajar <url> <fichero> <algoritmo> <suma>
  local url=$1 f="$BASE/descargas/$2" alg=$3 suma=$4
  if [[ ! -f "$f" ]]; then curl -fsSL --retry 3 -o "$f.parcial" "$url" && mv "$f.parcial" "$f"; fi
  local real
  real=$(shasum -a "$alg" "$f" | cut -d' ' -f1)
  if [[ "$real" != "$suma" ]]; then echo "sdk.sh: la suma de $2 no cuadra ($real)" >&2; mv "$f" "$f.mala"; exit 1; fi
}

if [[ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]]; then
  bajar "https://dl.google.com/android/repository/$HERR" "$HERR" 1 "$HERR_SHA1"
  mkdir -p "$SDK/cmdline-tools/.tmp"
  unzip -q -o "$BASE/descargas/$HERR" -d "$SDK/cmdline-tools/.tmp"
  mv "$SDK/cmdline-tools/.tmp/cmdline-tools" "$SDK/cmdline-tools/latest"
fi

# Las licencias del SDK se aceptan aquí (corre sin nadie delante); sin ellas Gradle no compila.
yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" --licenses >/dev/null 2>&1 || true
"$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" --install "${PAQUETES[@]}" >/dev/null 2>&1 ||
  { echo "sdk.sh: sdkmanager no pudo instalar ${PAQUETES[*]} (córrelo a mano para ver por qué)" >&2; exit 1; }

if [[ ! -x "$BASE/gradle-dist/gradle-$GRADLE_VER/bin/gradle" ]]; then
  bajar "https://services.gradle.org/distributions/gradle-$GRADLE_VER-bin.zip" "gradle-$GRADLE_VER-bin.zip" 256 "$GRADLE_SHA256"
  mkdir -p "$BASE/gradle-dist"
  unzip -q -o "$BASE/descargas/gradle-$GRADLE_VER-bin.zip" -d "$BASE/gradle-dist"
fi

echo "ANDROID_HOME=$SDK"
echo "GRADLE=$BASE/gradle-dist/gradle-$GRADLE_VER/bin/gradle"
