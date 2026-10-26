# هيكل مشروع مندوركوف

## الملفات التي نعدّلها

- `assets/public/index.html` — هيكل الشاشة ونصوصها وربط ملفات الواجهة.
- `assets/public/css/app.css` — تنسيقات التطبيق وألوانه وتخطيط الشاشات.
- `assets/public/js/app.js` — منطق التطبيق، التخزين المحلي، الفواتير، العملاء، الشيكات والبحث.
- `assets/mandour-app-icon.png` — الصورة المعتمدة لأيقونة الويب وشعار التطبيق.
- `assets/mandour-app-icon-foreground.png` — مصدر توليد طبقة Adaptive Icon من الصورة المعتمدة.
- `android-res/mipmap-*` — أيقونات Android بأحجام كثافات الشاشة المختلفة.
- `android-res/mipmap-anydpi-v26/` و`android-res/values/ic_launcher_background.xml` — تعريف الطبقات ولون خلفية Adaptive Icon.
- `assets/audio/Ayano.mp3` — المقطع الصوتي الموجود في ملف المستخدم: `Ayano.mp3`.
- `assets/audio/notification-glass.mp3` — جرس الإشعارات الزجاجي، يُنسخ إلى `res/raw` لقناة Android.
- `assets/audio/customer-name-reminder.mp3` — تنبيه الاسم عند حفظ أصناف دون اسم عميل.
- `assets/audio/order-wood.mp3` — نغمة اختيار صنف من قائمة المشروبات.
- `android-src/MainActivity.java` — جسر Android للنسخ الاحتياطي ومشاركة الإيصالات وتشغيل المقطع الصوتي.
- `.github/workflows/build.yml` — إعداد بناء Android على GitHub Actions.

## تتابع صوت اكتمال السداد

تشغيل الصوت مرتبط بدخول شاشة الشيكات مع وجود شيك واحد على الأقل وعدم وجود أي مبلغ متبقٍ. يرسل JavaScript مفتاحًا ثابتًا للجسر الأصلي؛ المفتاح يمنع إعادة تشغيل الصوت بسبب إعادة رسم القائمة. يشغل Android المقطع الصوتي الأول مرة واحدة، ومغادرة شاشة الشيكات توقف المشغل.

المقطع الصوتي محفوظ بصيغة M4A؛ لا يتضمن التطبيق ملفات الفيديو الأصلية أو صورًا غير مستخدمة. يتم نسخ الصوت إلى مجلد cache عند الحاجة فقط لتشغيله، وليس في كل مرة تُفتح فيها الشاشة.

## الملفات المولدة

`www/` هو مجلد الويب الذي يقرأه Capacitor عند المزامنة. أما `android/` فيحوي مشروع Android المولّد والمزامَن. لا نحرّر ملفات الواجهة داخلهما يدويًا؛ نعدّل الملفات المصدر المذكورة أعلاه ثم نشغّل `npx cap sync android`.

## فحوص قبل التسليم

1. `node --check assets/public/js/app.js`
2. `git diff --check`
3. بناء `assembleDebug` وفحص رقم الإصدار والتوقيع.
4. التأكد من وجود ملفات M4A داخل APK وخلوه من MP4.
