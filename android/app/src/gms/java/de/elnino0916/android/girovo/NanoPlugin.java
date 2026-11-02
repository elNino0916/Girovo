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
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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
 *
 * A question from "Frag deine Umsätze" (lib/nano-ask.ts) is the other use:
 * one prompt, its answer a line of JSON the page reads into a filter. It has
 * a worker of its own, so it never waits behind a batch of bookings — AICore
 * takes one at a time, and calls the other busy until it is free.
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
    private final ExecutorService questions = Executors.newSingleThreadExecutor();
    private final ExecutorService side = Executors.newSingleThreadExecutor();
    /**
     * AICore's download, on a thread of its own: it waits until AICore is
     * done, which may be never (a Xiaomi 17 Ultra offered Nano and did not
     * start for hours) — the status checks on `side` must not wait behind it.
     */
    private final ExecutorService downloads = Executors.newSingleThreadExecutor();
    private final Object resumed = new Object();
    private final AtomicBoolean downloading = new AtomicBoolean(false);
    private volatile boolean foreground = true;
    /** The variant chosen by the last status check (chooseModel), and its name for Einstellungen. */
    private volatile GenerativeModelFutures model;
    private volatile String variant;
    /**
     * The variant questions go to: of those AICore has, the newest Nano
     * generation ("nano-v4-…" over "nano-v3-…"), so a phone that carries v4
     * in any variant can ask. Its model name, for the page's v4 check.
     */
    private volatile GenerativeModelFutures askModel;
    private volatile String askModelName;

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
        questions.shutdownNow();
        downloads.shutdownNow();
        side.shutdownNow();
    }

    private boolean fake() {
        return BuildConfig.DEBUG && new File(getContext().getFilesDir(), FAKE_FLAG).exists();
    }

    /**
     * The variants AICore may offer, in the order Girovo wants them: the
     * calibration's (fast, released — what the S26 had at once, where the
     * default client waited forever for a download), then the full model, then
     * the preview stage. Phones differ in which they carry: a Xiaomi 17 Ultra
     * on HyperOS 3 answered "unsupported" for the fast released one alone.
     */
    private static final int[][] VARIANTS = {
        {ModelPreference.FAST, ModelReleaseStage.STABLE},
        {ModelPreference.FULL, ModelReleaseStage.STABLE},
        {ModelPreference.FAST, ModelReleaseStage.PREVIEW},
        {ModelPreference.FULL, ModelReleaseStage.PREVIEW},
    };

    private static GenerativeModelFutures clientFor(int preference, int stage) {
        ModelConfig.Builder m = new ModelConfig.Builder();
        m.setPreference(preference);
        m.setReleaseStage(stage);
        GenerationConfig.Builder g = new GenerationConfig.Builder();
        g.setModelConfig(m.build());
        return GenerativeModelFutures.from(Generation.INSTANCE.getClient(g.build()));
    }

    private static String labelOf(int[] v) {
        return (v[0] == ModelPreference.FAST ? "fast" : "full") + "/" + (v[1] == ModelReleaseStage.STABLE ? "stable" : "preview");
    }

    /** The model to ask: the variant the status check chose, or the calibration's until one has run. */
    private GenerativeModelFutures model() {
        GenerativeModelFutures m = model;
        if (m != null) return m;
        chooseModel();
        if (model == null) model = clientFor(VARIANTS[0][0], VARIANTS[0][1]);
        return model;
    }

    /** What AICore answered for each variant, for a phone without Nano to say ("fast/stable: unavailable · …"). */
    private volatile String probed = "";
    /** The most telling error AICore gave, for the reason Einstellungen names. */
    private volatile int probeError = GenAiException.ErrorCode.UNKNOWN;

    /**
     * Asks AICore about every variant, in order, and takes the first one that
     * is there — or, with none there, the first it is fetching or offers to
     * fetch. The answer: that variant's FeatureStatus, or -1 with none at all.
     * Of the variants there, the newest generation becomes the questions' model.
     */
    private synchronized int chooseModel() {
        int bestStatus = -1;
        GenerativeModelFutures best = null;
        String bestLabel = null;
        GenerativeModelFutures newest = null;
        String newestName = null;
        int newestGen = -1;
        StringBuilder said = new StringBuilder();
        probeError = GenAiException.ErrorCode.UNKNOWN;
        for (int[] v : VARIANTS) {
            String label = labelOf(v);
            GenerativeModelFutures m;
            int st;
            try {
                m = clientFor(v[0], v[1]);
                st = m.checkStatus().get(20, TimeUnit.SECONDS);
            } catch (ExecutionException e) {
                int code = codeOf(e);
                if (code == GenAiException.ErrorCode.NEEDS_SYSTEM_UPDATE || code == GenAiException.ErrorCode.AICORE_INCOMPATIBLE) probeError = code;
                said.append(said.length() > 0 ? " · " : "").append(label).append(": error ").append(code);
                continue;
            } catch (Throwable e) {
                said.append(said.length() > 0 ? " · " : "").append(label).append(": ").append(e.getClass().getSimpleName());
                continue;
            }
            said.append(said.length() > 0 ? " · " : "").append(label).append(": ").append(statusName(st));
            if (st == FeatureStatus.AVAILABLE) {
                String name = baseName(m);
                int gen = generationOf(name);
                if (name != null) said.append(" (").append(name).append(")");
                if (gen > newestGen) {
                    newest = m;
                    newestName = name;
                    newestGen = gen;
                }
                if (bestStatus != FeatureStatus.AVAILABLE) {
                    best = m;
                    bestLabel = label;
                    bestStatus = st;
                }
                continue;
            }
            if (bestStatus == FeatureStatus.AVAILABLE) continue;
            // Fetching beats offering; the earlier variant wins a tie.
            int rank = st == FeatureStatus.DOWNLOADING ? 2 : st == FeatureStatus.DOWNLOADABLE ? 1 : 0;
            int bestRank = bestStatus == FeatureStatus.DOWNLOADING ? 2 : bestStatus == FeatureStatus.DOWNLOADABLE ? 1 : 0;
            if (rank > bestRank) {
                best = m;
                bestLabel = label;
                bestStatus = st;
            }
        }
        probed = said.toString();
        Log.i(TAG, "variants: " + probed + (bestLabel != null ? " → " + bestLabel : ""));
        if (best != null) {
            model = best;
            variant = bestLabel;
        }
        askModel = newest;
        askModelName = newestName;
        return best != null ? bestStatus : -1;
    }

    /** AICore's name for a variant's model ("nano-v4-fast"), or null when it does not say. */
    private static String baseName(GenerativeModelFutures m) {
        try {
            return m.getBaseModelName().get(10, TimeUnit.SECONDS);
        } catch (Throwable e) {
            return null;
        }
    }

    private static final Pattern GENERATION = Pattern.compile("nano[-_ ]?v(\\d+)", Pattern.CASE_INSENSITIVE);

    /** The generation in a model name ("nano-v4-fast" → 4); 0 for a name without one, -1 for none. */
    static int generationOf(String name) {
        if (name == null) return -1;
        Matcher g = GENERATION.matcher(name);
        return g.find() ? Integer.parseInt(g.group(1)) : 0;
    }

    /** The model questions go to: the newest generation the last status check found, else the categories' model. */
    private GenerativeModelFutures askModel() {
        if (askModel == null) chooseModel();
        return askModel != null ? askModel : model();
    }

    private static String statusName(int st) {
        if (st == FeatureStatus.AVAILABLE) return "available";
        if (st == FeatureStatus.DOWNLOADING) return "downloading";
        if (st == FeatureStatus.DOWNLOADABLE) return "downloadable";
        if (st == FeatureStatus.UNAVAILABLE) return "unavailable";
        return "status " + st;
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
            out.put("askModel", "nano-v4-fake");
            return out;
        }
        try {
            int st = chooseModel();
            if (st == FeatureStatus.AVAILABLE) {
                out.put("state", "available");
                // The names are for Einstellungen, and for "Frag deine Umsätze", which needs v4.
                String name = baseName(model());
                if (name != null) out.put("model", name);
                if (askModelName != null) out.put("askModel", askModelName);
            } else if (st == FeatureStatus.DOWNLOADING || downloading.get()) {
                out.put("state", "downloading");
            } else if (st == FeatureStatus.DOWNLOADABLE) {
                out.put("state", "downloadable");
            } else {
                int code = probeError;
                out.put("state", "unsupported");
                out.put("reason", code == GenAiException.ErrorCode.NEEDS_SYSTEM_UPDATE ? "update"
                    : code == GenAiException.ErrorCode.AICORE_INCOMPATIBLE ? "aicore" : "unavailable");
            }
        } catch (Throwable e) {
            // No AICore at all, or a phone ML Kit's GenAI does not know.
            Log.w(TAG, "status: " + e);
            out.put("state", "unsupported");
            out.put("reason", "unavailable");
        }
        if (variant != null) out.put("variant", variant);
        // What AICore said of each variant: for a phone without Nano to show, and to report.
        if (!probed.isEmpty()) out.put("probed", probed);
        return out;
    }

    /**
     * Asks AICore to fetch Nano where it is downloadable. AICore keeps the
     * model for every app and decides when it comes (it may wait for Wi-Fi or
     * charging, or not start at all for hours); "download" events tell how
     * far it is, and carry `started` once AICore has begun.
     */
    @PluginMethod
    public void download(PluginCall call) {
        if (fake() || !downloading.compareAndSet(false, true)) {
            call.resolve(statusNow());
            return;
        }
        downloads.execute(() -> {
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
        // Only AICore's own callbacks make these: it has begun.
        e.put("started", true);
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
                String answer = fake() ? fakeAnswer(item.optString("text")) : ask(model(), system, prefix + item.optString("text"), 24, true);
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

    /**
     * One question: { system, text, maxTokens } → { text: answer | null }, on
     * its own worker. Its waits are its own too: the bookings' progress line
     * never shows them.
     */
    @PluginMethod
    public void prompt(PluginCall call) {
        String system = call.getString("system", "");
        String text = call.getString("text", "");
        int maxTokens = Math.max(8, Math.min(256, call.getInt("maxTokens", 96)));
        questions.execute(() -> {
            String answer = fake() ? fakeQuestion(text) : ask(askModel(), system, text, maxTokens, false);
            JSObject out = new JSObject();
            out.put("text", answer == null ? JSONObject.NULL : answer);
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
     * answer), of `to` — the categories' model or the questions'. Null only
     * after an error AICore calls final. `report` names the waits in the
     * bookings' progress — a question's are not theirs.
     */
    private String ask(GenerativeModelFutures to, String system, String text, int maxTokens, boolean report) {
        int busyMs = BUSY_FIRST_MS;
        int finals = 0;
        while (!Thread.currentThread().isInterrupted()) {
            if (!foreground) {
                if (report) setWaiting("background");
                awaitForeground();
                continue;
            }
            try {
                GenerateContentRequest.Builder b = new GenerateContentRequest.Builder(new SystemInstruction(system), new TextPart(text));
                b.setTemperature(0f);
                b.setTopK(1);
                b.setSeed(0);
                b.setCandidateCount(1);
                b.setMaxOutputTokens(maxTokens);
                GenerateContentResponse r = to.generateContent(b.build()).get(60, TimeUnit.SECONDS);
                List<Candidate> candidates = r.getCandidates();
                String answer = candidates.isEmpty() ? "" : candidates.get(0).getText();
                return answer == null ? "" : answer.trim();
            } catch (ExecutionException e) {
                int code = codeOf(e);
                if (code == GenAiException.ErrorCode.BACKGROUND_USE_BLOCKED) {
                    // The pause may not have reached this plugin yet.
                    if (report) setWaiting("background");
                    if (foreground) sleep(1000); else awaitForeground();
                } else if (code == GenAiException.ErrorCode.BUSY || code == GenAiException.ErrorCode.PER_APP_BATTERY_USE_QUOTA_EXCEEDED) {
                    if (report) setWaiting("busy");
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

    /** The emulator's question: a filter for the shop or category it names. */
    private String fakeQuestion(String text) {
        sleep(600);
        String q = text.toLowerCase();
        int at = q.lastIndexOf("frage:");
        if (at >= 0) q = q.substring(at);
        String search = q.contains("amazon") ? "\"Amazon\"" : "null";
        String category = q.contains("lebensmittel") ? "\"groceries\"" : "null";
        return "{\"art\":\"summe\",\"richtung\":\"aus\",\"kategorie\":" + category + ",\"suche\":" + search + "}";
    }

    private static void deleteTree(File f) {
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteTree(c);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
