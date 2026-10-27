// La app de Mimoia en Android: una Trusted Web Activity de la web, sin código propio.
// Dos sabores: «pruebas» abre staging (build interna, se instala aparte) y «tienda» abre mimoia.com (Google Play).
// La firma de subida llega de construir.sh por el entorno, nunca escrita aquí; la de la tienda la guarda Google.
plugins {
    id("com.android.application")
}

val codigo = (System.getenv("MIMOIA_VERSION_CODE") ?: "1").toInt()

fun declaracion(origen: String) =
    """[{\"relation\":[\"delegate_permission/common.handle_all_urls\"],\"target\":{\"namespace\":\"web\",\"site\":\"$origen\"}}]"""

android {
    namespace = "com.mimoia.app"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.mimoia.app"
        minSdk = 26
        targetSdk = 36
        versionCode = codigo
        versionName = "1.$codigo"
    }
    flavorDimensions += "entorno"
    productFlavors {
        create("pruebas") {
            dimension = "entorno"
            applicationIdSuffix = ".pruebas"
            manifestPlaceholders["host"] = "ona-web-staging.up.railway.app"
            resValue("string", "nombre", "Mimoia (pruebas)")
            resValue("string", "url_inicio", "https://ona-web-staging.up.railway.app/menu?app=android")
            resValue("string", "asset_statements", declaracion("https://ona-web-staging.up.railway.app"))
        }
        create("tienda") {
            dimension = "entorno"
            manifestPlaceholders["host"] = "mimoia.com"
            resValue("string", "nombre", "Mimoia")
            resValue("string", "url_inicio", "https://mimoia.com/menu?app=android")
            resValue("string", "asset_statements", declaracion("https://mimoia.com"))
        }
    }
    signingConfigs {
        create("subida") {
            System.getenv("MIMOIA_FIRMA_ALMACEN")?.let { storeFile = file(it) }
            storePassword = System.getenv("MIMOIA_FIRMA_CLAVE")
            keyAlias = "subida"
            keyPassword = System.getenv("MIMOIA_FIRMA_CLAVE")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("subida")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.4")
}
