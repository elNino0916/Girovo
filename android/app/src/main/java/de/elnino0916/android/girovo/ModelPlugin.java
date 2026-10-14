package de.elnino0916.android.girovo;

import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.LongBuffer;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;

/**
 * The category model (lib/category-model.ts) on the phone: an optional
 * download — 280 MB is too much to ship to everyone — run with ONNX Runtime.
 *
 * The download takes the files the desktop build bundles, from the same
 * pinned Hugging Face revision, and keeps each only when its size and digest
 * match what the app expects (scripts/category-models.json: SHA-256 for the
 * big files, the git blob id for the small ones). Until every file has
 * checked out, the model counts as absent and the keyword rules decide alone.
 *
 * The run answers what lib/category-model.ts needs from it — each text's
 * hidden states summed over its real tokens — so the 768-wide state of every
 * token never has to cross the bridge (mobile/shims/onnxruntime.ts).
 */
@CapacitorPlugin(name = "GirovoModel")
public class ModelPlugin extends Plugin {

    private static final String DIR = "category-model";
    /** Written last, once every file checked out. */
    private static final String COMPLETE = ".complete";

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService downloader = Executors.newSingleThreadExecutor();
    private final AtomicBoolean downloading = new AtomicBoolean(false);
    private final AtomicBoolean cancel = new AtomicBoolean(false);
    private volatile long received = 0;
    private volatile long total = 0;

    private OrtEnvironment env;
    private OrtSession session;

    private File dir() {
        return new File(getContext().getFilesDir(), DIR);
    }

    // ---------------------------------------------------------------------
    // Files

    private JSObject status() {
        JSObject result = new JSObject();
        File dir = dir();
        boolean installed = new File(dir, COMPLETE).exists();
        JSArray files = new JSArray();
        File[] list = dir.listFiles();
        if (installed && list != null) {
            for (File f : list) {
                if (!f.isFile() || f.getName().startsWith(".") || f.getName().endsWith(".part")) continue;
                JSObject entry = new JSObject();
                entry.put("name", f.getName());
                entry.put("size", f.length());
                files.put(entry);
            }
        }
        result.put("installed", installed);
        result.put("files", files);
        result.put("downloading", downloading.get());
        result.put("received", received);
        result.put("total", total);
        return result;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void download(PluginCall call) {
        JSONArray files = call.getArray("files");
        if (files == null || files.length() == 0) {
            call.reject("no files");
            return;
        }
        if (!downloading.compareAndSet(false, true)) {
            call.reject("already downloading", "BUSY");
            return;
        }
        cancel.set(false);
        downloader.execute(() -> {
            try {
                File dir = dir();
                if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("no folder");
                new File(dir, COMPLETE).delete();
                long sum = 0;
                for (int i = 0; i < files.length(); i++) sum += files.getJSONObject(i).getLong("size");
                total = sum;
                received = 0;
                for (int i = 0; i < files.length(); i++) {
                    JSONObject file = files.getJSONObject(i);
                    fetch(dir, file);
                }
                new File(dir, COMPLETE).createNewFile();
                downloading.set(false);
                notifyListeners("progress", status());
                call.resolve(status());
            } catch (Exception e) {
                downloading.set(false);
                notifyListeners("progress", status());
                call.reject(cancel.get() ? "cancelled" : String.valueOf(e.getMessage()), cancel.get() ? "CANCELLED" : "DOWNLOAD_FAILED");
            }
        });
    }

    /** One file: streamed to "<name>.part" while its digest is computed, kept only when it matches. */
    private void fetch(File dir, JSONObject file) throws Exception {
        String name = file.getString("name");
        long size = file.getLong("size");
        String sha256 = file.optString("sha256", "");
        String gitBlob = file.optString("gitBlob", "");
        File target = new File(dir, name);
        if (target.exists() && target.length() == size && matches(target, size, sha256, gitBlob)) {
            received += size;
            notifyListeners("progress", status());
            return;
        }
        File part = new File(dir, name + ".part");
        URL url = new URL(file.getString("url"));
        if (!"https".equals(url.getProtocol())) throw new IllegalArgumentException("https only");
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setConnectTimeout(30_000);
        c.setReadTimeout(60_000);
        try {
            if (c.getResponseCode() != 200) throw new IllegalStateException(name + ": HTTP " + c.getResponseCode());
            MessageDigest digest = digestFor(size, sha256, gitBlob);
            long last = 0;
            try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                byte[] buffer = new byte[64 * 1024];
                long got = 0;
                int n;
                while ((n = in.read(buffer)) != -1) {
                    if (cancel.get()) throw new InterruptedException("cancelled");
                    out.write(buffer, 0, n);
                    digest.update(buffer, 0, n);
                    got += n;
                    received += n;
                    if (got > size) throw new IllegalStateException(name + ": larger than expected");
                    if (received - last > 1_000_000) {
                        last = received;
                        notifyListeners("progress", status());
                    }
                }
                out.getFD().sync();
                if (got != size) throw new IllegalStateException(name + ": " + got + " of " + size + " bytes");
            }
            String hex = hex(digest.digest());
            String want = sha256.isEmpty() ? gitBlob : sha256;
            if (!hex.equalsIgnoreCase(want)) throw new SecurityException(name + ": digest does not match");
            if (!part.renameTo(target)) throw new IllegalStateException(name + ": could not keep it");
        } finally {
            c.disconnect();
            part.delete();
        }
    }

    private static MessageDigest digestFor(long size, String sha256, String gitBlob) throws Exception {
        if (!sha256.isEmpty()) return MessageDigest.getInstance("SHA-256");
        if (gitBlob.isEmpty()) throw new IllegalArgumentException("no digest to check against");
        MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
        sha1.update(("blob " + size + "\0").getBytes(java.nio.charset.StandardCharsets.US_ASCII));
        return sha1;
    }

    private static boolean matches(File f, long size, String sha256, String gitBlob) {
        try (InputStream in = new java.io.FileInputStream(f)) {
            MessageDigest digest = digestFor(size, sha256, gitBlob);
            byte[] buffer = new byte[64 * 1024];
            int n;
            while ((n = in.read(buffer)) != -1) digest.update(buffer, 0, n);
            return hex(digest.digest()).equalsIgnoreCase(sha256.isEmpty() ? gitBlob : sha256);
        } catch (Exception e) {
            return false;
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format(Locale.ROOT, "%02x", b));
        return sb.toString();
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        cancel.set(true);
        call.resolve();
    }

    @PluginMethod
    public void remove(PluginCall call) {
        worker.execute(() -> {
            closeSession();
            File[] list = dir().listFiles();
            if (list != null) for (File f : list) f.delete();
            dir().delete();
            call.resolve();
        });
    }

    // ---------------------------------------------------------------------
    // Running

    @PluginMethod
    public void load(PluginCall call) {
        String name = call.getString("file", "model_quantized.onnx");
        int threads = call.getInt("threads", 2);
        worker.execute(() -> {
            try {
                if (!new File(dir(), COMPLETE).exists()) throw new IllegalStateException("model not installed");
                closeSession();
                env = OrtEnvironment.getEnvironment();
                OrtSession.SessionOptions options = new OrtSession.SessionOptions();
                options.setIntraOpNumThreads(threads);
                options.setInterOpNumThreads(1);
                session = env.createSession(new File(dir(), name).getAbsolutePath(), options);
                JSObject result = new JSObject();
                result.put("inputNames", new JSArray(new ArrayList<>(session.getInputNames())));
                result.put("outputNames", new JSArray(new ArrayList<>(session.getOutputNames())));
                call.resolve(result);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()), "LOAD_FAILED");
            }
        });
    }

    @PluginMethod
    public void embed(PluginCall call) {
        JSONArray ids = call.getArray("ids");
        JSONArray mask = call.getArray("mask");
        worker.execute(() -> {
            try {
                if (session == null) throw new IllegalStateException("model not loaded");
                int n = ids.length();
                int len = ids.getJSONArray(0).length();
                long[] idData = new long[n * len];
                long[] maskData = new long[n * len];
                for (int i = 0; i < n; i++) {
                    JSONArray row = ids.getJSONArray(i);
                    JSONArray rowMask = mask.getJSONArray(i);
                    for (int j = 0; j < len; j++) {
                        idData[i * len + j] = row.getLong(j);
                        maskData[i * len + j] = rowMask.getLong(j);
                    }
                }
                long[] shape = {n, len};
                Map<String, OnnxTensor> feeds = new HashMap<>();
                List<OnnxTensor> made = new ArrayList<>();
                try {
                    OnnxTensor idTensor = OnnxTensor.createTensor(env, LongBuffer.wrap(idData), shape);
                    OnnxTensor maskTensor = OnnxTensor.createTensor(env, LongBuffer.wrap(maskData), shape);
                    made.add(idTensor);
                    made.add(maskTensor);
                    feeds.put("input_ids", idTensor);
                    feeds.put("attention_mask", maskTensor);
                    if (session.getInputNames().contains("token_type_ids")) {
                        OnnxTensor types = OnnxTensor.createTensor(env, LongBuffer.wrap(new long[n * len]), shape);
                        made.add(types);
                        feeds.put("token_type_ids", types);
                    }
                    try (OrtSession.Result out = session.run(feeds)) {
                        float[][][] hidden = (float[][][]) out.get(0).getValue();
                        int dim = hidden[0][0].length;
                        ByteBuffer pooled = ByteBuffer.allocate(n * dim * 4).order(ByteOrder.LITTLE_ENDIAN);
                        for (int i = 0; i < n; i++) {
                            float[] sum = new float[dim];
                            for (int j = 0; j < len; j++) {
                                if (maskData[i * len + j] == 0) continue;
                                float[] h = hidden[i][j];
                                for (int k = 0; k < dim; k++) sum[k] += h[k];
                            }
                            for (int k = 0; k < dim; k++) pooled.putFloat(sum[k]);
                        }
                        JSObject result = new JSObject();
                        result.put("dim", dim);
                        result.put("pooled", Base64.encodeToString(pooled.array(), Base64.NO_WRAP));
                        call.resolve(result);
                    }
                } finally {
                    for (OnnxTensor t : made) t.close();
                }
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()), "RUN_FAILED");
            }
        });
    }

    @PluginMethod
    public void release(PluginCall call) {
        worker.execute(() -> {
            closeSession();
            call.resolve();
        });
    }

    private void closeSession() {
        if (session != null) {
            try {
                session.close();
            } catch (Exception ignored) {
                // already closed
            }
            session = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        cancel.set(true);
        worker.execute(this::closeSession);
        worker.shutdown();
        downloader.shutdownNow();
    }
}
