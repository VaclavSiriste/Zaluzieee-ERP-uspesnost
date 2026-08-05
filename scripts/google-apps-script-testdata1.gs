/**
 * Export zakázek → Google Sheet, list testdata1
 * Filtr: created_at >= 2026-04-01, bez zákazníků s přesně 2 zakázkami (v tomto období)
 * Dávky: 500 řádků
 */

var TARGET_SPREADSHEET_ID = '1I4vnQ-AqWlHGmylMDnDyK-TWIH3UCXwLcMXPoNCbXJs';
var SHEET_NAME = 'testdata1';
var BATCH_SIZE = 500;
var MAX_MS_PER_RUN = 4.5 * 60 * 1000;
var MIN_CREATED_DATE = '2026-04-01';

var PROP_OFFSET = 'TESTDATA1_EXPORT_OFFSET';
var PROP_DONE = 'TESTDATA1_EXPORT_DONE';

/**
 * Zkopírujte z Prvni/.env jen hodnotu za ERP_DB_CONNECTION_STRING=
 * (bez názvu proměnné, bez uvozovek), uložte soubor, spusťte setConfigTestdata1().
 */
var ERP_CONNECTION_STRING_FOR_SETUP = '';

var OUTPUT_HEADERS = [
  'ID zakázky',
  'customer_name',
  'customer_phone',
  'customer_email',
  'druh_platby',
  'splatnost_faktury',
  'cislo_zalohove_faktury',
  'datum_prijeti_zalohove_platby',
  'dopadlo_zamereni',
  'uhrazeni_faktury',
  'Odkaz Systeeem'
];

function setConfigTestdata1() {
  var connStr = normalizeConnStr_(ERP_CONNECTION_STRING_FOR_SETUP);
  PropertiesService.getScriptProperties().setProperties({
    ERP_DB_CONNECTION_STRING: connStr
  }, true);
  getSpreadsheet_().toast('Connection string uložen.', SHEET_NAME, 5);
  Logger.log('ERP_DB_CONNECTION_STRING uložen pro ' + SHEET_NAME);
}

function testDbConnectionTestdata1() {
  testDbConnection_(SHEET_NAME);
}

function exportTestdata1OneBatch() {
  var props = PropertiesService.getScriptProperties();
  var offset = parseInt(props.getProperty(PROP_OFFSET) || '0', 10);
  var isFirst = offset === 0 && props.getProperty(PROP_DONE) !== '1';

  if (props.getProperty(PROP_DONE) === '1') {
    getSpreadsheet_().toast('Export už je hotový.', SHEET_NAME, 5);
    return;
  }

  var result = fetchAndWriteBatch_(offset, isFirst);
  props.setProperty(PROP_OFFSET, String(result.nextOffset));
  if (result.done) {
    props.setProperty(PROP_DONE, '1');
  }

  var msg = result.done
    ? 'HOTOVO – celkem ' + result.nextOffset + ' řádků.'
    : 'Zapsáno ' + result.written + ' (celkem ' + result.nextOffset + '). Spusť znovu OneBatch.';
  Logger.log(msg);
  getSpreadsheet_().toast(msg, SHEET_NAME, 8);
}

function exportTestdata1ToSheet() {
  resetExportProgressTestdata1();
  runExportBatches_(true);
}

function exportTestdata1Continue() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(PROP_DONE) === '1') {
    getSpreadsheet_().toast('Export už je hotový.', SHEET_NAME, 5);
    return;
  }
  runExportBatches_(false);
}

function exportTestdata1Reset() {
  resetExportProgressTestdata1();
  getOrCreateSheet_().clear();
  getSpreadsheet_().toast('Reset OK', SHEET_NAME, 3);
}

function resetExportProgressTestdata1() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROP_OFFSET);
  props.deleteProperty(PROP_DONE);
}

function runExportBatches_(isFreshStart) {
  var props = PropertiesService.getScriptProperties();
  var connStr = getConnStr_();
  var startTime = Date.now();
  var offset = isFreshStart ? 0 : parseInt(props.getProperty(PROP_OFFSET) || '0', 10);
  var ss = getSpreadsheet_();

  if (isFreshStart) {
    props.deleteProperty(PROP_DONE);
    props.setProperty(PROP_OFFSET, '0');
    initSheet_();
    ss.toast('Export začal…', SHEET_NAME, 3);
  }

  while (Date.now() - startTime < MAX_MS_PER_RUN) {
    var batch = fetchBatchFromDb_(connStr, BATCH_SIZE, offset);
    if (!batch.rows.length) {
      props.setProperty(PROP_DONE, '1');
      props.setProperty(PROP_OFFSET, String(offset));
      ss.toast('HOTOVO – ' + offset + ' zakázek', SHEET_NAME, 10);
      return;
    }

    appendRowsToSheet_(batch.rows);
    offset += batch.rows.length;
    props.setProperty(PROP_OFFSET, String(offset));
    ss.toast('+' + batch.rows.length + ' (celkem ' + offset + ')', SHEET_NAME, 3);

    if (batch.rows.length < BATCH_SIZE) {
      props.setProperty(PROP_DONE, '1');
      ss.toast('HOTOVO – ' + offset + ' zakázek', SHEET_NAME, 10);
      return;
    }
    Utilities.sleep(200);
  }

  ss.toast('Časový limit – spusť Continue nebo OneBatch', SHEET_NAME, 10);
}

function fetchAndWriteBatch_(offset, isFirst) {
  var connStr = getConnStr_();
  if (isFirst) {
    initSheet_();
  }
  var batch = fetchBatchFromDb_(connStr, BATCH_SIZE, offset);
  if (batch.rows.length) {
    appendRowsToSheet_(batch.rows);
  }
  var nextOffset = offset + batch.rows.length;
  return {
    written: batch.rows.length,
    nextOffset: nextOffset,
    done: batch.rows.length === 0 || batch.rows.length < BATCH_SIZE
  };
}

function fetchBatchFromDb_(connStr, limit, offset) {
  var cfg = parsePgUrl(connStr);
  var jdbcUrl = 'jdbc:postgresql://' + cfg.host + ':' + cfg.port + '/' + cfg.db;
  var sql = buildTestdata1Sql(limit, offset);
  var rows = [];
  var conn = Jdbc.getConnection(jdbcUrl, cfg.user, cfg.password);
  var stmt = null;
  var rs = null;

  try {
    stmt = conn.createStatement();
    try {
      stmt.setQueryTimeout(60);
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
    rs.getString(10),
    'https://systeeem.cz/orders/' + orderId
  ];
}

function buildTestdata1Sql(limit, offset) {
  return (
    buildOrdersBaseCte_(false) +
    ' SELECT order_id::text AS order_id, customer_name, customer_phone, customer_email,' +
    '   druh_platby, splatnost_faktury, cislo_zalohove_faktury, datum_prijeti_zalohove_platby,' +
    '   dopadlo_zamereni, uhrazeni_faktury' +
    ' FROM filtered ORDER BY order_id DESC' +
    ' LIMIT ' + parseInt(limit, 10) + ' OFFSET ' + parseInt(offset, 10)
  );
}

/** onlyExactlyTwo=false → vyloučit zákazníky s přesně 2 zakázkami od MIN_CREATED_DATE */
function buildOrdersBaseCte_(onlyExactlyTwo) {
  var customerFilter = onlyExactlyTwo ? 'cc.order_cnt = 2' : 'cc.order_cnt <> 2';
  return (
    'WITH period_orders AS (' +
    '  SELECT o.id AS order_id, o.customer_id' +
    '  FROM orders o' +
    '  WHERE o.deleted_at IS NULL' +
    "    AND o.created_at >= '" + MIN_CREATED_DATE + "'::date" +
    '),' +
    'customer_counts AS (' +
    '  SELECT customer_id, COUNT(*)::int AS order_cnt' +
    '  FROM period_orders GROUP BY customer_id' +
    '),' +
    'latest_cols AS (' +
    '  SELECT DISTINCT ON (ocv.order_id, oc.slug)' +
    '    ocv.order_id, oc.slug, TRIM(ocv.value) AS value' +
    '  FROM orders_column_values ocv' +
    '  JOIN orders_columns oc ON oc.id = ocv.column_id' +
    "  WHERE oc.slug IN ('dopadlo_zamereni','splatnost_faktury','uhrazeni_faktury','druh_platby','cislo_zalohove_faktury','datum_prijeti_zalohove_platby')" +
    '  ORDER BY ocv.order_id, oc.slug, ocv.id DESC' +
    '),' +
    'pivot AS (' +
    '  SELECT order_id,' +
    "    MAX(CASE WHEN slug = 'dopadlo_zamereni' THEN value END) AS dopadlo_zamereni," +
    "    MAX(CASE WHEN slug = 'splatnost_faktury' THEN value END) AS splatnost_faktury," +
    "    MAX(CASE WHEN slug = 'uhrazeni_faktury' THEN value END) AS uhrazeni_faktury," +
    "    MAX(CASE WHEN slug = 'druh_platby' THEN value END) AS druh_platby," +
    "    MAX(CASE WHEN slug = 'cislo_zalohove_faktury' THEN value END) AS cislo_zalohove_faktury," +
    "    MAX(CASE WHEN slug = 'datum_prijeti_zalohove_platby' THEN value END) AS datum_prijeti_zalohove_platby" +
    '  FROM latest_cols GROUP BY order_id' +
    '),' +
    'filtered AS (' +
    '  SELECT po.order_id, c.name AS customer_name, c.phone AS customer_phone,' +
    '    c.email AS customer_email, p.druh_platby, p.splatnost_faktury,' +
    '    p.cislo_zalohove_faktury, p.datum_prijeti_zalohove_platby, p.dopadlo_zamereni, p.uhrazeni_faktury' +
    '  FROM period_orders po' +
    '  JOIN customer_counts cc ON cc.customer_id = po.customer_id' +
    '  JOIN customers c ON c.id = po.customer_id' +
    '  LEFT JOIN pivot p ON p.order_id = po.order_id' +
    '  WHERE ' + customerFilter +
    ')'
  );
}

function getConnStr_() {
  var connStr = PropertiesService.getScriptProperties().getProperty('ERP_DB_CONNECTION_STRING');
  if (!connStr) {
    throw new Error('Chybí ERP_DB_CONNECTION_STRING. Spusť setConfigTestdata1().');
  }
  return normalizeConnStr_(connStr);
}

/** Očekává jen postgres://user:pass@host:port/db (ne řádek z .env, ne uvozovky). */
function normalizeConnStr_(connStr) {
  var raw = String(connStr || '').trim();
  if (!raw) {
    throw new Error(
      'Connection string je prázdný. Vložte ho do ERP_CONNECTION_STRING_FOR_SETUP (řádek ~18) a spusťte setConfigTestdata1().'
    );
  }
  if (raw.indexOf('ERP_DB_CONNECTION_STRING=') === 0) {
    raw = raw.substring('ERP_DB_CONNECTION_STRING='.length).trim();
  }
  if (
    (raw.charAt(0) === '"' && raw.charAt(raw.length - 1) === '"') ||
    (raw.charAt(0) === "'" && raw.charAt(raw.length - 1) === "'")
  ) {
    raw = raw.substring(1, raw.length - 1).trim();
  }
  if (!/^postgres(?:ql)?:\/\//i.test(raw)) {
    throw new Error(
      'ERP_DB_CONNECTION_STRING musí začínat postgres:// (zkopírujte jen hodnotu z Prvni/.env, ne název proměnné).'
    );
  }
  if (/USER:PASSWORD@HOST/i.test(raw)) {
    throw new Error(
      'Stále placeholder. Do ERP_CONNECTION_STRING_FOR_SETUP vložte postgres://… z Prvni/.env a spusťte setConfigTestdata1().'
    );
  }
  return raw;
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
  sheet
    .getRange(startRow, 1, dataRows.length, OUTPUT_HEADERS.length)
    .setValues(dataRows);
  SpreadsheetApp.flush();
}

function parsePgUrl(connStr) {
  var raw = normalizeConnStr_(connStr);
  var m = raw.match(/^postgres(?:ql)?:\/\/(.+)$/i);
  if (!m) {
    throw new Error('Neplatný ERP_DB_CONNECTION_STRING.');
  }

  var rest = m[1];
  var at = rest.lastIndexOf('@');
  if (at < 0) {
    throw new Error('Neplatný ERP_DB_CONNECTION_STRING (chybí @host).');
  }

  var userPass = rest.substring(0, at);
  var hostDb = rest.substring(at + 1);
  var colon = userPass.indexOf(':');
  if (colon < 0) {
    throw new Error('Neplatný ERP_DB_CONNECTION_STRING (chybí user:password).');
  }

  var slash = hostDb.indexOf('/');
  if (slash < 0) {
    throw new Error('Neplatný ERP_DB_CONNECTION_STRING (chybí /database).');
  }

  var hostPort = hostDb.substring(0, slash);
  var db = hostDb.substring(slash + 1).split('?')[0];
  var port = '5432';
  var host = hostPort;
  var portMatch = hostPort.match(/:(\d+)$/);
  if (portMatch) {
    port = portMatch[1];
    host = hostPort.substring(0, hostPort.length - portMatch[0].length);
  }

  return {
    user: decodeURIComponent(userPass.substring(0, colon)),
    password: decodeURIComponent(userPass.substring(colon + 1)),
    host: host,
    port: port,
    db: db
  };
}

/** Spusť po setConfig – ukáže, zda je uložený string v pořádku (bez hesla). */
function diagnoseConnStrTestdata1() {
  var raw = PropertiesService.getScriptProperties().getProperty('ERP_DB_CONNECTION_STRING');
  if (!raw) {
    Logger.log('CHYBÍ: spusť setConfigTestdata1()');
    getSpreadsheet_().toast('Chybí ERP_DB_CONNECTION_STRING', SHEET_NAME, 8);
    return;
  }
  var cfg = parsePgUrl(raw);
  var msg = 'OK → ' + cfg.user + '@' + cfg.host + ':' + cfg.port + '/' + cfg.db;
  Logger.log(msg);
  getSpreadsheet_().toast(msg, SHEET_NAME, 10);
}

function testDbConnection_(label) {
  var connStr = getConnStr_();
  var cfg = parsePgUrl(connStr);
  var jdbcUrl = 'jdbc:postgresql://' + cfg.host + ':' + cfg.port + '/' + cfg.db;
  var conn = Jdbc.getConnection(jdbcUrl, cfg.user, cfg.password);
  var stmt = conn.createStatement();
  try {
    stmt.setQueryTimeout(30);
  } catch (e) {}
  var rs = stmt.executeQuery('SELECT 1 AS ok');
  rs.next();
  rs.close();
  stmt.close();
  conn.close();
  getSpreadsheet_().toast('Připojení k DB OK', label, 5);
}
