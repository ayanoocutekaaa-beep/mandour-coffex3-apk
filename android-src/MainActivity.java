package com.mandour.coffee.v5;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;

/** Routes Android back and shares saved invoice artwork through the native sharesheet. */
public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new ReceiptShareBridge(), "MandourNative");
        }
    }

    @Override
    public void onBackPressed() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            finish();
            return;
        }
        WebView webView = getBridge().getWebView();
        webView.evaluateJavascript(
            "window.mandourAndroidBack ? window.mandourAndroidBack() : false",
            handled -> {
                if (!"true".equals(handled)) {
                    finish();
                }
            }
        );
    }

    private final class ReceiptShareBridge {
        @JavascriptInterface
        public void shareInvoiceImage(String dataUrl) {
            runOnUiThread(() -> shareInvoiceImageOnUiThread(dataUrl));
        }
    }

    private void shareInvoiceImageOnUiThread(String dataUrl) {
        try {
            if (dataUrl == null || dataUrl.length() > 20_000_000) {
                throw new IllegalArgumentException("Receipt image is missing or too large");
            }
            int separator = dataUrl.indexOf(',');
            String encoded = separator >= 0 ? dataUrl.substring(separator + 1) : dataUrl;
            byte[] imageBytes = Base64.decode(encoded, Base64.DEFAULT);

            File sharedDir = new File(getCacheDir(), "shared");
            if (!sharedDir.exists() && !sharedDir.mkdirs()) {
                throw new IllegalStateException("Unable to create share cache");
            }
            File[] oldFiles = sharedDir.listFiles();
            if (oldFiles != null) {
                for (File oldFile : oldFiles) {
                    oldFile.delete();
                }
            }
            File imageFile = new File(sharedDir, "mandour-receipt-" + System.currentTimeMillis() + ".png");
            try (FileOutputStream output = new FileOutputStream(imageFile)) {
                output.write(imageBytes);
            }

            Uri imageUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", imageFile);
            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType("image/png");
            shareIntent.putExtra(Intent.EXTRA_STREAM, imageUri);
            shareIntent.putExtra(Intent.EXTRA_TITLE, "إيصال من مندور كوفي");
            shareIntent.putExtra(Intent.EXTRA_SUBJECT, "إيصال من مندور كوفي");
            shareIntent.setClipData(ClipData.newRawUri("إيصال مندور كوفي", imageUri));
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(shareIntent, "مشاركة الإيصال");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(chooser);
        } catch (Exception error) {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript(
                    "if (window.notify) window.notify('تعذرت مشاركة الإيصال؛ جرّب تنزيل صورته');",
                    null
                );
            }
        }
    }
}
