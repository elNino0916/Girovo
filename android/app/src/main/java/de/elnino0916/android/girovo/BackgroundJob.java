package de.elnino0916.android.girovo;

import android.annotation.SuppressLint;
import android.app.job.JobParameters;
import android.app.job.JobService;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

import javax.net.ssl.HttpsURLConnection;

/**
 * "Neue Umsätze melden" (lib/background-check.ts) every six hours, while
 * Girovo is not open: Girovo's own code — lib-fints and the check, bundled as
 * mobile-background.js (scripts/build-mobile.mjs) — in a WebView nobody sees,
 * on the page's own origin (https://localhost), so it reads the app's
 * language as the page left it.
 *
 * The WebView has no Capacitor: what that code needs comes from GirovoBg —
 * the secret and the sealed box (BackgroundState), the state folder's files
 * read-only (the remembered devices), bank requests over HTTPS, the
 * notifications, and the end of the job. Nothing is written to the state
 * folder from here.
 *
 * Skipped while the app is in front: the user's own session reads the banks
 * then.
 */
public class BackgroundJob extends JobService {
    private static final String TAG = "GirovoBackground";
    /** A job gets about ten minutes; the check ends well before. */
    private static final long WATCHDOG_MS = 8L * 60 * 1000;
    private static final int CONNECT_TIMEOUT_MS = 30_000;
    private static final int READ_TIMEOUT_MS = 60_000;
    private static final int MAX_BODY = 20 * 1024 * 1024;
    private static final String ORIGIN = "https://localhost/";
    private static final String STATE_DIR = "fints-state";

    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView web;
    private JobParameters running;

    @Override
    public boolean onStartJob(JobParameters params) {
        if (MainActivity.inFront) return false;
        running = params;
        main.post(this::start);
        main.postDelayed(() -> finish("watchdog"), WATCHDOG_MS);
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        main.post(this::teardown);
        running = null;
        return true;
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void start() {
        try {
            web = new WebView(getApplicationContext());
        } catch (RuntimeException e) {
            // No WebView on this phone right now (being updated, say).
            Log.w(TAG, "no WebView: " + e.getMessage());
            finish("no webview");
            return;
        }
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        web.addJavascriptInterface(new Bridge(), "GirovoBg");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                // The app's own files, as Capacitor serves them to the page.
                if (!"localhost".equals(request.getUrl().getHost())) return null;
                String path = request.getUrl().getPath();
                if (path == null || path.contains("..")) return null;
                try {
                    InputStream in = getAssets().open("public" + path);
                    String mime = path.endsWith(".js") ? "text/javascript" : "text/html";
                    return new WebResourceResponse(mime, "utf-8", in);
                } catch (IOException e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
                }
            }
        });
        web.loadDataWithBaseURL(ORIGIN, "<!doctype html><meta charset=utf-8><script src=\"/mobile-background.js\"></script>",
                "text/html", "utf-8", null);
    }

    private void finish(String why) {
        main.post(() -> {
            JobParameters params = running;
            running = null;
            teardown();
            if (params != null) {
                Log.i(TAG, "done: " + why);
                jobFinished(params, false);
            }
        });
    }

    private void teardown() {
        main.removeCallbacksAndMessages(null);
        if (web != null) {
            web.destroy();
            web = null;
        }
    }

    /** What mobile/background/ calls on; every method runs on the WebView's bridge thread. */
    private final class Bridge {
        @JavascriptInterface
        public String secret() {
            try {
                return BackgroundState.secret(getApplicationContext());
            } catch (Exception e) {
                return null;
            }
        }

        @JavascriptInterface
        public String readBox() {
            return BackgroundState.readBox(getApplicationContext());
        }

        @JavascriptInterface
        public void writeBox(String text) {
            BackgroundState.writeBox(getApplicationContext(), text);
        }

        /** The state folder's file names (JSON array) — the page's runtime keeps it under files/fints-state. */
        @JavascriptInterface
        public String listFiles() {
            JSONArray out = new JSONArray();
            File[] files = new File(getFilesDir(), STATE_DIR).listFiles();
            if (files != null) for (File f : files) if (f.isFile()) out.put(f.getName());
            return out.toString();
        }

        /** One file of the state folder as UTF-8 text, or null. */
        @JavascriptInterface
        public String readFile(String name) {
            if (name == null || name.isEmpty() || name.contains("/") || name.contains("\\") || name.startsWith(".")) return null;
            File file = new File(new File(getFilesDir(), STATE_DIR), name);
            if (!file.isFile() || file.length() > MAX_BODY) return null;
            try (InputStream in = new FileInputStream(file)) {
                return new String(readAll(in, MAX_BODY), StandardCharsets.UTF_8);
            } catch (IOException e) {
                return null;
            }
        }

        /**
         * One HTTPS request, answered when it is done: {url, method, headers,
         * body (base64)} → {status, statusText, headers, body (base64)} or {error, code}.
         */
        @JavascriptInterface
        public String http(String requestJson) {
            JSONObject out = new JSONObject();
            HttpsURLConnection conn = null;
            try {
                JSONObject req = new JSONObject(requestJson);
                URL url = new URL(req.getString("url"));
                if (!"https".equals(url.getProtocol())) throw new IOException("only https");
                conn = (HttpsURLConnection) url.openConnection();
                conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
                conn.setReadTimeout(READ_TIMEOUT_MS);
                conn.setInstanceFollowRedirects(false);
                conn.setRequestMethod(req.optString("method", "GET"));
                JSONObject headers = req.optJSONObject("headers");
                if (headers != null) {
                    for (Iterator<String> it = headers.keys(); it.hasNext(); ) {
                        String name = it.next();
                        conn.setRequestProperty(name, headers.optString(name));
                    }
                }
                String body = req.optString("body", "");
                if (!body.isEmpty()) {
                    byte[] bytes = Base64.decode(body, Base64.DEFAULT);
                    conn.setDoOutput(true);
                    conn.setFixedLengthStreamingMode(bytes.length);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(bytes);
                    }
                }
                int status = conn.getResponseCode();
                InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                byte[] answer = in == null ? new byte[0] : readAll(in, MAX_BODY);
                JSONObject heads = new JSONObject();
                for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
                    if (e.getKey() != null && !e.getValue().isEmpty()) heads.put(e.getKey().toLowerCase(), e.getValue().get(0));
                }
                out.put("status", status);
                out.put("statusText", conn.getResponseMessage() == null ? "" : conn.getResponseMessage());
                out.put("headers", heads);
                out.put("body", Base64.encodeToString(answer, Base64.NO_WRAP));
            } catch (Exception e) {
                try {
                    out.put("error", e.getClass().getSimpleName());
                    out.put("code", e instanceof java.net.UnknownHostException ? "ENOTFOUND"
                            : e instanceof java.net.SocketTimeoutException ? "ETIMEDOUT"
                            : e instanceof java.net.ConnectException ? "ECONNREFUSED" : "EUNKNOWN");
                } catch (Exception ignored) {
                    // a JSONObject put of a string does not fail
                }
            } finally {
                if (conn != null) conn.disconnect();
            }
            return out.toString();
        }

        @JavascriptInterface
        public void notify(String payload) {
            try {
                BackgroundState.post(getApplicationContext(), new JSONObject(payload));
            } catch (Exception e) {
                Log.w(TAG, "notify: " + e.getMessage());
            }
        }

        /** Counts only — never a bank, an amount or a name. */
        @JavascriptInterface
        public void log(String message) {
            Log.i(TAG, message == null ? "" : message.substring(0, Math.min(message.length(), 300)));
        }

        @JavascriptInterface
        public void done(String summary) {
            finish(summary == null ? "" : summary.substring(0, Math.min(summary.length(), 200)));
        }
    }

    private static byte[] readAll(InputStream in, int max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
            if (out.size() > max) throw new IOException("too large");
        }
        return out.toByteArray();
    }
}
