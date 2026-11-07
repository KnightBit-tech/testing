/*
 * District 2.79.0 — WebView URL logger
 *
 * Use this to answer: "does this deeplink / click actually open an in-app WebView,
 * and with what URL?" It only logs; it does not modify behaviour.
 *
 * Usage:
 *   frida -U -f com.application.zomato.district -l log-webview.js --no-pause
 *
 * Then fire deeplinks from another shell and watch this console.
 */

Java.perform(function () {
    var WebView = Java.use("android.webkit.WebView");

    function wrap(ov, label) {
        ov.implementation = function () {
            var args = Array.prototype.slice.call(arguments);
            try {
                var u = String(args[0] || "");
                console.log("[" + label + "] " + u);
                if (u.indexOf("@") !== -1) {
                    console.log("  ^ contains '@' — possible userinfo host bypass: " +
                                "host would be '" + u.split("@").pop().split("/")[0] + "'");
                }
            } catch (e) {}
            return ov.apply(this, args);
        };
    }

    WebView.loadUrl.overloads.forEach(function (ov) { wrap(ov, "loadUrl"); });

    try {
        var ldu = WebView.loadDataWithBaseURL;
        if (ldu) {
            ldu.overloads.forEach(function (ov) {
                ov.implementation = function () {
                    var a = Array.prototype.slice.call(arguments);
                    console.log("[loadDataWithBaseURL] base=" + a[1] + " len=" + String(a[0] || "").length);
                    return ov.apply(this, a);
                };
            });
        }
    } catch (e) {}

    console.log("[webview-logger] ready — fire a deeplink now");
});
