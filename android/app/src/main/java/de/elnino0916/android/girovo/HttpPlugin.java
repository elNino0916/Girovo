package de.elnino0916.android.girovo;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.NoRouteToHostException;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.security.cert.CertificateException;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLHandshakeException;
import javax.net.ssl.SSLPeerUnverifiedException;

/**
 * The server's requests to other hosts — the bank's FinTS endpoint, Brandfetch
 * — sent by Android's own HTTPS stack, which the WebView's CORS rules do not
 * bind (mobile/server/fetch.ts).
 *
 * Two steps, like fetch: open() answers once the head is in, body() with the
 * rest. lib/bank-fetch.ts gives a bank a minute to start answering and then
 * as long as its answer takes to arrive; it can only do that because the head
 * comes on its own.
 *
 * Only https, with the system's certificate store and nothing else trusted.
 * Errors carry the codes Node's fetch reports (ENOTFOUND, ECONNREFUSED, …), so
 * lib/bank-fetch.ts turns them into the same sentences as on the desktop.
 */
@CapacitorPlugin(name = "GirovoHttp")
public class HttpPlugin extends Plugin {

    private static final int CONNECT_TIMEOUT_MS = 30_000;
    /**
     * Silence while reading: up to the first byte of the answer, the minute
     * lib/bank-fetch.ts gives a bank to start answering (FIRST_BYTE_MS), and
     * any later pause as long. Timed here, by the app's own process, rather
     * than by a timer in the page: the page's timers do not run while it is
     * in the background, and one that fires late on the way back would end a
     * request the bank had long answered (mobile/server/fetch.ts).
     */
    private static final int READ_TIMEOUT_MS = 60_000;

    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<String, HttpURLConnection> connections = new ConcurrentHashMap<>();
    private final Set<String> cancelled = ConcurrentHashMap.newKeySet();

    @PluginMethod
    public void open(PluginCall call) {
        String id = call.getString("id");
        String url = call.getString("url");
        String method = call.getString("method", "GET");
        JSObject headers = call.getObject("headers", new JSObject());
        String body = call.getString("body");
        if (id == null || url == null) {
            call.reject("id and url are required", "EUNKNOWN");
            return;
        }
        pool.execute(() -> {
            HttpURLConnection connection = null;
            try {
                URL target = new URL(url);
                if (!"https".equalsIgnoreCase(target.getProtocol())) {
                    call.reject("only https leaves the app", "ERR_TLS_REQUIRED");
                    return;
                }
                connection = (HttpsURLConnection) target.openConnection();
                connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
                connection.setReadTimeout(READ_TIMEOUT_MS);
                connection.setUseCaches(false);
                connection.setRequestMethod(method);
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    connection.setRequestProperty(key, headers.getString(key));
                }
                connections.put(id, connection);
                if (cancelled.remove(id)) {
                    connection.disconnect();
                    connections.remove(id);
                    call.reject("cancelled", "ECANCELED");
                    return;
                }
                if (body != null) {
                    byte[] bytes = Base64.decode(body, Base64.DEFAULT);
                    connection.setDoOutput(true);
                    connection.setFixedLengthStreamingMode(bytes.length);
                    try (OutputStream out = connection.getOutputStream()) {
                        out.write(bytes);
                    }
                }
                int status = connection.getResponseCode();
                JSObject head = new JSObject();
                head.put("status", status);
                head.put("statusText", connection.getResponseMessage() == null ? "" : connection.getResponseMessage());
                JSObject responseHeaders = new JSObject();
                for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
                    if (entry.getKey() == null || entry.getValue() == null) continue; // the status line
                    responseHeaders.put(entry.getKey().toLowerCase(java.util.Locale.ROOT), String.join(", ", entry.getValue()));
                }
                head.put("headers", responseHeaders);
                call.resolve(head);
            } catch (Exception e) {
                if (connection != null) connection.disconnect();
                connections.remove(id);
                call.reject(describe(e), codeOf(e));
            }
        });
    }

    @PluginMethod
    public void body(PluginCall call) {
        String id = call.getString("id");
        HttpURLConnection connection = id == null ? null : connections.get(id);
        if (connection == null) {
            call.reject("no open request " + id, "ECANCELED");
            return;
        }
        pool.execute(() -> {
            try {
                InputStream in;
                try {
                    in = connection.getResponseCode() >= 400 ? connection.getErrorStream() : connection.getInputStream();
                } catch (IOException e) {
                    in = connection.getErrorStream();
                }
                byte[] bytes = in == null ? new byte[0] : readAll(in);
                JSObject result = new JSObject();
                result.put("body", Base64.encodeToString(bytes, Base64.NO_WRAP));
                call.resolve(result);
            } catch (Exception e) {
                call.reject(describe(e), cancelled.remove(id) ? "ECANCELED" : codeOf(e));
            } finally {
                connection.disconnect();
                connections.remove(id);
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");
        if (id != null) {
            HttpURLConnection connection = connections.remove(id);
            if (connection != null) {
                cancelled.add(id);
                pool.execute(connection::disconnect);
            } else {
                cancelled.add(id); // open() has not got as far as connecting
            }
        }
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        for (HttpURLConnection connection : connections.values()) connection.disconnect();
        connections.clear();
        pool.shutdownNow();
    }

    private static byte[] readAll(InputStream in) throws IOException {
        try (InputStream stream = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            int n;
            while ((n = stream.read(buffer)) != -1) out.write(buffer, 0, n);
            return out.toByteArray();
        }
    }

    private static String describe(Exception e) {
        String message = e.getMessage();
        return e.getClass().getSimpleName() + (message == null ? "" : ": " + message);
    }

    /** The error code Node's fetch would have reported for the same failure. */
    static String codeOf(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof UnknownHostException) return "ENOTFOUND";
            if (t instanceof NoRouteToHostException) return "EHOSTUNREACH";
            if (t instanceof ConnectException) return "ECONNREFUSED";
            if (t instanceof SocketTimeoutException) return "ETIMEDOUT";
            if (t instanceof CertificateException || t instanceof SSLPeerUnverifiedException) return "CERT_INVALID";
            if (t instanceof SSLHandshakeException) {
                // A certificate the system does not trust shows up as a handshake
                // failure caused by a CertificateException; anything else broke
                // the connection itself.
                for (Throwable c = t.getCause(); c != null; c = c.getCause()) {
                    if (c instanceof CertificateException) return "CERT_INVALID";
                }
                return "ECONNRESET";
            }
            if (t instanceof SocketException) return "ECONNRESET";
        }
        return "EUNKNOWN";
    }
}
