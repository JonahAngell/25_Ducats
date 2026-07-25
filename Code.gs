// Personal Budget API v6
// Adds frontend-compatible support for bucket transfers, bucket retirement, and budget-plan saving.

const CONFIG = {
  API_TOKEN_PROPERTY: 'BUDGET_API_TOKEN',
  SPREADSHEET_ID_PROPERTY: 'BUDGET_SPREADSHEET_ID'
};

const SHEET_ALIASES = {
  BucketAliases: 'bucketAliases',
  BucketTransfers: 'bucketTransfers',
  BucketBalances: 'bucketBalances',
  IncomeHistory: 'incomeHistory'
};

const SHEETS = {
  TRANSACTIONS: 'Transactions',
  CATEGORIES: 'Categories',
  ACCOUNTS: 'Accounts',
  BUDGETS: 'Budgets',
  BUCKET_ALIASES: 'BucketAliases',
  BUCKET_TRANSFERS: 'BucketTransfers',
  BUCKET_BALANCES: 'BucketBalances',
  INCOME_HISTORY: 'IncomeHistory',
  SETTINGS: 'Settings',
  AUDIT_LOG: 'AuditLog'
};

const HEADERS = {
  Transactions: ['id','transactionDate','description','merchant','amount','transactionType','bucketId','categoryId','accountId','sourceBucket','notes','createdAt','updatedAt','deletedAt'],
  Categories: ['id','bucketId','name','type','colour','sortOrder','isActive','createdAt','updatedAt','retiredAt'],
  Accounts: ['id','bucketId','name','accountType','institution','isActive','currentBalance','createdAt','updatedAt','retiredAt'],
  Budgets: ['id','budgetMonth','bucketId','categoryId','plannedAmount','notes','createdAt','updatedAt'],
  BucketAliases: ['alias','sourceAccountId','sourceCategoryId','currentBucketId','currentBucketName','status','effectiveStart','effectiveEnd','transactionCount','netAmount','notes'],
  BucketTransfers: ['id','transferDate','fromBucketId','toBucketId','amount','reason','createdAt','updatedAt','deletedAt'],
  BucketBalances: ['bucketId','bucketName','currentBalance','totalFunded','totalSpent','transactionCount','asOf'],
  IncomeHistory: ['id','transactionDate','description','merchant','amount','notes','sourceRow','createdAt','updatedAt'],
  Settings: ['key','value','updatedAt'],
  AuditLog: ['id','action','entityType','entityId','beforeJson','afterJson','createdAt']
};

function doGet(e) {
  try {
    const action = queryParam_(e, 'action') || 'health';
    if (action === 'health') return json_({ ok: true, message: 'Budget API is running.', timestamp: now_() });
    validateToken_(queryParam_(e, 'token'));
    if (action === 'bootstrap') return json_(bootstrap_());
    return json_({ ok: false, error: 'Unknown GET action: ' + action });
  } catch (error) {
    return error_(error);
  }
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    validateToken_(body.token);
    const action = body.action;
    const payload = body.payload || {};
    if (action === 'bootstrap') return json_(bootstrap_());
    if (action === 'createTransaction') return json_(createTransaction_(payload));
    if (action === 'createBucketTransfer') return json_(createBucketTransfer_(payload));
    if (action === 'retireBucket') return json_(retireBucket_(payload));
    if (action === 'saveBudgetPlan') return json_(saveBudgetPlan_(payload));
    return json_({ ok: false, error: 'Unknown POST action: ' + action });
  } catch (error) {
    return error_(error);
  }
}

function setupBudgetWorkbook() {
  Object.keys(HEADERS).forEach(function(sheetName) { ensureSheet_(sheetName); });
  return { ok: true, message: 'Workbook setup complete.', timestamp: now_() };
}

function generateBudgetApiToken() {
  const token = Utilities.getUuid() + '-' + Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty(CONFIG.API_TOKEN_PROPERTY, token);
  console.log('Budget API token: ' + token);
  return { ok: true, token: token };
}

function bootstrap_() {
  ensureCoreSheets_();
  refreshBucketBalances_();
  return {
    ok: true,
    data: {
      transactions: readObjects_(SHEETS.TRANSACTIONS).filter(function(row) { return !row.deletedAt; }),
      categories: readObjects_(SHEETS.CATEGORIES),
      accounts: readObjects_(SHEETS.ACCOUNTS),
      budgets: readObjects_(SHEETS.BUDGETS),
      bucketAliases: readObjects_(SHEETS.BUCKET_ALIASES),
      bucketTransfers: readObjects_(SHEETS.BUCKET_TRANSFERS).filter(function(row) { return !row.deletedAt; }),
      bucketBalances: readObjects_(SHEETS.BUCKET_BALANCES),
      incomeHistory: readObjects_(SHEETS.INCOME_HISTORY),
      settings: readSettings_()
    },
    timestamp: now_()
  };
}

function createTransaction_(payload) {
  const amount = money_(payload.amount);
  const bucketId = normalBucketId_(payload.bucketId || payload.accountId);
  const now = now_();
  const transaction = {
    id: payload.id || id_('txn'),
    transactionDate: payload.transactionDate || today_(),
    description: payload.description || '',
    merchant: payload.merchant || '',
    amount: amount,
    transactionType: payload.transactionType || (amount < 0 ? 'expense' : amount > 0 ? 'allocation' : 'adjustment'),
    bucketId: bucketId,
    categoryId: payload.categoryId || 'cat_' + bucketId,
    accountId: payload.accountId || 'acct_' + bucketId,
    sourceBucket: payload.sourceBucket || bucketName_(bucketId),
    notes: payload.notes || '',
    createdAt: now,
    updatedAt: now,
    deletedAt: ''
  };
  appendObject_(SHEETS.TRANSACTIONS, transaction);
  refreshBucketBalances_();
  audit_('create', 'transaction', transaction.id, '', transaction);
  return { ok: true, transaction: transaction };
}

function createBucketTransfer_(payload) {
  const fromBucketId = normalBucketId_(payload.fromBucketId);
  const toBucketId = normalBucketId_(payload.toBucketId);
  const amount = Math.abs(money_(payload.amount));
  if (!fromBucketId || !toBucketId) throw new Error('Both source and target buckets are required.');
  if (fromBucketId === toBucketId) throw new Error('Choose two different buckets.');
  const now = now_();
  const transfer = {
    id: payload.id || id_('transfer'),
    transferDate: payload.transferDate || today_(),
    fromBucketId: fromBucketId,
    toBucketId: toBucketId,
    amount: amount,
    reason: payload.reason || '',
    createdAt: now,
    updatedAt: now,
    deletedAt: ''
  };
  appendObject_(SHEETS.BUCKET_TRANSFERS, transfer);
  const fromTransaction = transferTransaction_(transfer, fromBucketId, -amount, 'Transfer to ' + bucketName_(toBucketId));
  const toTransaction = transferTransaction_(transfer, toBucketId, amount, 'Transfer from ' + bucketName_(fromBucketId));
  appendObject_(SHEETS.TRANSACTIONS, fromTransaction);
  appendObject_(SHEETS.TRANSACTIONS, toTransaction);
  refreshBucketBalances_();
  audit_('create', 'bucketTransfer', transfer.id, '', { transfer: transfer, transactions: [fromTransaction, toTransaction] });
  return { ok: true, transfer: transfer, transactions: [fromTransaction, toTransaction] };
}

function retireBucket_(payload) {
  const sourceBucketId = normalBucketId_(payload.sourceBucketId);
  const targetBucketId = normalBucketId_(payload.targetBucketId);
  if (!sourceBucketId || !targetBucketId) throw new Error('Source and target bucket are required.');
  if (sourceBucketId === targetBucketId) throw new Error('A bucket cannot be retired into itself.');
  const now = now_();
  const sourceAccount = findByField_(SHEETS.ACCOUNTS, 'bucketId', sourceBucketId) || findByField_(SHEETS.ACCOUNTS, 'id', 'acct_' + sourceBucketId);
  const targetAccount = findByField_(SHEETS.ACCOUNTS, 'bucketId', targetBucketId) || findByField_(SHEETS.ACCOUNTS, 'id', 'acct_' + targetBucketId);
  if (!sourceAccount) throw new Error('Could not find source bucket account: ' + sourceBucketId);
  if (!targetAccount) throw new Error('Could not find target bucket account: ' + targetBucketId);
  const before = sourceAccount.object;
  const after = Object.assign({}, before, { isActive: false, retiredAt: now, updatedAt: now });
  writeObjectToRow_(SHEETS.ACCOUNTS, sourceAccount.rowNumber, after);
  const alias = {
    alias: before.name || sourceBucketId,
    sourceAccountId: before.id || 'acct_' + sourceBucketId,
    sourceCategoryId: 'cat_' + sourceBucketId,
    currentBucketId: targetBucketId,
    currentBucketName: targetAccount.object.name || targetBucketId,
    status: 'retired',
    effectiveStart: now,
    effectiveEnd: '',
    transactionCount: countTransactionsForBucket_(sourceBucketId),
    netAmount: currentBalance_(sourceBucketId),
    notes: payload.reason || 'Retired from app.'
  };
  appendObject_(SHEETS.BUCKET_ALIASES, alias);
  refreshBucketBalances_();
  audit_('retire', 'bucket', sourceBucketId, before, { account: after, alias: alias });
  return { ok: true, alias: alias };
}

function saveBudgetPlan_(payload) {
  const month = payload.budgetMonth;
  const rows = payload.rows || [];
  if (!month) throw new Error('A budget month is required.');
  const existing = readObjects_(SHEETS.BUDGETS);
  const kept = existing.filter(function(row) { return String(row.budgetMonth || '').slice(0, 7) !== String(month).slice(0, 7); });
  const now = now_();
  const saved = rows.map(function(row) {
    const bucketId = normalBucketId_(row.bucketId || row.categoryId);
    return {
      id: 'budget_' + String(month).replace('-', '_') + '_' + bucketId,
      budgetMonth: month,
      bucketId: bucketId,
      categoryId: row.categoryId || 'cat_' + bucketId,
      plannedAmount: money_(row.plannedAmount),
      notes: row.notes || '',
      createdAt: now,
      updatedAt: now
    };
  });
  clearAndWrite_(SHEETS.BUDGETS, kept.concat(saved));
  audit_('save', 'budgetPlan', month, '', saved);
  return { ok: true, budgets: saved };
}

function transferTransaction_(transfer, bucketId, amount, description) {
  const now = now_();
  return {
    id: id_('txn_transfer'),
    transactionDate: transfer.transferDate,
    description: description,
    merchant: '',
    amount: amount,
    transactionType: 'transfer',
    bucketId: bucketId,
    categoryId: 'cat_' + bucketId,
    accountId: 'acct_' + bucketId,
    sourceBucket: bucketName_(bucketId),
    notes: transfer.reason || '',
    createdAt: now,
    updatedAt: now,
    deletedAt: ''
  };
}

function refreshBucketBalances_() {
  const accounts = readObjects_(SHEETS.ACCOUNTS).filter(function(account) { return account.accountType !== 'income_source'; });
  const transactions = readObjects_(SHEETS.TRANSACTIONS).filter(function(row) { return !row.deletedAt; });
  const rows = accounts.map(function(account) {
    const bucketId = normalBucketId_(account.bucketId || account.id);
    const related = transactions.filter(function(tx) { return normalBucketId_(tx.bucketId || tx.accountId) === bucketId; });
    const funded = related.filter(function(tx) { return money_(tx.amount) > 0; }).reduce(function(total, tx) { return total + money_(tx.amount); }, 0);
    const spent = related.filter(function(tx) { return money_(tx.amount) < 0; }).reduce(function(total, tx) { return total + Math.abs(money_(tx.amount)); }, 0);
    return {
      bucketId: bucketId,
      bucketName: account.name || bucketId,
      currentBalance: Math.round((funded - spent) * 100) / 100,
      totalFunded: Math.round(funded * 100) / 100,
      totalSpent: Math.round(spent * 100) / 100,
      transactionCount: related.length,
      asOf: now_()
    };
  });
  clearAndWrite_(SHEETS.BUCKET_BALANCES, rows);
}

function currentBalance_(bucketId) {
  const normal = normalBucketId_(bucketId);
  return readObjects_(SHEETS.TRANSACTIONS).filter(function(tx) {
    return !tx.deletedAt && normalBucketId_(tx.bucketId || tx.accountId) === normal;
  }).reduce(function(total, tx) { return total + money_(tx.amount); }, 0);
}

function countTransactionsForBucket_(bucketId) {
  const normal = normalBucketId_(bucketId);
  return readObjects_(SHEETS.TRANSACTIONS).filter(function(tx) {
    return !tx.deletedAt && normalBucketId_(tx.bucketId || tx.accountId) === normal;
  }).length;
}

function readObjects_(sheetName) {
  const sheet = getSheet_(sheetName);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0].map(function(header) { return String(header || '').trim(); });
  return values.slice(1).filter(function(row) {
    return row.some(function(value) { return String(value || '').trim() !== ''; });
  }).map(function(row) { return rowToObject_(headers, row); });
}

function rowToObject_(headers, row) {
  const object = {};
  headers.forEach(function(header, index) { if (header) object[header] = row[index]; });
  return object;
}

function appendObject_(sheetName, object) {
  ensureSheet_(sheetName);
  const sheet = getSheet_(sheetName);
  const headers = headers_(sheetName);
  sheet.appendRow(headers.map(function(header) { return object[header] === undefined || object[header] === null ? '' : object[header]; }));
}

function writeObjectToRow_(sheetName, rowNumber, object) {
  const sheet = getSheet_(sheetName);
  const headers = headers_(sheetName);
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([headers.map(function(header) { return object[header] === undefined || object[header] === null ? '' : object[header]; })]);
}

function clearAndWrite_(sheetName, rows) {
  ensureSheet_(sheetName);
  const sheet = getSheet_(sheetName);
  const headers = headers_(sheetName);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows.map(function(row) { return headers.map(function(header) { return row[header] === undefined || row[header] === null ? '' : row[header]; }); }));
  }
  sheet.setFrozenRows(1);
}

function findByField_(sheetName, field, value) {
  const sheet = getSheet_(sheetName);
  if (!sheet) return null;
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return null;
  const headers = values[0].map(function(header) { return String(header || '').trim(); });
  const index = headers.indexOf(field);
  if (index === -1) return null;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][index] || '').trim() === String(value || '').trim()) {
      return { rowNumber: i + 1, object: rowToObject_(headers, values[i]) };
    }
  }
  return null;
}

function ensureCoreSheets_() {
  Object.keys(HEADERS).forEach(function(sheetName) { ensureSheet_(sheetName); });
}

function ensureSheet_(sheetName) {
  let sheet = getSheet_(sheetName);
  if (!sheet) sheet = spreadsheet_().insertSheet(sheetName);
  const headers = HEADERS[sheetName] || [];
  if (headers.length && sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

function headers_(sheetName) {
  const sheet = getSheet_(sheetName);
  const lastColumn = sheet.getLastColumn();
  if (lastColumn > 0) {
    const existing = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function(header) { return String(header || '').trim(); }).filter(Boolean);
    if (existing.length) return existing;
  }
  return HEADERS[sheetName] || [];
}

function getSheet_(sheetName) {
  const ss = spreadsheet_();
  return ss.getSheetByName(sheetName) || ss.getSheetByName(SHEET_ALIASES[sheetName] || '');
}

function readSettings_() {
  const settings = {};
  readObjects_(SHEETS.SETTINGS).forEach(function(row) { if (row.key) settings[row.key] = row.value; });
  return settings;
}

function audit_(action, entityType, entityId, before, after) {
  appendObject_(SHEETS.AUDIT_LOG, {
    id: id_('audit'),
    action: action,
    entityType: entityType,
    entityId: entityId,
    beforeJson: before ? JSON.stringify(before) : '',
    afterJson: after ? JSON.stringify(after) : '',
    createdAt: now_()
  });
}

function bucketName_(bucketId) {
  const found = findByField_(SHEETS.ACCOUNTS, 'bucketId', normalBucketId_(bucketId));
  return found ? found.object.name || bucketId : bucketId;
}

function normalBucketId_(value) {
  return String(value || '').trim().replace(/^acct_/, '').replace(/^cat_/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function money_(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  let text = String(value).trim();
  let negative = false;
  if (text.startsWith('(') && text.endsWith(')')) { negative = true; text = text.slice(1, -1); }
  text = text.replace(/[$,\s]/g, '');
  if (text.startsWith('-')) { negative = true; text = text.slice(1); }
  const parsed = Number(text);
  if (isNaN(parsed)) throw new Error('Amount must be numeric: ' + value);
  return negative ? -parsed : parsed;
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) throw new Error('Missing POST body.');
  return JSON.parse(e.postData.contents);
}

function queryParam_(e, key) {
  return e && e.parameter && e.parameter[key] ? String(e.parameter[key]) : '';
}

function validateToken_(providedToken) {
  const expected = PropertiesService.getScriptProperties().getProperty(CONFIG.API_TOKEN_PROPERTY);
  if (!expected) throw new Error('API token has not been generated. Run generateBudgetApiToken().');
  if (!providedToken || providedToken !== expected) throw new Error('Invalid API token.');
}

function spreadsheet_() {
  const storedId = PropertiesService.getScriptProperties().getProperty(CONFIG.SPREADSHEET_ID_PROPERTY);
  if (storedId) return SpreadsheetApp.openById(storedId);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('No active spreadsheet found. Bind this script to a Sheet or set the spreadsheet ID.');
  return active;
}

function id_(prefix) { return prefix + '_' + Utilities.getUuid(); }
function now_() { return new Date().toISOString(); }
function today_() { return new Date().toISOString().slice(0, 10); }
function json_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function error_(error) { return json_({ ok: false, error: error && error.message ? error.message : String(error), timestamp: now_() }); }

// --- v7 detailed budget planner backend overrides ---
const BUDGET_PLAN_HEADERS_V7 = ['id','budgetMonth','lineId','parentLineId','lineType','section','sortOrder','label','bucketId','categoryId','calculationType','calculationValue','multiplier','basisLineId','plannedAmount','actualOverride','actualAmount','variance','notes','createdAt','updatedAt'];
const BUDGET_PLAN_SHEET_V7 = 'BudgetPlans';

function doPost(e) {
  try {
    const body = parseBody_(e);
    validateToken_(body.token);
    const action = body.action;
    const payload = body.payload || {};
    if (action === 'bootstrap') return json_(bootstrap_());
    if (action === 'createTransaction') return json_(createTransaction_(payload));
    if (action === 'createBucketTransfer') return json_(createBucketTransfer_(payload));
    if (action === 'retireBucket') return json_(retireBucket_(payload));
    if (action === 'saveBudgetPlan') return json_(saveBudgetPlan_(payload));
    if (action === 'saveDetailedBudgetPlan') return json_(saveDetailedBudgetPlan_(payload));
    return json_({ ok: false, error: 'Unknown POST action: ' + action });
  } catch (error) {
    return error_(error);
  }
}

function bootstrap_() {
  ensureCoreSheets_();
  ensureBudgetPlansSheetV7_();
  refreshBucketBalances_();
  return {
    ok: true,
    data: {
      transactions: readObjects_(SHEETS.TRANSACTIONS).filter(function(row) { return !row.deletedAt; }),
      categories: readObjects_(SHEETS.CATEGORIES),
      accounts: readObjects_(SHEETS.ACCOUNTS),
      budgets: readObjects_(SHEETS.BUDGETS),
      budgetPlanRows: readBudgetPlanRowsV7_(),
      bucketAliases: readObjects_(SHEETS.BUCKET_ALIASES),
      bucketTransfers: readObjects_(SHEETS.BUCKET_TRANSFERS).filter(function(row) { return !row.deletedAt; }),
      bucketBalances: readObjects_(SHEETS.BUCKET_BALANCES),
      incomeHistory: readObjects_(SHEETS.INCOME_HISTORY),
      settings: readSettings_()
    },
    timestamp: now_()
  };
}

function saveDetailedBudgetPlan_(payload) {
  const month = payload.budgetMonth;
  if (!month) throw new Error('A budget month is required.');
  const rows = payload.rows || [];
  ensureBudgetPlansSheetV7_();
  const existing = readBudgetPlanRowsV7_();
  const kept = existing.filter(function(row) { return String(row.budgetMonth || '').slice(0, 7) !== String(month).slice(0, 7); });
  const now = now_();
  const saved = rows.map(function(row, index) {
    const lineId = row.lineId || normalBudgetLineIdV7_(row.label || ('line_' + index));
    const bucketId = normalBucketId_(row.bucketId || '');
    return {
      id: row.id || 'budget_plan_' + String(month).replace('-', '_') + '_' + lineId,
      budgetMonth: month,
      lineId: lineId,
      parentLineId: row.parentLineId || '',
      lineType: row.lineType || 'expense',
      section: row.section || '',
      sortOrder: Number(row.sortOrder || (index + 1) * 10),
      label: row.label || '',
      bucketId: bucketId,
      categoryId: row.categoryId || (bucketId ? 'cat_' + bucketId : ''),
      calculationType: row.calculationType || 'fixed',
      calculationValue: money_(row.calculationValue),
      multiplier: Number(row.multiplier || 1),
      basisLineId: row.basisLineId || '',
      plannedAmount: money_(row.plannedAmount),
      actualOverride: row.actualOverride === undefined || row.actualOverride === null ? '' : row.actualOverride,
      actualAmount: money_(row.actualAmount),
      variance: money_(row.variance),
      notes: row.notes || '',
      createdAt: row.createdAt || now,
      updatedAt: now
    };
  });
  clearAndWriteBudgetPlansV7_(kept.concat(saved));
  if (payload.monthNote) {
    PropertiesService.getScriptProperties().setProperty('BUDGET_NOTE_' + month, payload.monthNote);
  }
  audit_('save', 'detailedBudgetPlan', month, '', saved);
  return { ok: true, budgetPlanRows: saved };
}

function ensureBudgetPlansSheetV7_() {
  const ss = spreadsheet_();
  let sheet = ss.getSheetByName(BUDGET_PLAN_SHEET_V7);
  if (!sheet) sheet = ss.insertSheet(BUDGET_PLAN_SHEET_V7);
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, BUDGET_PLAN_HEADERS_V7.length).setValues([BUDGET_PLAN_HEADERS_V7]);
    sheet.setFrozenRows(1);
  }
}

function readBudgetPlanRowsV7_() {
  ensureBudgetPlansSheetV7_();
  const sheet = spreadsheet_().getSheetByName(BUDGET_PLAN_SHEET_V7);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0].map(function(header) { return String(header || '').trim(); });
  return values.slice(1).filter(function(row) {
    return row.some(function(value) { return String(value || '').trim() !== ''; });
  }).map(function(row) {
    const object = {};
    headers.forEach(function(header, index) { if (header) object[header] = row[index]; });
    return object;
  });
}

function clearAndWriteBudgetPlansV7_(rows) {
  ensureBudgetPlansSheetV7_();
  const sheet = spreadsheet_().getSheetByName(BUDGET_PLAN_SHEET_V7);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, BUDGET_PLAN_HEADERS_V7.length).setValues([BUDGET_PLAN_HEADERS_V7]);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, BUDGET_PLAN_HEADERS_V7.length).setValues(rows.map(function(row) {
      return BUDGET_PLAN_HEADERS_V7.map(function(header) {
        return row[header] === undefined || row[header] === null ? '' : row[header];
      });
    }));
  }
  sheet.setFrozenRows(1);
}

function normalBudgetLineIdV7_(label) {
  return String(label || 'line').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
