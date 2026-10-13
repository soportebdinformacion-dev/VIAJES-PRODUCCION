# Registro de Salidas & Retornos – Agrícola Huarmey
Guía de instalación (sin conocimientos de programación)

## 1. Qué contiene la carpeta

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La aplicación completa (pantalla, iconos, búsqueda, modo sin internet). |
| `service-worker.js` | Permite abrir la app sin internet. |
| `manifest.json` | Permite instalarla como app en el celular. |
| `Codigo.gs` | El "cerebro" que se pega en Google Apps Script y guarda en Google Sheets. |
| `membrete.png` | Su membrete (se muestra arriba, con sus proporciones originales). |
| `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | Iconos de la app (los pide el manifest.json). |

> Los iconos y `membrete.png` son archivos adicionales necesarios: sin ellos la app no se puede instalar ni mostrar el encabezado. **Todos los archivos deben subirse juntos, en la misma carpeta.**

**Cómo funciona (resumen):** el teléfono descarga la lista de colaboradores y la guarda localmente. Cada registro se guarda primero en el teléfono y luego se envía a Apps Script, que lo escribe en Google Sheets. Si no hay internet, queda "Pendiente" y se envía solo al volver la conexión. Cada registro tiene un identificador único, así que un reintento nunca se guarda dos veces.

---

## 2. Preparar el Google Sheets "REGISTROS VIAJES"

1. Abra el archivo **REGISTROS VIAJES**.
2. Verifique que existan **dos hojas** con estos nombres exactos (minúsculas):
   - `maestros` → columnas: `DNI`, `APELLIDOS Y NOMBRES`, `CELULAR`
   - `packing` → columnas A–G: `FECHA REGISTRO`, `DNI`, `NOMBRES Y APELLIDOS`, `CELULAR`, `AREA`, `RUTA SALIDA`, `RUTA RETORNO`
3. No cambie esos nombres ni el orden. La app agregará 3 columnas de control a la derecha en `packing`: `ID REGISTRO` (evita duplicados), `ORIGEN` (EN LINEA / DIFERIDO) y `FECHA SINCRONIZACION`.
4. Copie el **ID del archivo**: en la barra del navegador, es el texto largo entre `/d/` y `/edit`.
   Ejemplo: `https://docs.google.com/spreadsheets/d/`**`1AbC...xyz`**`/edit`

> Nota: en la hoja `packing` el campo AREA se guarda **sin emoji** (por ejemplo `ALMACÉN`) para que sea fácil de filtrar en Excel o Power BI.

## 3. Crear el backend en Google Apps Script

1. En el Google Sheets: menú **Extensiones → Apps Script**.
2. Borre el código de ejemplo y pegue **todo** el contenido de `Codigo.gs`.
3. En la parte de arriba, reemplace `PEGAR_AQUI_EL_ID_DEL_GOOGLE_SHEETS` por el ID copiado (deje las comillas).
4. Clic en **Guardar** (icono de disquete).
5. En la barra superior elija la función **`configurarHojas`** y presione **Ejecutar**.
   - La primera vez Google pide permisos: **Revisar permisos → su cuenta → Configuración avanzada → Ir a (proyecto) → Permitir**.
   - Esto deja DNI y CELULAR como texto (conserva ceros iniciales) y fija la zona horaria del archivo en Lima.
6. (Opcional) Ejecute `probarHorario` y revise el registro: debe mostrar la hora de Lima.

## 4. Publicar el backend y obtener la URL

1. Botón **Implementar → Nueva implementación**.
2. Tipo: **Aplicación web**.
3. **Ejecutar como:** *Yo* · **Quién tiene acceso:** *Cualquier persona*.
4. **Implementar** y copie la **URL de la aplicación web** (termina en `/exec`).
5. Si luego modifica `Codigo.gs`: **Implementar → Administrar implementaciones → editar (lápiz) → Versión: Nueva versión → Implementar**. La URL no cambia.

## 5. Conectar la app con Apps Script

1. Abra `index.html` con el Bloc de notas.
2. Busque `APPS_SCRIPT_URL` y reemplace `PEGAR_AQUI_LA_URL_DE_APPS_SCRIPT` por su URL `/exec` (deje las comillas).
3. Guarde el archivo.

**Datos que debe reemplazar con los suyos (solo 2):**
| Dónde | Qué |
|---|---|
| `Codigo.gs` → `SPREADSHEET_ID` | ID de su Google Sheets |
| `index.html` → `APPS_SCRIPT_URL` | URL `/exec` de su implementación |

`service-worker.js` y `manifest.json` no necesitan cambios. Solo si modifica `index.html` más adelante, cambie `VERSION = 'v1'` por `'v2'` en `service-worker.js` para que los teléfonos descarguen la versión nueva.

## 6. Alojar la app con HTTPS

Una PWA **solo se instala y funciona sin internet desde una dirección HTTPS**. Opciones gratuitas:

**Opción A – Netlify Drop (la más simple):** entre a `app.netlify.com/drop`, arrastre la **carpeta completa** y obtendrá un enlace `https://…netlify.app`. Puede cambiar el nombre del enlace en el panel.

**Opción B – GitHub Pages:** cree un repositorio, suba todos los archivos, y en *Settings → Pages* active la publicación de la rama principal. El enlace será `https://usuario.github.io/repositorio/`.

> La app usa rutas relativas, por lo que funciona tanto en la raíz como en una subcarpeta.
> Abrir `index.html` con doble clic en la computadora **no** activa el modo sin internet ni la instalación.

## 7. Instalar en el celular o la computadora

- **Android (Chrome):** abra el enlace → botón **Instalar app** (aparece en la app) o menú ⋮ → *Instalar aplicación / Agregar a pantalla principal*.
- **iPhone (Safari):** botón Compartir → *Agregar a pantalla de inicio*.
- **Computadora (Chrome/Edge):** icono de instalar en la barra de direcciones.

**Muy importante:** abra la app **una vez con internet** en cada teléfono para que descargue la lista de colaboradores. Desde entonces puede usarse sin conexión.

## 8. Pruebas obligatorias

> El formulario solo está abierto **miércoles** y **jueves hasta las 5:00 p. m.** Para probar fuera de ese horario, cambie temporalmente en `Codigo.gs` la función `estaHabilitado` a `return true;` y en `index.html` la línea `const abierto = ...` de `estadoHorario` a `const abierto = true;` (¡y devuélvalas al original al terminar!).

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Escribir un DNI completo (ej. `42048377`) | Aparece el colaborador. |
| 2 | Escribir parte del DNI (ej. `481325`) | Aparece `00481325` (con ceros). |
| 3 | Escribir `jose chavez julca`, `CHAVEZ`, `jose` | Aparecen coincidencias; el orden de las palabras no importa. |
| 4 | Escribir sin tildes (`gestion`, `jose`) y en mayúsculas/minúsculas | Mismo resultado. |
| 5 | Buscar algo inexistente | Mensaje "No se encontró…" y botón **+ REGISTRAR NUEVO COLABORADOR**. |
| 6 | Registrar un colaborador nuevo (DNI 8 dígitos, nombre, celular 9xxxxxxxx) | Aparece en la hoja `maestros` y queda seleccionado. |
| 7 | Intentar registrar un DNI ya existente | Aviso "ya está registrado" y opción **Usar este colaborador**; no se duplica. |
| 8 | Elegir rutas distintas de salida y retorno | Se guardan ambas en F y G. |
| 9 | Elegir **NINGUNO** | Se guarda `NINGUNO`. |
| 10 | Guardar un registro con internet | Mensaje verde "guardado y sincronizado"; fila nueva en `packing` con fecha de Lima. |
| 11 | Activar modo avión → guardar un registro | Mensaje ámbar "pendiente"; el contador muestra "1 pendiente". |
| 12 | Desactivar modo avión | Se sincroniza solo; el contador baja a 0; aparece 1 fila. |
| 13 | Tocar varias veces GUARDAR / reintentar | Una sola fila (el botón se bloquea y el ID único evita duplicados). |
| 14 | Probar fuera del horario permitido | Se ve "🔒 EL PLAZO DE REGISTRO HA FINALIZADO." con la próxima fecha, y el formulario no se puede usar. |
| 15 | Registrar sin internet el jueves 4:30 p. m. y conectar el viernes | Se acepta (creado dentro del plazo), con ORIGEN = DIFERIDO. |
| 16 | Probar en un teléfono Android real, instalado y con internet apagado | La app abre y permite buscar y guardar. |

## 9. Seguridad y limitaciones (léalo)

**Qué hace la app:**
- El horario se valida en la pantalla **y** en Apps Script (hora de Lima del servidor). Modificar el navegador no permite registrar fuera de horario cuando hay internet.
- Con internet, la app corrige el reloj del teléfono con la hora del servidor.
- `LockService` ordena los envíos simultáneos; el ID único evita duplicados.
- No hay contraseñas ni claves dentro del HTML.

**Limitaciones que debe conocer:**
1. **Un endpoint de Apps Script con acceso "Cualquier persona" es público**: quien tenga la URL puede consultarlo. Esa URL va dentro de la app, así que no es secreta.
2. **La lista de colaboradores contiene DNI y celulares** (datos personales). Se recomienda activar el código de acceso:
   - En Apps Script: ⚙ **Configuración del proyecto → Propiedades de la secuencia de comandos → Agregar propiedad**: nombre `CODIGO_ACCESO`, valor = el código que usted elija.
   - La app lo pedirá una sola vez en cada teléfono. El código **no** está en el HTML, pero cualquier persona que lo conozca puede usarlo: compártalo solo con el personal autorizado y cámbielo si se filtra.
3. **Registros sin internet:** el servidor no puede comprobar la hora real de un teléfono desconectado. Por eso solo acepta registros cuya fecha de creación caiga en el horario permitido y que lleguen dentro de `GRACIA_SYNC_HORAS` (72 h, ajustable en `Codigo.gs`). Una persona que adelante manualmente el reloj de su teléfono estando sin internet podría crear un registro "dentro del plazo". Revise la columna `ORIGEN` (DIFERIDO) y las fechas atípicas. Si desea más rigor, reduzca `GRACIA_SYNC_HORAS` (por ejemplo, a 24).
4. A las 17:00:00 en punto el formulario ya está cerrado (último segundo válido: 16:59:59).
5. Haga una copia de seguridad del Sheets de forma periódica (*Archivo → Historial de versiones*).
6. Los iPhone pueden borrar los datos locales de una web si no se usa en varias semanas; instale la app y ábrala con internet antes de cada semana de pago.

## 10. Problemas frecuentes

| Síntoma | Solución |
|---|---|
| Banner rojo "Falta configurar la aplicación" | Pegue la URL `/exec` en `APPS_SCRIPT_URL` y vuelva a subir `index.html`. |
| "El servidor no respondió como se esperaba" | La implementación debe ser *Ejecutar como: Yo* y *Acceso: Cualquier persona*; use la URL de la última implementación. |
| La lista de colaboradores está vacía | Abra la app con internet; verifique que la hoja se llame `maestros`. |
| Cambié el HTML pero el celular muestra lo anterior | Cambie `VERSION` en `service-worker.js`, vuelva a subir y abra la app con internet dos veces. |
| Error "COLABORADOR_NO_EXISTE" | El DNI no está en `maestros`; regístrelo como nuevo colaborador. |

## 11. Desactivar la app con una fecha manual

1. Abra el Google Sheets y vaya a la hoja **`config`** (la crea `configurarHojas`; si ya la ejecutó antes, vuelva a ejecutarla una vez).
2. En la celda **B1** escriba la fecha y hora desde la cual la app queda desactivada, por ejemplo `16/10/2026 17:00` (hora de Perú). Si escribe solo la fecha, se desactiva desde las 00:00 de ese día.
3. Desde ese momento la app muestra "🔒 EL PLAZO DE REGISTRO HA FINALIZADO." y bloquea nuevos registros, aunque sea miércoles o jueves. El servidor también lo rechaza.
4. Para volver a activarla, **borre la celda B1** o escriba una fecha posterior.

- No necesita volver a publicar el script ni subir archivos: los teléfonos con internet se actualizan en cerca de 1 minuto.
- Los registros hechos antes de esa fecha (incluso sin internet) siguen sincronizándose.
- Si hizo cambios en `Codigo.gs`, publique una **nueva versión** (sección 4, paso 5). Los teléfonos recibirán el cambio en `index.html` al abrir la app con internet (`VERSION` ya quedó en `v6`).

### Habilitar la app manualmente (fuera de miércoles y jueves)

En la hoja **`config`** (ejecute `configurarHojas` otra vez para que aparezca la fila nueva):

| Celda | Qué hace |
|---|---|
| **B2 – FECHA Y HORA DE HABILITACION** | Desde esa fecha/hora la app queda **abierta** aunque no sea miércoles ni jueves. Para habilitarla **ahora**, escriba una fecha y hora ya pasadas (ej. la de hoy a las 00:00). |
| **B1 – FECHA Y HORA DE DESACTIVACION** | Desde esa fecha/hora la app queda **cerrada**. Tiene prioridad sobre B2 y sobre el horario normal. |

Ejemplo: B2 = `12/10/2026 08:00` y B1 = `13/10/2026 18:00` → la app está abierta desde el lunes 12 a las 8:00 hasta el martes 13 a las 18:00.
Si deja B2 con una fecha pasada y B1 vacío, la app **seguirá abierta**; para volver al horario normal, borre B2.


## 12. Pestaña "Registros" (solo visualización)

La app tiene dos pestañas: **Registrar** y **Registros**. La segunda muestra únicamente **DNI**, **APELLIDOS Y NOMBRES** y **FECHA DE REGISTRO** (dd/mm/aaaa hh:mm, hora de Perú) de quienes ya tienen un registro guardado, con el mismo buscador (parcial, sin tildes ni mayúsculas, por DNI o por nombre). No muestra celular, área ni rutas, y no permite modificar nada.

- Muestra los registros de la **semana de pago actual** (desde el último miércoles 00:00, hora de Perú), una sola vez por DNI (si hay varios registros del mismo DNI, se muestra la fecha del más reciente). Para ver **todos** los registros históricos, cambie `SOLO_SEMANA_ACTUAL: true` a `false` en `Codigo.gs`.
- Si un colaborador guardó su registro sin internet, aparece en su teléfono con la etiqueta **"por enviar"** hasta que se sincronice.
- Sin internet se muestra la última lista descargada, con su fecha.
- Se puede abrir directo con el enlace de la app terminado en `#registros`.
- Si activó `CODIGO_ACCESO`, esta pestaña también lo exige (los nombres y DNI son datos personales).
- Después de pegar el nuevo `Codigo.gs`, publique una **nueva versión** (sección 4, paso 5) y suba otra vez `index.html` y `service-worker.js`.


## 13. Modificar rutas desde "Registros" (máximo 2 intentos)

En la pestaña **Registros** cada persona se ve con: DNI, APELLIDOS Y NOMBRES, FECHA DE REGISTRO, **RUTA SALIDA**, **RUTA RETORNO** y el botón **Modificar**.

**Cómo funciona**
1. El colaborador toca **Modificar**, cambia la ruta de salida y/o la de retorno y escribe su **celular** para confirmar que el registro es suyo.
2. Al guardar, la app actualiza las columnas **RUTA SALIDA** y **RUTA RETORNO** de la hoja `packing`.
3. Cada registro tiene **2 modificaciones** (`MAX_MODIFICACIONES` en `Codigo.gs`). Solo se gasta un intento cuando el cambio se guarda de verdad. Si el celular es incorrecto, si no hay cambios o si falla la conexión, **no se gasta intento**.
4. Con las 2 modificaciones usadas, el botón queda **gris y bloqueado ("Bloqueado – Sin intentos")** y el servidor rechaza cualquier cambio posterior, aunque alguien intente saltarse la pantalla.

**Reglas**
- Solo se puede modificar con **internet** y con el formulario **habilitado** (miércoles/jueves hasta las 5:00 p. m., o según su fecha manual de la hoja `config`). Fuera de ese plazo el botón aparece deshabilitado.
- Solo se pueden modificar registros de la **semana de pago actual**.
- Se modifica el registro **más reciente** de cada DNI (el que se ve en la lista). Los registros "por enviar" se podrán modificar cuando se sincronicen.
- Tras 5 celulares incorrectos para un mismo DNI, se bloquea 10 minutos. Si no quiere pedir el celular, ponga `PEDIR_CELULAR_PARA_MODIFICAR: false` (cualquiera podría modificar el registro de otro; no se recomienda).

**Hoja `packing`: columnas nuevas** (ejecute `configurarHojas` otra vez para que se agreguen los encabezados)

| Columna | Contenido |
|---|---|
| K · MODIFICACIONES | Cuántas veces se modificó (0, 1 o 2). |
| L · FECHA ULTIMA MODIFICACION | Fecha y hora del último cambio. |
| M · HISTORIAL MODIFICACIONES | Cada cambio: fecha, ruta anterior y ruta nueva. |

**Para actualizar:** pegue el nuevo `Codigo.gs`, ejecute `configurarHojas` una vez, publique una **nueva versión** (sección 4, paso 5) y suba otra vez `index.html` y `service-worker.js`.
