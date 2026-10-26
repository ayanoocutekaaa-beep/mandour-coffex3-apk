package com.mandour.coffee.v5;

import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.Environment;
import android.content.ContentValues;
import android.content.ContentUris;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.database.Cursor;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native Android bridge for sharing and user-selected persistent save folders. */
public class MainActivity extends BridgeActivity {
    private static final String BACKUP_RELATIVE_PATH = Environment.DIRECTORY_DOWNLOADS + "/test/";
    private static final int REQUEST_CREATE_DOCUMENT = 4107;
    private static final int REQUEST_PICK_FOLDER = 4108;
    private String pendingSaveData;
    private String pendingSaveMime;
    private String pendingSaveName;
    private String pendingFolderKind;
    private MediaPlayer paidAudioPlayer;
    private String activePaidAudioKey = "";
    private final String PREFS = "mandour_save_folders";
    private final ExecutorService backupExecutor = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            webView.setBackgroundColor(android.graphics.Color.WHITE);
            webView.addJavascriptInterface(new ReceiptShareBridge(), "MandourNative");
        }
    }

    @Override
    public void onResume() {
        super.onResume();
    }

    @Override
    public void onBackPressed() {
        if (getBridge() == null || getBridge().getWebView() == null) { finish(); return; }
        getBridge().getWebView().evaluateJavascript(
            "window.mandourAndroidBack ? window.mandourAndroidBack() : false",
            handled -> { if (!"true".equals(handled)) finish(); }
        );
    }

    private final class ReceiptShareBridge {
        @JavascriptInterface public void shareInvoiceImage(String dataUrl) {
            runOnUiThread(() -> shareInvoiceImageOnUiThread(dataUrl));
        }
        @JavascriptInterface public void saveBackup(String json, String fileName) {
            backupExecutor.execute(() -> notifyAutoBackupResult(saveBackupAutomatically(json), fileName));
        }
        @JavascriptInterface public void saveBackupToChosenFolder(String json, String fileName) {
            backupExecutor.execute(() -> {
                if (json == null || json.length() > 30_000_000) {
                    notifyAutoBackupResult(false, fileName);
                    return;
                }
                String savedTree = getSharedPreferences(PREFS, MODE_PRIVATE).getString("uri_backup", "");
                if (savedTree.isEmpty()) {
                    boolean saved = saveToDownloads(json);
                    notifyAutoBackupResult(saved, fileName);
                    return;
                }
                pendingSaveData = json;
                pendingSaveMime = "application/json";
                pendingSaveName = (fileName == null || fileName.trim().isEmpty()) ? "mandour-coffee-backup.json" : fileName;
                pendingFolderKind = "backup";
                boolean saved = writeToTree(Uri.parse(savedTree));
                if (!saved) {
                    clearPendingSave();
                    saved = saveToDownloads(json);
                }
                notifyAutoBackupResult(saved, fileName);
            });
        }
        @JavascriptInterface public void saveReceipt(String dataUrl, String fileName) {
            String encoded = dataUrl == null ? "" : dataUrl;
            int separator = encoded.indexOf(',');
            if (separator >= 0) encoded = encoded.substring(separator + 1);
            saveOrChooseFolder(encoded, "image/png", fileName, "receipt");
        }
        @JavascriptInterface public void chooseFolder(String kind) {
            runOnUiThread(() -> openFolderPicker("receipt".equals(kind) ? "receipt" : "backup"));
        }
        @JavascriptInterface public String getFolderName(String kind) {
            return getSharedPreferences(PREFS, MODE_PRIVATE).getString("name_" + kind, "");
        }
        @JavascriptInterface public void playPaidSound(String key) {
            String requestKey = key == null ? "paid" : key;
            runOnUiThread(() -> startAudioSequence(requestKey, "public/assets/audio/Ayano.mp3", "mandour-Ayano.mp3"));
        }
        @JavascriptInterface public void playActionSound(String key) {
            String requestKey = key == null ? "action" : key;
            String assetPath = "public/assets/audio/check-action.mp3";
            String cacheName = "mandour-check-action.mp3";
            if (requestKey.startsWith("menu-item-")) {
                assetPath = "public/assets/audio/order-wood.mp3";
                cacheName = "mandour-order-wood.mp3";
            } else if (requestKey.startsWith("missing-customer-")) {
                assetPath = "public/assets/audio/customer-name-reminder.mp3";
                cacheName = "mandour-customer-name-reminder.mp3";
            }
            final String selectedAssetPath = assetPath;
            final String selectedCacheName = cacheName;
            runOnUiThread(() -> startAudioSequence(requestKey, selectedAssetPath, selectedCacheName));
        }
        @JavascriptInterface public void stopPaidSound() {
            runOnUiThread(() -> stopPaidSoundSequence());
        }
    }

    private void startAudioSequence(String key, String assetPath, String cacheName) {
        if (key.equals(activePaidAudioKey) && paidAudioPlayer != null) return;
        stopPaidSoundSequence();
        activePaidAudioKey = key;
        playAudioAsset(assetPath, cacheName);
    }

    private void playAudioAsset(String assetPath, String cacheName) {
        MediaPlayer player = null;
        try (InputStream input = getAssets().open(assetPath)) {
            File audioFile = new File(getCacheDir(), cacheName);
            try (FileOutputStream output = new FileOutputStream(audioFile)) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                output.flush();
            }
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build());
            player.setDataSource(audioFile.getAbsolutePath());
            MediaPlayer preparedPlayer = player;
            preparedPlayer.setOnCompletionListener(completed -> {
                completed.release();
                if (paidAudioPlayer != completed) return;
                paidAudioPlayer = null;
                activePaidAudioKey = "";
            });
            preparedPlayer.setOnErrorListener((failed, what, extra) -> {
                if (paidAudioPlayer == failed) paidAudioPlayer = null;
                failed.release();
                activePaidAudioKey = "";
                return true;
            });
            preparedPlayer.setOnPreparedListener(ready -> {
                if (paidAudioPlayer == ready && !activePaidAudioKey.isEmpty()) ready.start();
                else ready.release();
            });
            paidAudioPlayer = preparedPlayer;
            preparedPlayer.prepareAsync();
        } catch (Exception error) {
            if (player != null) {
                try { player.release(); } catch (Exception ignored) {}
            }
            paidAudioPlayer = null;
            activePaidAudioKey = "";
        }
    }

    private void stopPaidSoundSequence() {
        activePaidAudioKey = "";
        MediaPlayer player = paidAudioPlayer;
        paidAudioPlayer = null;
        if (player != null) {
            try { if (player.isPlaying()) player.stop(); } catch (Exception ignored) {}
            try { player.release(); } catch (Exception ignored) {}
        }
    }

    @Override
    public void onDestroy() {
        stopPaidSoundSequence();
        backupExecutor.shutdownNow();
        super.onDestroy();
    }

    private boolean saveBackupAutomatically(String json) {
        if (json == null || json.length() > 30_000_000) {
            return false;
        }
        String savedTree = getSharedPreferences(PREFS, MODE_PRIVATE).getString("uri_backup", "");
        boolean saved = !savedTree.isEmpty() && saveBackupToTree(json, Uri.parse(savedTree));
        if (!saved) saved = saveToDownloads(json);
        return saved;
    }

    private boolean saveBackupToTree(String json, Uri treeUri) {
        pendingSaveData = json;
        pendingSaveMime = "application/json";
        pendingSaveName = "Ayanoo.json";
        pendingFolderKind = "backup";
        boolean saved = writeToTree(treeUri);
        if (!saved) clearPendingSave();
        return saved;
    }

    private boolean saveToDownloads(String json) {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            File temporary = null;
            File previous = null;
            File target = null;
            try {
                File downloads = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "test");
                if (!downloads.exists() && !downloads.mkdirs()) return false;
                String suffix = Long.toString(System.currentTimeMillis());
                target = new File(downloads, "Ayanoo.json");
                temporary = new File(downloads, "Ayanoo.json.pending-" + suffix);
                previous = new File(downloads, "Ayanoo.json.previous-" + suffix);
                try (FileOutputStream output = new FileOutputStream(temporary, false)) {
                    output.write(bytes);
                    output.flush();
                    output.getFD().sync();
                }
                boolean hadPrevious = target.exists();
                if (hadPrevious && !target.renameTo(previous)) return false;
                if (!temporary.renameTo(target)) {
                    if (hadPrevious) previous.renameTo(target);
                    return false;
                }
                if (hadPrevious) previous.delete();
                notifyWeb("تم تحديث Ayanoo.json تلقائيًا في Downloads/test");
                return true;
            } catch (Exception error) {
                if (previous != null && previous.exists() && target != null && !target.exists()) previous.renameTo(target);
                return false;
            } finally {
                if (temporary != null && temporary.exists()) temporary.delete();
            }
        }
        Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
        String suffix = Long.toString(System.currentTimeMillis());
        String temporaryName = "Ayanoo.json.pending-" + suffix;
        String previousName = "Ayanoo.json.previous-" + suffix;
        Uri temporary = null;
        Uri previous = null;
        boolean previousRenamed = false;
        boolean temporaryPromoted = false;
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, temporaryName);
            values.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, BACKUP_RELATIVE_PATH);
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            temporary = getContentResolver().insert(collection, values);
            if (temporary == null) return false;
            try (OutputStream output = getContentResolver().openOutputStream(temporary, "w")) {
                if (output == null) return false;
                output.write(bytes);
                output.flush();
            }
            ContentValues publish = new ContentValues();
            publish.put(MediaStore.MediaColumns.IS_PENDING, 0);
            if (getContentResolver().update(temporary, publish, null, null) <= 0) return false;

            Uri current = findDownloadFile(collection, "Ayanoo.json");
            if (current != null) {
                ContentValues renameOld = new ContentValues();
                renameOld.put(MediaStore.MediaColumns.DISPLAY_NAME, previousName);
                if (getContentResolver().update(current, renameOld, null, null) <= 0) return false;
                previous = current;
                previousRenamed = true;
            }
            ContentValues renameNew = new ContentValues();
            renameNew.put(MediaStore.MediaColumns.DISPLAY_NAME, "Ayanoo.json");
            if (getContentResolver().update(temporary, renameNew, null, null) <= 0) {
                if (previousRenamed) renameDownloadFile(previous, "Ayanoo.json");
                return false;
            }
            temporaryPromoted = true;
            if (previousRenamed) {
                try { getContentResolver().delete(previous, null, null); } catch (Exception ignored) {}
            }
            notifyWeb("تم تحديث Ayanoo.json تلقائيًا في Downloads/test");
            return true;
        } catch (Exception error) {
            if (previousRenamed && previous != null) renameDownloadFile(previous, "Ayanoo.json");
            return false;
        } finally {
            if (!temporaryPromoted && temporary != null) {
                try { getContentResolver().delete(temporary, null, null); } catch (Exception ignored) {}
            }
        }
    }

    private Uri findDownloadFile(Uri collection, String displayName) throws Exception {
        String[] projection = new String[] { "_id" };
        String selection = MediaStore.MediaColumns.DISPLAY_NAME + "=? AND " + MediaStore.MediaColumns.RELATIVE_PATH + "=?";
        try (Cursor cursor = getContentResolver().query(collection, projection, selection,
            new String[] { displayName, BACKUP_RELATIVE_PATH }, null)) {
            if (cursor == null) throw new IllegalStateException("Downloads query unavailable");
            if (!cursor.moveToFirst()) return null;
            int idIndex = cursor.getColumnIndex("_id");
            if (idIndex < 0) throw new IllegalStateException("Downloads row has no id");
            return ContentUris.withAppendedId(collection, cursor.getLong(idIndex));
        }
    }

    private boolean renameDownloadFile(Uri uri, String displayName) {
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, displayName);
            return getContentResolver().update(uri, values, null, null) > 0;
        } catch (Exception error) { return false; }
    }

    private void saveOrChooseFolder(String data, String mime, String name, String kind) {
        runOnUiThread(() -> {
            if (data == null || data.length() > 30_000_000) { notifyWeb("الملف كبير جدًا للحفظ"); return; }
            pendingSaveData = data; pendingSaveMime = mime;
            pendingSaveName = (name == null || name.trim().isEmpty()) ? "mandour-coffee-file" : name;
            pendingFolderKind = kind;
            String savedTree = getSharedPreferences(PREFS, MODE_PRIVATE).getString("uri_" + kind, "");
            if (!savedTree.isEmpty() && writeToTree(Uri.parse(savedTree))) return;
            openSavePicker(data, mime, pendingSaveName);
        });
    }

    private boolean writeToTree(Uri treeUri) {
        if ("backup".equals(pendingFolderKind))
            return writeBackupToTreeAtomically(treeUri, pendingSaveData);
        try {
            Uri fileUri = DocumentsContract.createDocument(getContentResolver(), treeUri, pendingSaveMime, pendingSaveName);
            if (fileUri == null) return false;
            byte[] bytes = "application/json".equals(pendingSaveMime)
                ? pendingSaveData.getBytes(StandardCharsets.UTF_8)
                : Base64.decode(pendingSaveData, Base64.DEFAULT);
            try (OutputStream output = getContentResolver().openOutputStream(fileUri)) {
                if (output == null) return false;
                output.write(bytes); output.flush();
            }
            notifyWeb("تم الحفظ تلقائيًا في مجلد " + getFolderName(pendingFolderKind));
            clearPendingSave();
            return true;
        } catch (Exception error) { return false; }
    }

    private boolean writeBackupToTreeAtomically(Uri treeUri, String json) {
        Uri temporary = null;
        Uri previous = null;
        boolean previousRenamed = false;
        boolean temporaryPromoted = false;
        String nonce = Long.toString(System.currentTimeMillis()) + "-" + Long.toString(System.nanoTime());
        String temporaryName = "Ayanoo.json.pending-" + nonce;
        String previousName = "Ayanoo.json.previous-" + nonce;
        try {
            if (json == null || json.length() > 30_000_000) return false;
            byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
            temporary = DocumentsContract.createDocument(getContentResolver(), treeUri, "application/json", temporaryName);
            if (temporary == null) return false;
            try (OutputStream output = getContentResolver().openOutputStream(temporary, "w")) {
                if (output == null) throw new IllegalStateException("تعذر فتح ملف النسخة المؤقت");
                output.write(bytes);
                output.flush();
            }
            if (!documentHasExpectedLength(temporary, bytes.length)) {
                try { DocumentsContract.deleteDocument(getContentResolver(), temporary); } catch (Exception ignored) {}
                return false;
            }
            Uri current = findTreeFile(treeUri, "Ayanoo.json");
            if (current != null) {
                previous = DocumentsContract.renameDocument(getContentResolver(), current, previousName);
                if (previous == null) return false;
                previousRenamed = true;
            }
            Uri replacement = DocumentsContract.renameDocument(getContentResolver(), temporary, "Ayanoo.json");
            if (replacement == null) {
                if (previousRenamed && previous != null)
                    DocumentsContract.renameDocument(getContentResolver(), previous, "Ayanoo.json");
                return false;
            }
            temporaryPromoted = true;
            if (previousRenamed && previous != null) {
                try { DocumentsContract.deleteDocument(getContentResolver(), previous); } catch (Exception ignored) {}
            }
            notifyWeb("تم تحديث Ayanoo.json تلقائيًا في المجلد المختار");
            clearPendingSave();
            return true;
        } catch (Exception error) {
            if (previousRenamed && previous != null) {
                try { DocumentsContract.renameDocument(getContentResolver(), previous, "Ayanoo.json"); } catch (Exception ignored) {}
            }
            return false;
        } finally {
            if (!temporaryPromoted && temporary != null) {
                try { DocumentsContract.deleteDocument(getContentResolver(), temporary); } catch (Exception ignored) {}
            }
        }
    }

    private Uri findTreeFile(Uri treeUri, String fileName) throws Exception {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
            treeUri,
            DocumentsContract.getTreeDocumentId(treeUri)
        );
        String[] projection = new String[] {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME
        };
        try (Cursor cursor = getContentResolver().query(childrenUri, projection, null, null, null)) {
            if (cursor == null) throw new IllegalStateException("تعذر فحص المجلد المختار");
            int idIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int nameIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            if (idIndex < 0 || nameIndex < 0) throw new IllegalStateException("معلومات ملف النسخة غير متاحة");
            while (cursor.moveToNext()) {
                if (fileName.equals(cursor.getString(nameIndex))) {
                    String documentId = cursor.getString(idIndex);
                    return DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId);
                }
            }
            return null;
        }
    }

    private boolean documentHasExpectedLength(Uri uri, long expectedLength) {
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) return false;
            long length = 0;
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) length += count;
            return length == expectedLength;
        } catch (Exception error) { return false; }
    }

    private String getFolderName(String kind) {
        return getSharedPreferences(PREFS, MODE_PRIVATE).getString("name_" + kind, "المجلد المختار");
    }

    private void openFolderPicker(String kind) {
        pendingFolderKind = kind;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(intent, REQUEST_PICK_FOLDER);
    }

    private void openSavePicker(String data, String mime, String name) {
        pendingSaveData = data; pendingSaveMime = mime; pendingSaveName = name;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(intent, REQUEST_CREATE_DOCUMENT);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent result) {
        super.onActivityResult(requestCode, resultCode, result);
        if (requestCode == REQUEST_PICK_FOLDER) {
            if (resultCode == RESULT_OK && result != null && result.getData() != null) {
                Uri tree = result.getData();
                try { getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); } catch (Exception ignored) {}
                String name = tree.getLastPathSegment();
                if (name == null || name.isEmpty()) name = "المجلد المختار";
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("uri_" + pendingFolderKind, tree.toString()).putString("name_" + pendingFolderKind, name).apply();
                notifyFolderChosen(pendingFolderKind, name);
            }
            return;
        }
        if (requestCode != REQUEST_CREATE_DOCUMENT) return;
        if (resultCode != RESULT_OK || result == null || result.getData() == null) { clearPendingSave(); return; }
        try {
            Uri uri = result.getData();
            byte[] bytes = "application/json".equals(pendingSaveMime) ? pendingSaveData.getBytes(StandardCharsets.UTF_8) : Base64.decode(pendingSaveData, Base64.DEFAULT);
            try (OutputStream output = getContentResolver().openOutputStream(uri)) {
                if (output == null) throw new IllegalStateException("تعذر فتح الملف للحفظ");
                output.write(bytes); output.flush();
            }
            notifyWeb("تم حفظ الملف في المكان الذي اخترته");
        } catch (Exception error) { notifyWeb("تعذر حفظ الملف في المكان المختار"); }
        finally { clearPendingSave(); }
    }

    private void clearPendingSave() { pendingSaveData = null; pendingSaveMime = null; pendingSaveName = null; pendingFolderKind = null; }
    private void notifyFolderChosen(String kind, String name) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        String safeKind = kind.replace("\\", "\\\\").replace("\'", "\\\'");
        String safeName = name.replace("\\", "\\\\").replace("\'", "\\\'");
        getBridge().getWebView().evaluateJavascript("if (window.mandourFolderChosen) window.mandourFolderChosen(\'" + safeKind + "\',\'" + safeName + "\'); if (window.notify) window.notify(\'تم اختيار المجلد\');", null);
    }

    private void notifyWeb(String message) {
        String safe = message.replace("\\", "\\\\").replace("'", "\\'");
        runOnUiThread(() -> {
            if (getBridge() == null || getBridge().getWebView() == null) return;
            getBridge().getWebView().evaluateJavascript("if (window.notify) window.notify('" + safe + "');", null);
        });
    }

    private void notifyAutoBackupResult(boolean success, String fileName) {
        runOnUiThread(() -> {
            if (getBridge() == null || getBridge().getWebView() == null) return;
            String safeName = (fileName == null ? "" : fileName).replace("\\", "\\\\").replace("'", "\\'");
            getBridge().getWebView().evaluateJavascript(
                "if (window.mandourAutoBackupResult) window.mandourAutoBackupResult(" + success + ", '" + (success ? "" : "تعذر حفظ النسخة؛ لم يتم تغيير النسخة السابقة.") + "', '" + safeName + "');",
                null
            );
        });
    }

    private void shareInvoiceImageOnUiThread(String dataUrl) {
        try {
            if (dataUrl == null || dataUrl.length() > 20_000_000) throw new IllegalArgumentException("Receipt image is missing or too large");
            int separator = dataUrl.indexOf(',');
            String encoded = separator >= 0 ? dataUrl.substring(separator + 1) : dataUrl;
            byte[] imageBytes = Base64.decode(encoded, Base64.DEFAULT);
            File sharedDir = new File(getCacheDir(), "shared");
            if (!sharedDir.exists() && !sharedDir.mkdirs()) throw new IllegalStateException("Unable to create share cache");
            File[] oldFiles = sharedDir.listFiles(); if (oldFiles != null) for (File oldFile : oldFiles) oldFile.delete();
            File imageFile = new File(sharedDir, "mandour-receipt-" + System.currentTimeMillis() + ".png");
            try (FileOutputStream output = new FileOutputStream(imageFile)) { output.write(imageBytes); }
            Uri imageUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", imageFile);
            Intent shareIntent = new Intent(Intent.ACTION_SEND); shareIntent.setType("image/png");
            shareIntent.putExtra(Intent.EXTRA_STREAM, imageUri); shareIntent.putExtra(Intent.EXTRA_TITLE, "إيصال من مندوركوف"); shareIntent.putExtra(Intent.EXTRA_SUBJECT, "إيصال من مندوركوف");
            shareIntent.setClipData(ClipData.newRawUri("إيصال مندوركوف", imageUri)); shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(shareIntent, "مشاركة الإيصال"); chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION); startActivity(chooser);
        } catch (Exception error) { notifyWeb("تعذرت مشاركة الإيصال؛ جرّب حفظه في مكان تختاره"); }
    }
}
