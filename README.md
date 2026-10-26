# مندوركوف

تطبيق عربي لإدارة فواتير البن، العملاء والتوليفات، طلبات الكافيه والشيكات والمدفوعات. يدعم حفظ البيانات محليًا، الإشعارات، التقارير، والنسخ الاحتياطي والاستعادة.

الواجهة الافتراضية بالوضع الداكن المستوحى من ألوان القهوة، مع إمكانية اختيار الوضع الفاتح من إعدادات التطبيق.

## مصادر التطبيق المعتمدة

- `assets/public/index.html`: هيكل الشاشات وتسميات الأزرار والتنقل.
- `assets/public/css/app.css`: الألوان والتخطيطات والاستجابة لأحجام الهاتف.
- `assets/public/js/app.js`: منطق الفواتير والعملاء والشيكات والتنبيهات والتخزين المحلي.
- `assets/mandour-app-icon.png`: الصورة المعتمدة لشعار التطبيق وأيقونة الويب.
- `assets/mandour-app-icon-foreground.png`: مصدر الصورة المعتمدة لتوليد طبقة Adaptive Icon.
- `android-res/mipmap-*`: أيقونات Android وأحجامها المختلفة.
- `android-res/mipmap-anydpi-v26/`: تعريف Adaptive Icon على Android الحديث.
- `android-res/values/ic_launcher_background.xml`: لون خلفية Adaptive Icon.
- `android-src/MainActivity.java`: جسر Android للنسخ الاحتياطي ومشاركة الإيصالات وتشغيل الصوت.
- `assets/audio/`: أصوات التنبيهات والتفاعل.
- `.github/workflows/build.yml`: بناء Android ونشر APK عند تحديث الفرع الرئيسي.

> عدّل ملفات المصدر أعلاه؛ لا تعدّل `www/` أو `android/` الناتجين عن Capacitor. ملف `index.html` في جذر المستودع نسخة قديمة للتوافق، والمصدر الذي يقرأه بناء APK هو `assets/public/index.html`.

## التحقق والبناء

```bash
node --check assets/public/js/app.js
git diff --check
```

تتم مزامنة واجهة الويب إلى Android عبر `npx cap sync android`، ثم إنشاء APK عبر `./gradlew assembleDebug` من مجلد Android.

## البنية

```text
assets/
  public/          واجهة التطبيق: HTML وCSS وJavaScript
  audio/           الأصوات
  beans/           صور أنواع البن
  menu/            صور المشروبات
  payments/        صور وشعارات الدفع
android-res/       أيقونات وموارد Android المصدرية
android-src/       كود Java الخاص بالتكامل مع Android
docs/              توثيق بنية المشروع وآليات النسخ الاحتياطي
.github/workflows/ مسار بناء APK
```

تسجل الشيكات أحداث الطلبات والخصومات والمدفوعات؛ حافظ على فصل المبلغ الإجمالي والمدفوع والمتبقي، وعلى بيانات الطاولة/التيك أواي والعملاء عند تحسين واجهة الطلبات.
