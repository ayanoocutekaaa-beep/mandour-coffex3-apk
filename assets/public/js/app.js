const BASE_BEANS = [
  {
    id: "brazil-santos",
    name: "برازيلي سانتوس",
    pricePerKg: 800,
    image: "assets/beans/real2/brazil-santos.jpg",
    builtIn: true,
  },
  {
    id: "colombian",
    name: "كولومبي",
    pricePerKg: 1000,
    image: "assets/beans/real2/colombian.jpg",
    builtIn: true,
  },
  {
    id: "ethiopian",
    name: "حبشي",
    pricePerKg: 700,
    image: "assets/beans/real2/ethiopian.jpg",
    builtIn: true,
  },
  {
    id: "indonesian",
    name: "إندونيسي",
    pricePerKg: 600,
    image: "assets/beans/real2/indonesian.jpg",
    builtIn: true,
  },
  {
    id: "indian-arika",
    name: "هندي اريكا",
    pricePerKg: 800,
    image: "assets/beans/real2/indian-arika.jpg",
    builtIn: true,
  },
  {
    id: "brazil-robusta",
    name: "برازيلي روبستا",
    pricePerKg: 600,
    image: "assets/beans/real2/brazil-robusta.jpg",
    builtIn: true,
  },
  {
    id: "hindri-robusta",
    name: "هندري روبستا",
    pricePerKg: 600,
    image: "assets/beans/real2/hindri-robusta.jpg",
    builtIn: true,
  },
  {
    id: "vietnamese",
    name: "فيتنامي",
    pricePerKg: 600,
    image: "assets/beans/real2/vietnamese.jpg",
    builtIn: true,
  },
];
const STORE_KEY = "mandour-coffee-manager-v3";
const LocalNotifications =
  window.Capacitor?.Plugins?.LocalNotifications ||
  window.Capacitor?.registerPlugin?.("LocalNotifications") ||
  null;
let notifSyncTimer = null;

function queueLocalCheckNotificationSync() {
  if (!LocalNotifications) return;
  clearTimeout(notifSyncTimer);
  notifSyncTimer = setTimeout(() => {
    syncLocalCheckNotifications().catch((error) => {
      console.error("Local notification sync failed:", error);
    });
  }, 700);
}

const fmt = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("ar-EG", {
  dateStyle: "medium",
  timeStyle: "short",
});
const dateOnlyFmt = new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" });
let data = loadData();
(function migrateItemDiscounts() {
  let changed = false;
  (data.checks || []).forEach((check) => {
    (check.guests || []).forEach((guest) => {
      (guest.items || []).forEach((item) => {
        if (item.discount !== undefined && item.lineDiscount === undefined) {
          item.lineDiscount =
            (Number(item.discount) || 0) * (Number(item.qty) || 0);
          delete item.discount;
          changed = true;
        }
      });
    });
  });
  if (changed) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) {}
  }
})();
let invoiceGrams = {};
let roastMode = "sada";
let documentType = "receipt";
let paymentMethod = "cash";
let invoiceLineage = null;
let invoiceCustomerContext = null;
let pendingDeleteInvoiceId = null;
let activeReceipt = null;
let currentView = "home";
let navigationToken = 0;
let recipeLines = [{ beanId: BASE_BEANS[0].id, grams: "" }];
let pendingPhoto = "";
let toastTimer;
function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    return {
      customBeans: Array.isArray(saved.customBeans) ? saved.customBeans : [],
      customers: Array.isArray(saved.customers) ? saved.customers : [],
      invoices: Array.isArray(saved.invoices) ? saved.invoices : [],
      deletedInvoices: Array.isArray(saved.deletedInvoices) ? saved.deletedInvoices : [],
      checks: Array.isArray(saved.checks) ? saved.checks : [],
      paymentQrs:
        saved.paymentQrs && typeof saved.paymentQrs === "object"
          ? saved.paymentQrs
          : {},
      activityLog: Array.isArray(saved.activityLog) ? saved.activityLog : [],
      notifications: Array.isArray(saved.notifications) ? saved.notifications : [],
      inventory: Array.isArray(saved.inventory) ? saved.inventory : [],
      loyalty: saved.loyalty && typeof saved.loyalty === "object" ? saved.loyalty : {},
      staffName: String(saved.staffName || ""),
      auditActor: String(saved.auditActor || ""),
    };
  } catch {
    return {
      customBeans: [],
      customers: [],
      invoices: [],
      deletedInvoices: [],
      checks: [],
      paymentQrs: {},
      activityLog: [],
      notifications: [],
      inventory: [],
      loyalty: {},
      staffName: "",
      auditActor: "",
    };
  }
}
let lastPersistedState = JSON.stringify(data);
let lastUndoSnapshot = null;
let suppressUndoCapture = false;
let changeBackupTimer = null;
let lastChangeBackupDescription = "تعديل";
function describeDataChange(before, after) {
  const byId = (rows) =>
    new Map(
      (Array.isArray(rows) ? rows : []).map((row) => [
        String(row?.id ?? ""),
        row,
      ]),
    );
  const summaries = [];
  for (const [key, label] of [
    ["checks", "شيك"],
    ["customers", "عميل"],
    ["invoices", "فاتورة"],
    ["customBeans", "نوع بن"],
  ]) {
    const oldRows = byId(before[key]),
      newRows = byId(after[key]);
    for (const [id, row] of oldRows) {
      if (!newRows.has(id)) {
        const name =
          row?.tableName || row?.customer || row?.name || row?.number || id;
        summaries.push(`حذف ${label}: ${String(name).slice(0, 60)}`);
        continue;
      }
      const updated = newRows.get(id);
      if (JSON.stringify(row) === JSON.stringify(updated)) continue;
      if (key === "checks") {
        const oldPaid = JSON.stringify(
          (row.guests || []).map((g) =>
            (g.items || []).map((i) => i.paidQty || 0),
          ),
        );
        const newPaid = JSON.stringify(
          (updated.guests || []).map((g) =>
            (g.items || []).map((i) => i.paidQty || 0),
          ),
        );
        summaries.push(
          oldPaid !== newPaid
            ? `تسجيل/تعديل دفعة في شيك ${row.tableName || (row.guests || []).map((g) => g.name).join("، ") || id}`
            : `تعديل شيك ${row.tableName || (row.guests || []).map((g) => g.name).join("، ") || id}`,
        );
      } else
        summaries.push(
          `تعديل ${label}: ${String(row?.customer || row?.name || row?.number || id).slice(0, 60)}`,
        );
    }
    for (const [id, row] of newRows)
      if (!oldRows.has(id)) {
        const name =
          row?.tableName || row?.customer || row?.name || row?.number || id;
        summaries.push(`إضافة ${label}: ${String(name).slice(0, 60)}`);
      }
  }
  if (
    JSON.stringify(before.paymentQrs || {}) !==
    JSON.stringify(after.paymentQrs || {})
  )
    summaries.push("تعديل بيانات رمز الدفع");
  return summaries.slice(0, 3).join(" · ") || "";
}
function renderActivityLog() {
  const list = document.getElementById("activity-list");
  const actor = document.getElementById("audit-actor");
  const undo = document.getElementById("undo-last-operation");
  if (actor && document.activeElement !== actor)
    actor.value = data.auditActor || "";
  if (undo) {
    undo.disabled = !lastUndoSnapshot;
    undo.textContent = lastUndoSnapshot
      ? "↶ تراجع عن آخر حفظ"
      : "لا يوجد إجراء للتراجع عنه";
  }
  if (!list) return;
  const entries = (data.activityLog || []).slice(0, 80);
  list.innerHTML = entries.length
    ? entries
        .map(
          (item) =>
            `<div class="audit-entry"><strong>${escapeHTML(item.description || "تعديل بيانات")}</strong><small>${escapeHTML(item.actor || "مستخدم الجهاز")} · ${escapeHTML(Number.isFinite(new Date(item.at).getTime()) ? dateFmt.format(new Date(item.at)) : "وقت غير محدد")}</small></div>`,
        )
        .join("")
    : '<div class="empty">سوف تظهر هنا التعديلات والدفعات والحذوفات الجديدة.</div>';
}
function persist() {
  const previous = lastPersistedState;
  const previousUndoSnapshot = lastUndoSnapshot;
  const before = previous ? JSON.parse(previous) : null;
  if (before && !suppressUndoCapture) {
    const description = describeDataChange(before, data);
    if (description) {
      lastUndoSnapshot = previous;
      data.activityLog = Array.isArray(data.activityLog)
        ? data.activityLog
        : [];
      data.activityLog.unshift({
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        at: new Date().toISOString(),
        actor: data.auditActor || "مستخدم الجهاز",
        description,
      });
      data.activityLog = data.activityLog.slice(0, 300);
    }
  }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
    lastPersistedState = JSON.stringify(data);
  } catch (error) {
    if (before) {
      data = before;
      lastPersistedState = previous;
    }
    lastUndoSnapshot = previousUndoSnapshot;
    throw error;
  }
  renderActivityLog();
  globalSearchRender();
  queueLocalCheckNotificationSync();
  const changeDescription = describeDataChange(before, data) || "تعديل البيانات";
  lastChangeBackupDescription = changeDescription;
  scheduleChangeBackup(changeDescription);
  scheduleAutoBackupCheck();
}

function backupSnapshot() {
  return {
    format: "mandour-coffee-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    app: "Mandour Coffee",
    data: JSON.parse(JSON.stringify(data)),
  };
}
function backupFileName() {
  return "Ayanoo.json";
}
function backupDateTimeStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}
function backupOperationLabel(description) {
  const text = String(description || "");
  if (text.includes("دفعة") || text.includes("دفع")) return "Payment";
  if (text.includes("شيك") || text.includes("طلب")) return "Order";
  if (text.includes("فاتورة")) return "Invoice";
  if (text.includes("مخزون")) return "Inventory";
  if (text.includes("عميل")) return "Customer";
  if (text.includes("بن")) return "Products";
  return "DataChange";
}
function changeBackupFileName(description = "تعديل") {
  return "Ayanoo.json";
}
function rememberBackupFile(fileName) {
  try {
    const names = JSON.parse(localStorage.getItem("mandour-backup-history") || "[]");
    names.unshift(fileName);
    localStorage.setItem("mandour-backup-history", JSON.stringify([...new Set(names)].slice(0, 30)));
  } catch {}
}
function scheduleChangeBackup(description) {
  clearTimeout(changeBackupTimer);
  changeBackupTimer = setTimeout(() => saveChangeBackup(description), 650);
}
function saveChangeBackup(description = "تعديل") {
  const fileName = changeBackupFileName(description);
  const json = JSON.stringify(backupSnapshot(), null, 2);
  const bridge = window.MandourNative;
  try {
    if (bridge?.saveBackupToChosenFolder && bridge?.getFolderName?.("backup")) {
      bridge.saveBackupToChosenFolder(json, fileName);
      rememberBackupFile(fileName);
      markBackupDone();
      return;
    }
    if (bridge?.saveBackup) {
      bridge.saveBackup(json, fileName);
      rememberBackupFile(fileName);
      markBackupDone();
      return;
    }
  } catch (error) {
    console.warn("Automatic backup failed", error);
  }
}
function markBackupDone() {
  try {
    localStorage.setItem("mandour-last-backup", new Date().toISOString());
  } catch {}
  updateBackupBanner();
}
function updateBackupBanner() {
  const banner = document.getElementById("backup-reminder");
  if (!banner) return;
  let last = null;
  try {
    last = localStorage.getItem("mandour-last-backup");
  } catch {}
  if (!last) {
    banner.hidden = false;
    banner.querySelector("small").textContent = "لسه مفيش نسخة احتياطية";
    return;
  }
  const days = Math.floor(
    (Date.now() - new Date(last).getTime()) / (24 * 60 * 60 * 1000),
  );
  if (days >= 1) {
    banner.hidden = false;
    banner.querySelector("small").textContent =
      `آخر نسخة احتياطية كانت من ${fmt.format(days)} يوم`;
  } else banner.hidden = true;
}
function downloadBackup() {
  const json = JSON.stringify(backupSnapshot(), null, 2);
  if (window.MandourNative?.saveBackup) {
    window.MandourNative.saveBackup(json, backupFileName());
    rememberBackupFile(backupFileName());
    markBackupDone();
    return;
  }
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  markBackupDone();
  rememberBackupFile(backupFileName());
  notify("تم تجهيز نسخة البيانات للتنزيل");
}
async function shareBackup() {
  const blob = new Blob([JSON.stringify(backupSnapshot(), null, 2)], {
    type: "application/json",
  });
  const file = new File([blob], backupFileName(), { type: "application/json" });
  if (
    navigator.share &&
    (!navigator.canShare || navigator.canShare({ files: [file] }))
  ) {
    try {
      await navigator.share({
        title: "نسخة بيانات مندور كوفي",
        text: "نسخة احتياطية كاملة لبيانات التطبيق",
        files: [file],
      });
      markBackupDone();
      notify("تم فتح المشاركة");
    } catch (error) {
      if (error?.name !== "AbortError") downloadBackup();
    }
    return;
  }
  downloadBackup();
}
function normalizeImportedData(value) {
  const candidate =
    value?.format === "mandour-coffee-backup" ? value.data : value;
  if (!candidate || typeof candidate !== "object")
    throw new Error("الملف ليس نسخة بيانات صحيحة");
  const result = {
    customBeans: Array.isArray(candidate.customBeans)
      ? candidate.customBeans
      : [],
    customers: Array.isArray(candidate.customers) ? candidate.customers : [],
    invoices: Array.isArray(candidate.invoices) ? candidate.invoices : [],
    deletedInvoices: Array.isArray(candidate.deletedInvoices) ? candidate.deletedInvoices : [],
    checks: Array.isArray(candidate.checks) ? candidate.checks : [],
    paymentQrs:
      candidate.paymentQrs && typeof candidate.paymentQrs === "object"
        ? candidate.paymentQrs
        : {},
    activityLog: Array.isArray(candidate.activityLog)
      ? candidate.activityLog
      : [],
    notifications: Array.isArray(candidate.notifications)
      ? candidate.notifications
      : [],
    inventory: Array.isArray(candidate.inventory) ? candidate.inventory : [],
    loyalty: candidate.loyalty && typeof candidate.loyalty === "object" ? candidate.loyalty : {},
    staffName: String(candidate.staffName || ""),
    auditActor: String(candidate.auditActor || ""),
  };
  if (
    !result.customBeans.length &&
    !result.customers.length &&
    !result.invoices.length &&
    !result.checks.length &&
    !Object.keys(result.paymentQrs).length
  )
    throw new Error("النسخة لا تحتوي على بيانات محفوظة");
  return result;
}
function stableBackupStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + value.map(stableBackupStringify).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map(
        (key) => JSON.stringify(key) + ":" + stableBackupStringify(value[key]),
      )
      .join(",") +
    "}"
  );
}
function mergeBackupRecords(current, incoming) {
  const merged = [...current];
  const seen = new Set(
    current.map((item) =>
      item && item.id != null
        ? "id:" + String(item.id)
        : "value:" + stableBackupStringify(item),
    ),
  );
  let added = 0;
  for (const item of incoming) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const key =
      item.id != null
        ? "id:" + String(item.id)
        : "value:" + stableBackupStringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
    added++;
  }
  return { items: merged, added };
}
function mergeImportedData(imported) {
  const next = { ...data };
  const added = {};
  for (const key of ["customers", "customBeans", "invoices", "checks"]) {
    const result = mergeBackupRecords(
      Array.isArray(data[key]) ? data[key] : [],
      Array.isArray(imported[key]) ? imported[key] : [],
    );
    next[key] = result.items;
    added[key] = result.added;
  }
  next.activityLog = [...(data.activityLog || [])];
  const logIds = new Set(next.activityLog.map((x) => x.id));
  for (const entry of imported.activityLog || [])
    if (entry?.id && !logIds.has(entry.id)) {
      next.activityLog.push(entry);
      logIds.add(entry.id);
    }
  next.activityLog = next.activityLog
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
    .slice(0, 300);
  next.auditActor = data.auditActor || imported.auditActor || "";
  next.paymentQrs = {
    ...(imported.paymentQrs || {}),
    ...(data.paymentQrs || {}),
  };
  added.paymentQrs = Object.keys(next.paymentQrs).filter(
    (key) => !data.paymentQrs?.[key] && !!imported.paymentQrs?.[key],
  ).length;
  return { data: next, added };
}
function importBackupFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = normalizeImportedData(JSON.parse(reader.result));
      const total = [
        imported.invoices.length,
        imported.checks.length,
        imported.customers.length,
        imported.customBeans.length,
      ].reduce((a, b) => a + b, 0);
      if (!total && !Object.keys(imported.paymentQrs).length)
        throw new Error("الملف لا تحتوي على بيانات محفوظة");
      const result = mergeImportedData(imported);
      const newTotal = Object.values(result.added).reduce((a, b) => a + b, 0);
      if (
        !confirm(
          `سيتم دمج بيانات النسخة مع بيانات التطبيق الحالية. سيُضاف ${fmt.format(newTotal)} سجل جديد، وستبقى البيانات الموجودة كما هي. العناصر المكررة لن تُضاف مرة أخرى. هل تريد المتابعة؟`,
        )
      )
        return;
      const previous = data;
      data = result.data;
      try {
        persist();
      } catch (storageError) {
        data = previous;
        throw new Error(
          "مساحة حفظ التطبيق غير كافية لإتمام الدمج؛ لم يتم تغيير البيانات",
        );
      }
      const summary = `عملاء ${result.added.customers}، توليفات ${result.added.customBeans}، فواتير ${result.added.invoices}، شيكات ${result.added.checks}`;
      notify(
        newTotal
          ? `تم الدمج بنجاح: ${summary}`
          : "لا توجد سجلات جديدة؛ البيانات الحالية محفوظة",
      );
      setTimeout(() => location.reload(), 900);
    } catch (error) {
      notify(error.message || "تعذر قراءة ملف البيانات");
    }
  };
  reader.onerror = () => notify("تعذرت قراءة الملف");
  reader.readAsText(file);
}

function purgeExpiredInvoices() {
  const today = localDateValue();
  const kept = data.invoices.filter(
    (invoice) =>
      !(
        /^\d{4}-\d{2}-\d{2}$/.test(String(invoice.autoDeleteAt || "")) &&
        invoice.autoDeleteAt <= today
      ),
  );
  const removed = data.invoices.length - kept.length;
  if (!removed) return 0;
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ ...data, invoices: kept }),
    );
    data.invoices = kept;
    return removed;
  } catch {
    return 0;
  }
}
const expiredInvoicesRemovedAtStartup = purgeExpiredInvoices();
function allBeans() {
  return [...BASE_BEANS, ...data.customBeans];
}
function money(value) {
  return `${fmt.format(value)} جنيه`;
}
function localDateValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function addMonthsToDate(value, months = 3) {
  const [year, month, day] = String(value || localDateValue())
    .split("-")
    .map(Number);
  const target = new Date(year, month - 1 + months, 1);
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  target.setDate(Math.min(day, lastDay));
  return localDateValue(target);
}
function setInvoiceExpiry() {
  const date =
    document.getElementById("invoice-date").value || localDateValue();
  document.getElementById("invoice-expiry").value = addMonthsToDate(date, 3);
}
function autoExpiryDate(invoiceDate) {
  return addMonthsToDate(invoiceDate, 3);
}
function paymentMethodLabel(method) {
  return (
    { cash: "نقدي", vodafone: "Vodafone Cash", instapay: "InstaPay" }[method] ||
    "نقدي"
  );
}
function branchTypeLabel(type) {
  return (
    {
      renewal: "تجديد",
      modified: "تعديل على الفاتورة",
      copy: "نسخة جديدة",
      suborder: "طلب فرعي",
    }[type] || "نسخة جديدة"
  );
}
function invoiceDateKey(invoice) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(invoice.invoiceDate || "")))
    return invoice.invoiceDate;
  const date = new Date(invoice.createdAt || invoice.savedAt || 0);
  return Number.isNaN(date.getTime()) ? localDateValue() : localDateValue(date);
}
function dateText(value) {
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || "")))
      return dateOnlyFmt.format(new Date(`${value}T12:00:00`));
    return dateFmt.format(new Date(value));
  } catch {
    return "—";
  }
}
function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function priceFor(bean, grams) {
  return (bean.pricePerKg * Number(grams || 0)) / 1000;
}
function notify(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  recordNotification(message);
}
let activeNotificationFilter = "all";
function notificationType(message) {
  const text = String(message || "");
  if (text.includes("دفع") || text.includes("مدفوع") || text.includes("تحصيل")) return "payments";
  if (text.includes("طلب") || text.includes("فاتورة") || text.includes("شيك")) return "orders";
  if (text.includes("نسخة") || text.includes("تذكير") || text.includes("تنبيه")) return "reminders";
  return "system";
}
function recordNotification(message) {
  if (!message || !data) return;
  const item = { id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, message: String(message), type: notificationType(message), createdAt: new Date().toISOString(), read: false };
  data.notifications = [item, ...(data.notifications || [])].slice(0, 80);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch {}
  updateNotificationBadge();
  if (currentView === "notifications") renderNotifications();
}
function updateNotificationBadge() {
  const unread = (data.notifications || []).filter((n) => !n.read).length;
  const badge = document.getElementById("nav-notification-badge");
  if (badge) { badge.hidden = unread === 0; badge.textContent = fmt.format(unread); }
  ["all", "orders", "payments", "reminders"].forEach((type) => {
    const el = document.getElementById(`notification-count-${type}`);
    if (el) el.textContent = fmt.format(type === "all" ? (data.notifications || []).length : (data.notifications || []).filter((n) => n.type === type).length);
  });
}
function renderNotifications() {
  const root = document.getElementById("notification-list");
  if (!root) return;
  const all = data.notifications || [];
  const items = activeNotificationFilter === "all" ? all : all.filter((n) => n.type === activeNotificationFilter);
  root.innerHTML = items.length ? items.map((n) => `<article class="notification-item ${n.read ? "is-read" : ""}" data-notification-id="${escapeHTML(n.id)}"><span class="notification-icon">${n.type === "payments" ? "✓" : n.type === "orders" ? "☕" : n.type === "reminders" ? "!" : "•"}</span><div><strong>${escapeHTML(n.message)}</strong><small>${dateFmt.format(new Date(n.createdAt))}</small></div></article>`).join("") : '<div class="empty">لا توجد إشعارات في هذا القسم.</div>';
  const unread = all.filter((n) => !n.read).length;
  const summary = document.getElementById("notification-summary");
  if (summary) summary.textContent = unread ? `${fmt.format(unread)} إشعارات غير مقروءة` : "كل الإشعارات مقروءة";
  updateNotificationBadge();
}
document.querySelectorAll("[data-notification-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    activeNotificationFilter = button.dataset.notificationFilter;
    document.querySelectorAll("[data-notification-filter]").forEach((b) => b.classList.toggle("active", b === button));
    renderNotifications();
  });
});
document.getElementById("clear-notifications-btn")?.addEventListener("click", () => {
  data.notifications = (data.notifications || []).map((n) => ({ ...n, read: true }));
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch {}
  renderNotifications();
});
function refreshHome() {
  document.getElementById("invoice-count").textContent = fmt.format(
    data.invoices.filter(
      (item) => (item.documentType || "receipt") === "receipt",
    ).length,
  );
  document.getElementById("bean-count").textContent = fmt.format(
    allBeans().length,
  );
  document.getElementById("invoice-bean-count").textContent = fmt.format(
    allBeans().length,
  );
  const netWEl = document.getElementById("invoice-net-weight");
  if (netWEl)
    netWEl.textContent = `${fmt.format(invoiceQuote().totalGrams)} جم`;
  const netWStripEl = document.getElementById("invoice-net-weight-strip");
  if (netWStripEl)
    netWStripEl.textContent = `${fmt.format(invoiceQuote().totalGrams)} جم`;
  const oc = document.getElementById("open-checks-count");
  if (oc)
    oc.textContent = fmt.format(
      data.checks.filter((c) => c.status === "open" || c.status === "partial")
        .length,
    );
  document.getElementById("customer-count").textContent = fmt.format(
    data.customers.length,
  );
  const recentRoot = document.getElementById("home-recent-orders");
  const tableRoot = document.getElementById("home-table-status");
  if (tableRoot) {
    const activeTables = data.checks.filter((c) => c.status === "open" || c.status === "partial" || c.status === "deferred").slice(0, 10);
    tableRoot.innerHTML = activeTables.length ? activeTables.map((c) => `<button type="button" class="home-table-card ${c.status}" data-view="checks"><strong>${c.mode === "inside" ? escapeHTML(c.tableName || "—") : "خارجية"}</strong><span>${c.status === "partial" ? "مدفوع جزئيًا" : c.status === "deferred" ? "مؤجل" : "مفتوحة"}</span><small>${money(checkDue(c))} متبقي</small></button>`).join("") : '<div class="empty">لا توجد طاولات نشطة.</div>';
  }
  if (recentRoot) {
    const recent = [
      ...data.checks.map((c) => ({ at: c.lastOrderAt || c.createdAt, title: c.mode === "inside" ? `طاولة ${c.tableName || "—"}` : "تيك أواي", detail: `${(c.guests || []).map((g) => g.name).join(" · ") || "بدون اسم"} · ${money(checkTotal(c))}`, type: "check" })),
      ...data.invoices.map((i) => ({ at: i.createdAt || i.date, title: `فاتورة ${i.number || ""}`, detail: `${i.customer || "بدون اسم"} · ${money(Number(i.total || 0))}`, type: "invoice" })),
    ].filter((item) => item.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 4);
    recentRoot.innerHTML = recent.length ? recent.map((item) => `<article class="home-recent-item"><span class="home-recent-icon">${item.type === "check" ? "🧾" : "☕"}</span><div><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.detail)}</small></div><time>${dateFmt.format(new Date(item.at))}</time></article>`).join("") : '<div class="empty">لا توجد عمليات بعد.</div>';
  }
  updateNotificationBadge();
}
const views = ["home", "invoice", "blends", "checks", "notifications", "tools"];
const titles = {
  home: "مندور كوفي",
  invoice: "إنشاء فاتورة",
  blends: "العملاء والتوليفات",
  "add-bean": "إضافة نوع بن",
  checks: "الشيكات",
  notifications: "مركز الإشعارات",
  tools: "المزيد والأدوات",
};
function openView(name, { push = false, animate = true } = {}) {
  if (!views.includes(name)) name = "home";
  if (push && name !== currentView)
    history.pushState(
      { mandourView: name },
      "",
      `${location.pathname}${location.search}#${name}`,
    );
  views.forEach((id) => {
    const view = document.getElementById(`${id}-view`);
    if (!view) return;
    view.hidden = id !== name;
    view.classList.remove("leaving", "entering");
    view.setAttribute("aria-hidden", String(id !== name));
  });
  const next = document.getElementById(`${name}-view`);
  if (!next) return;
  document.getElementById("back-button").hidden = name === "home";
  document.getElementById("bar-title").textContent = titles[name];
  currentView = name;
  syncPaidSound();
  document.body.classList.toggle("invoice-active", name === "invoice");
  document.getElementById("invoice-dock").hidden =
    name !== "invoice" || invoiceQuote().totalGrams <= 0;
  document.querySelectorAll("#app-navigation [data-view]").forEach((button) => {
    if (button.dataset.view === name)
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (name === "invoice") renderInvoice();
  if (name === "blends") {
    renderRecipeLines();
    renderCustomers();
  }
  if (name === "checks") {
    renderCheckMenu();
    renderExtraDrinks();
    renderChecks();
    renderCheckDraft();
    setCheckPanel("list");
  }
  if (name === "notifications") renderNotifications();
  if (name === "tools") { renderInventory(); renderLoyalty(); renderSalesDashboard(); renderBackupHistory(); renderDeletedInvoices(); updatePinStatus(); }
  refreshHome();
  window.scrollTo(0, 0);
}
document.getElementById("back-button").addEventListener("click", () => {
  if (currentView !== "home" && history.state?.mandourView) history.back();
  else openView("home", { animate: false });
});
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (button) openView(button.dataset.view, { push: true, animate: false });
});
window.addEventListener("popstate", (event) =>
  openView(event.state?.mandourView || "home", { push: false, animate: false }),
);
window.mandourAndroidBack = function () {
  if (!document.getElementById("receipt-modal").hidden) {
    closeReceipt();
    return true;
  }
  if (!document.getElementById("move-modal").hidden) {
    closeMoveDialog();
    return true;
  }
  if (!document.getElementById("delete-modal").hidden) {
    closeDeleteDialog();
    return true;
  }
  if (currentView === "home") return false;
  if (history.state?.mandourView) history.back();
  else openView("home", { animate: false });
  return true;
};
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    !document.getElementById("receipt-modal").hidden
  ) {
    closeReceipt();
    event.preventDefault();
    return;
  }
  if (event.key === "Escape" && !document.getElementById("move-modal").hidden) {
    closeMoveDialog();
    event.preventDefault();
    return;
  }
  if (
    event.key === "Escape" &&
    !document.getElementById("delete-modal").hidden
  ) {
    closeDeleteDialog();
    event.preventDefault();
    return;
  }
  if (
    (event.key === "Escape" || event.key === "Backspace") &&
    currentView !== "home" &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)
  ) {
    event.preventDefault();
    if (history.state?.mandourView) history.back();
    else openView("home", { animate: false });
  }
});
function renderInvoice() {
  const root = document.getElementById("invoice-beans");
  if (!document.getElementById("invoice-date").value)
    document.getElementById("invoice-date").value = localDateValue();
  document
    .querySelectorAll("[data-document-type]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.documentType === documentType),
      ),
    );
  document.getElementById("save-invoice").textContent =
    documentType === "quote" ? "حفظ عرض السعر" : "حفظ الإيصال";
  document
    .querySelectorAll("[data-payment-method]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.paymentMethod === paymentMethod),
      ),
    );
  if (
    !document.getElementById("invoice-expiry").value ||
    document.getElementById("invoice-expiry").dataset.forDate !==
      document.getElementById("invoice-date").value
  ) {
    setInvoiceExpiry();
    document.getElementById("invoice-expiry").dataset.forDate =
      document.getElementById("invoice-date").value;
  }
  root.innerHTML = allBeans()
    .map((bean) => {
      const grams = invoiceGrams[bean.id] || "";
      const amount = priceFor(bean, grams);
      return `<article class="bean-card" data-invoice-bean="${escapeHTML(bean.id)}"><img class="bean-photo" src="${escapeHTML(bean.image)}" alt="حبوب ${escapeHTML(bean.name)}"><div class="bean-meta"><div class="bean-name">${escapeHTML(bean.name)}</div><div class="bean-rate">الكيلو ${money(bean.pricePerKg)}</div><div class="invoice-entry"><div class="gram-field"><label>الوزن بالجرام</label><input class="g" data-grams type="number" min="0" max="100000" step="1" inputmode="decimal" placeholder="٠" value="${escapeHTML(grams)}" aria-label="جرامات ${escapeHTML(bean.name)}"></div><div class="pr"><span data-line-price>${money(amount)}</span><small>سعر الوزن</small></div></div></div></article>`;
    })
    .join("");
  root.oninput = (event) => {
    if (!event.target.matches("[data-grams]")) return;
    const card = event.target.closest("[data-invoice-bean]");
    const bean = allBeans().find(
      (item) => item.id === card.dataset.invoiceBean,
    );
    invoiceGrams[bean.id] = event.target.value;
    card.querySelector("[data-line-price]").textContent = money(
      priceFor(bean, event.target.value),
    );
    refreshInvoiceTotal();
  };
  refreshInvoiceTotal();
  renderInvoiceHistory();
}
function selectedInvoiceItems() {
  return allBeans()
    .filter((bean) => Number(invoiceGrams[bean.id]) > 0)
    .map((bean) => ({
      beanId: bean.id,
      name: bean.name,
      grams: Number(invoiceGrams[bean.id]),
      pricePerKg: bean.pricePerKg,
      total: priceFor(bean, invoiceGrams[bean.id]),
    }));
}
function invoiceQuote(items = selectedInvoiceItems()) {
  const baseTotal = items.reduce((sum, item) => sum + item.total, 0);
  const totalGrams = items.reduce((sum, item) => sum + item.grams, 0);
  const seasoningFee =
    roastMode === "m7awag"
      ? Math.round((totalGrams / 125) * 10 * 100) / 100
      : 0;
  return {
    baseTotal,
    totalGrams,
    seasoningFee,
    total: baseTotal + seasoningFee,
  };
}
function refreshInvoiceTotal() {
  const quote = invoiceQuote();
  document.getElementById("base-total").textContent = money(quote.baseTotal);
  document.getElementById("seasoning-total").textContent = money(
    quote.seasoningFee,
  );
  document.getElementById("weight-total").textContent =
    `${fmt.format(quote.totalGrams)} جم`;
  const netWeight = document.getElementById("invoice-net-weight");
  if (netWeight) netWeight.textContent = `${fmt.format(quote.totalGrams)} جم`;
  const netWeightStrip = document.getElementById("invoice-net-weight-strip");
  if (netWeightStrip)
    netWeightStrip.textContent = `${fmt.format(quote.totalGrams)} جم`;
  document.getElementById("invoice-total").textContent = money(quote.total);
  document.getElementById("dock-total").textContent = money(quote.total);
  document.getElementById("invoice-dock").hidden =
    currentView !== "invoice" || quote.totalGrams <= 0;
  document
    .querySelectorAll("[data-roast]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.roast === roastMode),
      ),
    );
}
document.querySelector(".roast-options").addEventListener("click", (event) => {
  const button = event.target.closest("[data-roast]");
  if (!button) return;
  roastMode = button.dataset.roast;
  refreshInvoiceTotal();
});
document.querySelectorAll("[data-document-type]").forEach((button) =>
  button.addEventListener("click", () => {
    documentType = button.dataset.documentType;
    document
      .querySelectorAll("[data-document-type]")
      .forEach((item) =>
        item.setAttribute("aria-pressed", String(item === button)),
      );
    document.getElementById("save-invoice").textContent =
      documentType === "quote" ? "حفظ عرض السعر" : "حفظ الإيصال";
  }),
);
document.querySelectorAll("[data-payment-method]").forEach((button) =>
  button.addEventListener("click", () => {
    paymentMethod = button.dataset.paymentMethod;
    document
      .querySelectorAll("[data-payment-method]")
      .forEach((item) =>
        item.setAttribute("aria-pressed", String(item === button)),
      );
  }),
);
document.getElementById("invoice-date").addEventListener("change", () => {
  setInvoiceExpiry();
  document.getElementById("invoice-expiry").dataset.forDate =
    document.getElementById("invoice-date").value;
});
document
  .getElementById("invoice-customer")
  .addEventListener("input", (event) => {
    if (
      invoiceCustomerContext &&
      customerKey(event.target.value) !==
        customerKey(invoiceCustomerContext.name)
    )
      invoiceCustomerContext = null;
  });
document.getElementById("save-invoice").addEventListener("click", () => {
  const items = selectedInvoiceItems();
  if (!items.length) {
    notify("أدخل وزن نوع بن واحد على الأقل");
    return;
  }
  const invoiceDate =
    document.getElementById("invoice-date").value || localDateValue();
  const expiryDate = document.getElementById("invoice-expiry").value;
  if (expiryDate && expiryDate < invoiceDate) {
    notify("تاريخ الصلاحية لا يسبق تاريخ الشراء");
    return;
  }
  const quote = invoiceQuote(items);
  const savedAt = new Date().toISOString();
  const serial = String(Date.now()).slice(-8);
  const invoice = {
    id: `inv-${Date.now()}`,
    number: `${documentType === "quote" ? "Q" : "M"}-${String(new Date().getFullYear()).slice(-2)}-${serial}`,
    documentType,
    invoiceDate,
    expiryDate: autoExpiryDate(invoiceDate),
    autoDeleteAt: autoExpiryDate(invoiceDate),
    paymentMethod,
    phoneNumber: "01096872170",
    customer: document.getElementById("invoice-customer").value.trim(),
    customerCountry: customerCountryForInvoice(),
    items,
    roastMode,
    baseTotal: quote.baseTotal,
    seasoningFee: quote.seasoningFee,
    total: quote.total,
    ...(invoiceLineage
      ? {
          ...(invoiceLineage.parentInvoiceId
            ? {
                parentInvoiceId: invoiceLineage.parentInvoiceId,
                parentInvoiceNumber: invoiceLineage.parentInvoiceNumber,
                parentInvoiceDate: invoiceLineage.parentInvoiceDate,
              }
            : {}),
          branchType: invoiceLineage.branchType,
        }
      : {}),
    createdAt: savedAt,
    savedAt,
  };
  data.invoices.unshift(invoice);
  awardLoyaltyStamp(invoice.customer);
  try {
    persist();
  } catch {
    data.invoices.shift();
    notify("مساحة التخزين ممتلئة؛ احذف صورًا كبيرة أو فواتير قديمة");
    return;
  }
  invoiceGrams = {};
  roastMode = "sada";
  documentType = "receipt";
  paymentMethod = "cash";
  invoiceLineage = null;
  invoiceCustomerContext = null;
  document.getElementById("invoice-date").value = localDateValue();
  document.getElementById("invoice-expiry").value = "";
  document.getElementById("invoice-expiry").dataset.forDate = "";
  document.getElementById("invoice-customer").value = "";
  renderInvoice();
  refreshHome();
  renderCustomers();
  openReceipt(invoice.id);
});
function invoiceKind(invoice) {
  return invoice.documentType === "quote" ? "عرض سعر" : "إيصال بيع";
}
function monthText(key) {
  try {
    return new Intl.DateTimeFormat("ar-EG", {
      month: "long",
      year: "numeric",
    }).format(new Date(`${key}-15T12:00:00`));
  } catch {
    return key;
  }
}
function invoiceMatches(invoice, query) {
  if (!query) return true;
  const text = [
    invoice.number,
    invoice.customer,
    invoiceKind(invoice),
    invoice.roastMode === "m7awag" ? "محوّج" : "سادة",
    invoice.customerCountry || "",
    paymentMethodLabel(invoice.paymentMethod),
    invoice.parentInvoiceNumber || "",
    ...(invoice.items || []).map((item) => item.name),
    invoiceDateKey(invoice),
    invoice.expiryDate || "",
  ]
    .join(" ")
    .toLocaleLowerCase("ar");
  return text.includes(query);
}
function invoiceCardMarkup(invoice) {
  const id = escapeHTML(invoice.id);
  const roast = invoice.roastMode === "m7awag" ? "محوّج" : "سادة";
  const fee = Number(invoice.seasoningFee || 0);
  const details = (invoice.items || [])
    .map(
      (item) =>
        `${escapeHTML(item.name)}: ${fmt.format(item.grams)} جم — ${money(item.total)}`,
    )
    .join("<br>");
  return `<details class="saved-invoice"><summary><div><strong>${escapeHTML(invoice.number)}${invoice.customer ? ` · ${escapeHTML(invoice.customer)}` : ""}</strong><small class="invoice-summary-meta">${dateText(invoiceDateKey(invoice))} · ${invoiceKind(invoice)} · ${roast}${invoice.customerCountry ? ` · ${escapeHTML(invoice.customerCountry)}` : ""}</small></div><strong class="record-total">${money(invoice.total)}</strong></summary><div class="history-detail">${details}${fee ? `<br>إضافة المحوّج: ${money(fee)}` : ""}<br><strong>الإجمالي: ${money(invoice.total)}</strong><br>طريقة الدفع: ${paymentMethodLabel(invoice.paymentMethod)}${invoice.expiryDate ? `<br>الصلاحية حتى: ${dateText(invoice.expiryDate)}` : ""}${invoice.branchType ? `<br><span class="invoice-lineage">${branchTypeLabel(invoice.branchType)}${invoice.parentInvoiceNumber ? ` من ${escapeHTML(invoice.parentInvoiceNumber)} بتاريخ ${dateText(invoice.parentInvoiceDate)}` : ""}</span>` : ""}<div class="record-actions"><button class="secondary" type="button" data-open-invoice="${id}">فتح الإيصال</button><button class="secondary" type="button" data-repeat-invoice="${id}">إعادة نفس الفاتورة</button><button class="danger" type="button" data-delete-invoice="${id}">حذف</button></div></div></details>`;
}
function groupedRecords(records, keyFn, renderGroup, openFirst = false) {
  return [
    ...records
      .reduce((map, record) => {
        const key = keyFn(record);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(record);
        return map;
      }, new Map())
      .entries(),
  ]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, items], index) =>
      renderGroup(key, items, openFirst && index === 0),
    )
    .join("");
}
function renderInvoiceHistory() {
  const root = document.getElementById("invoice-history");
  const query = document
    .getElementById("invoice-search")
    .value.trim()
    .toLocaleLowerCase("ar");
  const records = data.invoices.filter((invoice) =>
    invoiceMatches(invoice, query),
  );
  if (!records.length) {
    root.innerHTML = `<div class="empty">${query ? "لا توجد فواتير تطابق البحث." : "لسه مفيش فواتير محفوظة."}</div>`;
    return;
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffKey = localDateValue(cutoff);
  const recent = records.filter(
    (invoice) => invoiceDateKey(invoice) >= cutoffKey,
  );
  const older = records.filter(
    (invoice) => invoiceDateKey(invoice) < cutoffKey,
  );
  const recentHtml = recent.length
    ? groupedRecords(
        recent,
        invoiceDateKey,
        (day, items, open) =>
          `<details class="history-day" ${open ? "open" : ""}><summary>${dateText(day)}<span class="history-day-total">${fmt.format(items.length)} مستند · ${money(items.filter((i) => (i.documentType || "receipt") === "receipt").reduce((n, i) => n + Number(i.total || 0), 0))} مبيعات</span></summary><div class="history-day-content">${items
            .sort((a, b) =>
              String(b.savedAt || b.createdAt).localeCompare(
                String(a.savedAt || a.createdAt),
              ),
            )
            .map(invoiceCardMarkup)
            .join("")}</div></details>`,
        true,
      )
    : '<div class="empty">لا توجد فواتير خلال آخر ٣٠ يومًا.</div>';
  const archiveHtml = older.length
    ? `<details class="history-monthly-archive"><summary>الأرشيف الأقدم من شهر <small>${fmt.format(older.length)} مستند محفوظ</small></summary><div class="history-archive-content">${groupedRecords(
        older,
        (invoice) => invoiceDateKey(invoice).slice(0, 7),
        (month, items) =>
          `<details class="history-month"><summary>${monthText(month)}<span class="history-month-total">${fmt.format(items.length)} مستند</span></summary><div class="history-month-content">${items
            .sort((a, b) => invoiceDateKey(b).localeCompare(invoiceDateKey(a)))
            .map(invoiceCardMarkup)
            .join("")}</div></details>`,
      )}</div></details>`
    : '<div class="empty archive-empty">لا توجد فواتير أقدم من شهر.</div>';
  root.innerHTML = `<section class="history-section"><h4>الفواتير اليومية · آخر ٣٠ يومًا</h4>${recentHtml}</section><section class="history-section"><h4>الأرشيف</h4>${archiveHtml}</section>`;
}
document
  .getElementById("invoice-search")
  .addEventListener("input", renderInvoiceHistory);
[
  "global-search-query",
  "global-search-from",
  "global-search-to",
  "global-search-status",
  "global-search-method",
].forEach((id) =>
  document.getElementById(id)?.addEventListener("input", globalSearchRender),
);
document
  .getElementById("global-search-clear")
  ?.addEventListener("click", () => {
    ["global-search-query", "global-search-from", "global-search-to"].forEach(
      (id) => {
        const e = document.getElementById(id);
        if (e) e.value = "";
      },
    );
    document.getElementById("global-search-status").value = "all";
    document.getElementById("global-search-method").value = "all";
    globalSearchRender();
  });
document
  .getElementById("global-search-results")
  ?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-global-type]");
    if (!row) return;
    const type = row.dataset.globalType,
      id = row.dataset.globalId;
    if (type === "invoice") {
      openReceipt(id);
      return;
    }
    if (type === "customer") {
      openView("blends", { push: true, animate: true });
      setTimeout(() => {
        const button = [
          ...document.querySelectorAll("[data-customer-toggle]"),
        ].find((x) => x.dataset.customerToggle === id);
        if (button) {
          if (button.getAttribute("aria-expanded") !== "true") button.click();
          button.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 120);
      return;
    }
    openView("checks", { push: true, animate: true });
    setCheckPanel("list");
    checkFilter = "all";
    renderChecks();
    setTimeout(() => {
      const card = [...document.querySelectorAll("[data-check-card-id]")].find(
        (x) => x.dataset.checkCardId === id,
      );
      if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
  });
globalSearchRender();
document
  .getElementById("invoice-history")
  .addEventListener("click", (event) => {
    const open = event.target.closest("[data-open-invoice]");
    if (open) {
      openReceipt(open.dataset.openInvoice);
      return;
    }
    const repeat = event.target.closest("[data-repeat-invoice]");
    if (repeat) {
      repeatInvoice(repeat.dataset.repeatInvoice);
      return;
    }
    const remove = event.target.closest("[data-delete-invoice]");
    if (remove) beginDeleteInvoice(remove.dataset.deleteInvoice);
  });
function beginDeleteInvoice(id) {
  const invoice = data.invoices.find((item) => item.id === id);
  if (!invoice) return;
  pendingDeleteInvoiceId = id;
  document.getElementById("delete-step-label").textContent =
    "التأكيد الأول · ١ من ٢";
  document.getElementById("delete-title").textContent =
    `حذف ${invoice.number}؟`;
  document.getElementById("delete-copy").textContent =
    `فاتورة ${invoice.customer || "بدون اسم عميل"} بتاريخ ${dateText(invoiceDateKey(invoice))} ستُحذف نهائيًا بعد تأكيدين.`;
  document.getElementById("delete-step-one").hidden = false;
  document.getElementById("delete-step-two").hidden = true;
  document.getElementById("delete-modal").hidden = false;
}
document.getElementById("delete-next").addEventListener("click", () => {
  if (!pendingDeleteInvoiceId) return;
  document.getElementById("delete-step-label").textContent =
    "التأكيد النهائي · ٢ من ٢";
  document.getElementById("delete-title").textContent = "تأكيد الحذف نهائيًا";
  document.getElementById("delete-copy").textContent =
    "لن يمكن استرجاع هذا الإيصال بعد الحذف. اضغط زر الحذف الأحمر للتأكيد النهائي.";
  document.getElementById("delete-step-one").hidden = true;
  document.getElementById("delete-step-two").hidden = false;
});
document.getElementById("delete-final").addEventListener("click", () => {
  if (!pendingDeleteInvoiceId) return;
  const index = data.invoices.findIndex(
    (item) => item.id === pendingDeleteInvoiceId,
  );
  if (index < 0) {
    closeDeleteDialog();
    return;
  }
  const [removed] = data.invoices.splice(index, 1);
  data.deletedInvoices = Array.isArray(data.deletedInvoices) ? data.deletedInvoices : [];
  data.deletedInvoices.unshift({ ...removed, deletedAt: new Date().toISOString() });
  data.deletedInvoices = data.deletedInvoices.slice(0, 50);
  try {
    persist();
  } catch {
    data.invoices.splice(index, 0, removed);
    notify("تعذر حفظ التغيير؛ لم تُحذف الفاتورة");
    return;
  }
  const deletingId = pendingDeleteInvoiceId;
  closeDeleteDialog();
  if (activeReceipt?.id === deletingId) closeReceipt();
  renderInvoiceHistory();
  renderCustomers();
  refreshHome();
  notify("تم حذف الفاتورة بعد التأكيدين");
});
function closeDeleteDialog() {
  pendingDeleteInvoiceId = null;
  document.getElementById("delete-modal").hidden = true;
}
document
  .querySelectorAll("[data-close-delete]")
  .forEach((button) => button.addEventListener("click", closeDeleteDialog));
let receiptStampImage = null;
const paymentImageCache = {};
function drawPaymentLogo(method, x, y, maxWidth, maxHeight, invoice, canvas) {
  if (!method) return;
  const source =
    method === "cash"
      ? "assets/payments/cash.svg"
      : method === "vodafone"
        ? "assets/payments/vodafone-cash.png"
        : "assets/payments/instapay.png";
  let image = paymentImageCache[method];
  if (!image) {
    image = new Image();
    paymentImageCache[method] = image;
    image.onload = () => {
      if (activeReceipt?.id === invoice.id) drawReceipt(invoice, canvas);
    };
    image.src = source;
    return;
  }
  if (image.complete && image.naturalWidth) {
    const ctx = canvas.getContext("2d");
    const scale = Math.min(
      maxWidth / image.naturalWidth,
      maxHeight / image.naturalHeight,
    );
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    ctx.fillStyle = "#fff";
    ctx.fillRect(x, y, width, height);
    ctx.drawImage(image, x, y, width, height);
  }
}
const mapQrImage = new Image();
mapQrImage.onload = () => {
  if (activeReceipt)
    drawReceipt(activeReceipt, document.getElementById("receipt-canvas"));
};
mapQrImage.src = "assets/map-location-qr.png";
function drawMapLocationQr(ctx) {
  if (mapQrImage.complete && mapQrImage.naturalWidth) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(62, 268, 116, 116);
    ctx.drawImage(mapQrImage, 68, 274, 104, 104);
    ctx.textAlign = "center";
    ctx.font = "600 16px Cairo, Arial, sans-serif";
    ctx.fillStyle = "#76583b";
    ctx.fillText("موقع الفرع", 120, 402);
  }
}
const receiptQrCache = {};
function drawProviderPaymentQr(ctx, invoice, canvas) {
  const src = data.paymentQrs?.[invoice.paymentMethod];
  if (!src) return;
  const key = invoice.paymentMethod;
  let image = receiptQrCache[key];
  if (!image || image.src !== src) {
    image = new Image();
    receiptQrCache[key] = image;
    image.onload = () => {
      if (activeReceipt?.id === invoice.id) drawReceipt(invoice, canvas);
    };
    image.src = src;
    return;
  }
  if (image.complete && image.naturalWidth) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(194, 430, 112, 112);
    ctx.drawImage(image, 199, 435, 102, 102);
    ctx.textAlign = "center";
    ctx.font = "600 15px Cairo, Arial, sans-serif";
    ctx.fillStyle = "#76583b";
    ctx.fillText("QR الدفع", 250, 554);
  }
}
function drawReceipt(invoice, canvas) {
  const items = invoice.items || [];
  const w = 1080;
  const rowHeight = 92;
  const headerHeight = 590;
  const footerHeight = 420;
  const hasSeasoning = Number(invoice.seasoningFee || 0) > 0;
  const h =
    headerHeight +
    Math.max(items.length, 1) * rowHeight +
    footerHeight +
    (hasSeasoning ? rowHeight : 0);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.direction = "rtl";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fbf7ef";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#8c6848";
  ctx.lineWidth = 5;
  ctx.strokeRect(26, 26, w - 52, h - 52);
  ctx.strokeStyle = "#c9a773";
  ctx.lineWidth = 2;
  ctx.strokeRect(42, 42, w - 84, h - 84);
  ctx.fillStyle = "#503827";
  ctx.textAlign = "center";
  ctx.font = "800 64px Cairo, Arial, sans-serif";
  ctx.fillText("مندور كوفي", w / 2, 88);
  ctx.font = "700 32px Cairo, Arial, sans-serif";
  ctx.fillStyle = "#84674d";
  ctx.fillText(invoiceKind(invoice), w / 2, 143);
  ctx.beginPath();
  ctx.arc(145, 155, 74, 0, Math.PI * 2);
  ctx.strokeStyle = "#b8874e";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(145, 155, 62, 0, Math.PI * 2);
  ctx.strokeStyle = "#d4b68d";
  ctx.lineWidth = 1;
  ctx.stroke();
  if (!receiptStampImage) {
    receiptStampImage = new Image();
    receiptStampImage.src = "assets/receipt-stamp.png";
    receiptStampImage.onload = () => {
      if (activeReceipt?.id === invoice.id) drawReceipt(invoice, canvas);
    };
  }
  if (receiptStampImage.complete && receiptStampImage.naturalWidth) {
    ctx.save();
    ctx.globalAlpha = 0.36;
    ctx.drawImage(receiptStampImage, 93, 103, 104, 104);
    ctx.restore();
  }
  ctx.font = "700 26px Cairo, Arial, sans-serif";
  ctx.fillStyle = "#503827";
  ctx.textAlign = "right";
  ctx.fillText(`رقم المستند: ${invoice.number}`, 1010, 178);
  ctx.fillText(`تاريخ الشراء: ${dateText(invoiceDateKey(invoice))}`, 1010, 218);
  ctx.fillText(`العميل: ${invoice.customer || "عميل نقدي"}`, 1010, 258);
  ctx.fillText(`البلد: ${invoice.customerCountry || "—"}`, 1010, 298);
  ctx.fillText(`العامل: ${data.staffName || data.auditActor || "مستخدم الجهاز"}`, 1010, 338);
  ctx.fillText(
    `التحضير: ${invoice.roastMode === "m7awag" ? "محوّج" : "سادة"}`,
    1010,
    338,
  );

  ctx.fillText(
    `الوزن الإجمالي: ${fmt.format(items.reduce((sum, item) => sum + Number(item.grams || 0), 0))} جم`,
    1010,
    378,
  );
  ctx.fillText(
    `الصلاحية حتى: ${invoice.expiryDate ? dateText(invoice.expiryDate) : "غير محدد"}`,
    1010,
    418,
  );
  ctx.fillText(
    `طريقة الدفع: ${paymentMethodLabel(invoice.paymentMethod)}${invoice.paymentMethod === "vodafone" || invoice.paymentMethod === "instapay" ? " · رقم الاستقبال: 01097110611" : ""}`,
    1010,
    458,
    790,
  );
  ctx.fillText(
    invoice.branchType
      ? `${branchTypeLabel(invoice.branchType)}${invoice.parentInvoiceNumber ? ` من ${invoice.parentInvoiceNumber} · ${dateText(invoice.parentInvoiceDate)}` : ""}`
      : "مستند جديد",
    1010,
    498,
  );
  ctx.fillText(
    `حذف تلقائي في: ${invoice.autoDeleteAt ? dateText(invoice.autoDeleteAt) : "غير محدد"}`,
    1010,
    538,
  );
  drawMapLocationQr(ctx, invoice, canvas);
  drawPaymentLogo(invoice.paymentMethod, 62, 432, 110, 54, invoice, canvas);
  drawProviderPaymentQr(ctx, invoice, canvas);
  const tableY = 570;
  ctx.fillStyle = "#ede2d2";
  ctx.fillRect(62, tableY, w - 124, 64);
  ctx.fillStyle = "#503827";
  ctx.font = "800 28px Cairo, Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("الصنف", 875, tableY + 32);
  ctx.textAlign = "center";
  ctx.fillText("الوزن", 520, tableY + 32);
  ctx.textAlign = "left";
  ctx.fillText("السعر", 190, tableY + 32);
  let y = tableY + 88;
  ctx.font = "600 28px Cairo, Arial, sans-serif";
  items.forEach((item) => {
    ctx.fillStyle = "#33261c";
    ctx.textAlign = "right";
    let name = String(item.name || "");
    if (name.length > 27) name = name.slice(0, 26) + "…";
    ctx.fillText(name, 875, y);
    ctx.textAlign = "center";
    ctx.fillText(`${fmt.format(item.grams)} جم`, 520, y);
    ctx.textAlign = "left";
    ctx.fillText(money(item.total), 190, y);
    ctx.strokeStyle = "#e7dccd";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(75, y + 39);
    ctx.lineTo(w - 75, y + 39);
    ctx.stroke();
    y += rowHeight;
  });
  if (hasSeasoning) {
    ctx.font = "600 25px Cairo, Arial, sans-serif";
    ctx.fillStyle = "#94672f";
    ctx.textAlign = "right";
    ctx.fillText("إضافة المحوّج", 875, y);
    ctx.textAlign = "left";
    ctx.fillText(money(invoice.seasoningFee), 190, y);
    y += rowHeight;
  }
  ctx.fillStyle = "#ead9bf";
  ctx.fillRect(62, y - 25, w - 124, 78);
  ctx.font = "800 34px Cairo, Arial, sans-serif";
  ctx.fillStyle = "#503827";
  ctx.textAlign = "right";
  ctx.fillText("الإجمالي النهائي", 875, y + 14);
  ctx.textAlign = "left";
  ctx.fillText(money(invoice.total), 190, y + 14);
  const afterTotalY = y + 53;
  ctx.font = "700 25px Cairo, Arial, sans-serif";
  ctx.fillStyle = "#84674d";
  ctx.textAlign = "center";
  ctx.fillText("شكرًا لثقتكم · مندور كوفي", w / 2, afterTotalY + 60);
  ctx.font = "700 25px Cairo, Arial, sans-serif";
  ctx.fillStyle = "#503827";
  ctx.fillText(
    "للطلب عبر الهاتف أو واتساب: 01096872170",
    w / 2,
    afterTotalY + 120,
  );
  ctx.font = "500 19px Cairo, Arial, sans-serif";
  ctx.fillStyle = "#84674d";
  ctx.fillText(
    invoice.documentType === "quote"
      ? "عرض سعر محفوظ على الجهاز · احتفظ به للرجوع إليه"
      : "إيصال محفوظ على الجهاز · احتفظ به للرجوع إليه",
    w / 2,
    afterTotalY + 170,
  );
  ctx.font = "500 18px Cairo, Arial, sans-serif";
  ctx.fillText(
    `يحذف المستند تلقائيًا في ${invoice.autoDeleteAt ? dateText(invoice.autoDeleteAt) : "—"}`,
    w / 2,
    afterTotalY + 210,
  );
}
function openReceipt(id) {
  const invoice = data.invoices.find((item) => item.id === id);
  if (!invoice) return;
  activeReceipt = invoice;
  document.getElementById("receipt-repeat").dataset.repeatInvoice = invoice.id;
  document.getElementById("receipt-modal-title").textContent =
    `${invoiceKind(invoice)} · ${invoice.number}`;
  document.getElementById("receipt-repeat").textContent =
    invoice.documentType === "quote"
      ? "استخدام عرض السعر مجددًا"
      : "إعادة نفس الفاتورة";
  const modal = document.getElementById("receipt-modal");
  const canvas = document.getElementById("receipt-canvas");
  modal.hidden = false;
  document.body.classList.add("modal-open");
  drawReceipt(invoice, canvas);
  if (document.fonts?.ready)
    document.fonts.ready.then(() => {
      if (activeReceipt?.id === invoice.id) drawReceipt(invoice, canvas);
    });
  requestAnimationFrame(() =>
    document.getElementById("receipt-share").focus({ preventScroll: true }),
  );
}
function closeReceipt() {
  document.getElementById("receipt-modal").hidden = true;
  document.body.classList.remove("modal-open");
  activeReceipt = null;
}
document
  .querySelectorAll("[data-close-receipt]")
  .forEach((button) => button.addEventListener("click", closeReceipt));
function repeatInvoice(id, branchType = "copy") {
  const invoice = data.invoices.find((item) => item.id === id);
  if (!invoice) return;
  invoiceGrams = {};
  (invoice.items || []).forEach((item) => {
    if (item.beanId) invoiceGrams[item.beanId] = String(item.grams);
  });
  roastMode = invoice.roastMode || "sada";
  paymentMethod = invoice.paymentMethod || "cash";
  documentType = "receipt";
  invoiceLineage = {
    parentInvoiceId: invoice.id,
    parentInvoiceNumber: invoice.number,
    parentInvoiceDate: invoiceDateKey(invoice),
    branchType,
  };
  invoiceCustomerContext = {
    name: invoice.customer || "",
    country: invoice.customerCountry || "",
  };
  closeReceipt();
  openView("invoice", { push: true, animate: true });
  document.getElementById("invoice-customer").value = invoice.customer || "";
  document.getElementById("invoice-date").value = localDateValue();
  document.getElementById("invoice-expiry").value =
    autoExpiryDate(localDateValue());
  document.getElementById("invoice-expiry").dataset.forDate = localDateValue();
  document
    .querySelectorAll("[data-document-type]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.documentType === documentType),
      ),
    );
  document
    .querySelectorAll("[data-payment-method]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.paymentMethod === paymentMethod),
      ),
    );
  renderInvoice();
  notify("جهزت نسخة جديدة مرتبطة بالفاتورة الأصلية");
}
function dataUrlFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("تعذر تجهيز صورة الإيصال"));
    reader.readAsDataURL(blob);
  });
}
function receiptBlob() {
  return new Promise((resolve, reject) =>
    document
      .getElementById("receipt-canvas")
      .toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("تعذر تجهيز صورة الإيصال")),
        "image/png",
      ),
  );
}
function downloadReceipt() {
  if (!activeReceipt) return;
  receiptBlob()
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${activeReceipt.number}-receipt.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      notify("تم تنزيل صورة الإيصال");
    })
    .catch((error) => notify(error.message));
}
document
  .getElementById("receipt-download")
  .addEventListener("click", downloadReceipt);
document.getElementById("receipt-repeat").addEventListener("click", () => {
  if (activeReceipt) repeatInvoice(activeReceipt.id);
});
document.getElementById("receipt-share").addEventListener("click", async () => {
  if (!activeReceipt) return;
  try {
    const blob = await receiptBlob();
    if (window.MandourNative?.shareInvoiceImage) {
      window.MandourNative.shareInvoiceImage(await dataUrlFromBlob(blob));
      notify("اختار التطبيق المناسب من قائمة المشاركة");
      return;
    }
    const file = new File([blob], `${activeReceipt.number}-receipt.png`, {
      type: "image/png",
    });
    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({
        title: `إيصال ${activeReceipt.number}`,
        text: "إيصال من مندور كوفي",
        files: [file],
      });
      return;
    }
    downloadReceipt();
    notify("تم تجهيز الصورة؛ شاركها من المعرض");
  } catch (error) {
    if (error?.name !== "AbortError")
      notify(error.message || "تعذرت مشاركة الإيصال");
  }
});
document.getElementById("receipt-print").addEventListener("click", async () => {
  if (!activeReceipt) return;
  if (window.MandourNative?.shareInvoiceImage) {
    try {
      const blob = await receiptBlob();
      const dataUrl = await dataUrlFromBlob(blob);
      window.MandourNative.shareInvoiceImage(dataUrl);
      notify("اختر الطباعة أو احفظ الصورة من قائمة المشاركة");
    } catch (error) {
      notify(error.message || "تعذرت المشاركة");
    }
    return;
  }
  window.print();
});
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-delete]")) closeDeleteDialog();
  if (event.target.closest("[data-close-receipt]")) closeReceipt();
  if (event.target.closest("[data-close-move]")) closeMoveDialog();
  if (event.target.closest("[data-close-report]")) closeDailyReport();
});
function updateRecipeTotal() {
  const total = recipeLines.reduce(
    (sum, line) => sum + Number(line.grams || 0),
    0,
  );
  const el = document.getElementById("recipe-total-weight");
  if (el) el.textContent = `${fmt.format(total)} جم`;
}
function renderRecipeLines() {
  const root = document.getElementById("recipe-lines");
  const options = allBeans()
    .map(
      (bean) =>
        `<option value="${escapeHTML(bean.id)}">${escapeHTML(bean.name)}</option>`,
    )
    .join("");
  root.innerHTML = recipeLines
    .map(
      (line, index) =>
        `<div class="recipe-line" data-recipe-line="${index}"><select aria-label="نوع البن">${options}</select><input type="number" min="1" max="100000" step="1" inputmode="decimal" placeholder="جرام" value="${escapeHTML(line.grams)}" aria-label="الوزن بالجرام"><button type="button" class="remove-line" data-remove-line="${index}" aria-label="حذف المكون">×</button></div>`,
    )
    .join("");
  root.querySelectorAll(".recipe-line").forEach((el, index) => {
    el.querySelector("select").value = recipeLines[index].beanId;
    el.querySelector("select").addEventListener(
      "change",
      (event) => (recipeLines[index].beanId = event.target.value),
    );
    el.querySelector("input").addEventListener("input", (event) => {
      recipeLines[index].grams = event.target.value;
      updateRecipeTotal();
    });
  });
  updateRecipeTotal();
}
document.getElementById("add-recipe-line").addEventListener("click", () => {
  recipeLines.push({ beanId: allBeans()[0]?.id || "", grams: "" });
  renderRecipeLines();
});
document.getElementById("recipe-lines").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-line]");
  if (!button) return;
  if (recipeLines.length === 1) {
    notify("التوليفة لازم تحتوي على نوع بن واحد على الأقل");
    return;
  }
  recipeLines.splice(Number(button.dataset.removeLine), 1);
  renderRecipeLines();
});
function customerKey(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("ar");
}
function findCustomerByName(name) {
  return data.customers.find(
    (customer) => customerKey(customer.name) === customerKey(name),
  );
}
function customerInvoicesFor(name) {
  const key = customerKey(name);
  return data.invoices
    .filter(
      (invoice) =>
        customerKey(invoice.customer) === key &&
        (invoice.documentType || "receipt") === "receipt",
    )
    .sort(
      (a, b) =>
        invoiceActivityTime(b) - invoiceActivityTime(a) ||
        invoiceDateKey(b).localeCompare(invoiceDateKey(a)),
    );
}
function awardLoyaltyStamp(customerName) {
  const name = String(customerName || "").trim();
  if (!name) return false;
  const customer = findCustomerByName(name);
  if (!customer) return false;
  data.loyalty = data.loyalty || {};
  const next = Number(data.loyalty[customer.id] || 0) + 1;
  data.loyalty[customer.id] = next >= 8 ? 0 : next;
  if (next >= 8) notify(`العميل ${customer.name} استحق مكافأة الولاء`);
  return true;
}
function invoiceActivityTime(invoice) {
  const raw = invoice?.savedAt || invoice?.createdAt;
  const value = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(value) ? value : 0;
}
function lastInvoiceFor(name) {
  return customerInvoicesFor(name)[0];
}
function purchaseDateTime(invoice) {
  const timestamp = invoiceActivityTime(invoice);
  if (timestamp) {
    return new Intl.DateTimeFormat("ar-EG", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestamp));
  }
  return dateText(invoiceDateKey(invoice));
}
function relativeQuantity(value, unit) {
  const singular = {
    minute: "دقيقة",
    hour: "ساعة",
    day: "يوم",
    month: "شهر",
    year: "سنة",
  };
  const dual = {
    minute: "دقيقتين",
    hour: "ساعتين",
    day: "يومين",
    month: "شهرين",
    year: "سنتين",
  };
  const few = {
    minute: "دقائق",
    hour: "ساعات",
    day: "أيام",
    month: "أشهر",
    year: "سنوات",
  };
  const many = {
    minute: "دقيقة",
    hour: "ساعة",
    day: "يومًا",
    month: "شهرًا",
    year: "سنة",
  };
  if (value === 1) return singular[unit];
  if (value === 2) return dual[unit];
  return `${fmt.format(value)} ${value <= 10 ? few[unit] : many[unit]}`;
}
function relativePurchaseLabel(invoice) {
  if (!invoice) return "لا يوجد شراء مسجل";
  const timestamp = invoiceActivityTime(invoice);
  if (timestamp) {
    const elapsed = Date.now() - timestamp;
    if (elapsed < -60000) return `آخر شراء بتاريخ ${purchaseDateTime(invoice)}`;
    if (elapsed < 60000) return "آخر شراء منذ أقل من دقيقة";
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 60)
      return `آخر شراء منذ ${relativeQuantity(minutes, "minute")}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `آخر شراء منذ ${relativeQuantity(hours, "hour")}`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `آخر شراء منذ ${relativeQuantity(days, "day")}`;
    const months = Math.floor(days / 30);
    if (months < 12) return `آخر شراء منذ ${relativeQuantity(months, "month")}`;
    return `آخر شراء منذ ${relativeQuantity(Math.floor(days / 365), "year")}`;
  }
  const key = invoiceDateKey(invoice);
  const [y, m, d] = key.split("-").map(Number);
  const [ty, tm, td] = localDateValue().split("-").map(Number);
  const days = Math.floor(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86400000,
  );
  if (days < 0) return `آخر شراء بتاريخ ${dateText(key)}`;
  if (days === 0) return "آخر شراء اليوم";
  if (days < 30) return `آخر شراء منذ ${relativeQuantity(days, "day")}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `آخر شراء منذ ${relativeQuantity(months, "month")}`;
  return `آخر شراء منذ ${relativeQuantity(Math.floor(days / 365), "year")}`;
}
function customerCountryForInvoice() {
  const name = document.getElementById("invoice-customer").value.trim();
  const customer = findCustomerByName(name);
  if (customer?.country) return String(customer.country).trim();
  if (
    invoiceCustomerContext &&
    customerKey(invoiceCustomerContext.name) === customerKey(name)
  )
    return String(invoiceCustomerContext.country || "").trim();
  return "";
}
document.getElementById("blend-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = document.getElementById("blend-customer").value.trim();
  const country = document.getElementById("blend-country").value.trim();
  const blendName = document.getElementById("blend-name").value.trim();
  const ingredients = recipeLines
    .filter((line) => Number(line.grams) > 0)
    .map((line) => {
      const bean = allBeans().find((item) => item.id === line.beanId);
      return bean
        ? {
            beanId: bean.id,
            name: bean.name,
            grams: Number(line.grams),
            pricePerKg: bean.pricePerKg,
          }
        : null;
    })
    .filter(Boolean);
  if (!ingredients.length) {
    notify("أضف وزنًا لمكون واحد على الأقل");
    return;
  }
  let customer = data.customers.find(
    (item) => customerKey(item.name) === customerKey(name),
  );
  if (!customer) {
    customer = { id: `customer-${Date.now()}`, name, country, recipes: [] };
    data.customers.unshift(customer);
  } else if (country) customer.country = country;
  customer.recipes.unshift({
    id: `blend-${Date.now()}`,
    name: blendName,
    ingredients,
    createdAt: new Date().toISOString(),
  });
  try {
    persist();
  } catch {
    notify("تعذر الحفظ؛ مساحة الجهاز قد تكون ممتلئة");
    return;
  }
  event.target.reset();
  recipeLines = [{ beanId: allBeans()[0]?.id || "", grams: "" }];
  renderRecipeLines();
  renderCustomers();
  refreshHome();
  notify("اتحفظت التوليفة للعميل");
});
function renderCustomers() {
  const root = document.getElementById("customer-list");
  if (!data.customers.length) {
    root.innerHTML =
      '<div class="empty">لا يوجد عملاء محفوظون بعد. سجّل بيانات العميل وتوليفته من النموذج أعلاه.</div>';
    return;
  }
  const orderedCustomers = [...data.customers].sort(
    (a, b) =>
      invoiceActivityTime(lastInvoiceFor(b.name)) -
      invoiceActivityTime(lastInvoiceFor(a.name)),
  );
  root.innerHTML = orderedCustomers
    .map((customer) => {
      const id = escapeHTML(customer.id);
      const purchases = customerInvoicesFor(customer.name);
      const last = purchases[0];
      const country = String(customer.country || "").trim();
      const totalSaved = purchases.reduce(
        (sum, invoice) => sum + Number(invoice.total || 0),
        0,
      );
      const history =
        purchases
          .slice(0, 5)
          .map(
            (invoice) =>
              `<div class="customer-purchase-row"><span><strong>${escapeHTML(invoice.number)}</strong><small>${purchaseDateTime(invoice)} · ${paymentMethodLabel(invoice.paymentMethod)}</small></span><strong>${money(invoice.total)}</strong></div>`,
          )
          .join("") || '<div class="empty">لا توجد مشتريات محفوظة بعد.</div>';
      const recipes =
        (customer.recipes || [])
          .map((recipe) => {
            const ingredients = (recipe.ingredients || [])
              .map((item) => {
                const bean =
                  allBeans().find((x) => x.id === item.beanId) ||
                  allBeans().find(
                    (x) => customerKey(x.name) === customerKey(item.name),
                  );
                const grams = Number(item.grams || 0);
                const pricePerKg = bean
                  ? bean.pricePerKg
                  : Number(item.pricePerKg || 0);
                return `${escapeHTML(item.name)} — ${fmt.format(grams)} جم · ${money((pricePerKg * grams) / 1000)}`;
              })
              .join(" · ");
            const total = (recipe.ingredients || []).reduce((sum, item) => {
              const bean =
                allBeans().find((x) => x.id === item.beanId) ||
                allBeans().find(
                  (x) => customerKey(x.name) === customerKey(item.name),
                );
              return (
                sum +
                ((bean ? bean.pricePerKg : Number(item.pricePerKg || 0)) *
                  Number(item.grams || 0)) /
                  1000
              );
            }, 0);
            return `<div class="customer-template-row"><div class="recipe"><div class="recipe-title">${escapeHTML(recipe.name)} · ${dateText(recipe.createdAt)}</div><div class="ingredient-list">${ingredients}<br><strong>قيمة البن بالتسعير الحالي: ${money(total)}</strong></div></div><button type="button" class="secondary" data-customer-recipe-order="${id}" data-recipe-id="${escapeHTML(recipe.id)}">فاتورة بهذه التوليفة</button></div>`;
          })
          .join("") || '<span class="muted">لا توجد توليفات محفوظة بعد</span>';
      const lastDetails = last
        ? `${escapeHTML(last.number)} · ${purchaseDateTime(last)} · ${last.roastMode === "m7awag" ? "محوّج" : "سادة"} · الدفع: ${paymentMethodLabel(last.paymentMethod)}${last.expiryDate ? ` · الصلاحية حتى ${dateText(last.expiryDate)}` : ""}`
        : "لم تسجّل فاتورة بيع بعد";
      return `<article class="customer-card"><button class="customer-toggle" type="button" data-customer-toggle="${id}" aria-expanded="false" aria-controls="customer-details-${id}"><span class="customer-ident"><span class="customer-name-row"><strong>👤 ${escapeHTML(customer.name)}</strong>${country ? `<span class="customer-country">${escapeHTML(country)}</span>` : ""}</span><small class="customer-last-buy">${relativePurchaseLabel(last)}</small></span><span class="customer-chevron" aria-hidden="true">⌄</span></button><section class="customer-expanded" id="customer-details-${id}" hidden><div class="customer-stats"><div><small>إجمالي المشتريات المحفوظة</small><strong>${money(totalSaved)}</strong></div><div><small>عدد إيصالات البيع المحفوظة</small><strong>${fmt.format(purchases.length)}</strong></div></div><small class="customer-stats-note">الإجمالي من الفواتير المحفوظة على الجهاز، وليس صافي الربح.</small><div class="customer-invoice-actions"><button type="button" class="primary" data-add-customer-order="${id}">إضافة طلب</button><button type="button" class="secondary" data-add-customer-suborder="${id}">طلب فرعي</button></div><small class="customer-branch-note">«إضافة طلب» يحمّل آخر فاتورة، أو أحدث توليفة محفوظة إذا لم توجد فاتورة. «طلب فرعي» يبدأ أصنافًا إضافية مرتبطة بآخر فاتورة. الأسعار تُحسب تلقائيًا.</small><div class="field customer-note-field"><label for="customer-note-${id}">ملاحظات وتفضيلات العميل</label><textarea id="customer-note-${id}" data-customer-note="${id}" maxlength="600" rows="2" placeholder="مثال: يفضل البن السادة أو موعد التواصل">${escapeHTML(customer.notes || "")}</textarea></div><div class="customer-section"><strong>آخر المشتريات المحفوظة</strong><div class="customer-purchase-list">${history}</div></div><div class="history-detail"><strong>آخر فاتورة بيع:</strong> ${lastDetails}<br><strong>التوليفات المحفوظة:</strong>${recipes}</div></section></article>`;
    })
    .join("");
}
function startCustomerOrder(customerId, isSuborder = false, recipeId = "") {
  const customer = data.customers.find((item) => item.id === customerId);
  if (!customer) return;
  const last = lastInvoiceFor(customer.name);
  const recipes = Array.isArray(customer.recipes) ? customer.recipes : [];
  let recipe = recipeId ? recipes.find((item) => item.id === recipeId) : null;
  const reuseLast = !isSuborder && !recipeId && Boolean(last);
  if (!recipe && !reuseLast && !isSuborder && recipes.length)
    recipe = recipes[0];
  invoiceGrams = {};
  if (recipe) {
    (recipe.ingredients || []).forEach((item) => {
      const bean =
        allBeans().find((x) => x.id === item.beanId) ||
        allBeans().find((x) => customerKey(x.name) === customerKey(item.name));
      if (bean)
        invoiceGrams[bean.id] = String(
          Number(invoiceGrams[bean.id] || 0) + Number(item.grams || 0),
        );
    });
  } else if (reuseLast) {
    (last.items || []).forEach((item) => {
      const bean =
        allBeans().find((x) => x.id === item.beanId) ||
        allBeans().find((x) => customerKey(x.name) === customerKey(item.name));
      if (bean)
        invoiceGrams[bean.id] = String(
          Number(invoiceGrams[bean.id] || 0) + Number(item.grams || 0),
        );
    });
  }
  roastMode = last?.roastMode || "sada";
  documentType = "receipt";
  paymentMethod =
    last?.paymentMethod || customer.defaultPaymentMethod || "cash";
  invoiceLineage = isSuborder
    ? {
        branchType: "suborder",
        ...(last
          ? {
              parentInvoiceId: last.id,
              parentInvoiceNumber: last.number,
              parentInvoiceDate: invoiceDateKey(last),
            }
          : {}),
      }
    : null;
  invoiceCustomerContext = {
    name: customer.name,
    country: customer.country || "",
  };
  closeReceipt();
  openView("invoice", { push: true, animate: true });
  document.getElementById("invoice-customer").value = customer.name;
  document.getElementById("invoice-date").value = localDateValue();
  document.getElementById("invoice-expiry").value =
    autoExpiryDate(localDateValue());
  document.getElementById("invoice-expiry").dataset.forDate = localDateValue();
  document
    .querySelectorAll("[data-document-type]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.documentType === documentType),
      ),
    );
  document
    .querySelectorAll("[data-payment-method]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.paymentMethod === paymentMethod),
      ),
    );
  renderInvoice();
  const loaded = recipe
    ? `التوليفة «${recipe.name}»`
    : reuseLast
      ? "آخر فاتورة محفوظة"
      : "";
  notify(
    isSuborder
      ? "بدأ الطلب الفرعي؛ طريقة الدفع من آخر فاتورة"
      : loaded
        ? `حمّلنا ${loaded} وأسعار البن تتحسب تلقائيًا`
        : `بدأ طلب جديد للعميل ${customer.name}`,
  );
}
document.getElementById("customer-list").addEventListener("change", (event) => {
  const field = event.target.closest("[data-customer-note]");
  if (!field) return;
  const customer = data.customers.find(
    (x) => x.id === field.dataset.customerNote,
  );
  if (!customer) return;
  customer.notes = field.value.trim();
  try {
    persist();
    notify("تم حفظ ملاحظة العميل");
  } catch {
    notify("تعذر حفظ الملاحظة");
  }
});
document.getElementById("customer-list").addEventListener("click", (event) => {
  const saved = event.target.closest("[data-customer-recipe-order]");
  if (saved) {
    startCustomerOrder(
      saved.dataset.customerRecipeOrder,
      false,
      saved.dataset.recipeId,
    );
    return;
  }
  const add = event.target.closest("[data-add-customer-order]");
  if (add) {
    startCustomerOrder(add.dataset.addCustomerOrder, false);
    return;
  }
  const sub = event.target.closest("[data-add-customer-suborder]");
  if (sub) {
    startCustomerOrder(sub.dataset.addCustomerSuborder, true);
    return;
  }
  const toggle = event.target.closest("[data-customer-toggle]");
  if (!toggle) return;
  const details = document.getElementById(
    `customer-details-${toggle.dataset.customerToggle}`,
  );
  if (!details) return;
  details.hidden = !details.hidden;
  toggle.setAttribute("aria-expanded", String(!details.hidden));
});
function renderCustomBeans() {
  const root = document.getElementById("custom-bean-list");
  if (!root) return;
  if (!data.customBeans.length) {
    root.innerHTML =
      '<div class="empty">الأنواع الأربعة الأساسية جاهزة. أي نوع تضيفه هيظهر هنا وفي شاشة الفواتير.</div>';
    return;
  }
  root.innerHTML = data.customBeans
    .map(
      (bean) =>
        `<article class="custom-bean-row"><img src="${escapeHTML(bean.image)}" alt="${escapeHTML(bean.name)}"><div class="info"><strong>${escapeHTML(bean.name)}</strong><small>الكيلو ${money(bean.pricePerKg)}</small></div></article>`,
    )
    .join("");
}
function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("اختار ملف صورة صالح"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("تعذرت قراءة الصورة"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("الصورة غير مدعومة"));
      image.onload = () => {
        const scale = Math.min(1, 900 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas
          .getContext("2d")
          .drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.76));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
document
  .getElementById("export-data")
  .addEventListener("click", downloadBackup);
document.getElementById("share-data").addEventListener("click", shareBackup);
document
  .getElementById("backup-folder-settings")
  .addEventListener("click", () => {
    if (window.MandourNative?.chooseFolder)
      window.MandourNative.chooseFolder("backup");
    else notify("اختيار المجلد متاح في تطبيق Android");
  });
document.getElementById("import-data").addEventListener("change", (event) => {
  importBackupFile(event.target.files?.[0]);
  event.target.value = "";
});
window.mandourFolderChosen = (kind, name) => {
  if (kind === "backup") {
    notify("تم اختيار مجلد النسخ الاحتياطي: " + name);
    scheduleAutoBackupCheck();
  }
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  deferExpiredChecks();
  if (currentView === "checks") renderChecks();
  const removed = purgeExpiredInvoices();
  if (removed) {
    renderInvoiceHistory();
    renderCustomers();
    refreshHome();
    notify(`تم حذف ${fmt.format(removed)} مستند انتهت صلاحيته تلقائيًا`);
  }
});
setInterval(
  () => {
    if (document.hidden) return;
    const moved = deferExpiredChecks();
    if (moved && currentView === "checks") renderChecks();
    const removed = purgeExpiredInvoices();
    if (removed) {
      renderInvoiceHistory();
      renderCustomers();
      refreshHome();
      notify(`تم حذف ${fmt.format(removed)} مستند انتهت صلاحيته تلقائيًا`);
    }
  },
  60 * 60 * 1000,
);
const MAP_LOCATION_URL = "https://maps.app.goo.gl/phv48EMLHnG28rVP9";
const WALLET_NUMBER = "01097110611";
const CHECK_MENU = [
  {
    id: "turkish",
    name: "قهوة تركي",
    image: "assets/menu/real2/turkish.jpg",
    options: [
      { id: "single", label: "سنجل", price: 20 },
      { id: "double", label: "دبل", price: 40 },
    ],
  },
  {
    id: "turkish-milk",
    name: "قهوة بلبن عادية",
    image: "assets/menu/real2/turkish-milk.jpg",
    options: [{ id: "regular", label: "عادية", price: 30 }],
  },
  {
    id: "hazelnut",
    name: "قهوة بندق",
    image: "assets/menu/real2/hazelnut.jpg",
    options: [{ id: "regular", label: "عادية", price: 30 }],
  },
  {
    id: "french",
    name: "قهوة فرنساوي",
    image: "assets/menu/real2/french.jpg",
    options: [{ id: "regular", label: "عادية", price: 30 }],
  },
  {
    id: "espresso",
    name: "إسبريسو",
    image: "assets/menu/real2/espresso.jpg",
    espresso: true,
    defaultOption: "single",
    options: [
      { id: "single", label: "سنجل شوت", price: 25 },
      { id: "double", label: "دبل شوت", price: 40 },
    ],
  },
  {
    id: "latte",
    name: "لاتيه",
    image: "assets/menu/real2/latte.jpg",
    espresso: true,
    defaultOption: "single",
    options: [
      { id: "single", label: "سنجل إسبريسو", price: 40 },
      { id: "double", label: "دبل إسبريسو", price: 60 },
    ],
  },
  {
    id: "cappuccino",
    name: "كابتشينو",
    image: "assets/menu/real2/cappuccino.jpg",
    espresso: true,
    defaultOption: "single",
    options: [
      { id: "single", label: "سنجل إسبريسو", price: 40 },
      { id: "double", label: "دبل إسبريسو", price: 60 },
    ],
  },
  {
    id: "cortado",
    name: "كورتادو",
    image: "assets/menu/real2/cortado.jpg",
    espresso: true,
    defaultOption: "double",
    options: [
      { id: "single", label: "سنجل شوت", price: 40 },
      { id: "double", label: "دبل شوت", price: 50 },
    ],
  },
  {
    id: "biscuit",
    name: "بسكوت",
    image: "assets/menu/real2/biscuit.jpg",
    options: [{ id: "piece", label: "القطعة", price: 5 }],
  },
  {
    id: "dates",
    name: "تمر",
    image: "assets/menu/real2/dates.jpg",
    options: [{ id: "piece", label: "الحبة", price: 15 }],
  },
  {
    id: "tea",
    name: "الشاي",
    image: "assets/menu/real2/tea.jpg",
    options: [{ id: "regular", label: "كوب", price: 10 }],
  },
  {
    id: "tea-clove",
    name: "شاي بقرنفل",
    image: "assets/menu/real2/tea-clove.jpg",
    options: [{ id: "regular", label: "كوب", price: 10 }],
  },
  {
    id: "clove",
    name: "قرنفل",
    image: "assets/menu/real2/clove.jpg",
    options: [{ id: "regular", label: "كوب", price: 10 }],
  },
  {
    id: "anise",
    name: "ينسون",
    image: "assets/menu/real2/anise.jpg",
    options: [{ id: "regular", label: "كوب", price: 10 }],
  },
  {
    id: "mint",
    name: "نعناع",
    image: "assets/menu/real2/mint.jpg",
    options: [{ id: "regular", label: "كوب", price: 10 }],
  },
  {
    id: "green-tea",
    name: "شاي أخضر",
    image: "assets/menu/real2/green-tea.jpg",
    options: [{ id: "regular", label: "كوب", price: 10 }],
  },
  {
    id: "nescafe",
    name: "نسكافية",
    image: "assets/menu/real2/nescafe.jpg",
    options: [{ id: "regular", label: "كوب", price: 30 }],
  },
];
let checkDraft = [];
let checkFilter = "unpaid";
let checkModeFilter = "all";
let checkPanel = "list";
let moveState = null;
const EXTRA_DRINKS = [
  {
    id: "rani",
    name: "راني",
    image: "assets/menu/cold/rani.jpg",
    options: [{ id: "regular", label: "زجاجة", price: 20 }],
  },
  {
    id: "pepsi",
    name: "بيبسي",
    image: "assets/menu/cold/pepsi.jpg",
    options: [{ id: "regular", label: "زجاجة", price: 20 }],
  },
  {
    id: "seven-up",
    name: "سفن أب",
    image: "assets/menu/cold/seven-up.jpg",
    options: [{ id: "regular", label: "زجاجة", price: 20 }],
  },
  {
    id: "sting",
    name: "ستينغ",
    image: "assets/menu/cold/sting.jpg",
    options: [{ id: "regular", label: "علبة", price: 20 }],
  },
  {
    id: "fayrouz",
    name: "فيروز",
    image: "assets/menu/cold/fayrouz.jpg",
    options: [{ id: "regular", label: "زجاجة", price: 20 }],
  },
  {
    id: "mirinda",
    name: "ميرندا",
    image: "assets/menu/cold/mirinda.jpg",
    options: [{ id: "regular", label: "زجاجة", price: 20 }],
  },
  {
    id: "pepsi-diet",
    name: "بيبسي دايت",
    image: "assets/menu/cold/pepsi-diet.jpg",
    options: [{ id: "regular", label: "زجاجة", price: 20 }],
  },
  {
    id: "water-small",
    name: "مياه صغيرة",
    image: "assets/menu/cold/water-small.jpg",
    options: [{ id: "regular", label: "زجاجة", price: 10 }],
  },
  {
    id: "water-large",
    name: "مياه كبيرة",
    image: "assets/menu/cold/water-large.jpg",
    options: [{ id: "regular", label: "زجاجة", price: 15 }],
  },
  {
    id: "volt",
    name: "فولت",
    image: "assets/menu/cold/volt.jpg",
    options: [{ id: "regular", label: "علبة", price: 10 }],
  },
  {
    id: "monster",
    name: "مونستر",
    image: "assets/menu/cold/monster.jpg",
    options: [{ id: "regular", label: "علبة", price: 60 }],
  },
  {
    id: "redbull",
    name: "ريد بُل",
    image: "assets/menu/cold/redbull.jpg",
    options: [{ id: "regular", label: "علبة", price: 70 }],
  },
  {
    id: "juice",
    name: "عصير",
    image: "assets/menu/cold/juice.jpg",
    options: [{ id: "regular", label: "زجاجة", price: 20 }],
  },
];
function allCheckProducts() {
  return CHECK_MENU.concat(EXTRA_DRINKS);
}
function activeChecks() {
  return data.checks.filter(
    (c) => c.status === "open" || c.status === "partial",
  );
}
function availableChecks() {
  return data.checks.filter((c) => c.status !== "paid");
}
function netUnitPrice(item) {
  const base = Number(item.unitPrice || 0);
  const qty = Math.max(1, Number(item.qty || 1));
  const lineDiscount = Math.max(
    0,
    Math.min(base * qty, Number(item.lineDiscount || 0)),
  );
  return Math.max(0, (base * qty - lineDiscount) / qty);
}
function priceText(item) {
  const base = Number(item.unitPrice || 0),
    net = netUnitPrice(item);
  return Number(item.lineDiscount || 0) > 0
    ? `<del>${money(base)}</del> <strong>${money(net)}</strong>`
    : money(net);
}
function lineLabel(item) {
  const qty = Math.max(1, Number(item.qty || 1));
  const unit = Number(item.unitPrice || 0);
  const discount = Number(item.lineDiscount || 0);
  const gross = unit * qty;
  if (discount > 0) {
    return `العدد: ${fmt.format(qty)} · الإجمالي: <del>${money(gross)}</del> <strong>${money(gross - discount)}</strong> · خصم ${money(discount)}`;
  }
  return `العدد: ${fmt.format(qty)} · السعر: ${money(unit)}`;
}
function checkGuestTotal(guest) {
  return (guest.items || []).reduce(
    (sum, item) => sum + netUnitPrice(item) * Number(item.qty || 0),
    0,
  );
}
function checkPaidTotal(check) {
  const itemsPaid = (check.guests || []).reduce(
    (sum, guest) =>
      sum +
      (guest.items || []).reduce(
        (n, item) =>
          n +
          netUnitPrice(item) *
            Math.min(Number(item.qty || 0), Number(item.paidQty || 0)),
        0,
      ),
    0,
  );
  return itemsPaid + (check.tipPaid ? Number(check.tip || 0) : 0);
}
function checkTotal(check) {
  return (
    (check.guests || []).reduce(
      (sum, guest) => sum + checkGuestTotal(guest),
      0,
    ) + Number(check.tip || 0)
  );
}
function checkDue(check) {
  return Math.max(0, checkTotal(check) - checkPaidTotal(check));
}
function checkItemLabel(item) {
  return `${item.name}${item.optionLabel && item.optionLabel !== "عادية" && item.optionLabel !== "القطعة" && item.optionLabel !== "الحبة" && item.optionLabel !== "كوب" && item.optionLabel !== "زجاجة" && item.optionLabel !== "علبة" ? ` · ${item.optionLabel}` : ""}`;
}
function localShiftDayKey(date = new Date()) {
  const d = new Date(date);
  if (d.getHours() < 2) d.setDate(d.getDate() - 1);
  return localDateValue(d);
}
function deferExpiredChecks() {
  const cutoff = localShiftDayKey();
  let changed = false;
  data.checks.forEach((c) => {
    if (
      (c.status === "open" || c.status === "partial") &&
      checkDue(c) > 0 &&
      localDateValue(new Date(c.createdAt)) < cutoff
    ) {
      c.status = "deferred";
      c.deferredAt = new Date().toISOString();
      changed = true;
    }
  });
  if (changed)
    try {
      persist();
    } catch {}
  return changed;
}
let favoriteProductIds = new Set();
try { favoriteProductIds = new Set(JSON.parse(localStorage.getItem("mandour-favorite-products") || "[]")); } catch {}
function menuCards(list, buttonAttr) {
  return list
    .map((item) => {
      const opts = item.options || [];
      if (opts.length > 1) {
        const defaultOptId = item.defaultOption || opts[0].id;
        const buttons = opts
          .map(
            (o) =>
              `<button type="button" class="option-btn${o.id === defaultOptId ? " is-default" : ""}" ${buttonAttr}="${item.id}" data-option-id="${o.id}"><span class="opt-label">${escapeHTML(o.label)}</span><span class="opt-price">${money(o.price)}</span></button>`,
          )
          .join("");
        return `<article class="check-menu-card" data-menu-card="${item.id}"><button type="button" class="favorite-menu-btn ${favoriteProductIds.has(item.id) ? "is-favorite" : ""}" data-favorite-product="${escapeHTML(item.id)}" aria-label="إضافة للمفضلة">${favoriteProductIds.has(item.id) ? "♥" : "♡"}</button><img src="${item.image}" alt="${escapeHTML(item.name)}" loading="lazy"><div class="check-menu-info"><strong>${escapeHTML(item.name)}</strong><div class="option-buttons">${buttons}</div></div></article>`;
      }
      const option = opts[0];
      return `<article class="check-menu-card" data-menu-card="${item.id}"><button type="button" class="favorite-menu-btn ${favoriteProductIds.has(item.id) ? "is-favorite" : ""}" data-favorite-product="${escapeHTML(item.id)}" aria-label="إضافة للمفضلة">${favoriteProductIds.has(item.id) ? "♥" : "♡"}</button><img src="${item.image}" alt="${escapeHTML(item.name)}" loading="lazy"><div class="check-menu-info"><strong>${escapeHTML(item.name)}</strong><small class="check-menu-price">السعر: ${money(option.price)}</small><button type="button" ${buttonAttr}="${item.id}">＋ إضافة</button></div></article>`;
    })
    .join("");
}
function renderQuickAdd() {
  const root = document.getElementById("quick-add");
  if (!root) return;
  const counts = {};
  (data.checks || []).forEach((c) => {
    (c.guests || []).forEach((g) => {
      (g.items || []).forEach((item) => {
        if (!item.productId || !item.optionId) return;
        const key = item.productId + "::" + item.optionId;
        if (!counts[key])
          counts[key] = {
            productId: item.productId,
            optionId: item.optionId,
            count: 0,
          };
        counts[key].count += Number(item.qty || 0);
      });
    });
  });
  const top = Object.values(counts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const simpleLabels = ["عادية", "كوب", "زجاجة", "علبة", "القطعة", "الحبة"];
  const items = top
    .map((t) => {
      const product = allCheckProducts().find((p) => p.id === t.productId);
      if (!product) return "";
      const opt = (product.options || []).find((o) => o.id === t.optionId);
      if (!opt) return "";
      const label = simpleLabels.includes(opt.label) ? "" : " · " + opt.label;
      return `<button type="button" class="quick-add-btn" data-quick-add="${escapeHTML(t.productId)}" data-quick-option="${escapeHTML(t.optionId)}"><span class="qa-name">${escapeHTML(product.name)}${escapeHTML(label)}</span><span class="qa-price">${money(opt.price)}</span></button>`;
    })
    .filter(Boolean)
    .join("");
  root.innerHTML = items;
  root.hidden = !items;
}
function renderCheckMenu() {
  const root = document.getElementById("check-menu");
  if (!root) return;
  const count = document.getElementById("menu-count");
  if (count) count.textContent = `${fmt.format(CHECK_MENU.length)} صنف`;
  root.innerHTML = menuCards(CHECK_MENU, "data-menu-add");
  renderQuickAdd();
}
function renderExtraDrinks() {
  const root = document.getElementById("extra-drinks-menu");
  if (root) root.innerHTML = menuCards(EXTRA_DRINKS, "data-extra-menu-add");
}
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-favorite-product]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  const id = button.dataset.favoriteProduct;
  if (favoriteProductIds.has(id)) favoriteProductIds.delete(id);
  else favoriteProductIds.add(id);
  try { localStorage.setItem("mandour-favorite-products", JSON.stringify([...favoriteProductIds])); } catch {}
  renderCheckMenu();
  renderExtraDrinks();
  notify(favoriteProductIds.has(id) ? "اتضاف للمفضلة" : "اتشال من المفضلة");
});
function renderCheckTargets() {
  const select = document.getElementById("check-existing");
  if (!select) return;
  const selected = select.value;
  const options = availableChecks()
    .map(
      (c) =>
        `<option value="${escapeHTML(c.id)}">${c.mode === "inside" ? "طاولة " + escapeHTML(c.tableName || "—") : "تيك أواي"} · ${(c.guests || []).length} عميل · ${money(checkTotal(c))}</option>`,
    )
    .join("");
  select.innerHTML = '<option value="">إنشاء حساب جديد</option>' + options;
  if (availableChecks().some((c) => c.id === selected)) select.value = selected;
  syncCheckTarget();
}
function syncCheckTarget() {
  const existing = document.getElementById("check-existing")?.value;
  const check = availableChecks().find((c) => c.id === existing);
  const mode = document.getElementById("check-service-mode");
  const table = document.getElementById("check-table-name");
  const tableField = document.getElementById("check-table-field");
  if (!mode || !table) return;
  if (check) {
    mode.value = check.mode;
    mode.disabled = true;
    table.value = check.tableName || "";
    table.disabled = true;
  } else {
    mode.disabled = false;
    table.disabled = false;
  }
  tableField.hidden = mode.value !== "inside";
  table.required = mode.value === "inside" && !check;
  const preview = document.getElementById("check-user-preview");
  if (preview)
    preview.textContent = check
      ? `العميل الحالي: ${(check.guests || []).map((g) => g.name).join(" · ") || "بدون اسم"}`
      : document.getElementById("check-customer")?.value.trim()
        ? `العميل الحالي: ${document.getElementById("check-customer").value.trim()}`
        : "أصناف بدون اسم عميل";
}
function renderCheckDraft() {
  const root = document.getElementById("check-draft-lines");
  if (!root) return;
  const total = checkDraft.reduce(
    (sum, item) => sum + netUnitPrice(item) * item.qty,
    0,
  );
  document.getElementById("check-draft-total").textContent = money(total);
  root.innerHTML = checkDraft.length
    ? `<div class="check-draft-list">${checkDraft.map((item, index) => `<div class="check-draft-line"><span class="check-line-name">${escapeHTML(checkItemLabel(item))}<small class="line-qty-label">${lineLabel(item)}</small><input type="text" class="draft-customer-input" placeholder="اسم العميل (اختياري)" value="${escapeHTML(item.customerName || "")}" data-draft-customer="${index}" maxlength="60" aria-label="اسم عميل ${escapeHTML(checkItemLabel(item))}"></span><label class="discount-field"><span>خصم على السطر (جنيه)</span><input type="number" min="0" max="${Number(item.unitPrice || 0) * Number(item.qty || 1)}" step="1" value="${item.lineDiscount || ""}" placeholder="0" data-draft-discount="${index}"></label><span class="qty-controls"><button type="button" data-draft-dec="${index}">−</button><strong>${fmt.format(item.qty)}</strong><button type="button" data-draft-inc="${index}">＋</button><button type="button" data-draft-remove="${index}">×</button></span></div>`).join("")}</div>`
    : '<div class="empty">اختار صنفًا من القائمة.</div>';
}
function setCheckPanel(mode = "list") {
  checkPanel = mode;
  const form = document.getElementById("check-order-form"),
    list = document.getElementById("checks-only-panel");
  if (form) form.hidden = mode !== "orders";
  if (list) list.hidden = mode !== "list";
  document
    .querySelectorAll("[data-check-panel]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.checkPanel === mode)),
    );
  if (mode === "orders") window.scrollTo({ top: 0, behavior: "smooth" });
}
function addCheckEvent(check, type, payload = {}) {
  check.events = Array.isArray(check.events) ? check.events : [];
  check.events.push({
    id: `event-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    at: new Date().toISOString(),
    ...payload,
  });
  if (check.events.length > 1000) check.events = check.events.slice(-1000);
}
function checkEventLabel(entry) {
  if (entry.type === "order")
    return `طلب مسجل · ${(entry.items || []).map((i) => `${i.name} × ${fmt.format(i.qty)}${i.customerName && i.customerName !== "بدون اسم" ? " · " + i.customerName : ""}`).join("، ")}`;
  if (entry.type === "discount")
    return `تعديل خصم · ${entry.itemName} · ${money(entry.discount || 0)}`;
  if (entry.type === "payment")
    return `${entry.paid ? "تسجيل دفع" : "إلغاء دفع"} · ${entry.itemName} · ${money(entry.amount || 0)}`;
  if (entry.type === "payment_full")
    return `تسجيل دفع كامل · ${money(entry.amount || 0)}`;
  return entry.label || "تحديث الشيك";
}
function renderCheckTimeline(check) {
  const events = (check.events || [])
    .slice()
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  if (!events.length) return "";
  return `<details class="check-timeline"><summary>سجل الطلبات والخصومات والمدفوعات · ${fmt.format(events.length)}</summary><div class="check-timeline-list">${events.map((entry) => `<div class="check-timeline-entry"><strong>${escapeHTML(checkEventLabel(entry))}</strong><small>${escapeHTML(dateFmt.format(new Date(entry.at)))}</small></div>`).join("")}</div></details>`;
}
function globalDateKey(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return String(value);
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? "" : localDateValue(date);
}
function globalInDateRange(value, from, to) {
  const key = globalDateKey(value);
  return Boolean(key) && (!from || key >= from) && (!to || key <= to);
}
function globalSearchMatch(text, query) {
  if (!query) return true;
  return String(text || "")
    .toLocaleLowerCase("ar")
    .includes(query);
}
function globalSearchRender() {
  const root = document.getElementById("global-search-results");
  if (!root) return;
  const q = (document.getElementById("global-search-query")?.value || "")
    .trim()
    .toLocaleLowerCase("ar");
  const from = document.getElementById("global-search-from")?.value || "",
    to = document.getElementById("global-search-to")?.value || "";
  const status =
      document.getElementById("global-search-status")?.value || "all",
    method = document.getElementById("global-search-method")?.value || "all";
  const count = document.getElementById("global-search-count");
  if (!q && !from && !to && status === "all" && method === "all") {
    root.innerHTML = '<div class="empty">اكتب كلمة للبحث أو اختر فلترًا.</div>';
    if (count) count.textContent = "";
    return;
  }
  const results = [];
  for (const invoice of data.invoices) {
    const label = invoice.documentType === "quote" ? "عرض سعر" : "فاتورة";
    if (method !== "all" && invoice.paymentMethod !== method) continue;
    if (status !== "all") continue;
    if (!globalInDateRange(invoiceDateKey(invoice), from, to)) continue;
    const text = [
      invoice.number,
      invoice.customer,
      invoice.customerCountry,
      invoice.documentType,
      paymentMethodLabel(invoice.paymentMethod),
      (invoice.items || []).map((i) => i.name).join(" "),
    ].join(" ");
    if (!globalSearchMatch(text, q)) continue;
    results.push({
      type: "invoice",
      id: invoice.id,
      date: invoice.savedAt || invoice.createdAt || invoiceDateKey(invoice),
      title: `${label} ${invoice.number || ""} · ${invoice.customer || "عميل نقدي"}`,
      detail: `${dateText(invoiceDateKey(invoice))} · ${paymentMethodLabel(invoice.paymentMethod)} · ${money(invoice.total || 0)}`,
    });
  }
  for (const check of data.checks) {
    if (method !== "all") continue;
    const due = checkDue(check),
      paid = checkPaidTotal(check);
    const state = due <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid";
    if (status !== "all" && status !== state) continue;
    const guests = (check.guests || []).map((g) => g.name).join(" ");
    const items = (check.guests || [])
      .flatMap((g) => (g.items || []).map((i) => i.name + " " + i.optionLabel))
      .join(" ");
    const text = [
      check.id,
      check.tableName,
      check.mode,
      check.notes,
      guests,
      items,
    ].join(" ");
    if (
      globalSearchMatch(text, q) &&
      globalInDateRange(check.createdAt || check.lastOrderAt, from, to)
    ) {
      results.push({
        type: "check",
        id: check.id,
        date: check.lastOrderAt || check.createdAt,
        title: `شيك ${check.mode === "inside" ? "طاولة " + (check.tableName || "—") : "تيك أواي"} · ${guests || "بدون اسم"}`,
        detail: `${dateFmt.format(new Date(check.lastOrderAt || check.createdAt))} · ${state === "paid" ? "مدفوع بالكامل" : state === "partial" ? "مدفوع جزئيًا" : "غير مدفوع"} · المتبقي ${money(due)}`,
      });
    }
    for (const entry of check.events || []) {
      if (!globalInDateRange(entry.at, from, to)) continue;
      const eventText = [
        check.id,
        check.tableName,
        guests,
        entry.itemName,
        checkEventLabel(entry),
        (entry.items || []).map((i) => i.name + " " + i.customerName).join(" "),
      ].join(" ");
      if (!globalSearchMatch(eventText, q)) continue;
      results.push({
        type: "check",
        id: check.id,
        date: entry.at,
        title: `${check.mode === "inside" ? "طاولة " + (check.tableName || "—") : "تيك أواي"} · ${checkEventLabel(entry)}`,
        detail: `${dateFmt.format(new Date(entry.at))} · ${guests || "بدون اسم"}`,
      });
    }
  }
  if (status === "all" && method === "all")
    for (const customer of data.customers) {
      const invoices = customerInvoicesFor(customer.name);
      const recipeDates = (customer.recipes || [])
        .map((r) => r.createdAt)
        .filter(Boolean);
      const relevant = [
        ...invoices.map((i) => i.savedAt || i.createdAt || invoiceDateKey(i)),
        ...recipeDates,
      ].sort((a, b) => String(b).localeCompare(String(a)));
      const when = relevant[0] || "";
      if (!globalInDateRange(when, from, to)) continue;
      const text = [
        customer.name,
        customer.country,
        customer.notes,
        (customer.recipes || [])
          .map(
            (r) =>
              r.name + " " + (r.ingredients || []).map((i) => i.name).join(" "),
          )
          .join(" "),
      ].join(" ");
      if (!globalSearchMatch(text, q)) continue;
      results.push({
        type: "customer",
        id: customer.id,
        date: when,
        title: `عميل · ${customer.name}`,
        detail: `${customer.country || "بدون بلد"} · ${invoices.length ? `آخر فاتورة ${dateText(invoiceDateKey(invoices[0]))}` : "لا توجد فواتير"}`,
      });
    }
  results.sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || "")),
  );
  const visible = results.slice(0, 80);
  if (count)
    count.textContent =
      results.length > 80
        ? `عرض ٨٠ من ${fmt.format(results.length)} نتيجة`
        : `${fmt.format(results.length)} نتيجة`;
  root.innerHTML = visible.length
    ? visible
        .map(
          (r) =>
            `<button type="button" class="global-result" data-global-type="${r.type}" data-global-id="${escapeHTML(r.id)}"><strong>${escapeHTML(r.title)}</strong><small>${escapeHTML(r.detail)}</small></button>`,
        )
        .join("")
    : '<div class="empty">لا توجد نتائج تطابق البحث والفلاتر.</div>';
}
let lastPaidSoundKey = "";
let paidSoundRequested = false;
const expandedCheckIds = new Set();
function syncPaidSound() {
  const allPaid =
    currentView === "checks" &&
    data.checks.length > 0 &&
    data.checks.every((c) => checkDue(c) <= 0);
  if (!allPaid) {
    if (paidSoundRequested) {
      try {
        window.MandourNative?.stopPaidSound?.();
      } catch (error) {}
    }
    paidSoundRequested = false;
    lastPaidSoundKey = "";
    return;
  }
  const key = data.checks
    .map(
      (c) =>
        `${c.id}:${c.paidAt || c.closedAt || c.lastOrderAt || c.createdAt || "paid"}`,
    )
    .sort()
    .join("|");
  if (key === lastPaidSoundKey) return;
  lastPaidSoundKey = key;
  paidSoundRequested = true;
  try {
    window.MandourNative?.playPaidSound?.(key);
  } catch (error) {
    paidSoundRequested = false;
  }
}
function playCheckActionSound(kind) {
  try {
    window.MandourNative?.playActionSound?.(`${kind}-${Date.now()}-${Math.random()}`);
  } catch (error) {}
}
function renderChecks() {
  const root = document.getElementById("check-list");
  if (!root) return;
  deferExpiredChecks();
  renderCheckTargets();
  const opened = activeChecks().sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt)),
  );
  const deferred = data.checks
    .filter((c) => c.status === "deferred")
    .sort((a, b) =>
      String(b.deferredAt || b.createdAt).localeCompare(
        String(a.deferredAt || a.createdAt),
      ),
    );
  const paid = data.checks
    .filter((c) => c.status === "paid")
    .sort((a, b) =>
      String(b.paidAt || b.createdAt).localeCompare(
        String(a.paidAt || a.createdAt),
      ),
    );
  const closed = data.checks
    .filter((c) => c.status === "closed")
    .sort((a, b) =>
      String(b.closedAt || b.createdAt).localeCompare(
        String(a.closedAt || a.createdAt),
      ),
    );
  let list =
    checkFilter === "unpaid"
      ? [...opened, ...deferred]
      : checkFilter === "paid"
        ? paid
        : [...opened, ...deferred, ...paid, ...closed];
  function card(c) {
    const total = checkTotal(c);
    const paid = checkPaidTotal(c);
    const due = checkDue(c);
    const status =
      c.status === "paid"
        ? "مدفوع بالكامل"
        : c.status === "deferred"
          ? "مؤجل"
          : c.status === "closed"
            ? "مغلق"
            : due < total
              ? "مدفوع جزئيًا"
              : "مفتوح";
    const quickPay =
      c.status !== "paid" && c.status !== "closed"
        ? `<button type="button" class="primary quick-pay" data-pay-check="${escapeHTML(c.id)}">دفع المتبقي <strong>${money(due)}</strong></button>`
        : `<span class="paid-stamp">✓ ${status}</span>`;
    const guests = (c.guests || [])
      .map(
        (g) =>
          `<div class="compact-guest"><div class="compact-guest-head"><strong>${escapeHTML(g.name)} <button type="button" class="edit-guest" data-edit-guest="${escapeHTML(c.id)}" data-guest-id="${escapeHTML(g.id)}" aria-label="تعديل اسم العميل" title="تعديل اسم العميل">✎</button></strong><button type="button" class="remove-guest" data-remove-guest="${escapeHTML(c.id)}" data-guest-id="${escapeHTML(g.id)}">حذف</button></div><div class="compact-items">${(
            g.items || []
          )
            .map((item, index) => {
              const paidQty = Math.min(Number(item.qty || 0), Number(item.paidQty || 0));
              const fullyPaid = paidQty >= Number(item.qty || 0);
              const lineTotal = netUnitPrice(item) * Number(item.qty || 0);
              const product = allCheckProducts().find((p) => p.id === item.productId);
              return `<div class="compact-item ${fullyPaid ? "paid-line" : ""}"><img class="check-item-thumb" src="${escapeHTML(product?.image || "assets/mandour-welcome-poster.png")}" alt="" loading="lazy"><div class="item-main"><div class="check-line-name">${escapeHTML(checkItemLabel(item))}<small>${lineLabel(item)}</small></div><div class="item-line-meta"><strong>الإجمالي: ${money(lineTotal)}</strong><label class="discount-field saved-discount"><span>خصم</span><input aria-label="خصم على السطر" type="number" min="0" max="${Number(item.unitPrice || 0) * Number(item.qty || 1)}" step="1" value="${item.lineDiscount || ""}" data-saved-discount="${Number(item.lineDiscount || 0)}" placeholder="٠" data-check-discount="${escapeHTML(c.id)}" data-guest-id="${escapeHTML(g.id)}" data-item-index="${index}"></label></div></div><span class="qty-controls compact-qty"><button type="button" data-check-qty="-1" data-check-id="${escapeHTML(c.id)}" data-guest-id="${escapeHTML(g.id)}" data-item-index="${index}" aria-label="تقليل العدد">−</button><strong>${fmt.format(item.qty)}</strong><button type="button" data-check-qty="1" data-check-id="${escapeHTML(c.id)}" data-guest-id="${escapeHTML(g.id)}" data-item-index="${index}" aria-label="زيادة العدد">＋</button><button type="button" class="pay-item ${fullyPaid ? "is-paid" : ""}" data-pay-item="${escapeHTML(c.id)}" data-guest-id="${escapeHTML(g.id)}" data-item-index="${index}">${fullyPaid ? "✓ مدفوع" : "دفع"}</button><button type="button" class="move-item" data-move-item="${escapeHTML(c.id)}" data-guest-id="${escapeHTML(g.id)}" data-item-index="${index}" aria-label="نقل لعميل آخر" title="نقل لعميل آخر">↪</button></span></div>`;
            })
            .join("")}</div></div>`,
      )
      .join("");
    const detailActions = `<div class="compact-actions"><label class="tip-field"><span>بقشيش</span><input type="number" min="0" step="1" value="${c.tip || ""}" placeholder="0" data-check-tip="${escapeHTML(c.id)}"></label>${c.status === "open" || c.status === "partial" ? `<button type="button" class="secondary add-guest-btn" data-add-guest="${escapeHTML(c.id)}">＋ عميل</button>` : ""}${c.status === "deferred" ? `<button type="button" class="secondary" data-reopen-check="${escapeHTML(c.id)}">إرجاع</button>` : ""}${c.status === "open" || c.status === "partial" ? `<button type="button" class="secondary" data-close-check="${escapeHTML(c.id)}">إنهاء</button>` : ""}<button type="button" class="danger" data-delete-check="${escapeHTML(c.id)}">حذف</button></div>`;
    return `<article data-check-card-id="${escapeHTML(c.id)}" class="check-card redesigned-check-card ${c.status === "deferred" ? "deferred-card" : ""}"><div class="check-card-priority"><div class="priority-heading"><div><span class="check-kind">${c.mode === "inside" ? "طاولة" : "تيك أواي"}</span><h4>${c.mode === "inside" ? escapeHTML(c.tableName || "—") : "طلب خارجي"}</h4><strong class="compact-customer">${(c.guests || []).map((g) => escapeHTML(g.name)).join(" · ") || "بدون اسم"}</strong></div><span class="check-state ${c.status === "deferred" ? "deferred" : ""}">${status}</span></div><div class="check-card-metrics"><span><small>الإجمالي</small><strong>${money(total)}</strong></span><span><small>المدفوع</small><strong>${money(paid)}</strong></span><span class="remaining"><small>المتبقي</small><strong>${money(due)}</strong></span></div><div class="check-card-quick-actions">${quickPay}<button type="button" class="secondary quick-add-order" data-add-order="${escapeHTML(c.id)}">＋ إضافة طلب</button></div></div><details class="check-accordion" ${expandedCheckIds.has(c.id) ? "open" : ""}><summary class="check-details-toggle"><span>عرض تفاصيل الطلب والأصناف</span><span class="accordion-chevron" aria-hidden="true">⌄</span></summary><div class="check-accordion-body"><div class="compact-guest-list">${guests || '<div class="empty">لا توجد أصناف</div>'}</div><div class="check-note-grid"><label>موعد السداد<input type="date" value="${escapeHTML(c.dueDate || "")}" data-check-due-date="${escapeHTML(c.id)}"></label><label>ملاحظات الشيك<textarea rows="2" maxlength="500" data-check-note="${escapeHTML(c.id)}" placeholder="ملاحظة أو تفضيل الطلب">${escapeHTML(c.notes || "")}</textarea></label></div>${renderCheckTimeline(c)}${detailActions}</div></details></article>`;
  }
  const modeFilter = checkModeFilter || "all";
  const filteredList = list.filter((c) => {
    if (modeFilter === "inside") return c.mode === "inside";
    if (modeFilter === "takeaway") return c.mode === "takeaway";
    return true;
  });

  const visibleOpenChecks = data.checks.filter(
    (c) => c.status === "open" || c.status === "partial" || c.status === "deferred",
  );
  const checksSummary = `<div class="checks-summary-strip"><div class="checks-summary-card open"><span>الحسابات المفتوحة</span><strong>${fmt.format(visibleOpenChecks.length)}</strong><small>شيك نشط</small></div><div class="checks-summary-card due"><span>إجمالي المتبقي</span><strong>${money(visibleOpenChecks.reduce((sum, c) => sum + checkDue(c), 0))}</strong><small>مطلوب تحصيله</small></div><div class="checks-summary-card paid"><span>المدفوع</span><strong>${money(data.checks.reduce((sum, c) => sum + checkPaidTotal(c), 0))}</strong><small>كل الشيكات</small></div></div>`;

  const toolbar = `<div class="check-filter-bar" style="flex-direction:column;align-items:stretch;gap:8px;">
  <div style="display:flex;justify-content:space-between;align-items:center;">
    <strong>نوع الخدمة</strong>
    <div style="display:flex;gap:5px;">
      ${[
        ["all", "الكل"],
        ["inside", "داخل الكافيه"],
        ["takeaway", "تيك أواي"],
      ]
        .map(
          ([id, label]) =>
            `<button type="button" data-mode-filter="${id}" aria-pressed="${modeFilter === id}">${label}</button>`,
        )
        .join("")}
    </div>
  </div>
  <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:7px;">
    <strong>الحالة</strong>
    <div style="display:flex;gap:5px;">
      ${[
        ["unpaid", "غير المدفوعة"],
        ["all", "الكل"],
        ["paid", "المدفوعة"],
      ]
        .map(
          ([id, label]) =>
            `<button type="button" data-check-filter="${id}" aria-pressed="${checkFilter === id}">${label}</button>`,
        )
        .join("")}
    </div>
  </div>
</div>`;

  root.innerHTML =
    checksSummary +
    toolbar +
    (filteredList.length
      ? `<div class="check-list">${filteredList.map(card).join("")}</div>`
      : '<div class="empty">لا توجد شيكات تطابق خيارات التصفية الحالية.</div>');
  syncPaidSound();
}

function menuAdd(itemId, optionId) {
  const customer = document.getElementById("check-customer").value.trim();
  const existingId = document.getElementById("check-existing").value;
  const check = availableChecks().find((c) => c.id === existingId);
  const mode =
    check?.mode || document.getElementById("check-service-mode").value;
  const tableName =
    check?.tableName ||
    document.getElementById("check-table-name").value.trim();
  if (mode === "inside" && !tableName) {
    document.getElementById("check-table-name").focus();
    notify("اكتب رقم أو اسم الطاولة");
    return;
  }
  const product = allCheckProducts().find((x) => x.id === itemId);
  if (!product) return;
  const opts = product.options || [];
  let option = opts[0];
  if (optionId) {
    option = opts.find((o) => o.id === optionId) || option;
  } else if (product.defaultOption) {
    option = opts.find((o) => o.id === product.defaultOption) || option;
  }
  const old = checkDraft.find(
    (x) =>
      x.productId === itemId &&
      x.optionId === option.id &&
      (x.customerName || "") === customer,
  );
  if (old) old.qty++;
  else
    checkDraft.push({
      productId: itemId,
      name: product.name,
      optionId: option.id,
      optionLabel: option.label,
      unitPrice: option.price,
      lineDiscount: 0,
      qty: 1,
      customerName: customer,
    });
  renderCheckDraft();
  notify(`اتضاف ${product.name} · ${option.label}`);
}

document.getElementById("check-menu").addEventListener("click", (event) => {
  const b = event.target.closest("[data-menu-add]");
  if (b) menuAdd(b.dataset.menuAdd, b.dataset.optionId);
});
document
  .getElementById("extra-drinks-menu")
  .addEventListener("click", (event) => {
    const b = event.target.closest("[data-extra-menu-add]");
    if (b) menuAdd(b.dataset.extraMenuAdd, b.dataset.optionId);
  });
document.getElementById("quick-add").addEventListener("click", (event) => {
  const b = event.target.closest("[data-quick-add]");
  if (b) menuAdd(b.dataset.quickAdd, b.dataset.quickOption);
});
document.getElementById("extra-drinks-toggle").addEventListener("click", () => {
  const root = document.getElementById("extra-drinks-menu"),
    button = document.getElementById("extra-drinks-toggle");
  const open = root.hidden;
  root.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
  button.querySelector("small").textContent = open
    ? "إخفاء القائمة"
    : "افتح القائمة";
});

document
  .getElementById("check-draft-lines")
  .addEventListener("input", (event) => {
    const custInput = event.target.closest("[data-draft-customer]");
    if (custInput) {
      const i = Number(custInput.dataset.draftCustomer);
      if (checkDraft[i]) checkDraft[i].customerName = custInput.value.trim();
      return;
    }
    const input = event.target.closest("[data-draft-discount]");
    if (!input) return;
    const index = Number(input.dataset.draftDiscount);
    const item = checkDraft[index];
    if (item) {
      const val = Number(input.value) || 0;
      const max = Number(item.unitPrice || 0) * Number(item.qty || 1);
      const clamped = Math.max(0, Math.min(max, val));
      item.lineDiscount = clamped;
      input.max = String(max);
      if (clamped !== val) input.value = clamped;
      const total = checkDraft.reduce(
        (sum, x) => sum + netUnitPrice(x) * x.qty,
        0,
      );
      document.getElementById("check-draft-total").textContent = money(total);
      const line = input.closest(".check-draft-line");
      if (line) {
        const priceEl = line.querySelector(".line-qty-label");
        if (priceEl) priceEl.innerHTML = lineLabel(item);
      }
    }
  });

document
  .getElementById("check-draft-lines")
  .addEventListener("click", (event) => {
    const b = event.target.closest(
      "[data-draft-inc],[data-draft-dec],[data-draft-remove]",
    );
    if (!b) return;
    const i = Number(
        b.dataset.draftInc ?? b.dataset.draftDec ?? b.dataset.draftRemove,
      ),
      item = checkDraft[i];
    if (!item) return;
    if (b.hasAttribute("data-draft-remove")) checkDraft.splice(i, 1);
    else {
      item.qty += b.hasAttribute("data-draft-inc") ? 1 : -1;
      if (item.qty <= 0) checkDraft.splice(i, 1);
    }
    renderCheckDraft();
  });
document
  .getElementById("check-existing")
  .addEventListener("change", syncCheckTarget);
document
  .getElementById("check-service-mode")
  .addEventListener("change", syncCheckTarget);
document
  .getElementById("check-customer")
  .addEventListener("input", syncCheckTarget);
document.getElementById("commit-check-order").addEventListener("click", () => {
  if (!checkDraft.length) {
    notify("أضف صنفًا واحدًا على الأقل");
    return;
  }
  const existingId = document.getElementById("check-existing").value;
  let target = availableChecks().find((c) => c.id === existingId);
  const mode =
    target?.mode || document.getElementById("check-service-mode").value;
  const tableName =
    target?.tableName ||
    document.getElementById("check-table-name").value.trim();
  if (mode === "inside" && !tableName) {
    document.getElementById("check-table-name").focus();
    notify("اكتب رقم أو اسم الطاولة");
    return;
  }
  const before = JSON.stringify(data.checks);
  try {
    const orderNow = new Date().toISOString();
    if (!target) {
      target = {
        id: `check-${Date.now()}`,
        mode,
        tableName: mode === "inside" ? tableName : "",
        status: "open",
        createdAt: orderNow,
        lastOrderAt: orderNow,
        guests: [],
        events: [],
      };
      data.checks.unshift(target);
    } else {
      target.lastOrderAt = orderNow;
      if (target.status === "closed") target.status = "open";
    }
    const orderSnapshot = checkDraft.map((d) => ({
      name: d.name,
      optionLabel: d.optionLabel || "",
      customerName: d.customerName || "بدون اسم",
      qty: Number(d.qty || 0),
      unitPrice: Number(d.unitPrice || 0),
      discount: Number(d.lineDiscount || 0),
      amount: Math.max(
        0,
        Number(d.unitPrice || 0) * Number(d.qty || 0) -
          Number(d.lineDiscount || 0),
      ),
    }));
    addCheckEvent(target, "order", {
      at: orderNow,
      items: orderSnapshot,
      amount: orderSnapshot.reduce((n, i) => n + i.amount, 0),
    });
    orderSnapshot
      .filter((i) => i.discount > 0)
      .forEach((i) =>
        addCheckEvent(target, "discount", {
          at: orderNow,
          itemName: i.name,
          discount: i.discount,
          previous: 0,
        }),
      );
    const groups = {};
    checkDraft.forEach((draft) => {
      const key = (draft.customerName || "").trim();
      if (!groups[key]) groups[key] = [];
      groups[key].push(draft);
    });
    for (const [rawName, items] of Object.entries(groups)) {
      const guestName = rawName || "بدون اسم";
      let guest = target.guests.find(
        (g) => customerKey(g.name) === customerKey(guestName),
      );
      if (!guest) {
        guest = {
          id: `guest-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: guestName,
          items: [],
        };
        target.guests.push(guest);
      }
      items.forEach((draft) => {
        const existing = guest.items.find(
          (x) =>
            x.productId === draft.productId &&
            x.optionId === draft.optionId &&
            Number(x.lineDiscount || 0) === Number(draft.lineDiscount || 0),
        );
        if (existing) existing.qty += draft.qty;
        else
          guest.items.push({
            productId: draft.productId,
            name: draft.name,
            optionId: draft.optionId,
            optionLabel: draft.optionLabel,
            unitPrice: draft.unitPrice,
            lineDiscount: draft.lineDiscount,
            qty: draft.qty,
            paidQty: 0,
            createdAt: orderNow,
            ...(Number(draft.lineDiscount || 0) > 0
              ? {
                  discountAt: orderNow,
                  discountHistory: [
                    {
                      at: orderNow,
                      amount: Number(draft.lineDiscount || 0),
                      previous: 0,
                    },
                  ],
                }
              : {}),
          });
      });
    }
    persist();
  } catch {
    data.checks = JSON.parse(before);
    notify("تعذر حفظ الحساب");
    return;
  }
  checkDraft = [];
  renderCheckMenu();
  renderExtraDrinks();
  document.getElementById("check-existing").value = target.id;
  syncCheckTarget();
  renderCheckDraft();
  renderChecks();
  playCheckActionSound("new-order");
  notify("اتضاف الطلب للحساب بنجاح");
});

document.getElementById("check-list").addEventListener("toggle", (event) => {
  const details = event.target.closest(".check-accordion");
  const card = details?.closest("[data-check-card-id]");
  if (!details || !card) return;
  if (details.open) expandedCheckIds.add(card.dataset.checkCardId);
  else expandedCheckIds.delete(card.dataset.checkCardId);
});
document.getElementById("check-list").addEventListener("change", (event) => {
  const note = event.target.closest("[data-check-note]");
  const due = event.target.closest("[data-check-due-date]");
  const field = note || due;
  if (!field) return;
  const c = data.checks.find(
    (x) => x.id === (note ? note.dataset.checkNote : due.dataset.checkDueDate),
  );
  if (!c) return;
  if (note) c.notes = note.value.trim();
  else c.dueDate = due.value;
  try {
    persist();
    notify("تم حفظ ملاحظات وموعد الشيك");
  } catch {
    notify("تعذر حفظ بيانات الشيك");
  }
});
document.getElementById("check-list").addEventListener("change", (event) => {
  const input = event.target.closest("[data-check-discount]");
  if (!input) return;
  const c = data.checks.find((x) => x.id === input.dataset.checkDiscount),
    g = c?.guests.find((x) => x.id === input.dataset.guestId),
    item = g?.items[Number(input.dataset.itemIndex)];
  if (!c || !item) return;
  const previous = Number(input.dataset.savedDiscount || 0),
    current = Number(item.lineDiscount || 0);
  if (previous !== current) {
    const at = new Date().toISOString();
    item.discountAt = at;
    item.discountHistory = Array.isArray(item.discountHistory)
      ? item.discountHistory
      : [];
    item.discountHistory.push({ at, amount: current, previous });
    addCheckEvent(c, "discount", {
      itemName: checkItemLabel(item),
      discount: current,
      previous,
    });
    input.dataset.savedDiscount = String(current);
    try {
      persist();
      renderChecks();
      notify("تم تسجيل وقت الخصم");
    } catch {
      notify("تعذر حفظ وقت الخصم");
    }
  }
});
document.getElementById("check-list").addEventListener("input", (event) => {
  const tipInput = event.target.closest("[data-check-tip]");
  if (tipInput) {
    const c = data.checks.find((x) => x.id === tipInput.dataset.checkTip);
    if (c) {
      const val = Math.max(0, Number(tipInput.value) || 0);
      c.tip = val;
      if (String(val) !== tipInput.value && tipInput.value !== "")
        tipInput.value = val;
      persist();
      const card = tipInput.closest(".compact-check-card");
      if (card) {
        const totalEl = card.querySelector(".compact-total strong");
        const dueEl = card.querySelector(".compact-total small");
        if (totalEl) totalEl.textContent = money(checkTotal(c));
        if (dueEl) dueEl.textContent = `المتبقي ${money(checkDue(c))}`;
      }
    }
    return;
  }
  const input = event.target.closest("[data-check-discount]");
  if (!input) return;
  const c = data.checks.find((x) => x.id === input.dataset.checkDiscount);
  const g = c?.guests.find((x) => x.id === input.dataset.guestId);
  const item = g?.items[Number(input.dataset.itemIndex)];
  if (item) {
    const val = Number(input.value) || 0;
    const max = Number(item.unitPrice || 0) * Number(item.qty || 1);
    const clamped = Math.max(0, Math.min(max, val));
    item.lineDiscount = clamped;
    input.max = String(max);
    if (clamped !== val) input.value = clamped;
    const card = input.closest(".compact-check-card");
    if (card) {
      const due = checkDue(c);
      const totalEl = card.querySelector(".compact-total strong");
      const dueEl = card.querySelector(".compact-total small");
      if (totalEl) totalEl.textContent = money(checkTotal(c));
      if (dueEl) dueEl.textContent = `المتبقي ${money(due)}`;
      const itemRow = input.closest(".compact-item");
      if (itemRow) {
        const nameEl = itemRow.querySelector(".check-line-name");
        if (nameEl) {
          const smallEl = nameEl.querySelector("small");
          if (smallEl) smallEl.innerHTML = lineLabel(item);
        }
      }
    }
  }
});

document.getElementById("check-list").addEventListener("click", (event) => {
  const detailsSummary = event.target.closest(".check-details-toggle");
  if (detailsSummary) {
    const details = detailsSummary.closest(".check-accordion");
    const card = details?.closest("[data-check-card-id]");
    if (details && card) {
      setTimeout(() => {
        if (details.open) expandedCheckIds.add(card.dataset.checkCardId);
        else expandedCheckIds.delete(card.dataset.checkCardId);
      }, 0);
    }
  }
  const editGuestBtn = event.target.closest("[data-edit-guest]");
  if (editGuestBtn) {
    const c = data.checks.find((x) => x.id === editGuestBtn.dataset.editGuest);
    const g = c?.guests?.find((x) => x.id === editGuestBtn.dataset.guestId);
    if (!c || !g) return;
    const current = g.name === "بدون اسم" ? "" : g.name;
    const rawName = prompt(
      "اكتب اسم العميل (اتركه فاضي ليعود «بدون اسم»):",
      current,
    );
    if (rawName === null) return;
    const trimmed = rawName.trim();
    if (!trimmed) {
      if (g.name === "بدون اسم") {
        notify("الاسم لم يتغيّر");
        return;
      }
      const clash = c.guests.find(
        (x) => x.id !== g.id && x.name === "بدون اسم",
      );
      if (clash) {
        if (!confirm("يوجد عميل «بدون اسم» بالفعل. هل تريد دمج الأصناف معه؟"))
          return;
        g.items.forEach((item) => {
          const found = clash.items.find(
            (x) =>
              x.productId === item.productId &&
              x.optionId === item.optionId &&
              Number(x.lineDiscount || 0) === Number(item.lineDiscount || 0),
          );
          if (found) {
            found.qty += item.qty;
            found.paidQty =
              Number(found.paidQty || 0) + Number(item.paidQty || 0);
          } else clash.items.push(item);
        });
        c.guests = c.guests.filter((x) => x.id !== g.id);
      } else {
        g.name = "بدون اسم";
      }
      persist();
      renderChecks();
      notify("تم تحديث اسم العميل");
      return;
    }
    if (customerKey(trimmed) === customerKey(g.name)) {
      notify("الاسم لم يتغيّر");
      return;
    }
    const existing = c.guests.find(
      (x) => x.id !== g.id && customerKey(x.name) === customerKey(trimmed),
    );
    if (existing) {
      if (
        !confirm(
          `يوجد عميل بنفس الاسم «${trimmed}» في هذا الشيك. هل تريد دمج أصناف العميلين؟`,
        )
      )
        return;
      g.items.forEach((item) => {
        const found = existing.items.find(
          (x) =>
            x.productId === item.productId &&
            x.optionId === item.optionId &&
            Number(x.lineDiscount || 0) === Number(item.lineDiscount || 0),
        );
        if (found) {
          found.qty += item.qty;
          found.paidQty =
            Number(found.paidQty || 0) + Number(item.paidQty || 0);
        } else existing.items.push(item);
      });
      c.guests = c.guests.filter((x) => x.id !== g.id);
    } else {
      g.name = trimmed;
    }
    persist();
    renderChecks();
    notify("تم تحديث اسم العميل");
    return;
  }
  const addGuestBtn = event.target.closest("[data-add-guest]");
  if (addGuestBtn) {
    const c = data.checks.find((x) => x.id === addGuestBtn.dataset.addGuest);
    if (!c) return;
    const rawName = prompt("اكتب اسم العميل الجديد:", "");
    if (rawName === null) return;
    const trimmed = rawName.trim();
    if (!trimmed) {
      notify("الاسم مطلوب");
      return;
    }
    if (c.guests.some((x) => customerKey(x.name) === customerKey(trimmed))) {
      notify("يوجد عميل بنفس الاسم في هذا الشيك");
      return;
    }
    c.guests.push({
      id: `guest-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed,
      items: [],
    });
    persist();
    renderChecks();
    notify("تمت إضافة عميل. استخدم «إضافة طلب» لإدخال أصنافه");
    return;
  }
  const moveBtn = event.target.closest("[data-move-item]");
  if (moveBtn) {
    openMoveDialog(
      moveBtn.dataset.moveItem,
      moveBtn.dataset.guestId,
      Number(moveBtn.dataset.itemIndex),
    );
    return;
  }
  const filter = event.target.closest("[data-check-filter]");
  if (filter) {
    checkFilter = filter.dataset.checkFilter;
    renderChecks();
    return;
  }
  const modeFilterBtn = event.target.closest("[data-mode-filter]");
  if (modeFilterBtn) {
    checkModeFilter = modeFilterBtn.dataset.modeFilter;
    renderChecks();
    return;
  }
  const removeGuestBtn = event.target.closest("[data-remove-guest]");
  if (removeGuestBtn) {
    const c = data.checks.find(
      (x) => x.id === removeGuestBtn.dataset.removeGuest,
    );
    const guest = c?.guests?.find(
      (g) => g.id === removeGuestBtn.dataset.guestId,
    );
    if (c && guest) {
      if (!confirm(`حذف العميل «${guest.name}» وكل أصنافه من الشيك؟`)) return;
      c.guests = c.guests.filter(
        (g) => g.id !== removeGuestBtn.dataset.guestId,
      );
      if (!c.guests.length) c.status = "closed";
      persist();
      renderChecks();
      notify("تم حذف العميل من الحساب");
    }
    return;
  }
  const add = event.target.closest("[data-add-order]");
  if (add) {
    setCheckPanel("orders");
    const c = data.checks.find((x) => x.id === add.dataset.addOrder),
      g = c?.guests?.[0];
    document.getElementById("check-existing").value = c?.id || "";
    document.getElementById("check-customer").value = g?.name || "";
    syncCheckTarget();
    document
      .getElementById("check-order-form")
      .scrollIntoView({ behavior: "smooth", block: "start" });
    notify("اختار المشروب لإضافته إلى نفس الحساب");
    return;
  }
  const pay = event.target.closest("[data-pay-check]");
  if (pay) {
    const c = data.checks.find((x) => x.id === pay.dataset.payCheck);
    if (c) {
      if (!confirm(`تأكيد تسجيل دفع كامل بقيمة ${money(checkDue(c))}؟`)) return;
      const paidAt = new Date().toISOString(),
        paidAmount = checkDue(c);
      (c.guests || []).forEach((g) =>
        (g.items || []).forEach((i) => {
          const remainingQty = Math.max(
            0,
            Number(i.qty || 0) - Number(i.paidQty || 0),
          );
          if (remainingQty > 0) {
            i.paymentHistory = Array.isArray(i.paymentHistory)
              ? i.paymentHistory
              : [];
            i.paymentHistory.push({
              at: paidAt,
              amount: netUnitPrice(i) * remainingQty,
              paid: true,
            });
          }
          i.paidQty = i.qty;
          i.paidAt = paidAt;
        }),
      );
      addCheckEvent(c, "payment_full", { amount: paidAmount });
      c.tipPaid = true;
      c.status = "paid";
      c.paidAt = paidAt;
      if (!c.loyaltyAwarded) {
        (c.guests || []).forEach((guest) => awardLoyaltyStamp(guest.name));
        c.loyaltyAwarded = true;
      }
      persist();
      renderChecks();
      playCheckActionSound("payment-full");
      notify("تم تسجيل دفع الفاتورة بالكامل");
    }
    return;
  }
  const payItem = event.target.closest("[data-pay-item]");
  if (payItem) {
    const c = data.checks.find((x) => x.id === payItem.dataset.payItem),
      g = c?.guests.find((x) => x.id === payItem.dataset.guestId),
      item = g?.items[Number(payItem.dataset.itemIndex)];
    if (item) {
      if (!confirm(`تأكيد تغيير حالة الدفع للصنف «${checkItemLabel(item)}»؟`))
        return;
      const at = new Date().toISOString();
      item.paidQty =
        Math.min(Number(item.qty || 0), Number(item.paidQty || 0)) >=
        Number(item.qty || 0)
          ? 0
          : Number(item.qty || 0);
      const paid = Number(item.paidQty || 0) > 0;
      item.paidAt = paid ? at : null;
      item.paymentHistory = Array.isArray(item.paymentHistory)
        ? item.paymentHistory
        : [];
      item.paymentHistory.push({
        at,
        amount: netUnitPrice(item) * Number(item.qty || 0),
        paid,
      });
      addCheckEvent(c, "payment", {
        itemName: checkItemLabel(item),
        amount: netUnitPrice(item) * Number(item.qty || 0),
        paid,
      });
      c.status = checkDue(c) <= 0 ? "paid" : "partial";
      c.paidAt = c.status === "paid" ? at : null;
      if (c.status === "paid" && !c.loyaltyAwarded) {
        (c.guests || []).forEach((guest) => awardLoyaltyStamp(guest.name));
        c.loyaltyAwarded = true;
      }
      persist();
      renderChecks();
      playCheckActionSound("payment-item");
      notify(item.paidQty ? "تم تعليم الصنف كمدفوع" : "تم إلغاء دفع الصنف");
    }
    return;
  }
  const qty = event.target.closest("[data-check-qty]");
  if (qty) {
    const c = data.checks.find((x) => x.id === qty.dataset.checkId),
      g = c?.guests.find((x) => x.id === qty.dataset.guestId),
      item = g?.items[Number(qty.dataset.itemIndex)];
    if (item) {
      item.qty += Number(qty.dataset.checkQty);
      if (item.qty <= 0) g.items.splice(Number(qty.dataset.itemIndex), 1);
      else item.paidQty = Math.min(Number(item.paidQty || 0), Number(item.qty));
      persist();
      renderChecks();
    }
    return;
  }
  const del = event.target.closest("[data-delete-check]");
  if (del) {
    if (!confirm("حذف الحساب وكل طلبات العملاء فيه؟")) return;
    data.checks = data.checks.filter((c) => c.id !== del.dataset.deleteCheck);
    persist();
    renderChecks();
    notify("تم حذف الحساب");
    return;
  }
  const close = event.target.closest("[data-close-check]");
  if (close) {
    const c = data.checks.find((x) => x.id === close.dataset.closeCheck);
    if (c) {
      if (!confirm(`تأكيد إنهاء الحساب؟ المتبقي ${money(checkDue(c))}`)) return;
      c.status = checkDue(c) <= 0 ? "paid" : "closed";
      c.closedAt = new Date().toISOString();
      persist();
      renderChecks();
      notify("تم تحديث حالة الحساب");
    }
    return;
  }
  const reopen = event.target.closest("[data-reopen-check]");
  if (reopen) {
    const c = data.checks.find((x) => x.id === reopen.dataset.reopenCheck);
    if (c) {
      c.status = "open";
      delete c.closedAt;
      delete c.deferredAt;
      persist();
      renderChecks();
      notify("تمت إعادة الحساب إلى المفتوحة");
    }
  }
});
renderExtraDrinks();

function openMoveDialog(checkId, guestId, itemIndex) {
  const c = data.checks.find((x) => x.id === checkId);
  const g = c?.guests?.find((x) => x.id === guestId);
  const item = g?.items?.[itemIndex];
  if (!c || !g || !item) return;
  const maxQty = Number(item.qty || 0);
  if (maxQty <= 0) return;
  moveState = { checkId, guestId, itemIndex, maxQty };
  document.getElementById("move-title").textContent =
    `نقل «${checkItemLabel(item)}»`;
  document.getElementById("move-sub").textContent =
    `الإجمالي الحالي: ${fmt.format(maxQty)} قطعة`;
  const qtyInput = document.getElementById("move-qty");
  qtyInput.max = String(maxQty);
  qtyInput.value = "1";
  document.getElementById("move-qty-total").textContent = fmt.format(maxQty);
  const custInput = document.getElementById("move-customer");
  custInput.value = "";
  const sugg = document.getElementById("move-suggestions");
  const others = c.guests.filter((x) => x.id !== g.id).map((x) => x.name);
  sugg.innerHTML = others
    .map(
      (name) =>
        `<button type="button" data-move-suggest="${escapeHTML(name)}">${escapeHTML(name)}</button>`,
    )
    .join("");
  document.getElementById("move-modal").hidden = false;
  document.body.classList.add("modal-open");
  setTimeout(() => qtyInput.focus({ preventScroll: true }), 80);
}

function closeMoveDialog() {
  moveState = null;
  document.getElementById("move-modal").hidden = true;
  document.body.classList.remove("modal-open");
}

document.getElementById("move-confirm").addEventListener("click", () => {
  if (!moveState) return;
  const c = data.checks.find((x) => x.id === moveState.checkId);
  const g = c?.guests?.find((x) => x.id === moveState.guestId);
  const item = g?.items?.[moveState.itemIndex];
  if (!c || !g || !item) {
    closeMoveDialog();
    return;
  }
  const requested = Math.max(
    1,
    Math.floor(Number(document.getElementById("move-qty").value) || 1),
  );
  const qty = Math.min(moveState.maxQty, requested);
  const targetName = document.getElementById("move-customer").value.trim();
  if (!targetName) {
    document.getElementById("move-customer").focus();
    notify("اكتب اسم العميل");
    return;
  }
  if (customerKey(targetName) === customerKey(g.name)) {
    notify("الصنف بالفعل باسم هذا العميل");
    return;
  }
  const itemQty = Number(item.qty || 0);
  const itemDiscount = Number(item.lineDiscount || 0);
  const itemPaid = Number(item.paidQty || 0);
  const movedDiscount =
    qty >= itemQty
      ? itemDiscount
      : Math.round(((itemDiscount * qty) / itemQty) * 100) / 100;
  const movedPaid = qty >= itemQty ? itemPaid : Math.min(itemPaid, qty);
  let targetGuest = c.guests.find(
    (x) => customerKey(x.name) === customerKey(targetName),
  );
  if (!targetGuest) {
    targetGuest = {
      id: `guest-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: targetName,
      items: [],
    };
    c.guests.push(targetGuest);
  }
  const existing = targetGuest.items.find(
    (x) => x.productId === item.productId && x.optionId === item.optionId,
  );
  if (existing) {
    existing.qty += qty;
    existing.lineDiscount =
      Math.round((Number(existing.lineDiscount || 0) + movedDiscount) * 100) /
      100;
    existing.paidQty = Number(existing.paidQty || 0) + movedPaid;
  } else {
    targetGuest.items.push({
      productId: item.productId,
      name: item.name,
      optionId: item.optionId,
      optionLabel: item.optionLabel,
      unitPrice: item.unitPrice,
      lineDiscount: movedDiscount,
      qty,
      paidQty: movedPaid,
    });
  }
  if (qty >= itemQty) {
    g.items.splice(moveState.itemIndex, 1);
  } else {
    item.qty = itemQty - qty;
    item.lineDiscount = Math.round((itemDiscount - movedDiscount) * 100) / 100;
    item.paidQty = itemPaid - movedPaid;
  }
  if (!g.items.length) {
    c.guests = c.guests.filter((x) => x.id !== g.id);
  }
  persist();
  renderChecks();
  closeMoveDialog();
  notify(`تم نقل ${fmt.format(qty)} لـ «${targetName}»`);
});

function openDailyReport() {
  const shiftDay = localShiftDayKey(new Date());
  const todayChecks = data.checks.filter(
    (c) => localShiftDayKey(new Date(c.createdAt)) === shiftDay,
  );
  const openChecks = todayChecks.filter(
    (c) => c.status === "open" || c.status === "partial",
  );
  const paidChecks = todayChecks.filter((c) => c.status === "paid");
  const deferredChecks = todayChecks.filter((c) => c.status === "deferred");
  const totalSales = todayChecks.reduce((s, c) => s + checkTotal(c), 0);
  const totalPaidToday = paidChecks.reduce((s, c) => s + checkTotal(c), 0);
  const openDue = openChecks.reduce((s, c) => s + checkDue(c), 0);
  const totalTips = todayChecks.reduce((s, c) => s + Number(c.tip || 0), 0);
  const itemCounts = {};
  todayChecks.forEach((c) => {
    (c.guests || []).forEach((g) => {
      (g.items || []).forEach((item) => {
        const key = checkItemLabel(item);
        if (!itemCounts[key])
          itemCounts[key] = { label: key, qty: 0, revenue: 0 };
        itemCounts[key].qty += Number(item.qty || 0);
        itemCounts[key].revenue += netUnitPrice(item) * Number(item.qty || 0);
      });
    });
  });
  const topItems = Object.values(itemCounts)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);
  document.getElementById("report-date").textContent = dateText(shiftDay);
  document.getElementById("report-body").innerHTML =
    `<div class="report-stats"><div class="report-stat"><small>إجمالي مبيعات اليوم</small><strong>${money(totalSales)}</strong></div><div class="report-stat"><small>محصّل اليوم</small><strong>${money(totalPaidToday)}</strong></div><div class="report-stat"><small>شيكات مفتوحة</small><strong>${fmt.format(openChecks.length)}</strong></div><div class="report-stat"><small>متبقي مفتوح</small><strong>${money(openDue)}</strong></div><div class="report-stat"><small>البقشيش</small><strong>${money(totalTips)}</strong></div><div class="report-stat"><small>عدد الشيكات</small><strong>${fmt.format(todayChecks.length)}</strong></div></div><div class="report-section"><h4>حالة الشيكات</h4><div class="report-top-item"><span>مفتوح / جزئي</span><strong>${fmt.format(openChecks.length)}</strong></div><div class="report-top-item"><span>مدفوع بالكامل</span><strong>${fmt.format(paidChecks.length)}</strong></div><div class="report-top-item"><span>مؤجل</span><strong>${fmt.format(deferredChecks.length)}</strong></div></div><div class="report-section"><h4>الأكثر مبيعًا اليوم</h4>${topItems.length ? topItems.map((t) => `<div class="report-top-item"><span>${escapeHTML(t.label)}</span><strong>${fmt.format(t.qty)} · ${money(t.revenue)}</strong></div>`).join("") : '<div class="empty">لا توجد مبيعات اليوم بعد.</div>'}</div>`;
  document.getElementById("report-modal").hidden = false;
  document.body.classList.add("modal-open");
}
function closeDailyReport() {
  document.getElementById("report-modal").hidden = true;
  document.body.classList.remove("modal-open");
}
document
  .getElementById("open-report-btn")
  .addEventListener("click", openDailyReport);
document
  .querySelector("[data-report-nav]")
  ?.addEventListener("click", openDailyReport);
document
  .querySelectorAll("[data-close-report]")
  .forEach((b) => b.addEventListener("click", closeDailyReport));
document.getElementById("share-report-btn")?.addEventListener("click", async () => {
  const text = `تقرير مندور كوفي\n${document.getElementById("report-date")?.textContent || ""}\n${document.getElementById("report-body")?.innerText || ""}`;
  try {
    if (navigator.share) await navigator.share({ title: "تقرير مندور كوفي", text });
    else { await navigator.clipboard.writeText(text); notify("تم نسخ التقرير للمشاركة"); }
  } catch (error) { if (error?.name !== "AbortError") notify("تعذرت مشاركة التقرير"); }
});

document
  .getElementById("move-suggestions")
  .addEventListener("click", (event) => {
    const btn = event.target.closest("[data-move-suggest]");
    if (!btn) return;
    document.getElementById("move-customer").value = btn.dataset.moveSuggest;
  });

document.addEventListener("click", (event) => {
  const b = event.target.closest("[data-check-panel]");
  if (b) {
    setCheckPanel(b.dataset.checkPanel);
  }
});
function renderPaymentQrs() {
  for (const method of ["vodafone", "instapay"]) {
    const image = document.getElementById(`${method}-qr-preview`);
    if (!image) continue;
    const value = data.paymentQrs?.[method] || "";
    image.src = value;
    image.hidden = !value;
  }
}
document.querySelectorAll("[data-payment-qr]").forEach((input) =>
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImage(file);
      data.paymentQrs = data.paymentQrs || {};
      data.paymentQrs[input.dataset.paymentQr] = dataUrl;
      persist();
      renderPaymentQrs();
      notify("اتحفظ رمز الدفع على الجهاز");
    } catch (error) {
      notify(error.message || "تعذر حفظ رمز الدفع");
    }
    input.value = "";
  }),
);
document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy-wallet]");
  if (!button) return;
  try {
    await navigator.clipboard.writeText(WALLET_NUMBER);
    notify("اتنسخ الرقم: " + WALLET_NUMBER);
  } catch {
    const field = document.createElement("textarea");
    field.value = WALLET_NUMBER;
    document.body.appendChild(field);
    field.select();
    document.execCommand("copy");
    field.remove();
    notify("اتنسخ الرقم: " + WALLET_NUMBER);
  }
});
renderPaymentQrs();
document
  .getElementById("backup-reminder-btn")
  .addEventListener("click", downloadBackup);
updateBackupBanner();
function autoBackupIntervalDays() {
  return 1;
}
function updateAutoBackupStatus(text) {
  const el = document.getElementById("auto-backup-status");
  if (el && text) el.textContent = text;
}
function scheduleAutoBackupCheck() {
  clearTimeout(window.mandourAutoBackupTimer);
  window.mandourAutoBackupTimer = setTimeout(maybeRunAutoBackup, 1800);
}
function maybeRunAutoBackup() {
  const enabled = document.getElementById("auto-backup-enabled");
  if (!enabled || !enabled.checked) return;
  const bridge = window.MandourNative;
  if (!bridge?.saveBackupToChosenFolder || !bridge?.getFolderName?.("backup")) {
    updateAutoBackupStatus(
      "اختار مجلد الحفظ من زر «اختيار مجلد الحفظ» لتفعيل النسخ اليومي.",
    );
    return;
  }
  let last = 0;
  try {
    last = Number(localStorage.getItem("mandour-auto-backup-at") || 0);
  } catch {}
  const due = Date.now() - last >= autoBackupIntervalDays() * 86400000;
  if (!due) {
    const days = Math.max(
      1,
      Math.ceil(
        (autoBackupIntervalDays() * 86400000 - (Date.now() - last)) / 86400000,
      ),
    );
    updateAutoBackupStatus(
      `النسخة اليومية مفعّلة؛ النسخة التالية خلال ${fmt.format(days)} يوم.`,
    );
    return;
  }
  updateAutoBackupStatus("جارٍ حفظ النسخة اليومية في المجلد المختار…");
  try {
    bridge.saveBackupToChosenFolder(
      JSON.stringify(backupSnapshot(), null, 2),
      "Ayanoo.json",
    );
  } catch (error) {
    updateAutoBackupStatus(
      "تعذر بدء النسخ؛ افتح التطبيق واختبر صلاحية المجلد المختار.",
    );
  }
}
window.mandourAutoBackupResult = (success, message) => {
  if (success) {
    try {
      localStorage.setItem("mandour-auto-backup-at", String(Date.now()));
    } catch {}
    markBackupDone();
    updateAutoBackupStatus("تم حفظ نسخة احتياطية يومية في المجلد المختار.");
  } else
    updateAutoBackupStatus(
      message || "تعذر حفظ النسخة الاحتياطية؛ اختر المجلد مرة أخرى.",
    );
};
const autoBackupToggle = document.getElementById("auto-backup-enabled");
if (autoBackupToggle) {
  autoBackupToggle.checked =
    localStorage.getItem("mandour-auto-backup-enabled") !== "false";
  autoBackupToggle.addEventListener("change", () => {
    localStorage.setItem(
      "mandour-auto-backup-enabled",
      String(autoBackupToggle.checked),
    );
    if (autoBackupToggle.checked) maybeRunAutoBackup();
    else updateAutoBackupStatus("تم إيقاف النسخ الاحتياطي اليومي التلقائي.");
  });
}
function applyTheme(theme) {
  document.body.classList.toggle("dark-theme", theme === "dark");
  const button = document.getElementById("theme-toggle-btn");
  if (button) button.textContent = theme === "dark" ? "☀️ تفعيل الوضع الفاتح" : "🌙 تفعيل الوضع الداكن";
}
let savedTheme = "light";
try { savedTheme = localStorage.getItem("mandour-theme") || "light"; } catch {}
applyTheme(savedTheme);
document.getElementById("theme-toggle-btn")?.addEventListener("click", () => {
  const theme = document.body.classList.contains("dark-theme") ? "light" : "dark";
  try { localStorage.setItem("mandour-theme", theme); } catch {}
  applyTheme(theme);
});
function renderSalesDashboard() {
  const root = document.getElementById("sales-dashboard");
  if (!root) return;
  const today = new Date();
  const key = (offset) => { const d = new Date(today); d.setDate(d.getDate() - offset); return d.toISOString().slice(0, 10); };
  const todayKey = key(0), weekKey = key(6), monthKey = key(29);
  const invoices = (data.invoices || []).filter((x) => (x.documentType || "receipt") === "receipt");
  const checks = (data.checks || []).filter((x) => x.status === "paid");
  const amountFor = (from) => invoices.filter((x) => invoiceDateKey(x) >= from).reduce((sum, x) => sum + Number(x.total || 0), 0) + checks.filter((x) => String(x.paidAt || x.createdAt || "").slice(0, 10) >= from).reduce((sum, x) => sum + Number(checkTotal(x) || 0), 0);
  const countFor = (from) => invoices.filter((x) => invoiceDateKey(x) >= from).length + checks.filter((x) => String(x.paidAt || x.createdAt || "").slice(0, 10) >= from).length;
  const methods = {};
  invoices.filter((x) => invoiceDateKey(x) === todayKey).forEach((x) => { methods[paymentMethodLabel(x.paymentMethod)] = (methods[paymentMethodLabel(x.paymentMethod)] || 0) + Number(x.total || 0); });
  root.innerHTML = `<div class="sales-kpi-grid"><div><small>اليوم</small><strong>${money(amountFor(todayKey))}</strong><span>${fmt.format(countFor(todayKey))} عملية</span></div><div><small>آخر ٧ أيام</small><strong>${money(amountFor(weekKey))}</strong><span>${fmt.format(countFor(weekKey))} عملية</span></div><div><small>آخر ٣٠ يومًا</small><strong>${money(amountFor(monthKey))}</strong><span>${fmt.format(countFor(monthKey))} عملية</span></div></div><div class="sales-methods"><strong>طرق الدفع اليوم</strong>${Object.keys(methods).length ? Object.entries(methods).map(([name, amount]) => `<span>${escapeHTML(name)} <b>${money(amount)}</b></span>`).join("") : '<small>لا توجد مبيعات اليوم بعد.</small>'}</div>`;
}
function renderBackupHistory() {
  const root = document.getElementById("backup-history-list");
  if (!root) return;
  let names = [];
  try { names = JSON.parse(localStorage.getItem("mandour-backup-history") || "[]"); } catch {}
  root.innerHTML = names.length ? names.slice(0, 8).map((name) => `<div class="backup-history-item"><span>✓</span><code>${escapeHTML(name)}</code></div>`).join("") : '<div class="empty">لم تُحفظ نسخ تلقائية بعد.</div>';
}
function renderDeletedInvoices() {
  const root = document.getElementById("deleted-invoices-list");
  if (!root) return;
  const items = data.deletedInvoices || [];
  root.innerHTML = items.length ? items.slice(0, 12).map((invoice) => `<div class="backup-history-item deleted-invoice-item"><span>↺</span><div><strong>${escapeHTML(invoice.number || "فاتورة")}</strong><small>${escapeHTML(invoice.customer || "عميل نقدي")} · ${money(invoice.total || 0)}</small></div><button class="secondary" type="button" data-restore-invoice="${escapeHTML(invoice.id)}">استرجاع</button></div>`).join("") : '<div class="empty">السلة فارغة.</div>';
}
function renderInventory() {
  const root = document.getElementById("inventory-list");
  if (!root) return;
  const list = data.inventory || [];
  const alerts = list.filter((item) => Number(item.qty) <= Number(item.min)).length;
  const count = document.getElementById("inventory-alert-count");
  if (count) count.textContent = `${fmt.format(alerts)} تنبيه`;
  root.innerHTML = list.length ? list.map((item) => `<article class="inventory-item ${Number(item.qty) <= Number(item.min) ? "low-stock" : ""}"><div><strong>${escapeHTML(item.name)}</strong><small>التكلفة: ${money(item.cost)} · حد التنبيه: ${fmt.format(item.min)}</small></div><b>${fmt.format(item.qty)}</b><div class="inventory-actions"><button type="button" data-inventory-adjust="${escapeHTML(item.id)}" data-inventory-delta="-1">−</button><button type="button" data-inventory-adjust="${escapeHTML(item.id)}" data-inventory-delta="1">＋</button></div></article>`).join("") : '<div class="empty">لا يوجد مخزون مسجل بعد.</div>';
}
document.getElementById("inventory-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = document.getElementById("inventory-name").value.trim();
  const qty = Number(document.getElementById("inventory-qty").value);
  const min = Number(document.getElementById("inventory-min").value);
  const cost = Number(document.getElementById("inventory-cost").value);
  if (!name || !Number.isFinite(qty) || !Number.isFinite(min) || !Number.isFinite(cost)) return;
  const existing = (data.inventory || []).find((item) => item.name === name);
  if (existing) { existing.qty = qty; existing.min = min; existing.cost = cost; }
  else data.inventory.unshift({ id: `stock-${Date.now()}`, name, qty, min, cost });
  persist(); renderInventory(); event.target.reset(); notify(`تم حفظ مخزون ${name}`);
});
document.getElementById("inventory-list")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-inventory-adjust]");
  if (!button) return;
  const item = (data.inventory || []).find((x) => x.id === button.dataset.inventoryAdjust);
  if (!item) return;
  item.qty = Math.max(0, Number(item.qty) + Number(button.dataset.inventoryDelta));
  persist(); renderInventory();
  if (item.qty <= item.min) notify(`تنبيه: مخزون ${item.name} وصل لحد التنبيه`);
});
function renderLoyalty() {
  const root = document.getElementById("loyalty-list");
  if (!root) return;
  const customers = data.customers || [];
  root.innerHTML = customers.length ? customers.slice(0, 30).map((customer) => { const stamps = Math.max(0, Number((data.loyalty || {})[customer.id] || 0)); return `<article class="loyalty-item"><div><strong>${escapeHTML(customer.name)}</strong><small>${fmt.format(stamps)} من ٨ أختام ${stamps >= 8 ? "· يستحق مكافأة" : ""}</small><div class="loyalty-dots">${Array.from({ length: 8 }, (_, i) => `<i class="${i < stamps ? "filled" : ""}">✦</i>`).join("")}</div></div><button class="secondary" type="button" data-loyalty-add="${escapeHTML(customer.id)}">＋ ختم</button></article>`; }).join("") : '<div class="empty">أضف عملاء من شاشة العملاء أولًا.</div>';
}
document.getElementById("loyalty-list")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-loyalty-add]");
  if (!button) return;
  const id = button.dataset.loyaltyAdd;
  data.loyalty[id] = Number(data.loyalty[id] || 0) + 1;
  if (data.loyalty[id] >= 8) notify("العميل استحق مكافأة الولاء"); else notify("تمت إضافة ختم ولاء");
  persist(); renderLoyalty();
});
function updatePinStatus() {
  const enabled = Boolean(localStorage.getItem("mandour-app-pin"));
  const toggle = document.getElementById("pin-lock-enabled");
  const status = document.getElementById("pin-status");
  const staff = document.getElementById("staff-name-input");
  if (toggle) toggle.checked = enabled;
  if (staff) staff.value = data.staffName || "";
  if (status) status.textContent = enabled ? "قفل PIN مفعّل عند فتح التطبيق." : "القفل غير مفعّل.";
}
document.getElementById("staff-name-input")?.addEventListener("change", (event) => { data.staffName = event.target.value.trim(); persist(); });
document.getElementById("set-pin-btn")?.addEventListener("click", () => {
  const pin = window.prompt("اكتب PIN من 4 أرقام");
  if (!/^\d{4}$/.test(pin || "")) return notify("استخدم 4 أرقام بالضبط");
  localStorage.setItem("mandour-app-pin", pin); updatePinStatus(); notify("تم تفعيل قفل التطبيق");
});
document.getElementById("pin-lock-enabled")?.addEventListener("change", (event) => {
  if (!event.target.checked) { localStorage.removeItem("mandour-app-pin"); updatePinStatus(); notify("تم إيقاف قفل التطبيق"); }
  else document.getElementById("set-pin-btn")?.click();
});
document.getElementById("tools-report-btn")?.addEventListener("click", () => { openDailyReport(); });
document.getElementById("tools-save-backup")?.addEventListener("click", () => { downloadBackup(); renderBackupHistory(); });
document.getElementById("deleted-invoices-list")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-restore-invoice]");
  if (!button) return;
  const index = (data.deletedInvoices || []).findIndex((invoice) => invoice.id === button.dataset.restoreInvoice);
  if (index < 0) return;
  const [invoice] = data.deletedInvoices.splice(index, 1);
  delete invoice.deletedAt;
  data.invoices.unshift(invoice);
  persist();
  renderDeletedInvoices();
  renderInvoiceHistory();
  notify(`تم استرجاع ${invoice.number}`);
});
const auditActorInput = document.getElementById("audit-actor");
if (auditActorInput)
  auditActorInput.addEventListener("change", () => {
    data.auditActor = auditActorInput.value.trim();
    try {
      persist();
      notify("تم حفظ اسم المستخدم لسجل العمليات");
    } catch {
      notify("تعذر حفظ الاسم");
    }
  });
document
  .getElementById("undo-last-operation")
  ?.addEventListener("click", () => {
    if (!lastUndoSnapshot) return;
    if (
      !confirm("استعادة البيانات كما كانت قبل آخر حفظ؟ سيُلغى آخر تعديل محفوظ.")
    )
      return;
    try {
      const restored = JSON.parse(lastUndoSnapshot);
      const audit = [...(data.activityLog || [])];
      restored.activityLog = [
        {
          id: `undo-${Date.now()}`,
          at: new Date().toISOString(),
          actor: restored.auditActor || "مستخدم الجهاز",
          description: "تراجع عن آخر حفظ",
        },
        ...audit,
      ].slice(0, 300);
      suppressUndoCapture = true;
      localStorage.setItem(STORE_KEY, JSON.stringify(restored));
      data = restored;
      lastPersistedState = JSON.stringify(restored);
      suppressUndoCapture = false;
      lastUndoSnapshot = null;
      renderActivityLog();
      renderCustomers();
      renderChecks();
      renderInvoiceHistory();
      refreshHome();
      syncLocalCheckNotifications().catch(console.error);
      notify("تم التراجع عن آخر حفظ");
    } catch (error) {
      suppressUndoCapture = false;
      notify("تعذر التراجع؛ مساحة التخزين قد تكون غير كافية");
    }
  });
renderActivityLog();
scheduleAutoBackupCheck();

const CHECK_NOTIFICATION_IDS = [12001, 12002];
const CHECK_NOW_NOTIFICATION_ID = 12003;
const CHECK_NOTIFICATION_CHANNEL_ID = "checks_reminders_v1";
const CHECK_NOTIFICATION_SOUND = "mandour_notification.mp3";

async function requestNotificationPermission() {
  if (!LocalNotifications) return "unsupported";

  try {
    let permission = await LocalNotifications.checkPermissions();

    if (permission.display !== "granted") {
      permission = await LocalNotifications.requestPermissions();
    }

    return permission.display || "denied";
  } catch (error) {
    console.error("Notification permission error:", error);
    return "unsupported";
  }
}

function checkReminderDetails(checks) {
  const rows = checks.slice(0, 3).map((c) => {
    const names = (c.guests || [])
      .map((g) => g.name)
      .filter((n) => n && n !== "بدون اسم");
    const who =
      names.join("، ") ||
      (c.mode === "inside" ? `طاولة ${c.tableName || "—"}` : "تيك أواي");
    return `${who}: ${money(checkDue(c))}`;
  });
  const extra =
    checks.length > 3 ? ` و${fmt.format(checks.length - 3)} شيكات أخرى` : "";
  return (rows.join(" | ") + extra).slice(0, 220) || "لا توجد شيكات مستحقة.";
}
async function ensureChecksNotificationChannel() {
  if (!LocalNotifications?.createChannel) return false;

  try {
    await LocalNotifications.createChannel({
      id: CHECK_NOTIFICATION_CHANNEL_ID,
      name: "تنبيهات الشيكات",
      description: "تنبيهات الشيكات المفتوحة والإشعار اليدوي",
      importance: 4,
      sound: CHECK_NOTIFICATION_SOUND,
      vibration: true,
    });
    return true;
  } catch (error) {
    console.error("Check notification channel error:", error);
    return false;
  }
}
function checksForNotification() {
  return (data.checks || []).filter(
    (check) =>
      (check.status === "open" || check.status === "partial") &&
      checkDue(check) > 0,
  );
}
function checksNotificationBody(checks) {
  if (!checks.length) return "لا توجد شيكات مفتوحة حاليًا.";
  const totalDue = checks.reduce((sum, check) => sum + checkDue(check), 0);
  return `${fmt.format(checks.length)} شيكات مفتوحة · إجمالي المتبقي ${money(totalDue)}. ${checkReminderDetails(checks)}`.slice(0, 500);
}
async function syncLocalCheckNotifications() {
  if (!LocalNotifications) {
    updateNotifStatus(
      "تعذر الوصول إلى إضافة إشعارات Android. أعد بناء التطبيق بعد تثبيت الإضافة.",
    );
    return;
  }

  const permission = await LocalNotifications.checkPermissions();

  if (permission.display !== "granted") {
    updateNotifStatus("فعّل الإشعارات من الزر أدناه.");
    return;
  }

  const channelReady = await ensureChecksNotificationChannel();
  const unpaidChecks = checksForNotification();

  await LocalNotifications.cancel({
    notifications: CHECK_NOTIFICATION_IDS.map((id) => ({ id })),
  }).catch(() => {});

  if (unpaidChecks.length === 0) {
    updateNotifStatus("لا توجد شيكات غير مدفوعة حاليًا؛ لن يتم إرسال تذكير.");
    return;
  }

  await LocalNotifications.schedule({
    notifications: [
      {
        id: CHECK_NOTIFICATION_IDS[0],
        title: "مندور كوفي · مراجعة الشيكات",
        body: checkReminderDetails(unpaidChecks),
        channelId: channelReady ? CHECK_NOTIFICATION_CHANNEL_ID : undefined,
        sound: CHECK_NOTIFICATION_SOUND,
        schedule: {
          on: { hour: 0, minute: 0 },
          repeats: true,
        },
      },
      {
        id: CHECK_NOTIFICATION_IDS[1],
        title: "مندور كوفي · تذكير بالشيكات",
        body: `قبل إغلاق اليوم: ${checkReminderDetails(unpaidChecks)}`,
        channelId: channelReady ? CHECK_NOTIFICATION_CHANNEL_ID : undefined,
        sound: CHECK_NOTIFICATION_SOUND,
        schedule: {
          on: { hour: 1, minute: 30 },
          repeats: true,
        },
      },
    ],
  });

  updateNotifStatus(
    channelReady
      ? "تنبيهات الشيكات مفعّلة يوميًا الساعة 12:00 و1:30 بنغمة الشيكات الخاصة."
      : "تذكيرات الشيكات مفعّلة يوميًا الساعة 12:00 و1:30 بصوت النظام.",
  );
}

function updateNotifStatus(message) {
  const element = document.getElementById("notif-status");
  if (element && message) element.textContent = message;
}

document
  .getElementById("enable-notif-btn")
  ?.addEventListener("click", async () => {
    const result = await requestNotificationPermission();

    if (result === "granted") {
      await syncLocalCheckNotifications();
      notify("تم تفعيل تنبيهات Android المحلية");
    } else if (result === "denied") {
      updateNotifStatus(
        "الإذن مرفوض. فعّل إشعارات التطبيق من إعدادات Android.",
      );
      notify("إذن الإشعارات مرفوض");
    } else {
      updateNotifStatus(
        "الإضافة غير موجودة. أعد بناء التطبيق بعد تعديل ملف البناء.",
      );
      notify("تعذر الوصول إلى إشعارات Android");
    }
  });

function updateChecksNotificationStatus(message) {
  const element = document.getElementById("checks-notification-status");
  if (element && message) element.textContent = message;
}

document
  .getElementById("send-checks-notification-btn")
  ?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "جاري الإرسال…";

    try {
      const permission = await requestNotificationPermission();
      if (permission !== "granted") {
        const message =
          permission === "denied"
            ? "إذن الإشعارات مرفوض؛ فعّله من إعدادات Android."
            : "إشعارات Android غير متاحة في هذا الإصدار من التطبيق.";
        updateChecksNotificationStatus(message);
        notify(message);
        return;
      }

      const channelReady = await ensureChecksNotificationChannel();
      const checks = checksForNotification();
      const body = checksNotificationBody(checks);

      await LocalNotifications.cancel({
        notifications: [{ id: CHECK_NOW_NOTIFICATION_ID }],
      }).catch(() => {});
      await LocalNotifications.schedule({
        notifications: [
          {
            id: CHECK_NOW_NOTIFICATION_ID,
            title: "مندور كوفي · الشيكات المفتوحة",
            body: body.slice(0, 240),
            largeBody: body,
            summaryText: `${fmt.format(checks.length)} شيكات · ${money(checks.reduce((sum, check) => sum + checkDue(check), 0))} متبقي`,
            channelId: channelReady ? CHECK_NOTIFICATION_CHANNEL_ID : undefined,
            sound: CHECK_NOTIFICATION_SOUND,
          },
        ],
      });

      const message = channelReady
        ? "تم إرسال إشعار الشيكات بالنغمة الخاصة."
        : "تم إرسال الإشعار؛ تعذر تجهيز النغمة الخاصة وقد يستخدم صوت النظام.";
      updateChecksNotificationStatus(message);
      notify(message);
    } catch (error) {
      console.error("Send checks notification error:", error);
      const message = "تعذر إرسال إشعار الشيكات. راجع إذن الإشعارات وحاول مجددًا.";
      updateChecksNotificationStatus(message);
      notify(message);
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    syncLocalCheckNotifications().catch(console.error);
    updateBackupBanner();
  }
});

syncLocalCheckNotifications().catch(console.error);

const splash = document.getElementById("splash");
let splashReady = false;
function finishSplash() {
  if (splashReady || !splash) return;
  const staffField = document.getElementById("splash-staff-name");
  if (staffField?.value.trim()) {
    data.staffName = staffField.value.trim();
    data.auditActor = data.staffName;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch {}
  }
  splashReady = true;
  splash.classList.add("leaving");
  window.setTimeout(() => {
    splash.remove();
    document.body.classList.add("app-ready");
  }, 700);
}
const splashStaffName = document.getElementById("splash-staff-name");
if (splashStaffName) splashStaffName.value = data.staffName || data.auditActor || "";
document.getElementById("splash-enter")?.addEventListener("click", finishSplash);
window.setTimeout(finishSplash, 7300);
window.setTimeout(() => {
  const savedPin = localStorage.getItem("mandour-app-pin");
  if (!savedPin) return;
  const entered = window.prompt("التطبيق مقفول. اكتب PIN من 4 أرقام");
  if (entered !== savedPin)
    document.body.innerHTML = '<main class="pin-denied"><h2>التطبيق مقفول</h2><p>أعد فتح التطبيق واكتب رمز PIN الصحيح.</p></main>';
}, 900);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) window.setTimeout(finishSplash, 120);
});
history.replaceState(
  { mandourView: "home" },
  "",
  `${location.pathname}${location.search}#home`,
);
refreshHome();
openView("home", { push: false, animate: false });
if (expiredInvoicesRemovedAtStartup)
  setTimeout(
    () =>
      notify(
        `تم حذف ${fmt.format(expiredInvoicesRemovedAtStartup)} مستند انتهت صلاحيته تلقائيًا`,
      ),
    3650,
  );
