package com.mandour.coffee.v5;

import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
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
    private final String PREFS = "mandour_save_folders";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new ReceiptShareBridge(), "MandourNative");
        }
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
            saveOrChooseFolder(json, "application/json", fileName, "backup");
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
