package com.hamidreza.budgetplanner;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.OnBackPressedDispatcher;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Stock Capacitor exits the app whenever the WebView reports no history.
    // Because the bridge loads the server page via loadUrl(), that page has no
    // back-history — so "back" inside the planner quit the app instantly.
    //
    // Back behavior, registered AFTER Capacitor's callback (the dispatcher runs
    // the most recently added callback first):
    //   1. WebView has history (SPA navigation in the planner) → go back.
    //   2. On the server page with no history → return to the connect screen
    //      and clear the history stack, so the next back exits cleanly.
    //   3. On the connect screen → exit (standard Android behavior).
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        OnBackPressedDispatcher dispatcher = getOnBackPressedDispatcher();
        dispatcher.addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge == null || bridge.getWebView() == null) {
                    setEnabled(false);
                    dispatcher.onBackPressed();
                    return;
                }
                if (bridge.getWebView().canGoBack()) {
                    bridge.getWebView().goBack();
                    return;
                }
                String url = bridge.getWebView().getUrl();
                String local = bridge.getLocalUrl();
                boolean onLocalShell = url != null && local != null
                        && url.startsWith(local.replaceAll("/+$", ""));
                if (!onLocalShell) {
                    // Back from the server root: show the connect screen. The
                    // #server-picker fragment tells the shell to skip its
                    // auto-connect (otherwise it would bounce straight back to
                    // the server). clearHistory then makes the next back exit
                    // cleanly instead of bouncing.
                    bridge.getWebView().loadUrl(local.replaceAll("/+$", "") + "#server-picker");
                    bridge.getWebView().postDelayed(
                            () -> bridge.getWebView().clearHistory(), 1200);
                } else {
                    setEnabled(false);
                    dispatcher.onBackPressed();
                }
            }
        });
    }
}
