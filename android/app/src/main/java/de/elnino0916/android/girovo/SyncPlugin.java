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
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Sync "Direkt im WLAN" (lib/sync-stores.ts): the phone's way to the desktop
 * app's file shelf (electron/sync-lan.cjs), one GET or PUT of a sealed file.
 *
 * Plain HTTP over a socket of its own: the app's network rules allow no
 * cleartext at all, and should not for anything else — this goes only to a
 * private address, a port above 1024 and the shelf's own path, and what it
 * carries was sealed with the group's key before it left the page.
 */
@CapacitorPlugin(name = "GirovoSync")
public class SyncPlugin extends Plugin {
    private static final Pattern PRIVATE = Pattern.compile(
            "^(10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|192\\.168\\.\\d{1,3}\\.\\d{1,3}|172\\.(1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3})$");
    private static final String PATH = "/girovo-sync/v1/";
    private static final int CONNECT_MS = 4_000;
    private static final int READ_MS = 30_000;
    private static final int MAX_BYTES = 64 * 1024 * 1024;

    @PluginMethod
    public void lan(PluginCall call) {
        try {
            String method = call.getString("method", "GET");
            URI uri = new URI(call.getString("url", ""));
            String host = uri.getHost();
            int port = uri.getPort();
            String path = uri.getRawPath();
            if (!"http".equals(uri.getScheme()) || host == null || !PRIVATE.matcher(host).matches()
                    || port < 1024 || port > 65535 || path == null || !path.startsWith(PATH) || path.contains("..")
                    || !("GET".equals(method) || "PUT".equals(method))) {
                call.reject("not the desktop app's shelf", "invalid");
                return;
            }
            String body64 = call.getString("body", "");
            byte[] body = body64 == null || body64.isEmpty() ? new byte[0] : Base64.decode(body64, Base64.DEFAULT);
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(host, port), CONNECT_MS);
                socket.setSoTimeout(READ_MS);
                OutputStream out = socket.getOutputStream();
                String head = method + " " + path + " HTTP/1.1\r\n"
                        + "Host: " + host + ":" + port + "\r\n"
                        + "Connection: close\r\n"
                        + "Content-Type: application/octet-stream\r\n"
                        + "Content-Length: " + body.length + "\r\n\r\n";
                out.write(head.getBytes(StandardCharsets.US_ASCII));
                out.write(body);
                out.flush();
                byte[] answer = readAll(socket.getInputStream());
                int split = indexOf(answer, new byte[] { '\r', '\n', '\r', '\n' });
                if (split < 0) throw new IOException("no answer");
                String[] lines = new String(answer, 0, split, StandardCharsets.US_ASCII).split("\r\n");
                String[] status = lines[0].split(" ");
                if (status.length < 2 || !status[0].startsWith("HTTP/1.")) throw new IOException("not HTTP");
                int code = Integer.parseInt(status[1]);
                int length = answer.length - split - 4;
                boolean chunked = false;
                for (String line : lines) {
                    String lower = line.toLowerCase(Locale.ROOT);
                    if (lower.startsWith("content-length:")) length = Math.min(length, Integer.parseInt(line.substring(15).trim()));
                    if (lower.startsWith("transfer-encoding:") && lower.contains("chunked")) chunked = true;
                }
                byte[] received = chunked ? unchunk(answer, split + 4) : java.util.Arrays.copyOfRange(answer, split + 4, split + 4 + Math.max(0, length));
                JSObject result = new JSObject();
                result.put("status", code);
                result.put("body", Base64.encodeToString(received, Base64.NO_WRAP));
                call.resolve(result);
            }
        } catch (Exception e) {
            call.reject("the desktop app is not reachable", "unreachable");
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
            if (out.size() > MAX_BYTES + 4096) throw new IOException("too large");
        }
        return out.toByteArray();
    }

    /** An answer sent in chunks, put back together (the shelf sends a length; anything else might not). */
    private static byte[] unchunk(byte[] data, int from) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int at = from;
        while (true) {
            int eol = indexOf(java.util.Arrays.copyOfRange(data, at, data.length), new byte[] { '\r', '\n' });
            if (eol < 0) throw new IOException("bad chunk");
            String sizeLine = new String(data, at, eol, StandardCharsets.US_ASCII).split(";")[0].trim();
            int size = Integer.parseInt(sizeLine, 16);
            at += eol + 2;
            if (size == 0) return out.toByteArray();
            if (at + size > data.length) throw new IOException("short chunk");
            out.write(data, at, size);
            at += size + 2;
        }
    }

    private static int indexOf(byte[] data, byte[] pattern) {
        outer:
        for (int i = 0; i <= data.length - pattern.length; i++) {
            for (int j = 0; j < pattern.length; j++) if (data[i + j] != pattern[j]) continue outer;
            return i;
        }
        return -1;
    }
}
