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

/** Native Android bridge for sharing and user-selected persistent save folders. */
public class MainActivity extends BridgeActivity {
    private static final int REQUEST_CREATE_DOCUMENT = 4107;
    private static final int REQUEST_PICK_FOLDER = 4108;
    private String pendingSaveData;
    private String pendingSaveMime;
    private String pendingSaveName;
    private String pendingFolderKind;
    private MediaPlayer paidAudioPlayer;
    private String activePaidAudioKey = "";
    private final String PREFS = "mandour_save_folders";

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
            saveBackupAutomatically(json);
        }
        @JavascriptInterface public void saveBackupToChosenFolder(String json, String fileName) {
            runOnUiThread(() -> {
                if (json == null || json.length() > 30_000_000) {
                    notifyAutoBackupResult(false);
                    return;
                }
                String savedTree = getSharedPreferences(PREFS, MODE_PRIVATE).getString("uri_backup", "");
                if (savedTree.isEmpty()) {
                    boolean saved = saveToDownloads(json);
                    notifyAutoBackupResult(saved);
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
                notifyAutoBackupResult(saved);
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
            runOnUiThread(() -> startAudioSequence(requestKey, "public/assets/audio/check-action.mp3", "mandour-check-action.mp3"));
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
        super.onDestroy();
    }

    private void saveBackupAutomatically(String json) {
        runOnUiThread(() -> {
            if (json == null || json.length() > 30_000_000) {
                notifyWeb("ملف النسخة كبير جدًا");
                return;
            }
            String savedTree = getSharedPreferences(PREFS, MODE_PRIVATE).getString("uri_backup", "");
            boolean saved = !savedTree.isEmpty() && saveBackupToTree(json, Uri.parse(savedTree));
            if (!saved) saved = saveToDownloads(json);
            if (!saved) notifyWeb("تعذر حفظ Ayanoo.json تلقائيًا");
        });
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
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            try {
                File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!downloads.exists() && !downloads.mkdirs()) return false;
                File file = new File(downloads, "Ayanoo.json");
                try (FileOutputStream output = new FileOutputStream(file, false)) {
                    output.write(json.getBytes(StandardCharsets.UTF_8));
                    output.flush();
                }
                notifyWeb("تم تحديث Ayanoo.json تلقائيًا في Downloads");
                return true;
            } catch (Exception error) { return false; }
        }
        try {
            Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
            getContentResolver().delete(collection,
                MediaStore.MediaColumns.DISPLAY_NAME + "=? AND " + MediaStore.MediaColumns.RELATIVE_PATH + "=?",
                new String[]{"Ayanoo.json", Environment.DIRECTORY_DOWNLOADS + "/"});
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, "Ayanoo.json");
            values.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/");
            Uri target = getContentResolver().insert(collection, values);
            if (target == null) return false;
            try (OutputStream output = getContentResolver().openOutputStream(target)) {
                if (output == null) return false;
                output.write(json.getBytes(StandardCharsets.UTF_8));
                output.flush();
            }
            notifyWeb("تم تحديث Ayanoo.json تلقائيًا في Downloads");
            return true;
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
        try {
            if ("backup".equals(pendingFolderKind)) {
                pendingSaveName = "Ayanoo.json";
                deleteExistingTreeFile(treeUri, pendingSaveName);
            }
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

    private void deleteExistingTreeFile(Uri treeUri, String fileName) {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
            treeUri,
            DocumentsContract.getTreeDocumentId(treeUri)
        );
        String[] projection = new String[] {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME
        };
        try (Cursor cursor = getContentResolver().query(childrenUri, projection, null, null, null)) {
            if (cursor == null) return;
            int idIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int nameIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            while (cursor.moveToNext()) {
                String existingName = nameIndex >= 0 ? cursor.getString(nameIndex) : "";
                if (!fileName.equals(existingName) || idIndex < 0) continue;
                String documentId = cursor.getString(idIndex);
                Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId);
                try { DocumentsContract.deleteDocument(getContentResolver(), documentUri); } catch (Exception ignored) {}
            }
        }
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
        if (getBridge() == null || getBridge().getWebView() == null) return;
        String safe = message.replace("\\", "\\\\").replace("'", "\\'");
        getBridge().getWebView().evaluateJavascript("if (window.notify) window.notify('" + safe + "');", null);
    }

    private void notifyAutoBackupResult(boolean success) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().evaluateJavascript(
            "if (window.mandourAutoBackupResult) window.mandourAutoBackupResult(" + success + ", '" + (success ? "" : "تعذر الحفظ في المجلد المختار؛ اختره مرة أخرى.") + "');",
            null
        );
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
            shareIntent.putExtra(Intent.EXTRA_STREAM, imageUri); shareIntent.putExtra(Intent.EXTRA_TITLE, "إيصال من مندور كوفي"); shareIntent.putExtra(Intent.EXTRA_SUBJECT, "إيصال من مندور كوفي");
            shareIntent.setClipData(ClipData.newRawUri("إيصال مندور كوفي", imageUri)); shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(shareIntent, "مشاركة الإيصال"); chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION); startActivity(chooser);
        } catch (Exception error) { notifyWeb("تعذرت مشاركة الإيصال؛ جرّب حفظه في مكان تختاره"); }
    }
}
