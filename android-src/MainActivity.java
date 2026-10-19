package com.mandour.coffee.v5;

import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

/** Routes Android system-back to the in-app history before the activity closes. */
public class MainActivity extends BridgeActivity {
    @Override
    public void onBackPressed() {
        if (getBridge() == null) {
            finish();
            return;
        }
        WebView webView = getBridge().getWebView();
        if (webView == null) {
            finish();
            return;
        }
        webView.evaluateJavascript(
            "window.mandourAndroidBack ? window.mandourAndroidBack() : false",
            handled -> {
                if (!"true".equals(handled)) {
                    finish();
                }
            }
        );
    }
}
