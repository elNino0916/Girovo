package de.elnino0916.android.girovo;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Updates for the APK from GitHub's releases (the "github" flavour), the way
 * the desktop app updates itself: mobile/bridges/updates.ts finds the newer
 * release (electron/update-logic.cjs, shared), this downloads its APK and
 * keeps it only when its size and SHA-256 are what GitHub published for it,
 * then hands it to Android's package installer — which itself refuses an APK
 * not signed with the same key as the installed app.
 *
 * The Google Play build has its own UpdaterPlugin (src/play), which leaves
 * all of this to Play.
 */
@CapacitorPlugin(name = "GirovoUpdater")
public class UpdaterPlugin extends Plugin {

    private static final String DIR = "updates";
    private static final String FILE = "girovo-update.apk";

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean cancel = new AtomicBoolean(false);
    private volatile String phase = "idle";
    private volatile long received = 0;
    private volatile long total = 0;
    private volatile String error = null;

    private File apk() {
        return new File(new File(getContext().getCacheDir(), DIR), FILE);
    }

    private JSObject state() {
        JSObject s = new JSObject();
        s.put("phase", phase);
        s.put("received", received);
        s.put("total", total);
        if (error != null) s.put("error", error);
        return s;
    }

    private void emit() {
        notifyListeners("state", state());
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String sha256 = call.getString("sha256", "");
        // Not call.getLong: Capacitor answers it only for a value that arrived
        // as a Long, and a size under 2 GB arrives as an Integer — it would
        // read 0, and every download would be refused before it began.
        long size = call.getData().optLong("size", 0L);
        if (url == null || sha256 == null || sha256.length() != 64 || size <= 0) {
            call.reject("a release file with its size and SHA-256 is required");
            return;
        }
        if ("downloading".equals(phase)) {
            call.reject("already downloading", "BUSY");
            return;
        }
        cancel.set(false);
        phase = "downloading";
        received = 0;
        total = size;
        error = null;
        emit();
        worker.execute(() -> {
            File target = apk();
            File part = new File(target.getParentFile(), FILE + ".part");
            HttpURLConnection c = null;
            try {
                if (!target.getParentFile().exists() && !target.getParentFile().mkdirs()) throw new IllegalStateException("no folder");
                target.delete();
                URL u = new URL(url);
                if (!"https".equals(u.getProtocol())) throw new IllegalArgumentException("https only");
                c = (HttpURLConnection) u.openConnection();
                c.setConnectTimeout(30_000);
                c.setReadTimeout(60_000);
                if (c.getResponseCode() != 200) throw new IllegalStateException("HTTP " + c.getResponseCode());
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long last = 0;
                try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                    byte[] buffer = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buffer)) != -1) {
                        if (cancel.get()) throw new InterruptedException("cancelled");
                        out.write(buffer, 0, n);
                        digest.update(buffer, 0, n);
                        received += n;
                        if (received > size) throw new IllegalStateException("larger than published");
                        if (received - last > 512 * 1024) {
                            last = received;
                            emit();
                        }
                    }
                    out.getFD().sync();
                }
                if (received != size) throw new IllegalStateException(received + " of " + size + " bytes");
                StringBuilder hex = new StringBuilder();
                for (byte b : digest.digest()) hex.append(String.format(Locale.ROOT, "%02x", b));
                if (!hex.toString().equalsIgnoreCase(sha256)) throw new SecurityException("the file does not match the SHA-256 GitHub published");
                if (!part.renameTo(target)) throw new IllegalStateException("could not keep the file");
                // A release for a newer Android than this phone's never reaches
                // the installer, which would only say "App not installed": the
                // page says which Android it needs (mobile/bridges/updates.ts).
                int needs = minSdk(target);
                if (needs > Build.VERSION.SDK_INT) {
                    target.delete();
                    throw new IllegalStateException("needs-sdk:" + needs);
                }
                phase = "ready";
                emit();
                call.resolve(state());
            } catch (Exception e) {
                part.delete();
                boolean cancelled = cancel.get();
                phase = cancelled ? "idle" : "failed";
                error = cancelled ? null : String.valueOf(e.getMessage());
                emit();
                call.resolve(state());
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    /** The lowest Android (API level) the downloaded APK declares; 0 when it cannot be read. */
    private int minSdk(File file) {
        PackageInfo info = getContext().getPackageManager().getPackageArchiveInfo(file.getPath(), 0);
        return info == null || info.applicationInfo == null ? 0 : info.applicationInfo.minSdkVersion;
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        cancel.set(true);
        call.resolve();
    }

    @PluginMethod
    public void install(PluginCall call) {
        File target = apk();
        JSObject result = new JSObject();
        if (!"ready".equals(phase) || !target.exists()) {
            call.reject("nothing downloaded", "NOT_READY");
            return;
        }
        // Android asks once whether Girovo may install apps; until it may,
        // its own settings page is where the user says yes.
        if (!getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(settings);
            result.put("result", "permission");
            call.resolve(result);
            return;
        }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", target);
        Intent install = new Intent(Intent.ACTION_VIEW);
        install.setDataAndType(uri, "application/vnd.android.package-archive");
        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().startActivity(install);
        phase = "installing";
        emit();
        result.put("result", "started");
        call.resolve(result);
    }

    @PluginMethod
    public void playCheck(PluginCall call) {
        call.unavailable("Google Play updates are in the Play build only.");
    }

    @PluginMethod
    public void playUpdate(PluginCall call) {
        call.unavailable("Google Play updates are in the Play build only.");
    }

    @Override
    protected void handleOnDestroy() {
        cancel.set(true);
        worker.shutdownNow();
    }
}
