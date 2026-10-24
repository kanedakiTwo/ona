#!/usr/bin/env bash
# La app de Mimoia en Android: construye y firma con la clave de subida, en apps/android/dist/:
#   mimoia-pruebas-<versionCode>.apk + mimoia-pruebas.json   la build interna (staging), para instalarla por descarga
#   mimoia-tienda-<versionCode>.aab                         lo que se sube a Google Play (Play App Signing la firma)
#   huella-subida.txt                                       la huella SHA-256 de la clave de subida (para assetlinks.json)
# La clave de subida vive fuera del repo, en ~/.config/mimoia/firmas/: este script la crea la primera vez y nunca
# imprime su contraseña. Si se pierde, Google la cambia (Play Console → Integridad de la app); no va a ningún repo.
# Uso: apps/android/construir.sh        (MIMOIA_FIRMAS=<carpeta> para probar con otro almacén)
set -euo pipefail
cd "$(dirname "$0")"

while IFS='=' read -r k v; do export "$k=$v"; done < <(./sdk.sh | grep -E '^(ANDROID_HOME|GRADLE)=')
JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 17)}"
export JAVA_HOME
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$HOME/.cache/mimoia/gradle-home}"
export ANDROID_USER_HOME="${ANDROID_USER_HOME:-$HOME/.cache/mimoia/android-user}"

FIRMAS="${MIMOIA_FIRMAS:-$HOME/.config/mimoia/firmas}"
ALMACEN="$FIRMAS/mimoia-app-subida.p12"
CLAVE="$FIRMAS/mimoia-app-subida.clave"
if [[ ! -f $ALMACEN ]]; then
  mkdir -p "$FIRMAS"
  chmod 700 "$FIRMAS"
  (umask 077 && openssl rand -hex 24 >"$CLAVE")
  MIMOIA_FIRMA_CLAVE=$(<"$CLAVE") "$JAVA_HOME/bin/keytool" -genkeypair -keystore "$ALMACEN" -storetype PKCS12 -alias subida \
    -keyalg RSA -keysize 3072 -validity 10000 -dname "CN=Mimoia, C=ES" \
    -storepass:env MIMOIA_FIRMA_CLAVE -keypass:env MIMOIA_FIRMA_CLAVE >/dev/null 2>&1
  chmod 600 "$ALMACEN"
fi
MIMOIA_FIRMA_CLAVE=$(<"$CLAVE")
export MIMOIA_FIRMA_CLAVE MIMOIA_FIRMA_ALMACEN="$ALMACEN"
# versionCode: minutos desde el 1-ene-2026, siempre creciente sin depender de git (Google Play pide uno mayor cada vez)
MIMOIA_VERSION_CODE=$((($(date +%s) - 1767225600) / 60))
export MIMOIA_VERSION_CODE

"$GRADLE" --no-daemon -q -p . assemblePruebasRelease bundleTiendaRelease

mkdir -p dist
APK="mimoia-pruebas-$MIMOIA_VERSION_CODE.apk"
cp app/build/outputs/apk/pruebas/release/app-pruebas-release.apk "dist/$APK"
cp app/build/outputs/bundle/tiendaRelease/app-tienda-release.aab "dist/mimoia-tienda-$MIMOIA_VERSION_CODE.aab"
SUMA=$(shasum -a 256 "dist/$APK" | cut -d' ' -f1)
printf '{"versionCode":%s,"apk":"%s","sha256":"%s"}\n' "$MIMOIA_VERSION_CODE" "$APK" "$SUMA" >dist/mimoia-pruebas.json

HUELLA=$("$JAVA_HOME/bin/keytool" -list -v -keystore "$ALMACEN" -alias subida -storepass:env MIMOIA_FIRMA_CLAVE 2>/dev/null |
  sed -n 's/^[[:space:]]*SHA256: //p' | head -1)
[[ $HUELLA =~ ^([0-9A-F]{2}:){31}[0-9A-F]{2}$ ]] || { echo "construir.sh: no sale la huella SHA-256 de la clave de subida" >&2; exit 1; }
echo "$HUELLA" >dist/huella-subida.txt

echo "dist/$APK y dist/mimoia-tienda-$MIMOIA_VERSION_CODE.aab"
echo "huella de la clave de subida: $HUELLA"
