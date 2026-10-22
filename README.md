

## تنظيم الملفات والصوت

الواجهة مقسمة إلى `assets/public/index.html` (هيكل الصفحة)، و`assets/public/css/app.css` (التصميم)، و`assets/public/js/app.js` (المنطق). يوجد الصوتان الأصليان منفصلين تحت `assets/audio/`، ويتولى `android-src/MainActivity.java` تشغيلهما مرة واحدة بعد سداد كل الحسابات، مع فاصل ثانيتين. تفاصيل البنية وخطوات التحقق موجودة في [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md).
