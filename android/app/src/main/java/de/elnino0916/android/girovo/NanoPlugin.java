package de.elnino0916.android.girovo;

import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.genai.common.DownloadCallback;
import com.google.mlkit.genai.common.FeatureStatus;
import com.google.mlkit.genai.common.GenAiException;
import com.google.mlkit.genai.prompt.Candidate;
import com.google.mlkit.genai.prompt.GenerateContentRequest;
import com.google.mlkit.genai.prompt.GenerateContentResponse;
import com.google.mlkit.genai.prompt.Generation;
import com.google.mlkit.genai.prompt.GenerationConfig;
import com.google.mlkit.genai.prompt.ModelConfig;
import com.google.mlkit.genai.prompt.ModelPreference;
import com.google.mlkit.genai.prompt.ModelReleaseStage;
import com.google.mlkit.genai.prompt.SystemInstruction;
import com.google.mlkit.genai.prompt.TextPart;
import com.google.mlkit.genai.prompt.java.GenerativeModelFutures;

import org.json.JSONObject;

import java.io.File;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Gemini Nano on the phone, through Android AICore and ML Kit's Prompt API:
 * the category guess for bookings the keyword rules miss
 * (mobile/server/categories.ts builds the prompts, lib/nano-categories.ts
 * reads the answers). Nothing leaves the phone — AICore runs the model
 * on-device, for every app that asks.
 *
 * Phones without AICore or without Nano get none: the keyword rules decide
 * alone there, and Einstellungen says so ("Nicht unterstütztes Telefon").
 *
 * AICore rations its model. Under sustained use about every 14th request is
 * refused as busy ("out of usage quota"), and none is served while the app is
 * in the background. Both are waits, not failures: a booking is asked again
 * until it has an answer — after a growing pause when busy, after the user's
 * return when in the background. Only an error AICore itself calls final
 * ends a booking without one, after a few tries.
 *
 * Batches queue on one worker, one booking at a time (AICore runs one
 * anyway), and the page hears how far the queue is ("progress").
 */
@CapacitorPlugin(name = "GirovoNano")
public class NanoPlugin extends Plugin {

    private static final String TAG = "GirovoNano";
    /** What the e5 model left in the app's storage before Nano replaced it (ModelPlugin, ≤ 5.6). */
    private static final String OLD_MODEL_DIR = "category-model";
    /** A debug build with this file in its files folder runs a stand-in model: the emulator has no AICore. */
    private static final String FAKE_FLAG = "nano-fake";

    private static final int BUSY_FIRST_MS = 2000;
    private static final int BUSY_MAX_MS = 16000;
    /** Tries for an error AICore does not call a wait (a request it cannot take, an inner fault). */
    private static final int FINAL_TRIES = 3;

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService side = Executors.newSingleThreadExecutor();
    private final Object resumed = new Object();
    private final AtomicBoolean downloading = new AtomicBoolean(false);
    private volatile boolean foreground = true;
    private volatile GenerativeModelFutures model;

    // The queue's progress, across every batch waiting on the worker.
    private int total = 0;
    private int done = 0;
    /** "busy" or "background" while a booking waits for AICore, else null. */
    private String waiting = null;

    @Override
    public void load() {
        // Nano replaces the e5 download: its 280 MB go, once.
        side.execute(() -> {
            File old = new File(getContext().getFilesDir(), OLD_MODEL_DIR);
            if (old.exists()) {
                deleteTree(old);
                Log.i(TAG, "removed the old category model");
            }
        });
    }

    @Override
    protected void handleOnResume() {
        foreground = true;
        synchronized (resumed) {
            resumed.notifyAll();
        }
    }

    @Override
    protected void handleOnPause() {
        foreground = false;
    }

    @Override
    protected void handleOnDestroy() {
        worker.shutdownNow();
        side.shutdownNow();
    }

    private boolean fake() {
        return BuildConfig.DEBUG && new File(getContext().getFilesDir(), FAKE_FLAG).exists();
    }

    /** The fast variant, released: what the S26 had at once, where the default client waited forever for a download. */
    private GenerativeModelFutures model() {
        if (model == null) {
            ModelConfig.Builder m = new ModelConfig.Builder();
            m.setPreference(ModelPreference.FAST);
            m.setReleaseStage(ModelReleaseStage.STABLE);
            GenerationConfig.Builder g = new GenerationConfig.Builder();
            g.setModelConfig(m.build());
            model = GenerativeModelFutures.from(Generation.INSTANCE.getClient(g.build()));
        }
        return model;
    }

    // ---------------------------------------------------------------------
    // Whether this phone has Nano

    /** available · downloadable · downloading · unsupported, with the model's name or the reason. */
    @PluginMethod
    public void status(PluginCall call) {
        side.execute(() -> call.resolve(statusNow()));
    }

    private JSObject statusNow() {
        JSObject out = new JSObject();
        if (fake()) {
            out.put("state", "available");
            out.put("model", "fake");
            return out;
        }
        try {
            int st = model().checkStatus().get(20, TimeUnit.SECONDS);
            if (st == FeatureStatus.AVAILABLE) {
                out.put("state", "available");
                try {
                    out.put("model", model().getBaseModelName().get(10, TimeUnit.SECONDS));
                } catch (Exception ignored) {
                    // The name is for Einstellungen only.
                }
            } else if (st == FeatureStatus.DOWNLOADING || downloading.get()) {
                out.put("state", "downloading");
            } else if (st == FeatureStatus.DOWNLOADABLE) {
                out.put("state", "downloadable");
            } else {
                out.put("state", "unsupported");
                out.put("reason", "unavailable");
            }
        } catch (ExecutionException e) {
            int code = codeOf(e);
            out.put("state", "unsupported");
            out.put("reason", code == GenAiException.ErrorCode.NEEDS_SYSTEM_UPDATE ? "update"
                : code == GenAiException.ErrorCode.AICORE_INCOMPATIBLE ? "aicore" : "unavailable");
        } catch (Throwable e) {
            // No AICore at all, or a phone ML Kit's GenAI does not know.
            Log.w(TAG, "status: " + e);
            out.put("state", "unsupported");
            out.put("reason", "unavailable");
        }
        return out;
    }

    /**
     * Asks AICore to fetch Nano where it is downloadable. AICore keeps the
     * model for every app and decides when it comes (it may wait for Wi-Fi or
     * charging); "download" events tell how far it is.
     */
    @PluginMethod
    public void download(PluginCall call) {
        if (fake() || !downloading.compareAndSet(false, true)) {
            call.resolve(statusNow());
            return;
        }
        side.execute(() -> {
            try {
                final long[] size = {0};
                model().download(new DownloadCallback() {
                    @Override public void onDownloadStarted(long bytes) {
                        size[0] = bytes;
                        notifyListeners("download", downloadEvent(0, bytes));
                    }
                    @Override public void onDownloadProgress(long bytes) {
                        notifyListeners("download", downloadEvent(bytes, size[0]));
                    }
                    @Override public void onDownloadCompleted() { }
                    @Override public void onDownloadFailed(GenAiException e) {
                        Log.w(TAG, "download failed: " + e.getErrorCode() + " " + e.getMessage());
                    }
                }).get();
            } catch (Throwable e) {
                Log.w(TAG, "download: " + e);
            } finally {
                downloading.set(false);
                JSObject now = statusNow();
                notifyListeners("download", now);
                call.resolve(now);
            }
        });
    }

    private static JSObject downloadEvent(long received, long total) {
        JSObject e = new JSObject();
        e.put("state", "downloading");
        e.put("received", received);
        e.put("total", total);
        return e;
    }

    // ---------------------------------------------------------------------
    // Asking

    /**
     * One batch: { system, prefix, items: [{ id, text }] } → { answers: { id: text | null } }.
     * Each prompt is prefix + text — the fixed category list once over the bridge, not per booking.
     */
    @PluginMethod
    public void classify(PluginCall call) {
        String system = call.getString("system", "");
        String prefix = call.getString("prefix", "");
        JSArray items = call.getArray("items", new JSArray());
        int n = items.length();
        synchronized (this) {
            total += n;
        }
        emitProgress();
        worker.execute(() -> {
            JSObject answers = new JSObject();
            for (int i = 0; i < n; i++) {
                JSONObject item = items.optJSONObject(i);
                if (item == null) continue;
                String id = item.optString("id");
                String answer = fake() ? fakeAnswer(item.optString("text")) : ask(system, prefix + item.optString("text"));
                answers.put(id, answer == null ? JSONObject.NULL : answer);
                synchronized (this) {
                    done++;
                    waiting = null;
                }
                emitProgress();
            }
            synchronized (this) {
                // The queue is empty: the next batch counts from nought.
                if (done >= total) {
                    done = 0;
                    total = 0;
                }
            }
            emitProgress();
            JSObject out = new JSObject();
            out.put("answers", answers);
            call.resolve(out);
        });
    }

    /** How far the queue is, for a page that starts listening mid-way. */
    @PluginMethod
    public void progress(PluginCall call) {
        call.resolve(progressNow());
    }

    private synchronized JSObject progressNow() {
        JSObject p = new JSObject();
        p.put("active", total > 0 && done < total);
        p.put("done", done);
        p.put("total", total);
        p.put("waiting", waiting == null ? JSONObject.NULL : waiting);
        return p;
    }

    private void emitProgress() {
        notifyListeners("progress", progressNow());
    }

    private void setWaiting(String why) {
        boolean changed;
        synchronized (this) {
            changed = !why.equals(waiting);
            waiting = why;
        }
        if (changed) emitProgress();
    }

    /**
     * Nano's answer to one prompt, asked until AICore gives one: the
     * settings the calibration used (temperature 0, top 1, seed 0, a short
     * answer). Null only after an error AICore calls final.
     */
    private String ask(String system, String text) {
        int busyMs = BUSY_FIRST_MS;
        int finals = 0;
        while (!Thread.currentThread().isInterrupted()) {
            if (!foreground) {
                setWaiting("background");
                awaitForeground();
                continue;
            }
            try {
                GenerateContentRequest.Builder b = new GenerateContentRequest.Builder(new SystemInstruction(system), new TextPart(text));
                b.setTemperature(0f);
                b.setTopK(1);
                b.setSeed(0);
                b.setCandidateCount(1);
                b.setMaxOutputTokens(24);
                GenerateContentResponse r = model().generateContent(b.build()).get(60, TimeUnit.SECONDS);
                List<Candidate> candidates = r.getCandidates();
                String answer = candidates.isEmpty() ? "" : candidates.get(0).getText();
                return answer == null ? "" : answer.trim();
            } catch (ExecutionException e) {
                int code = codeOf(e);
                if (code == GenAiException.ErrorCode.BACKGROUND_USE_BLOCKED) {
                    // The pause may not have reached this plugin yet.
                    setWaiting("background");
                    if (foreground) sleep(1000); else awaitForeground();
                } else if (code == GenAiException.ErrorCode.BUSY || code == GenAiException.ErrorCode.PER_APP_BATTERY_USE_QUOTA_EXCEEDED) {
                    setWaiting("busy");
                    sleep(busyMs);
                    busyMs = Math.min(busyMs * 2, BUSY_MAX_MS);
                } else {
                    Log.w(TAG, "ask: error " + code + " " + e.getCause());
                    if (++finals >= FINAL_TRIES) return null;
                    sleep(BUSY_FIRST_MS);
                }
            } catch (TimeoutException e) {
                Log.w(TAG, "ask: no answer within a minute");
                if (++finals >= FINAL_TRIES) return null;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } catch (Throwable e) {
                Log.w(TAG, "ask: " + e);
                if (++finals >= FINAL_TRIES) return null;
                sleep(BUSY_FIRST_MS);
            }
        }
        return null;
    }

    private void awaitForeground() {
        synchronized (resumed) {
            while (!foreground && !Thread.currentThread().isInterrupted()) {
                try {
                    resumed.wait(30_000);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }
    }

    private static int codeOf(Throwable e) {
        Throwable cause = e instanceof ExecutionException && e.getCause() != null ? e.getCause() : e;
        return cause instanceof GenAiException ? ((GenAiException) cause).getErrorCode() : GenAiException.ErrorCode.UNKNOWN;
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    // ---------------------------------------------------------------------
    // The emulator's stand-in

    private int fakeAsked = 0;

    /** No AICore on an emulator: answers after a Nano-like pause, refuses like AICore does — busy now and then, never in the background. */
    private String fakeAnswer(String text) {
        while (true) {
            if (!foreground) {
                setWaiting("background");
                awaitForeground();
                continue;
            }
            sleep(240);
            if (++fakeAsked % 14 == 0) {
                setWaiting("busy");
                sleep(BUSY_FIRST_MS);
                continue;
            }
            String booking = text.toLowerCase();
            return booking.contains("markt") ? "groceries" : booking.contains("abo") ? "media" : "NONE";
        }
    }

    private static void deleteTree(File f) {
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteTree(c);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
