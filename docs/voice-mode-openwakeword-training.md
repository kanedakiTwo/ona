# Entrenar el wake-word "Hola Ona" con openWakeWord

Esta guía cubre cómo generar el modelo `hola_ona.onnx` que ONA carga en
el cliente (`apps/web/public/wakewords/openwakeword/`) para detectar la
frase "Hola Ona" sin enviar audio a ningún servidor.

El runtime en browser ya está implementado y usa tres ficheros ONNX:

| Fichero | Origen | Tamaño |
|---|---|---|
| `melspectrogram.onnx` | release oficial v0.5.1 del repo `dscripka/openWakeWord` | ~1.1 MB |
| `embedding_model.onnx` | release oficial v0.5.1 | ~1.3 MB |
| `hola_ona.onnx` | **lo entrenas tú con esta guía** | ~1.2 MB |

Los dos primeros son genéricos y ya están comprometidos en el repo. El
tercero hay que entrenarlo.

## Opciones de entrenamiento

| Opción | Tiempo | GPU | Calidad |
|---|---|---|---|
| **A. Colab gratis (T4)** | ~30 min | sí | buena con voces sintéticas |
| **B. Local sin GPU** | ~3 h | no | igual; sólo es lento |
| **C. Colab + tus muestras** | +15 min | sí | mejor para tu voz/acento |

Recomendado: empezar por A, escuchar resultados en local, y si la
detección de tu voz es floja repetir con C.

## Opción A — Colab con muestras sintéticas (Piper TTS)

openWakeWord trae un script (`automatic_model_training.ipynb`) que:

1. Sintetiza ~1000 muestras de la frase objetivo variando voces y ruido
   con Piper TTS y una colección de "negativos" (audios de fondo, ASR
   datasets, ruido ambiente).
2. Entrena un clasificador binario sobre los embeddings del modelo
   `embedding_model.onnx`.
3. Exporta el `.onnx` final.

### Pasos

1. Abre el notebook oficial:
   [`automatic_model_training.ipynb`](https://github.com/dscripka/openWakeWord/blob/main/notebooks/automatic_model_training.ipynb)
2. Runtime → Change runtime type → **T4 GPU**.
3. En la celda de configuración:
   ```python
   target_phrase = ["hola ona"]
   target_phrase_alt = ["hola, ona", "hola Ona"]  # variantes ortográficas/entonación
   language = "es"  # español
   model_name = "hola_ona"
   ```
4. Aumenta `n_samples` si el resultado es flojo:
   ```python
   n_samples = 2000  # default 1000
   n_samples_val = 200
   ```
5. Ejecuta todas las celdas. Tarda 25-40 min en T4.
6. Al final, descarga `hola_ona.onnx` del panel de archivos de Colab.

### Validación rápida en Colab

Antes de bajar el modelo, el notebook imprime metrics:

- **Recall** (qué % de "hola ona" detecta): debe ser > 0.85
- **FPR** (false positives/hora con audio normal): debe ser < 1
- **Threshold sugerido**: si el notebook propone algo distinto de 0.5,
  apunta el valor — habrá que ajustar `SCORE_THRESHOLD` en
  [openWakeWord.ts](../apps/web/src/lib/wakeword/openWakeWord.ts).

## Opción C — Colab + 50 muestras tuyas

Si la detección con A funciona pero falla con tu acento, añade
~50 grabaciones tuyas en el notebook:

1. Graba 50 clips de 1-2s diciendo "hola ona" con variaciones (susurro,
   tono normal, con prisa, con ruido de fondo, etc.). Móvil + WhatsApp
   está bien. Guarda como WAV 16 kHz mono.
2. Súbelos a Colab y modifica la celda de muestras positivas:
   ```python
   import glob
   custom_positives = glob.glob('/content/mis_muestras/*.wav')
   positive_clips = synthetic_positives + custom_positives
   ```
3. El resto del flujo es idéntico.

## Subir el modelo a ONA

1. Coloca el `.onnx` descargado en:
   `apps/web/public/wakewords/openwakeword/hola_ona.onnx`
2. Si el threshold sugerido por el notebook no es `0.5`, edita
   `SCORE_THRESHOLD` en `apps/web/src/lib/wakeword/openWakeWord.ts`.
3. Despliega:
   ```bash
   railway up --service ona-web
   ```
4. Configura el engine en Railway:
   ```bash
   railway variables --set NEXT_PUBLIC_WAKE_WORD_ENGINE=openwakeword --service ona-web
   ```
5. Activa "Modo voz" → sub-toggle "Hola Ona" en `/profile`.

## Logs útiles en producción

El cliente loguea cada paso con prefijo `[voice]`. Para diagnosticar:

```js
// En la consola del browser
performance.getEntriesByType('resource').filter(r => r.name.includes('wakewords'))
// → confirma que los .onnx cargan con HTTP 200
```

## Swap a Porcupine (por si acaso)

El runtime mantiene ambos backends. Para volver a Porcupine si
openWakeWord no rinde:

```bash
railway variables --set NEXT_PUBLIC_WAKE_WORD_ENGINE=porcupine --service ona-web
railway variables --set NEXT_PUBLIC_PICOVOICE_ACCESS_KEY=<key> --service ona-web
```

`useWakeWord` decide qué motor arrancar en base a la env var.

## Tamaño total en el cliente

Los tres ONNX suman ~3.7 MB. Para evitar coste de descarga en first
load, el bundle de openWakeWord se carga dinámicamente sólo cuando el
modo voz está activo y el toggle "Hola Ona" está encendido. El service
worker (PWA) cachea los modelos en la segunda visita.
