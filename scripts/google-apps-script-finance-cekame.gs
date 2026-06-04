/**
 * Zakázky: Dopadlo = Čekáme, splatnost prázdná NEBO před dneškem, bez Report zaplaceno
 * Cíl: spreadsheet 1I4vnQ... → list ERP
 *
 * Spouštění (dávkově, kvůli limitu Apps Script ~6 min):
 *   1) setConfig() – jednou
 *   2) exportFinanceCekameToSheet() – začátek (vymaže list, stáhne první dávky)
 *   3) exportFinanceCekameContinue() – dokud v logu není „HOTOVO“
 *
 * Nebo: exportFinanceCekameOneBatch() – vždy jen 1 dávka (nejspolehlivější)
 */

var TARGET_SPREADSHEET_ID = '1I4vnQ-AqWlHGmylMDnDyK-TWIH3UCXwLcMXPoNCbXJs';
var SHEET_NAME = 'ERP';
var BATCH_SIZE = 80;
var MAX_MS_PER_RUN = 4.5 * 60 * 1000;

var PROP_OFFSET = 'ERP_EXPORT_OFFSET';
var PROP_DONE = 'ERP_EXPORT_DONE';

var OUTPUT_HEADERS = [
  'ID zakázky',
  'customer_name',
  'customer_phone',
  'customer_email',
  'druh_platby',
  'splatnost_faktury',
  'cislo_zalohove_faktury',
  'dopadlo_zamereni',
  'uhrazeni_faktury',
  'Odkaz Systeeem'
];

function setConfig() {
  PropertiesService.getScriptProperties().setProperties({
    ERP_DB_CONNECTION_STRING:
      'postgres://USER:PASSWORD@HOST:PORT/DATABASE'
  }, true);
}

/** Nový export od začátku – stáhne co stihne za ~4,5 min, pak případně Continue */
function exportFinanceCekameToSheet() {
  resetExportProgress();
  runExportBatches_(true);
}

/** Pokračování od uložené pozice */
function exportFinanceCekameContinue() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(PROP_DONE) === '1') {
    Logger.log('Export už je hotový. Pro nový běh spusť exportFinanceCekameToSheet().');
    getSpreadsheet_().toast('Export už je hotový.', 'ERP', 5);
    return;
  }
  runExportBatches_(false);
}

/** Jen jedna dávka (~80 řádků) – když ToSheet/Continue padá na timeout */
function exportFinanceCekameOneBatch() {
  var props = PropertiesService.getScriptProperties();
  var offset = parseInt(props.getProperty(PROP_OFFSET) || '0', 10);
  var isFirst = offset === 0 && props.getProperty(PROP_DONE) !== '1';

  if (props.getProperty(PROP_DONE) === '1') {
    Logger.log('Hotovo. Pro nový export: exportFinanceCekameReset() a exportFinanceCekameToSheet().');
    return;
  }

  var result = fetchAndWriteBatch_(offset, isFirst);
  props.setProperty(PROP_OFFSET, String(result.nextOffset));
  if (result.done) {
    props.setProperty(PROP_DONE, '1');
  }

  var msg = result.done
    ? 'HOTOVO – celkem ' + result.nextOffset + ' řádků v listu ERP.'
    : 'Dávka OK. Zapsáno ' + result.written + ' řádků (celkem ' + result.nextOffset + '). Spusť znovu exportFinanceCekameOneBatch().';
  Logger.log(msg);
  getSpreadsheet_().toast(msg, 'ERP export', 8);
}

function exportFinanceCekameReset() {
  resetExportProgress();
  var sheet = getOrCreateSheet_();
  sheet.clear();
  getSpreadsheet_().toast('Export resetován.', 'ERP', 3);
  Logger.log('Export resetován.');
}

function resetExportProgress() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROP_OFFSET);
  props.deleteProperty(PROP_DONE);
}

function runExportBatches_(isFreshStart) {
  var props = PropertiesService.getScriptProperties();
  var connStr = props.getProperty('ERP_DB_CONNECTION_STRING');
  if (!connStr) {
    throw new Error('Chybí ERP_DB_CONNECTION_STRING. Nejdřív spusť setConfig().');
  }

  var startTime = Date.now();
  var offset = isFreshStart ? 0 : parseInt(props.getProperty(PROP_OFFSET) || '0', 10);
  var totalWritten = 0;
  var ss = getSpreadsheet_();

  if (isFreshStart) {
    props.deleteProperty(PROP_DONE);
    props.setProperty(PROP_OFFSET, '0');
    initSheet_();
    ss.toast('Export začal…', 'ERP', 3);
  }

  while (Date.now() - startTime < MAX_MS_PER_RUN) {
    var isFirstBatch = offset === 0 && isFreshStart && totalWritten === 0;
    var batch = fetchBatchFromDb_(connStr, BATCH_SIZE, offset);
    if (!batch.rows.length) {
      props.setProperty(PROP_DONE, '1');
      props.setProperty(PROP_OFFSET, String(offset));
      var doneMsg = 'HOTOVO – ' + offset + ' zakázek v listu ERP.';
      Logger.log(doneMsg);
      ss.toast(doneMsg, 'ERP', 10);
      return;
    }

    appendRowsToSheet_(batch.rows);
    offset += batch.rows.length;
    totalWritten += batch.rows.length;
    props.setProperty(PROP_OFFSET, String(offset));

    ss.toast(
      'Dávka: +' + batch.rows.length + ' (celkem ' + offset + ')',
      'ERP export',
      3
    );
    Logger.log('Zapsáno offset ' + offset);

    if (batch.rows.length < BATCH_SIZE) {
      props.setProperty(PROP_DONE, '1');
      var fin = 'HOTOVO – ' + offset + ' zakázek.';
      Logger.log(fin);
      ss.toast(fin, 'ERP', 10);
      return;
    }

    Utilities.sleep(200);
  }

  var cont =
    'Časový limit – zapsáno ' +
    offset +
    ' řádků. Spusť exportFinanceCekameContinue() nebo exportFinanceCekameOneBatch().';
  Logger.log(cont);
  ss.toast(cont, 'ERP', 12);
}

function fetchAndWriteBatch_(offset, isFirst) {
  var props = PropertiesService.getScriptProperties();
  var connStr = props.getProperty('ERP_DB_CONNECTION_STRING');
  if (!connStr) throw new Error('Chybí ERP_DB_CONNECTION_STRING.');

  if (isFirst) {
    initSheet_();
  }

  var batch = fetchBatchFromDb_(connStr, BATCH_SIZE, offset);
  if (batch.rows.length) {
    appendRowsToSheet_(batch.rows);
  }

  var nextOffset = offset + batch.rows.length;
  var done = batch.rows.length === 0 || batch.rows.length < BATCH_SIZE;

  return {
    written: batch.rows.length,
    nextOffset: nextOffset,
    done: done
  };
}

function fetchBatchFromDb_(connStr, limit, offset) {
  var cfg = parsePgUrl(connStr);
  var jdbcUrl = 'jdbc:postgresql://' + cfg.host + ':' + cfg.port + '/' + cfg.db;
  var sql = buildFinanceCekameSql(limit, offset);

  var rows = [];
  var conn = Jdbc.getConnection(jdbcUrl, cfg.user, cfg.password);
  var stmt = null;
  var rs = null;

  try {
    stmt = conn.createStatement();
    try {
      stmt.setQueryTimeout(30);
    } catch (ignore) {}
    rs = stmt.executeQuery(sql);
    while (rs.next()) {
      rows.push(rowFromResultSet_(rs));
    }
  } finally {
    if (rs) rs.close();
    if (stmt) stmt.close();
    conn.close();
  }

  return { rows: rows };
}

function rowFromResultSet_(rs) {
  var orderId = rs.getString(1);
  return [
    orderId,
    rs.getString(2),
    rs.getString(3),
    rs.getString(4),
    rs.getString(5),
    rs.getString(6),
    rs.getString(7),
    rs.getString(8),
    rs.getString(9),
    'https://systeeem.cz/orders/' + orderId
  ];
}

function buildFinanceCekameBaseCte_() {
  return (
    'WITH latest_cols AS (' +
    '  SELECT DISTINCT ON (ocv.order_id, oc.slug)' +
    '    ocv.order_id, oc.slug, TRIM(ocv.value) AS value' +
    '  FROM orders_column_values ocv' +
    '  JOIN orders_columns oc ON oc.id = ocv.column_id' +
    "  WHERE oc.slug IN ('dopadlo_zamereni','splatnost_faktury','uhrazeni_faktury','druh_platby','cislo_zalohove_faktury')" +
    '  ORDER BY ocv.order_id, oc.slug, ocv.id DESC' +
    '),' +
    'pivot AS (' +
    '  SELECT order_id,' +
    "    MAX(CASE WHEN slug = 'dopadlo_zamereni' THEN value END) AS dopadlo_zamereni," +
    "    MAX(CASE WHEN slug = 'splatnost_faktury' THEN value END) AS splatnost_faktury," +
    "    MAX(CASE WHEN slug = 'uhrazeni_faktury' THEN value END) AS uhrazeni_faktury," +
    "    MAX(CASE WHEN slug = 'druh_platby' THEN value END) AS druh_platby," +
    "    MAX(CASE WHEN slug = 'cislo_zalohove_faktury' THEN value END) AS cislo_zalohove_faktury" +
    '  FROM latest_cols GROUP BY order_id' +
    '),' +
    'filtered AS (' +
    '  SELECT o.id AS order_id, c.name AS customer_name, c.phone AS customer_phone,' +
    '    c.email AS customer_email, p.druh_platby, p.splatnost_faktury,' +
    '    p.cislo_zalohove_faktury, p.dopadlo_zamereni, p.uhrazeni_faktury' +
    '  FROM orders o' +
    '  JOIN customers c ON c.id = o.customer_id' +
    '  JOIN pivot p ON p.order_id = o.id' +
    '  WHERE o.deleted_at IS NULL' +
    "    AND LOWER(TRIM(COALESCE(p.dopadlo_zamereni, ''))) = 'cekame'" +
    '    AND (' +
    "      NULLIF(TRIM(COALESCE(p.splatnost_faktury, '')), '') IS NULL" +
    "      OR LOWER(TRIM(p.splatnost_faktury)) IN ('nezadano','nezadáno','n/a','null','-')" +
    "      OR (TRIM(p.splatnost_faktury) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'" +
    '          AND SUBSTRING(TRIM(p.splatnost_faktury), 1, 10)::date < CURRENT_DATE)' +
    '    )' +
    "    AND (NULLIF(TRIM(COALESCE(p.uhrazeni_faktury, '')), '') IS NULL" +
    "         OR LOWER(TRIM(p.uhrazeni_faktury)) IN ('nezadano','nezadáno','n/a','null','-'))" +
    ')'
  );
}

function buildFinanceCekameSql(limit, offset) {
  return (
    buildFinanceCekameBaseCte_() +
    ' SELECT order_id::text AS order_id, customer_name, customer_phone, customer_email,' +
    '   druh_platby, splatnost_faktury, cislo_zalohove_faktury,' +
    '   dopadlo_zamereni, uhrazeni_faktury' +
    ' FROM filtered' +
    ' ORDER BY order_id DESC' +
    ' LIMIT ' +
    parseInt(limit, 10) +
    ' OFFSET ' +
    parseInt(offset, 10)
  );
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
}

function getOrCreateSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  return sheet;
}

function initSheet_() {
  var sheet = getOrCreateSheet_();
  sheet.clear();
  sheet.getRange(1, 1, 1, OUTPUT_HEADERS.length).setValues([OUTPUT_HEADERS]);
  sheet.getRange(1, 1, 1, OUTPUT_HEADERS.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function appendRowsToSheet_(dataRows) {
  if (!dataRows.length) return;
  var sheet = getOrCreateSheet_();
  var startRow = Math.max(sheet.getLastRow(), 1) + 1;
  if (sheet.getLastRow() === 0) {
    initSheet_();
    startRow = 2;
  }
  var numRows = dataRows.length;
  var numCols = OUTPUT_HEADERS.length;
  sheet.getRange(startRow, 1, numRows, numCols).setValues(dataRows);
  SpreadsheetApp.flush();
}

function parsePgUrl(connStr) {
  var m = String(connStr).match(
    /^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:/?#]+)(?::(\d+))?\/([^?#]+)(?:\?.*)?$/i
  );
  if (!m) throw new Error('Neplatný ERP_DB_CONNECTION_STRING.');
  return {
    user: decodeURIComponent(m[1]),
    password: decodeURIComponent(m[2]),
    host: m[3],
    port: m[4] || '5432',
    db: m[5]
  };
}

/** Rychlý test – jen připojení k DB (spusť pokud vše visí) */
function testDbConnection() {
  var props = PropertiesService.getScriptProperties();
  var connStr = props.getProperty('ERP_DB_CONNECTION_STRING');
  if (!connStr) throw new Error('Chybí ERP_DB_CONNECTION_STRING.');
  var cfg = parsePgUrl(connStr);
  var jdbcUrl = 'jdbc:postgresql://' + cfg.host + ':' + cfg.port + '/' + cfg.db;
  var conn = Jdbc.getConnection(jdbcUrl, cfg.user, cfg.password);
  var stmt = conn.createStatement();
  try {
    stmt.setQueryTimeout(30);
  } catch (e) {
    Logger.log('setQueryTimeout přeskočeno: ' + e);
  }
  var rs = stmt.executeQuery('SELECT 1 AS ok');
  rs.next();
  Logger.log('DB OK: ' + rs.getString('ok'));
  rs.close();
  stmt.close();
  conn.close();
  getSpreadsheet_().toast('Připojení k DB OK', 'ERP', 5);
}
