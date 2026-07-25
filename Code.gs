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
    if (action === 'health') return json_({ ok: true, message: 'Budget API v7 route-debug 2026-07-25', supportedPostActions: ['bootstrap','createTransaction','createBucketTransfer','retireBucket','saveBudgetPlan','saveDetailedBudgetPlan'], timestamp: now_() });
    if (action === 'actions') return json_({ ok: true, version: 'Budget API v7 route-debug 2026-07-25', supportedPostActions: ['bootstrap','createTransaction','createBucketTransfer','retireBucket','saveBudgetPlan','saveDetailedBudgetPlan'], timestamp: now_() });
    validateToken_(queryParam_(e, 'token'));
    if (action === 'bootstrap') return json_(bootstrap_());
    return json_({ ok: false, error: 'Unknown GET action: ' + action, supportedGetActions: ['health','actions','bootstrap'] });
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

// --- v12 simplified budget backend with supporting tables ---
const V12_SHEETS = {
  BUDGET_INCOME: 'BudgetIncome',
  BUDGET_PLANNED_EXPENSES: 'BudgetPlannedExpenses',
  BUDGET_GENERATED_TRANSACTIONS: 'BudgetGeneratedTransactions'
};
const V12_HEADERS = {
  BudgetIncome: ['id','incomeName','amount','amountBasis','frequency','dayOfWeek','dayOfMonth','effectiveStartDate','effectiveEndDate','isActive','notes','createdAt','updatedAt'],
  BudgetPlannedExpenses: ['id','budgetMonth','bucketId','expenseName','frequency','dayOfWeek','amount','monthlyCalculatedAmount','autoGenerateTransaction','requiresManualActual','startDate','endDate','notes','createdAt','updatedAt'],
  BudgetGeneratedTransactions: ['id','sourceExpenseId','budgetMonth','transactionDate','bucketId','amount','status','createdTransactionId','notes','createdAt','updatedAt'],
  BudgetsV12: ['id','budgetMonth','bucketId','categoryId','allocationType','allocationValue','allocationBasis','plannedAmount','actualAmount','remainingAmount','notes','createdAt','updatedAt']
};

function doGet(e) {
  try {
    const action = queryParam_(e, 'action') || 'health';
    if (action === 'health') return json_({ ok: true, message: 'Budget API v12 simplified budgets', supportedPostActions: ['bootstrap','createTransaction','createBucketTransfer','retireBucket','saveBudgetPlan','saveSimplifiedBudgetPlan','saveBudgetIncome','saveBudgetPlannedExpense','generatePlannedTransactions'], timestamp: now_() });
    if (action === 'actions') return json_({ ok: true, version: 'Budget API v12 simplified budgets', supportedPostActions: ['bootstrap','createTransaction','createBucketTransfer','retireBucket','saveBudgetPlan','saveSimplifiedBudgetPlan','saveBudgetIncome','saveBudgetPlannedExpense','generatePlannedTransactions'], timestamp: now_() });
    validateToken_(queryParam_(e, 'token'));
    if (action === 'bootstrap') return json_(bootstrap_());
    return json_({ ok: false, error: 'Unknown GET action: ' + action, supportedGetActions: ['health','actions','bootstrap'] });
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
    if (action === 'saveSimplifiedBudgetPlan') return json_(saveSimplifiedBudgetPlan_(payload));
    if (action === 'saveBudgetIncome') return json_(saveBudgetIncome_(payload));
    if (action === 'saveBudgetPlannedExpense') return json_(saveBudgetPlannedExpense_(payload));
    if (action === 'deleteBudgetPlannedExpense') return json_(deleteBudgetPlannedExpense_(payload));
    if (action === 'generatePlannedTransactions') return json_(generatePlannedTransactions_(payload));
    return json_({ ok: false, error: 'Unknown POST action: ' + action });
  } catch (error) {
    return error_(error);
  }
}

function setupBudgetWorkbook() {
  ensureCoreSheets_();
  ensureV12Sheets_();
  return { ok: true, message: 'Workbook setup complete, including v12 budget support sheets.', timestamp: now_() };
}

function bootstrap_() {
  ensureCoreSheets_();
  ensureV12Sheets_();
  refreshBucketBalances_();
  return {
    ok: true,
    data: {
      transactions: readObjects_(SHEETS.TRANSACTIONS).filter(function(row) { return !row.deletedAt; }),
      categories: readObjects_(SHEETS.CATEGORIES),
      accounts: readObjects_(SHEETS.ACCOUNTS),
      budgets: readObjects_(SHEETS.BUDGETS),
      budgetIncome: readObjects_(V12_SHEETS.BUDGET_INCOME),
      budgetPlannedExpenses: readObjects_(V12_SHEETS.BUDGET_PLANNED_EXPENSES),
      budgetGeneratedTransactions: readObjects_(V12_SHEETS.BUDGET_GENERATED_TRANSACTIONS),
      bucketAliases: readObjects_(SHEETS.BUCKET_ALIASES),
      bucketTransfers: readObjects_(SHEETS.BUCKET_TRANSFERS).filter(function(row) { return !row.deletedAt; }),
      bucketBalances: readObjects_(SHEETS.BUCKET_BALANCES),
      incomeHistory: readObjects_(SHEETS.INCOME_HISTORY),
      settings: readSettings_()
    },
    timestamp: now_()
  };
}

function ensureV12Sheets_() {
  ensureSheetWithHeadersV12_(V12_SHEETS.BUDGET_INCOME, V12_HEADERS.BudgetIncome);
  ensureSheetWithHeadersV12_(V12_SHEETS.BUDGET_PLANNED_EXPENSES, V12_HEADERS.BudgetPlannedExpenses);
  ensureSheetWithHeadersV12_(V12_SHEETS.BUDGET_GENERATED_TRANSACTIONS, V12_HEADERS.BudgetGeneratedTransactions);
}

function ensureSheetWithHeadersV12_(sheetName, headers) {
  let sheet = spreadsheet_().getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet_().insertSheet(sheetName);
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function saveSimplifiedBudgetPlan_(payload) {
  const month = normalMonthV12_(payload.budgetMonth);
  if (!month) throw new Error('A budget month is required.');
  const rows = payload.rows || [];
  const existing = readObjects_(SHEETS.BUDGETS);
  const kept = existing.filter(function(row) { return normalMonthV12_(row.budgetMonth) !== month; });
  const now = now_();
  const saved = rows.map(function(row) {
    const bucketId = normalBucketId_(row.bucketId || row.categoryId);
    const allocationType = row.allocationType || 'fixed';
    const allocationValue = money_(row.allocationValue);
    const plannedAmount = money_(row.plannedAmount);
    return {
      id: row.id || 'budget_' + month.replace('-', '_') + '_' + bucketId,
      budgetMonth: month,
      bucketId: bucketId,
      categoryId: row.categoryId || 'cat_' + bucketId,
      allocationType: allocationType,
      allocationValue: allocationValue,
      allocationBasis: row.allocationBasis || 'net_income',
      plannedAmount: plannedAmount,
      actualAmount: money_(row.actualAmount),
      remainingAmount: money_(row.remainingAmount),
      notes: row.notes || '',
      createdAt: row.createdAt || now,
      updatedAt: now
    };
  });
  clearAndWriteWithHeadersV12_(SHEETS.BUDGETS, V12_HEADERS.BudgetsV12, kept.concat(saved));
  audit_('save', 'simplifiedBudgetPlan', month, '', saved);
  return { ok: true, budgets: saved };
}

function saveBudgetIncome_(payload) {
  ensureV12Sheets_();
  const now = now_();
  const newStart = normalDateV12_(payload.effectiveStartDate || today_());
  const income = {
    id: payload.id || id_('income'),
    incomeName: payload.incomeName || 'Income',
    amount: money_(payload.amount),
    amountBasis: payload.amountBasis || 'net',
    frequency: payload.frequency || 'weekly',
    dayOfWeek: payload.dayOfWeek === undefined ? '' : String(payload.dayOfWeek),
    dayOfMonth: payload.dayOfMonth || 1,
    effectiveStartDate: newStart,
    effectiveEndDate: payload.effectiveEndDate || '',
    isActive: payload.isActive === undefined ? true : payload.isActive,
    notes: payload.notes || '',
    createdAt: payload.createdAt || now,
    updatedAt: now
  };
  const existing = readObjects_(V12_SHEETS.BUDGET_INCOME).map(function(row) {
    if (!payload.id && row.incomeName === income.incomeName && !row.effectiveEndDate && normalDateV12_(row.effectiveStartDate) < newStart) {
      const end = new Date(newStart + 'T00:00:00');
      end.setDate(end.getDate() - 1);
      row.effectiveEndDate = end.toISOString().slice(0, 10);
      row.updatedAt = now;
    }
    return row;
  }).filter(function(row) { return row.id !== income.id; });
  clearAndWriteWithHeadersV12_(V12_SHEETS.BUDGET_INCOME, V12_HEADERS.BudgetIncome, existing.concat([income]));
  audit_('save', 'budgetIncome', income.id, '', income);
  return { ok: true, income: income };
}

function saveBudgetPlannedExpense_(payload) {
  ensureV12Sheets_();
  const month = normalMonthV12_(payload.budgetMonth || today_().slice(0, 7));
  const bucketId = normalBucketId_(payload.bucketId);
  const now = now_();
  const expense = {
    id: payload.id || id_('planned_expense'),
    budgetMonth: month,
    bucketId: bucketId,
    expenseName: payload.expenseName || 'Planned Expense',
    frequency: payload.frequency || 'monthly',
    dayOfWeek: payload.dayOfWeek === undefined ? '' : String(payload.dayOfWeek),
    amount: money_(payload.amount),
    monthlyCalculatedAmount: calculatePlannedExpenseMonthlyAmountV12_(payload, month),
    autoGenerateTransaction: payload.autoGenerateTransaction === undefined ? true : payload.autoGenerateTransaction,
    requiresManualActual: payload.requiresManualActual === true || String(payload.requiresManualActual).toLowerCase() === 'true',
    startDate: payload.startDate || month + '-01',
    endDate: payload.endDate || '',
    notes: payload.notes || '',
    createdAt: payload.createdAt || now,
    updatedAt: now
  };
  const existing = readObjects_(V12_SHEETS.BUDGET_PLANNED_EXPENSES).filter(function(row) { return row.id !== expense.id; });
  clearAndWriteWithHeadersV12_(V12_SHEETS.BUDGET_PLANNED_EXPENSES, V12_HEADERS.BudgetPlannedExpenses, existing.concat([expense]));
  audit_('save', 'budgetPlannedExpense', expense.id, '', expense);
  return { ok: true, expense: expense };
}

function deleteBudgetPlannedExpense_(payload) {
  const id = payload.id;
  if (!id) throw new Error('Planned expense id is required.');
  const kept = readObjects_(V12_SHEETS.BUDGET_PLANNED_EXPENSES).filter(function(row) { return row.id !== id; });
  clearAndWriteWithHeadersV12_(V12_SHEETS.BUDGET_PLANNED_EXPENSES, V12_HEADERS.BudgetPlannedExpenses, kept);
  audit_('delete', 'budgetPlannedExpense', id, '', '');
  return { ok: true, deletedId: id };
}

function generatePlannedTransactions_(payload) {
  const month = normalMonthV12_(payload.budgetMonth || today_().slice(0, 7));
  ensureV12Sheets_();
  const expenses = readPlannedExpensesForMonthV12_(month).filter(function(expense) {
    return normalBoolV12_(expense.autoGenerateTransaction) && !normalBoolV12_(expense.requiresManualActual);
  });
  const existingGenerated = readObjects_(V12_SHEETS.BUDGET_GENERATED_TRANSACTIONS);
  const generatedThisMonth = existingGenerated.filter(function(row) { return normalMonthV12_(row.budgetMonth) === month; });
  const generated = [];
  const transactions = [];
  expenses.forEach(function(expense) {
    const already = generatedThisMonth.some(function(row) { return row.sourceExpenseId === expense.id; });
    if (already) return;
    const amount = calculatePlannedExpenseMonthlyAmountV12_(expense, month);
    if (!amount) return;
    const transaction = createTransaction_({
      transactionDate: month + '-01',
      description: 'Planned allocation: ' + expense.expenseName,
      merchant: '25 Ducats Budget',
      amount: amount,
      transactionType: 'allocation',
      bucketId: expense.bucketId,
      categoryId: 'cat_' + normalBucketId_(expense.bucketId),
      accountId: 'acct_' + normalBucketId_(expense.bucketId),
      sourceBucket: bucketName_(expense.bucketId),
      notes: 'Auto-generated from planned expense ' + expense.id
    }).transaction;
    const generatedRow = {
      id: id_('generated_budget_txn'),
      sourceExpenseId: expense.id,
      budgetMonth: month,
      transactionDate: month + '-01',
      bucketId: normalBucketId_(expense.bucketId),
      amount: amount,
      status: 'generated',
      createdTransactionId: transaction.id,
      notes: expense.expenseName,
      createdAt: now_(),
      updatedAt: now_()
    };
    generated.push(generatedRow);
    transactions.push(transaction);
  });
  clearAndWriteWithHeadersV12_(V12_SHEETS.BUDGET_GENERATED_TRANSACTIONS, V12_HEADERS.BudgetGeneratedTransactions, existingGenerated.concat(generated));
  return { ok: true, generatedCount: generated.length, generatedTransactions: existingGenerated.concat(generated), transactions: transactions };
}

function readPlannedExpensesForMonthV12_(month) {
  const all = readObjects_(V12_SHEETS.BUDGET_PLANNED_EXPENSES);
  const exact = all.filter(function(row) { return normalMonthV12_(row.budgetMonth) === month; });
  if (exact.length) return exact;
  const prior = all.map(function(row) { return normalMonthV12_(row.budgetMonth); }).filter(function(m) { return m && m < month; }).sort().pop();
  return prior ? all.filter(function(row) { return normalMonthV12_(row.budgetMonth) === prior; }).map(function(row) { row.budgetMonth = month; return row; }) : [];
}

function calculatePlannedExpenseMonthlyAmountV12_(expense, month) {
  const amount = money_(expense.amount);
  if (expense.frequency === 'weekly') return Math.round(amount * countWeekdayInMonthV12_(month, Number(expense.dayOfWeek || 0)) * 100) / 100;
  return Math.round(amount * 100) / 100;
}

function countWeekdayInMonthV12_(month, weekday) {
  const start = new Date(month + '-01T00:00:00');
  const last = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  let count = 0;
  for (let d = new Date(start); d <= last; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === weekday) count += 1;
  }
  return count;
}

function clearAndWriteWithHeadersV12_(sheetName, headers, rows) {
  let sheet = spreadsheet_().getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet_().insertSheet(sheetName);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows.map(function(row) {
      return headers.map(function(header) { return row[header] === undefined || row[header] === null ? '' : row[header]; });
    }));
  }
  sheet.setFrozenRows(1);
}

function normalMonthV12_(value) {
  if (!value) return '';
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 7);
  const text = String(value).trim();
  if (/^\d{4}-\d{2}/.test(text)) return text.slice(0, 7);
  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 7);
}

function normalDateV12_(value) {
  if (!value) return '';
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
}

function normalBoolV12_(value) {
  if (value === true || value === false) return value;
  const text = String(value || '').toLowerCase().trim();
  return text === 'true' || text === 'yes' || text === '1';
}

// --- v14 drill-down support: update transactions, delete income, and budget line item fields ---
function doPost(e) {
  try {
    const body = parseBody_(e);
    validateToken_(body.token);
    const action = body.action;
    const payload = body.payload || {};
    if (action === 'bootstrap') return json_(bootstrap_());
    if (action === 'createTransaction') return json_(createTransaction_(payload));
    if (action === 'updateTransaction') return json_(updateTransaction_(payload));
    if (action === 'createBucketTransfer') return json_(createBucketTransfer_(payload));
    if (action === 'retireBucket') return json_(retireBucket_(payload));
    if (action === 'saveBudgetPlan') return json_(saveBudgetPlan_(payload));
    if (action === 'saveDetailedBudgetPlan') return json_(saveDetailedBudgetPlan_(payload));
    if (action === 'saveSimplifiedBudgetPlan') return json_(saveSimplifiedBudgetPlan_(payload));
    if (action === 'saveBudgetIncome') return json_(saveBudgetIncome_(payload));
    if (action === 'deleteBudgetIncome') return json_(deleteBudgetIncome_(payload));
    if (action === 'saveBudgetPlannedExpense') return json_(saveBudgetPlannedExpense_(payload));
    if (action === 'deleteBudgetPlannedExpense') return json_(deleteBudgetPlannedExpense_(payload));
    if (action === 'generatePlannedTransactions') return json_(generatePlannedTransactions_(payload));
    return json_({ ok: false, error: 'Unknown POST action: ' + action });
  } catch (error) {
    return error_(error);
  }
}

function updateTransaction_(payload) {
  if (!payload.id) throw new Error('Transaction id is required.');
  const found = findByField_(SHEETS.TRANSACTIONS, 'id', payload.id);
  if (!found) throw new Error('Could not find transaction: ' + payload.id);
  const before = found.object;
  const bucketId = normalBucketId_(payload.bucketId || payload.accountId || before.bucketId || before.accountId);
  const after = Object.assign({}, before, {
    transactionDate: payload.transactionDate || before.transactionDate || today_(),
    description: payload.description === undefined ? before.description : payload.description,
    merchant: payload.merchant === undefined ? before.merchant : payload.merchant,
    amount: money_(payload.amount),
    transactionType: payload.transactionType || before.transactionType || (money_(payload.amount) < 0 ? 'expense' : money_(payload.amount) > 0 ? 'allocation' : 'adjustment'),
    bucketId: bucketId,
    categoryId: payload.categoryId || 'cat_' + bucketId,
    accountId: payload.accountId || 'acct_' + bucketId,
    sourceBucket: payload.sourceBucket || bucketName_(bucketId),
    notes: payload.notes === undefined ? before.notes : payload.notes,
    updatedAt: now_()
  });
  writeObjectToRow_(SHEETS.TRANSACTIONS, found.rowNumber, after);
  refreshBucketBalances_();
  audit_('update', 'transaction', payload.id, before, after);
  return { ok: true, transaction: after };
}

function deleteBudgetIncome_(payload) {
  const id = payload.id;
  if (!id) throw new Error('Income id is required.');
  const kept = readObjects_(V12_SHEETS.BUDGET_INCOME).filter(function(row) { return row.id !== id; });
  clearAndWriteWithHeadersV12_(V12_SHEETS.BUDGET_INCOME, V12_HEADERS.BudgetIncome, kept);
  audit_('delete', 'budgetIncome', id, '', '');
  return { ok: true, deletedId: id };
}

function saveBudgetPlannedExpense_(payload) {
  ensureV12Sheets_();
  const month = normalMonthV12_(payload.budgetMonth || today_().slice(0, 7));
  const bucketId = normalBucketId_(payload.bucketId);
  const now = now_();
  const expense = {
    id: payload.id || id_('planned_expense'),
    budgetMonth: month,
    bucketId: bucketId,
    expenseName: payload.expenseName || 'Planned Expense',
    budgetCategory: payload.budgetCategory || 'other',
    allocationType: payload.allocationType || 'fixed',
    allocationBasis: payload.allocationBasis || 'net_income',
    frequency: payload.frequency || 'monthly',
    dayOfWeek: payload.dayOfWeek === undefined ? '' : String(payload.dayOfWeek),
    amount: money_(payload.amount),
    monthlyCalculatedAmount: calculatePlannedExpenseMonthlyAmountV14_(payload, month),
    autoGenerateTransaction: payload.autoGenerateTransaction === undefined ? true : payload.autoGenerateTransaction,
    requiresManualActual: payload.requiresManualActual === true || String(payload.requiresManualActual).toLowerCase() === 'true',
    startDate: payload.startDate || month + '-01',
    endDate: payload.endDate || '',
    notes: payload.notes || '',
    createdAt: payload.createdAt || now,
    updatedAt: now
  };
  const existing = readObjects_(V12_SHEETS.BUDGET_PLANNED_EXPENSES).filter(function(row) { return row.id !== expense.id; });
  const headers = ['id','budgetMonth','bucketId','expenseName','budgetCategory','allocationType','allocationBasis','frequency','dayOfWeek','amount','monthlyCalculatedAmount','autoGenerateTransaction','requiresManualActual','startDate','endDate','notes','createdAt','updatedAt'];
  clearAndWriteWithHeadersV12_(V12_SHEETS.BUDGET_PLANNED_EXPENSES, headers, existing.concat([expense]));
  audit_('save', 'budgetPlannedExpense', expense.id, '', expense);
  return { ok: true, expense: expense };
}

function calculatePlannedExpenseMonthlyAmountV14_(expense, month) {
  const amount = money_(expense.amount);
  if (expense.frequency === 'weekly') return Math.round(amount * countWeekdayInMonthV12_(month, Number(expense.dayOfWeek || 0)) * 100) / 100;
  return Math.round(amount * 100) / 100;
}

// v14 percentage line-item calculation support for server-generated planned transactions.
function calculatePlannedExpenseMonthlyAmountV14_(expense, month) {
  let amount = money_(expense.amount);
  if ((expense.allocationType || 'fixed') === 'percentage') {
    const forecast = incomeForecastV14_(month);
    amount = basisAmountV14_(expense.allocationBasis || 'net_income', forecast) * (money_(expense.amount) / 100);
  }
  if (expense.frequency === 'weekly') return Math.round(amount * countWeekdayInMonthV12_(month, Number(expense.dayOfWeek || 0)) * 100) / 100;
  return Math.round(amount * 100) / 100;
}

function incomeForecastV14_(month) {
  const schedules = readObjects_(V12_SHEETS.BUDGET_INCOME).filter(function(row) {
    return row.isActive !== false && String(row.isActive).toLowerCase() !== 'false' && incomeRelevantV14_(row, month);
  });
  let gross = 0;
  let net = 0;
  schedules.forEach(function(row) {
    const amount = incomeAmountForMonthV14_(row, month);
    if (row.amountBasis === 'gross') gross += amount;
    else net += amount;
  });
  if (!gross && net) gross = net;
  if (!net && gross) net = gross;
  return { gross: gross, net: net };
}

function incomeRelevantV14_(row, month) {
  const start = new Date(month + '-01T00:00:00');
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const effStart = row.effectiveStartDate ? new Date(normalDateV12_(row.effectiveStartDate) + 'T00:00:00') : start;
  const effEnd = row.effectiveEndDate ? new Date(normalDateV12_(row.effectiveEndDate) + 'T00:00:00') : null;
  return effStart <= end && (!effEnd || effEnd >= start);
}

function incomeAmountForMonthV14_(row, month) {
  const amount = money_(row.amount);
  if (row.frequency === 'monthly') return amount;
  if (row.frequency === 'weekly') return amount * countWeekdayInMonthV12_(month, Number(row.dayOfWeek || 0));
  if (row.frequency === 'biweekly') return amount * countBiweeklyDatesInMonthV14_(month, row.effectiveStartDate || (month + '-01'));
  return amount;
}

function countBiweeklyDatesInMonthV14_(month, anchorDateText) {
  const start = new Date(month + '-01T00:00:00');
  const last = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  let anchor = new Date(normalDateV12_(anchorDateText) + 'T00:00:00');
  while (anchor > start) anchor.setDate(anchor.getDate() - 14);
  let count = 0;
  for (let d = new Date(anchor); d <= last; d.setDate(d.getDate() + 14)) {
    if (d >= start && d <= last) count += 1;
  }
  return count;
}

function basisAmountV14_(basis, forecast) {
  if (basis === 'gross_income') return forecast.gross || 0;
  return forecast.net || forecast.gross || 0;
}

// --- v15 transaction soft-delete support ---
function doPost(e) {
  try {
    const body = parseBody_(e);
    validateToken_(body.token);
    const action = body.action;
    const payload = body.payload || {};
    if (action === 'bootstrap') return json_(bootstrap_());
    if (action === 'createTransaction') return json_(createTransaction_(payload));
    if (action === 'updateTransaction') return json_(updateTransaction_(payload));
    if (action === 'deleteTransaction') return json_(deleteTransaction_(payload));
    if (action === 'createBucketTransfer') return json_(createBucketTransfer_(payload));
    if (action === 'retireBucket') return json_(retireBucket_(payload));
    if (action === 'saveBudgetPlan') return json_(saveBudgetPlan_(payload));
    if (action === 'saveDetailedBudgetPlan') return json_(saveDetailedBudgetPlan_(payload));
    if (action === 'saveSimplifiedBudgetPlan') return json_(saveSimplifiedBudgetPlan_(payload));
    if (action === 'saveBudgetIncome') return json_(saveBudgetIncome_(payload));
    if (action === 'deleteBudgetIncome') return json_(deleteBudgetIncome_(payload));
    if (action === 'saveBudgetPlannedExpense') return json_(saveBudgetPlannedExpense_(payload));
    if (action === 'deleteBudgetPlannedExpense') return json_(deleteBudgetPlannedExpense_(payload));
    if (action === 'generatePlannedTransactions') return json_(generatePlannedTransactions_(payload));
    return json_({ ok: false, error: 'Unknown POST action: ' + action });
  } catch (error) {
    return error_(error);
  }
}

function deleteTransaction_(payload) {
  if (!payload.id) throw new Error('Transaction id is required.');
  const found = findByField_(SHEETS.TRANSACTIONS, 'id', payload.id);
  if (!found) throw new Error('Could not find transaction: ' + payload.id);
  const before = found.object;
  const after = Object.assign({}, before, {
    deletedAt: now_(),
    updatedAt: now_()
  });
  writeObjectToRow_(SHEETS.TRANSACTIONS, found.rowNumber, after);
  refreshBucketBalances_();
  audit_('delete', 'transaction', payload.id, before, after);
  return { ok: true, deletedId: payload.id, transaction: after };
}
