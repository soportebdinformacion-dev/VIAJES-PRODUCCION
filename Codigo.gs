/* =====================================================================
   REGISTRO DE SALIDAS & RETORNOS – AGRÍCOLA HUARMEY
   Backend en Google Apps Script  (archivo: Código.gs)

   Qué hace:
   - Entrega la lista de colaboradores (hoja "maestros").
   - Registra colaboradores nuevos en "maestros" (sin duplicar DNI).
   - Registra los viajes en la hoja "packing" (sin duplicar reintentos).
   - Valida los datos y el horario (miércoles todo el día, jueves hasta las 17:00, hora de Perú).
   - Responde siempre en formato JSON.

   LO ÚNICO QUE DEBE CAMBIAR:  CONFIG.SPREADSHEET_ID  (línea 25)
   ===================================================================== */

const CONFIG = {
  // ▼▼▼ REEMPLACE por el ID de su archivo "REGISTROS VIAJES" ▼▼▼
  // (es el texto largo de la URL del Sheets, entre /d/ y /edit)
  SPREADSHEET_ID: '16m-c72EGGxrUZXHU3rkvKIizoixf8-bOVDfv59D4H9w',
  // ▲▲▲

  HOJA_MAESTROS: 'maestros',
  HOJA_PACKING: 'packing',
  HOJA_CONFIG: 'config',   // aquí se escribe la FECHA DE DESACTIVACIÓN manual (celda B1)
  ZONA: 'America/Lima',

  // La pestaña "Registros" de la app muestra solo los registros de la semana de pago actual
  // (desde el último miércoles 00:00, hora de Lima). Ponga false para mostrar TODOS los registros.
  SOLO_SEMANA_ACTUAL: true,

  // Modificación de rutas desde la pestaña "Registros"
  MAX_MODIFICACIONES: 2,               // intentos permitidos por registro; al agotarse, el botón queda bloqueado
  PEDIR_CELULAR_PARA_MODIFICAR: true,  // el colaborador confirma con su celular que el registro es suyo (false = no pedirlo)

  // Un registro hecho SIN internet se acepta al sincronizar hasta estas horas después de creado
  // (siempre que haya sido creado dentro del horario permitido).
  GRACIA_SYNC_HORAS: 72,
  // Margen para relojes de teléfono ligeramente adelantados
  TOLERANCIA_FUTURO_MIN: 10,
  // Un envío con menos de estos minutos de antigüedad se anota como "EN LINEA"
  TOLERANCIA_EN_LINEA_MIN: 10
};

const AREAS = ['ALMACÉN','CALIDAD AGRÍCOLA','CÁMARA','DESPACHOS','ETIQUETADO','GESTIÓN HUMANA','LÍNEA DE PROCESO',
  'MANTENIMIENTO','OPERACIONES','PRE FRÍO','RECEPCIÓN','SADEMA','SANEAMIENTO','SSOMA','TI'];
const RUTAS = ['CHONGOYAPE','CUCULI','LA CRIA','PATAPO','TUMAN','CHICLAYO','LAMBAYEQUE','MORROPE','OLMOS','LA PAREJA','PIURA CENTRO','NINGUNO'];

// Encabezados. Las columnas A–G NO se modifican; H–M son de control interno.
const ENC_MAESTROS = ['DNI','APELLIDOS Y NOMBRES','CELULAR'];
const ENC_PACKING = ['FECHA REGISTRO','DNI','NOMBRES Y APELLIDOS','CELULAR','AREA','RUTA SALIDA','RUTA RETORNO',
  'ID REGISTRO','ORIGEN','FECHA SINCRONIZACION','MODIFICACIONES','FECHA ULTIMA MODIFICACION','HISTORIAL MODIFICACIONES'];

/* =====================================================================
   PUNTOS DE ENTRADA (la aplicación web)
   ===================================================================== */
function doGet(e) {
  return responder(manejarGet(e && e.parameter ? e.parameter : {}));
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (ex) {
    return responder(fallo('JSON', 'Solicitud no válida.'));
  }
  return responder(manejarPost(body));
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fallo(codigo, mensaje, extra) {
  return Object.assign({ ok: false, codigo: codigo, mensaje: mensaje }, extra || {});
}

function manejarGet(p) {
  try {
    // Hora oficial del servidor (no requiere código): la usa la app para corregir el reloj del teléfono.
    if (p.action === 'estado') {
      const f = leerFechasManuales();
      return { ok: true, ts: Date.now(), abierto: estaHabilitado(new Date()), zona: CONFIG.ZONA,
               desactiva: f.des ? f.des.getTime() : null, habilita: f.hab ? f.hab.getTime() : null };
    }
    if (!autorizado(p.codigo)) return fallo('AUTH', 'Código de acceso incorrecto.');
    if (p.action === 'registros') {
      const r = listarRegistros();
      return { ok: true, total: r.total, unicos: r.datos.length, desde: r.desde, datos: r.datos,
               maxMod: CONFIG.MAX_MODIFICACIONES, pedirCelular: CONFIG.PEDIR_CELULAR_PARA_MODIFICAR };
    }
    if (p.action === 'maestros') {
      const datos = listarMaestros();
      return { ok: true, total: datos.length, datos: datos };
    }
    return fallo('ACCION', 'Acción no reconocida.');
  } catch (ex) {
    console.error(ex);
    return fallo('SERVIDOR', 'Error interno del servidor.');
  }
}

function manejarPost(b) {
  try {
    if (!autorizado(b.codigo)) return fallo('AUTH', 'Código de acceso incorrecto.');
    if (b.action === 'modificarRuta') {
      return modificarRuta(b);
    }
    if (b.action === 'sincronizar') {
      return { ok: true, resultados: sincronizarPendientes(b.items) };
    }
    // Atajos para un solo registro (usan la misma lógica)
    if (b.action === 'registrarMaestro') {
      return { ok: true, resultados: sincronizarPendientes([{ id: b.id, tipo: 'maestro', creadoEn: b.creadoEn, datos: b.datos }]) };
    }
    if (b.action === 'registrarViaje') {
      return { ok: true, resultados: sincronizarPendientes([{ id: b.id, tipo: 'viaje', creadoEn: b.creadoEn, datos: b.datos }]) };
    }
    return fallo('ACCION', 'Acción no reconocida.');
  } catch (ex) {
    console.error(ex);
    return fallo('SERVIDOR', 'Error interno del servidor.');
  }
}

/* =====================================================================
   SEGURIDAD
   Si usted define la propiedad de script CODIGO_ACCESO, la app pedirá ese
   código una sola vez en cada teléfono. Si no la define, el acceso es abierto.
   (Ver INSTRUCCIONES.md, sección de seguridad.)
   ===================================================================== */
function autorizado(codigo) {
  const esperado = PropertiesService.getScriptProperties().getProperty('CODIGO_ACCESO');
  if (!esperado) return true;
  return String(codigo || '') === String(esperado);
}

/* =====================================================================
   HORARIO (siempre America/Lima)
   Miércoles 00:00–23:59:59 · Jueves 00:00–16:59:59 · Resto: cerrado
   ===================================================================== */
function estaHabilitado(fecha) {
  const dia = Number(Utilities.formatDate(fecha, CONFIG.ZONA, 'u')); // 1=lunes … 7=domingo
  const hora = Number(Utilities.formatDate(fecha, CONFIG.ZONA, 'H'));
  const porHorario = dia === 3 || (dia === 4 && hora < 17);
  const f = leerFechasManuales();
  const habManual = f.hab && fecha.getTime() >= f.hab.getTime();      // habilitada a mano
  const desManual = f.des && fecha.getTime() >= f.des.getTime();      // desactivada a mano (prioridad)
  return (porHorario || habManual) && !desManual;
}

/* Lee las fechas manuales de la hoja "config":
   B1 = DESACTIVACIÓN (desde esa fecha/hora la app queda cerrada; tiene prioridad).
   B2 = HABILITACIÓN  (desde esa fecha/hora la app queda abierta aunque no sea miércoles/jueves).
   - Celda vacía = no se usa.
   - Acepta una fecha/hora de Sheets o texto "dd/mm/aaaa" o "dd/mm/aaaa hh:mm" (hora de Lima).
   - Si solo escribe la fecha, rige desde las 00:00 de ese día. */
let _fechasManuales;   // se leen una sola vez por ejecución
function leerFechasManuales() {
  if (_fechasManuales !== undefined) return _fechasManuales;
  _fechasManuales = { des: null, hab: null };
  try {
    const hoja = abrirLibro().getSheetByName(CONFIG.HOJA_CONFIG);
    if (!hoja) return _fechasManuales;
    const v = hoja.getRange('B1:B2').getValues();
    _fechasManuales.des = interpretarFecha(v[0][0]);
    _fechasManuales.hab = interpretarFecha(v[1][0]);
  } catch (ex) { console.error(ex); }
  return _fechasManuales;
}
function leerDesactivacion() { return leerFechasManuales().des; }
function leerHabilitacion() { return leerFechasManuales().hab; }
function interpretarFecha(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === 'string' && v.trim()) {
    const t = v.trim();
    const conHora = /^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}$/.test(t);
    const soloFecha = /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t);
    if (conHora || soloFecha) return Utilities.parseDate(conHora ? t : t + ' 00:00', CONFIG.ZONA, 'd/M/yyyy H:mm');
  }
  return null;
}

/* Valida el momento en que el colaborador creó el registro (puede ser anterior si trabajó sin internet). */
function validarMomento(creadoEn) {
  const ahora = new Date();
  const creado = creadoEn ? new Date(creadoEn) : ahora;
  if (isNaN(creado.getTime())) return { ok: false, codigo: 'FECHA_INVALIDA', mensaje: 'La fecha del registro no es válida.' };
  const edadMin = (ahora.getTime() - creado.getTime()) / 60000;
  if (edadMin < -CONFIG.TOLERANCIA_FUTURO_MIN) {
    return { ok: false, codigo: 'FECHA_INVALIDA', mensaje: 'La hora del teléfono está adelantada. Corríjala e intente de nuevo.' };
  }
  if (!estaHabilitado(creado)) {
    return { ok: false, codigo: 'FUERA_HORARIO', mensaje: 'EL PLAZO DE REGISTRO HA FINALIZADO. Se creó fuera del horario permitido.' };
  }
  if (edadMin > CONFIG.GRACIA_SYNC_HORAS * 60) {
    return { ok: false, codigo: 'EXPIRADO', mensaje: 'Pasó el tiempo máximo (' + CONFIG.GRACIA_SYNC_HORAS + ' h) para sincronizar este registro.' };
  }
  return { ok: true, creado: creado, origen: edadMin <= CONFIG.TOLERANCIA_EN_LINEA_MIN ? 'EN LINEA' : 'DIFERIDO' };
}

/* =====================================================================
   NORMALIZACIÓN Y VALIDACIÓN
   ===================================================================== */
function normalizarDniGuardado(v) {          // DNI leído de la hoja (recupera ceros perdidos)
  let s = String(v === null || v === undefined ? '' : v).replace(/\D/g, '');
  if (s.length > 0 && s.length < 8) s = s.padStart(8, '0');
  return s;
}
function limpiarNombre(v) {
  return String(v || '').toUpperCase().replace(/\s+/g, ' ').trim();
}
function normalizarCelular(v) {
  let s = String(v || '').replace(/\D/g, '');
  if (s.length === 11 && s.indexOf('51') === 0) s = s.slice(2);
  return /^9\d{8}$/.test(s) ? s : '';
}

/* =====================================================================
   LECTURA DE HOJAS
   ===================================================================== */
function abrirLibro() {
  if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID.indexOf('PEGAR_AQUI') === 0) {
    throw new Error('Falta configurar SPREADSHEET_ID en Código.gs');
  }
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function leerMaestros(hoja) {
  const mapa = {};
  const n = hoja.getLastRow() - 1;
  if (n < 1) return mapa;
  hoja.getRange(2, 1, n, 3).getValues().forEach(function (f) {
    const dni = normalizarDniGuardado(f[0]);
    if (dni.length === 8 && !mapa[dni]) {
      mapa[dni] = { dni: dni, nombre: limpiarNombre(f[1]), celular: String(f[2] === null ? '' : f[2]).replace(/\D/g, '') };
    }
  });
  return mapa;
}

function listarMaestros() {
  const hoja = abrirLibro().getSheetByName(CONFIG.HOJA_MAESTROS);
  if (!hoja) throw new Error('No existe la hoja "' + CONFIG.HOJA_MAESTROS + '"');
  const mapa = leerMaestros(hoja);
  return Object.keys(mapa).map(function (k) { return [mapa[k].dni, mapa[k].nombre, mapa[k].celular]; });
}

/* Miércoles 00:00 (hora de Lima) de la semana de pago vigente */
function inicioSemanaPago(ahora) {
  const u = Number(Utilities.formatDate(ahora, CONFIG.ZONA, 'u'));       // 1=lunes … 7=domingo
  const dias = (u - 3 + 7) % 7;                                         // días desde el último miércoles
  const hoy0 = Utilities.parseDate(Utilities.formatDate(ahora, CONFIG.ZONA, 'yyyy-MM-dd') + ' 00:00', CONFIG.ZONA, 'yyyy-MM-dd HH:mm');
  return new Date(hoy0.getTime() - dias * 86400000);
}

/* Devuelve, por cada DNI, su registro más reciente con: DNI, APELLIDOS Y NOMBRES, FECHA DE REGISTRO,
   RUTA SALIDA, RUTA RETORNO, ID REGISTRO y cuántas modificaciones lleva.
   No se envía celular ni área: la pestaña es de consulta y modificación de rutas. */
function listarRegistros() {
  const hoja = abrirLibro().getSheetByName(CONFIG.HOJA_PACKING);
  if (!hoja) throw new Error('No existe la hoja "' + CONFIG.HOJA_PACKING + '"');
  const desde = inicioSemanaPago(new Date());
  const n = hoja.getLastRow() - 1;
  const pos = {}, datos = [];
  let total = 0;
  if (n > 0) {
    const cols = Math.min(11, hoja.getMaxColumns());
    hoja.getRange(2, 1, n, cols).getValues().forEach(function (f) {
      if (CONFIG.SOLO_SEMANA_ACTUAL && !(f[0] instanceof Date && f[0].getTime() >= desde.getTime())) return;
      const dni = normalizarDniGuardado(f[1]);
      if (dni.length !== 8) return;
      total++;
      const ms = (f[0] instanceof Date && !isNaN(f[0].getTime())) ? f[0].getTime() : null;
      const reg = [dni, limpiarNombre(f[2]), ms, String(f[5] || ''), String(f[6] || ''), String(f[7] || ''), Number(f[10]) || 0];
      if (pos[dni] === undefined) {
        pos[dni] = datos.length;
        datos.push(reg);
      } else {
        const act = datos[pos[dni]];
        if (ms !== null && (act[2] === null || ms >= act[2])) datos[pos[dni]] = reg;   // se queda el más reciente
      }
    });
  }
  datos.sort(function (a, b) { return a[1].localeCompare(b[1], 'es'); });
  return { datos: datos, total: total, desde: desde.getTime() };
}

/* =====================================================================
   MODIFICAR RUTAS  (máximo CONFIG.MAX_MODIFICACIONES por registro)
   Solo cambia RUTA SALIDA y/o RUTA RETORNO del registro, solo con el formulario habilitado
   y solo para registros de la semana de pago actual. Deja constancia en las columnas K–M.
   ===================================================================== */
function asegurarColumnas(hoja) {
  if (hoja.getMaxColumns() < ENC_PACKING.length) hoja.insertColumnsAfter(hoja.getMaxColumns(), ENC_PACKING.length - hoja.getMaxColumns());
}

function modificarRuta(b) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (ex) { return fallo('OCUPADO', 'El servidor está ocupado. Intente de nuevo en unos segundos.'); }
  try {
    const id = String(b.id || '');
    const dni = String(b.dni || '').trim();
    if (!id || !/^\d{8}$/.test(dni)) return fallo('DATOS', 'Solicitud no válida.');
    if (RUTAS.indexOf(b.rutaSalida) < 0 || RUTAS.indexOf(b.rutaRetorno) < 0) return fallo('RUTA_INVALIDA', 'Ruta no válida.');

    const ahora = new Date();
    if (!estaHabilitado(ahora)) return fallo('FUERA_HORARIO', 'EL PLAZO DE REGISTRO HA FINALIZADO. Ya no se pueden modificar las rutas.');

    const hoja = abrirLibro().getSheetByName(CONFIG.HOJA_PACKING);
    if (!hoja) throw new Error('No existe la hoja "' + CONFIG.HOJA_PACKING + '"');
    asegurarColumnas(hoja);
    const n = hoja.getLastRow() - 1;
    if (n < 1) return fallo('NO_EXISTE', 'No se encontró el registro.');
    const ids = hoja.getRange(2, 8, n, 1).getValues();
    let fila = -1;
    for (let i = 0; i < ids.length; i++) { if (String(ids[i][0]) === id) { fila = i + 2; break; } }
    if (fila < 0) return fallo('NO_EXISTE', 'No se encontró el registro.');

    const r = hoja.getRange(fila, 1, 1, 13).getValues()[0];
    if (normalizarDniGuardado(r[1]) !== dni) return fallo('DATOS', 'El registro no corresponde a ese DNI.');
    if (!(r[0] instanceof Date) || r[0].getTime() < inicioSemanaPago(ahora).getTime()) {
      return fallo('SEMANA_ANTERIOR', 'Este registro es de una semana de pago anterior y ya no se puede modificar.');
    }

    const usadas = Number(r[10]) || 0;
    if (usadas >= CONFIG.MAX_MODIFICACIONES) {
      return fallo('LIMITE', 'Ya usó las ' + CONFIG.MAX_MODIFICACIONES + ' modificaciones permitidas. No se pueden hacer más cambios.',
        { modificaciones: usadas, restantes: 0 });
    }

    if (CONFIG.PEDIR_CELULAR_PARA_MODIFICAR) {
      const cache = CacheService.getScriptCache();
      const clave = 'celfail_' + dni;
      const fallos = Number(cache.get(clave)) || 0;
      if (fallos >= 5) return fallo('BLOQUEO', 'Demasiados intentos con un celular incorrecto. Espere 10 minutos o consulte al responsable.');
      if (normalizarCelular(b.celular) !== String(r[3]).replace(/\D/g, '')) {
        cache.put(clave, String(fallos + 1), 600);
        return fallo('CELULAR', 'El celular no coincide con el de este registro. No se gastó ningún intento.');
      }
      cache.remove(clave);
    }

    const sal = String(r[5]), ret = String(r[6]);
    if (sal === b.rutaSalida && ret === b.rutaRetorno) {
      return fallo('SIN_CAMBIOS', 'Las rutas ya están registradas con esos valores. No se gastó ningún intento.');
    }

    const linea = Utilities.formatDate(ahora, CONFIG.ZONA, 'dd/MM/yyyy HH:mm') +
      ' | SALIDA: ' + sal + ' > ' + b.rutaSalida + ' | RETORNO: ' + ret + ' > ' + b.rutaRetorno;
    const hist = String(r[12] || '');
    hoja.getRange(fila, 6, 1, 2).setValues([[b.rutaSalida, b.rutaRetorno]]);   // F y G
    hoja.getRange(fila, 11).setValue(usadas + 1);                              // K
    hoja.getRange(fila, 12).setNumberFormat('dd/mm/yyyy hh:mm:ss').setValue(ahora);   // L
    hoja.getRange(fila, 13).setValue(hist ? hist + '\n' + linea : linea);      // M
    SpreadsheetApp.flush();
    return { ok: true, estado: 'MODIFICADO', rutaSalida: b.rutaSalida, rutaRetorno: b.rutaRetorno,
             modificaciones: usadas + 1, restantes: CONFIG.MAX_MODIFICACIONES - (usadas + 1) };
  } catch (ex) {
    console.error(ex);
    return fallo('SERVIDOR', 'Error interno del servidor.');
  } finally {
    lock.releaseLock();
  }
}

function crearContexto() {
  const libro = abrirLibro();
  const sm = libro.getSheetByName(CONFIG.HOJA_MAESTROS);
  const sp = libro.getSheetByName(CONFIG.HOJA_PACKING);
  if (!sm || !sp) throw new Error('Faltan las hojas "maestros" y/o "packing". Ejecute configurarHojas().');
  const ids = {};
  const n = sp.getLastRow() - 1;
  if (n > 0) sp.getRange(2, 8, n, 1).getValues().forEach(function (f) { if (f[0]) ids[String(f[0])] = true; });
  return { sm: sm, sp: sp, maestros: leerMaestros(sm), ids: ids, reintentables: {} };
}

/* =====================================================================
   SINCRONIZACIÓN (recibe una lista de pendientes y devuelve un resultado por cada uno)
   LockService evita que dos teléfonos escriban al mismo tiempo.
   ===================================================================== */
function sincronizarPendientes(items) {
  if (!Array.isArray(items) || !items.length) return [];
  items = items.slice(0, 50);

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (ex) {
    return items.map(function (it) {
      return { id: it && it.id, ok: false, reintentable: true, codigo: 'OCUPADO', mensaje: 'El servidor está ocupado. Se reintentará.' };
    });
  }
  try {
    const ctx = crearContexto();
    const resultados = items.map(function (it) {
      let r;
      try {
        r = (it && it.tipo === 'maestro') ? procesarMaestro(it, ctx) : procesarViaje(it, ctx);
      } catch (ex) {
        console.error(ex);
        r = { ok: false, reintentable: true, codigo: 'SERVIDOR', mensaje: 'Error interno: ' + ex.message };
      }
      r.id = it && it.id;
      return r;
    });
    SpreadsheetApp.flush();
    return resultados;
  } catch (ex) {
    console.error(ex);
    return items.map(function (it) {
      return { id: it && it.id, ok: false, reintentable: true, codigo: 'SERVIDOR', mensaje: 'No se pudo abrir el Google Sheets: ' + ex.message };
    });
  } finally {
    lock.releaseLock();
  }
}

function noReintentable(codigo, mensaje) { return { ok: false, reintentable: false, codigo: codigo, mensaje: mensaje }; }

/* ---------- Nuevo colaborador ---------- */
function procesarMaestro(it, ctx) {
  const d = it.datos || {};
  const dni = String(d.dni || '').trim();
  if (!/^\d{8}$/.test(dni)) return noReintentable('DNI_INVALIDO', 'El DNI debe tener exactamente 8 dígitos.');
  const nombre = limpiarNombre(d.nombre);
  if (nombre.length < 5 || nombre.split(' ').length < 2) return noReintentable('NOMBRE_INVALIDO', 'Escriba apellidos y nombres completos.');
  const celular = normalizarCelular(d.celular);
  if (!celular) return noReintentable('CELULAR_INVALIDO', 'El celular debe tener 9 dígitos y empezar con 9.');

  // Si el DNI ya existe, el reintento se considera correcto (no se duplica).
  if (ctx.maestros[dni]) {
    return { ok: true, estado: 'EXISTIA', colaborador: ctx.maestros[dni], mensaje: 'El DNI ya estaba registrado.' };
  }
  const m = validarMomento(it.creadoEn);
  if (!m.ok) return noReintentable(m.codigo, m.mensaje);

  const fila = Math.max(ctx.sm.getLastRow(), 1) + 1;
  const rango = ctx.sm.getRange(fila, 1, 1, 3);
  rango.setNumberFormat('@');                       // texto: conserva ceros iniciales
  rango.setValues([[dni, nombre, celular]]);
  ctx.maestros[dni] = { dni: dni, nombre: nombre, celular: celular };
  return { ok: true, estado: 'CREADO', colaborador: ctx.maestros[dni] };
}

/* ---------- Registro de viaje ---------- */
function procesarViaje(it, ctx) {
  if (!it || !it.id) return noReintentable('ID_FALTANTE', 'Registro sin identificador.');
  const id = String(it.id);
  // Reintento de una operación ya guardada: se confirma sin volver a escribir.
  if (ctx.ids[id]) return { ok: true, estado: 'DUPLICADO', mensaje: 'Este registro ya estaba guardado.' };

  const d = it.datos || {};
  const dni = String(d.dni || '').trim();
  if (!/^\d{8}$/.test(dni)) return noReintentable('DNI_INVALIDO', 'El DNI debe tener exactamente 8 dígitos.');
  const col = ctx.maestros[dni];
  if (!col) {
    if (ctx.reintentables[dni]) return { ok: false, reintentable: true, codigo: 'DEPENDENCIA', mensaje: 'Esperando el registro del colaborador nuevo.' };
    return noReintentable('COLABORADOR_NO_EXISTE', 'El DNI ' + dni + ' no está en la lista de colaboradores.');
  }
  if (AREAS.indexOf(d.area) < 0) return noReintentable('AREA_INVALIDA', 'Área no válida.');
  if (RUTAS.indexOf(d.rutaSalida) < 0) return noReintentable('RUTA_INVALIDA', 'Ruta de salida no válida.');
  if (RUTAS.indexOf(d.rutaRetorno) < 0) return noReintentable('RUTA_INVALIDA', 'Ruta de retorno no válida.');

  const m = validarMomento(it.creadoEn);
  if (!m.ok) return noReintentable(m.codigo, m.mensaje);

  const fila = Math.max(ctx.sp.getLastRow(), 1) + 1;
  const hoja = ctx.sp;
  hoja.getRange(fila, 2).setNumberFormat('@');      // DNI
  hoja.getRange(fila, 4).setNumberFormat('@');      // CELULAR
  hoja.getRange(fila, 8).setNumberFormat('@');      // ID
  hoja.getRange(fila, 1).setNumberFormat('dd/mm/yyyy hh:mm:ss');
  hoja.getRange(fila, 10).setNumberFormat('dd/mm/yyyy hh:mm:ss');
  hoja.getRange(fila, 1, 1, 10).setValues([[
    m.creado, dni, col.nombre, col.celular, d.area, d.rutaSalida, d.rutaRetorno, id, m.origen, new Date()
  ]]);
  ctx.ids[id] = true;
  return { ok: true, estado: 'GUARDADO', origen: m.origen };
}

/* =====================================================================
   CONFIGURACIÓN INICIAL  –  EJECUTAR UNA SOLA VEZ  (menú: configurarHojas ▶ Ejecutar)
   Crea las hojas/encabezados si faltan, deja DNI y CELULAR como texto
   y fija la zona horaria del archivo en Lima.
   ===================================================================== */
function configurarHojas() {
  const libro = abrirLibro();
  libro.setSpreadsheetTimeZone(CONFIG.ZONA);

  const preparar = function (nombre, encabezados, colsTexto) {
    let h = libro.getSheetByName(nombre);
    if (!h) h = libro.insertSheet(nombre);
    if (h.getMaxColumns() < encabezados.length) h.insertColumnsAfter(h.getMaxColumns(), encabezados.length - h.getMaxColumns());
    const actual = h.getRange(1, 1, 1, encabezados.length).getValues()[0];
    encabezados.forEach(function (t, i) {
      if (!actual[i]) h.getRange(1, i + 1).setValue(t);              // solo completa los vacíos
    });
    h.getRange(1, 1, 1, encabezados.length).setFontWeight('bold');
    h.setFrozenRows(1);
    colsTexto.forEach(function (c) { h.getRange(2, c, h.getMaxRows() - 1, 1).setNumberFormat('@'); });
    return h;
  };

  preparar(CONFIG.HOJA_MAESTROS, ENC_MAESTROS, [1, 3]);
  const sp = preparar(CONFIG.HOJA_PACKING, ENC_PACKING, [2, 4, 8]);
  sp.getRange(2, 1, sp.getMaxRows() - 1, 1).setNumberFormat('dd/mm/yyyy hh:mm:ss');
  sp.getRange(2, 10, sp.getMaxRows() - 1, 1).setNumberFormat('dd/mm/yyyy hh:mm:ss');

  // Hoja "config": celda B1 = fecha de desactivación manual (déjela vacía para no desactivar)
  let cfg = libro.getSheetByName(CONFIG.HOJA_CONFIG);
  if (!cfg) cfg = libro.insertSheet(CONFIG.HOJA_CONFIG);
  cfg.getRange('A1').setValue('FECHA Y HORA DE DESACTIVACION').setFontWeight('bold');
  cfg.getRange('A2').setValue('FECHA Y HORA DE HABILITACION').setFontWeight('bold');
  cfg.getRange('B1:B2').setNumberFormat('dd/mm/yyyy hh:mm');
  cfg.getRange('A4').setValue('B1 = desde esta fecha/hora la app queda DESACTIVADA (tiene prioridad). B2 = desde esta fecha/hora la app queda HABILITADA aunque no sea miércoles/jueves. Ejemplo: 16/10/2026 17:00. Deje vacío lo que no use.');
  cfg.setColumnWidth(1, 260); cfg.setColumnWidth(2, 160);

  Logger.log('Listo. Hojas configuradas y zona horaria = ' + CONFIG.ZONA);
}

/* Prueba rápida del horario (opcional): ejecútela y mire el registro de ejecución. */
function probarHorario() {
  const ahora = new Date();
  Logger.log('Hora en Lima: ' + Utilities.formatDate(ahora, CONFIG.ZONA, 'EEEE dd/MM/yyyy HH:mm:ss'));
  Logger.log('¿Formulario habilitado ahora? ' + estaHabilitado(ahora));
}
