from pathlib import Path

manifest = Path('android/app/src/main/AndroidManifest.xml')
text = manifest.read_text(encoding='utf-8')
if 'androidx.core.content.FileProvider' in text:
    raise SystemExit('AndroidManifest already declares a FileProvider; review before merging')
provider = '''
        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/share_paths" />
        </provider>
'''
if text.count('</application>') != 1:
    raise SystemExit('Expected one </application> element in Capacitor manifest')
manifest.write_text(text.replace('</application>', provider + '    </application>', 1), encoding='utf-8')
