# ClaroIA: una herramienta portable para trabajar con modelos de lenguaje sin perder el control

ClaroIA nace con una idea sencilla: hacer que comparar, resumir y evaluar respuestas de modelos de lenguaje sea util de verdad, no solo una demo visual. La aplicacion permite pegar textos, cargar lotes de documentos, probar varios modelos, juzgar la calidad de las respuestas y exportar resultados para seguir trabajando con ellos.

El objetivo de esta primera version publica es claro: una herramienta practica, local-first, portable en Windows y disponible tambien como demo web BYOK, es decir, "bring your own key". El usuario decide que proveedor usar y aporta su propia clave API en su sesion.

## Para que sirve

ClaroIA esta pensada para equipos que necesitan evaluar resultados de LLMs con criterio:

- Resumir documentos y comparar salidas entre modelos.
- Probar prompts y parametros de generacion.
- Procesar datasets en lote desde CSV, TXT, Markdown, JSON o PDF.
- Evaluar resumenes con un LLM juez usando criterios ponderados.
- Exportar resultados en formatos reutilizables como CSV, JSONL y datasets estilo SFT/RL/DPO.
- Trabajar con modelos cloud compatibles con OpenAI o con modelos locales como LM Studio.

En la practica, sirve para pasar de "este modelo parece bueno" a una comparacion mas sistematica: mismo texto, mismas reglas, varios modelos, evaluacion y trazabilidad.

## Como se ha hecho

La aplicacion se ha construido con una arquitectura deliberadamente simple:

- Frontend React + Vite para una experiencia rapida y facil de publicar.
- Electron para generar un ZIP portable de Windows que no exige instalar Node.js, npm ni dependencias tecnicas.
- Netlify Functions para una demo publica minima que evita problemas de CORS y aplica controles de seguridad.
- Integracion con APIs compatibles con OpenAI para no atarse a un unico proveedor.
- Modo local para permitir endpoints `localhost`, util con LM Studio u otros servidores privados.

La version publica prioriza estabilidad y seguridad sobre acumular formatos o funciones. Por eso Excel y DOCX estan desactivados en esta build: los parsers usados anteriormente estaban marcados por `npm audit` con vulnerabilidades de alta severidad sin una solucion npm segura. En su lugar, se recomienda exportar hojas de calculo como CSV y documentos Word como TXT o PDF.

## Por que se ha hecho asi

La decision principal es ser local-first y BYOK.

Local-first significa que la herramienta no necesita una cuenta central ni una base de datos remota para ser util. El usuario puede ejecutar la version portable, configurar su endpoint y trabajar con sus textos desde su maquina.

BYOK significa que la demo publica no guarda ni proporciona una clave propia del proyecto. Cada usuario introduce su API key en la sesion y el backend minimo solo la reenvia al proveedor elegido. Esto reduce riesgos operativos, evita costes ocultos y deja claro quien controla el proveedor y el gasto.

Tambien se ha hecho asi para mantener una frontera de privacidad clara:

- El historial no se guarda por defecto.
- Las claves API no se persisten en snapshots de historial.
- La demo Netlify rechaza endpoints no HTTPS, redes privadas y destinos fuera de allowlist.
- Electron bloquea navegaciones inesperadas y usa sandbox de renderer.
- El worker de PDF.js va empaquetado localmente, sin CDN externo.
- El Privacy Filter opcional puede enmascarar PII localmente antes de llamar a un LLM. En modo `mask`, si el sidecar local no esta disponible o falla, la operacion se bloquea en vez de enviar texto original.
- En lotes, el texto fuente y el resumen de referencia se tratan como superficies independientes: ambos deben estar escaneados y enmascarados antes de juzgar o exportar en modo `mask`.
- Las exportaciones se bloquean si los resultados fueron generados antes de activar el enmascarado, para evitar reutilizar outputs antiguos que puedan contener PII copiada del texto original.
- El artefacto con Privacy Filter empaquetado fija una revision concreta del modelo y verifica hashes antes de publicar el ZIP.
- El workbench permite marcar filas como pendientes, aprobadas o rechazadas antes de preparar datasets SFT.

El resultado es una aplicacion que puede publicarse sin convertir el servidor en un proxy abierto ni pedir a los usuarios que confien ciegamente en almacenamiento remoto.

## Como usarlo en local

1. Descargar el ZIP portable de Windows.
2. Extraerlo en una carpeta.
3. Ejecutar `ClaroIA.exe`.
4. Elegir proveedor:
   - Cloud API, por ejemplo OpenAI, OpenRouter, Groq o DeepSeek.
   - Local LLM, por ejemplo LM Studio en `http://localhost:1234/v1/chat/completions`.
5. Introducir modelo, endpoint y clave API si hace falta.
6. Pegar un texto o cargar un lote.
7. Generar, comparar, juzgar y exportar.

La version portable no requiere instalar Node.js ni ejecutar comandos.

## Como usar la demo online

1. Abrir la demo desplegada en Netlify.
2. Seleccionar un endpoint permitido.
3. Introducir una API key propia.
4. Trabajar igual que en local, teniendo en cuenta que la demo publica solo permite endpoints HTTPS de la lista configurada.

La demo no esta pensada para guardar datos ni para custodiar secretos. Es una forma rapida de probar la herramienta con una clave propia y una configuracion controlada.

## Que la hace util

La utilidad de ClaroIA no esta en generar un unico resumen, sino en cerrar el ciclo completo:

- Entrada de texto o lotes.
- Configuracion de modelos.
- Comparacion de salidas.
- Evaluacion con criterios.
- Exportacion para analisis o entrenamiento posterior.

Esto ahorra tiempo cuando hay que revisar muchos textos, comparar proveedores, medir prompts o construir datasets de evaluacion. En vez de hacer pruebas manuales dispersas, la herramienta da una superficie comun para experimentar y decidir.

## Buenas decisiones de la v1

La v1 evita prometer mas de lo que puede sostener:

- Windows portable primero, porque es facil de distribuir a usuarios no tecnicos.
- Demo web BYOK, porque permite probar sin desplegar infraestructura pesada.
- Backend minimo, porque menos servidor significa menos superficie de ataque.
- Formatos de importacion seguros y auditables.
- Historial privado por defecto.
- Documentacion explicita sobre limites, privacidad y seguridad.

Esta combinacion hace que ClaroIA sea una herramienta publicable, entendible y util desde el primer dia, con una base razonable para crecer sin comprometer la confianza del usuario.
