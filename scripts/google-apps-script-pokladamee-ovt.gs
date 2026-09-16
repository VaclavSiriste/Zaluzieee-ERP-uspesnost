/**
 * Pokladamee OVT — list podle gid z URL (nemění se při přejmenování)
 * https://docs.google.com/spreadsheets/d/18PGajHulyJm8wC1QdxRISFYVwVrKbriFMfdY-UYfOyA/edit?gid=1262379590
 *
 * Nasazení:
 * 1) Otevři sheet → Rozšíření → Apps Script → vlož tento soubor
 * 2) PropertiesService: SHEET_API_TOKEN = libovolný tajný klíč
 * 3) Nasadit → Nové nasazení → Typ: Webová aplikace
 *    - Spouštět jako: Já
 *    - Kdo má přístup: Kdokoli (nebo Kdokoli s Google účtem)
 * 4) URL nasazení dej do Prvni/.env jako POKLADAMEE_OVT_SHEET_WEBAPP_URL
 *    a stejný token jako POKLADAMEE_OVT_SHEET_TOKEN
 *
 * Sloupce: K = datum navolání, L = dopadl hovor, Q = technik (OVT)
 * Řádek 2 = nadpis, data od řádku 3.
 */

var SPREADSHEET_ID = '18PGajHulyJm8wC1QdxRISFYVwVrKbriFMfdY-UYfOyA';
/** Stabilní ID listu z URL (?gid=...) — přejmenování listu ho nezmění */
var SHEET_GID = 1262379590;
var DATA_START_ROW = 3;
var COL_DATUM = 11; // K
var COL_DOPADL = 12; // L
var COL_TECHNIK = 17; // Q

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var expected = PropertiesService.getScriptProperties().getProperty('SHEET_API_TOKEN') || '';
    var token = String(params.token || '');
    if (expected && token !== expected) {
      return json_({ error: 'Unauthorized' }, 401);
    }

    var sheetInfo = getTargetSheet_();
    var rows = readSheetRows_(sheetInfo.sheet);
    var mode = String(params.mode || 'summary');
    if (mode === 'raw') {
      return json_({
        sheet: sheetInfo.name,
        gid: SHEET_GID,
        rows: rows
      });
    }

    var startDate = String(params.startDate || '');
    var endDate = String(params.endDate || '');
    var analyzed = analyze_(rows, startDate, endDate);
    return json_({
      sheet: sheetInfo.name,
      gid: SHEET_GID,
      startDate: startDate || null,
      endDate: endDate || null,
      technicians: analyzed.technicians,
      success: analyzed.success
    });
  } catch (err) {
    return json_({ error: String(err && err.message ? err.message : err) }, 500);
  }
}

function setSheetApiToken() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.prompt('API token pro Prvni dashboard', 'Zadej tajný token:', ui.ButtonSet.OK_CANCEL);
  if (result.getSelectedButton() !== ui.Button.OK) return;
  var token = String(result.getResponseText() || '').trim();
  if (!token) {
    ui.alert('Token nesmí být prázdný.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('SHEET_API_TOKEN', token);
  ui.alert('Token uložen.');
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Pokladamee OVT API')
    .addItem('Nastavit API token', 'setSheetApiToken')
    .addToUi();
}

/** Najde list podle gid z URL (odolné vůči přejmenování). */
function getTargetSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetById(SHEET_GID);
  if (!sheet) {
    throw new Error('List s gid=' + SHEET_GID + ' nenalezen ve spreadsheetu.');
  }
  return { sheet: sheet, name: sheet.getName() };
}

function readSheetRows_(sheet) {
  var lastRow = Math.max(sheet.getLastRow(), 1);
  var lastCol = Math.max(sheet.getLastColumn(), COL_TECHNIK);
  return sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
}

function analyze_(rows, startDate, endDate) {
  var techNames = [];
  var techSeen = {};
  var total = 0;
  var ano = 0;
  var ne = 0;

  for (var i = DATA_START_ROW - 1; i < rows.length; i++) {
    var row = rows[i] || [];
    var tech = String(row[COL_TECHNIK - 1] || '').trim().replace(/\s+/g, ' ');
    if (tech) {
      var key = tech.toLowerCase();
      if (!techSeen[key]) {
        techSeen[key] = true;
        techNames.push({
          id: slug_(tech),
          name: tech
        });
      }
    }

    var dateStr = parseDate_(row[COL_DATUM - 1]);
    if (!dateStr) continue;
    if (startDate && dateStr < startDate) continue;
    if (endDate && dateStr > endDate) continue;

    total++;
    var dopadl = String(row[COL_DOPADL - 1] || '').trim().toLowerCase();
    dopadl = dopadl
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (dopadl === 'ano' || dopadl === 'yes' || dopadl === '1' || dopadl === 'true') {
      ano++;
    } else if (String(row[COL_DOPADL - 1] || '').trim()) {
      ne++;
    }
  }

  techNames.sort(function (a, b) {
    return a.name.localeCompare(b.name, 'cs');
  });

  return {
    technicians: techNames,
    success: {
      dopadl_hovor_ano: ano,
      dopadl_hovor_ne: ne,
      dopadl_hovor_pocet: total,
      success_navolani_pct: total > 0 ? (ano / total) * 100 : null,
      domluveno_zamereni_ano: 0,
      domluveno_zamereni_ne: 0,
      domluveno_zamereni_pocet: 0,
      by_operator: [],
      source: 'pokladamee-ovt-sheet',
      date_basis: 'datum_navolani'
    }
  };
}

function parseDate_(value) {
  if (value == null || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  var m = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) {
    var d = ('0' + m[1]).slice(-2);
    var mo = ('0' + m[2]).slice(-2);
    return m[3] + '-' + mo + '-' + d;
  }
  return null;
}

function slug_(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function json_(obj, status) {
  var output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
