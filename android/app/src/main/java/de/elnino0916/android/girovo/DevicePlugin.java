package de.elnino0916.android.girovo;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintJob;
import android.print.PrintManager;
import android.util.Base64;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.activity.BackEventCompat;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.Locale;

/**
 * What the desktop shell does for the page (electron/main.cjs), the Android way
 * (mobile/bridges/*): the wallpaper's colours for Material You, printing a
 * document — "Save as PDF" is one of Android's printers — saving a file where
 * the user picks, handing one to another app, and keeping the screen out of
 * screenshots and the recent-apps preview. And what only a phone has: a touch
 * of haptic feedback, and the back gesture's progress for an open sheet.
 */
@CapacitorPlugin(name = "GirovoDevice")
public class DevicePlugin extends Plugin {

    /** Material You's tone steps, as Android names them (system_accent1_<step>). */
    private static final int[] STEPS = {0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000};

    /**
     * The colour roles the page uses (mobile/bridges/material-you.ts), as
     * Android 14 and later publish them ready-made: system_<role>_light and
     * system_<role>_dark — the very colours the phone's own apps are drawn in.
     */
    private static final String[] ROLES = {
        "primary", "on_primary", "primary_container", "on_primary_container", "inverse_primary",
        "secondary", "on_secondary", "secondary_container", "on_secondary_container",
        "tertiary", "on_tertiary", "tertiary_container", "on_tertiary_container",
        "surface", "surface_dim", "surface_bright",
        "surface_container_lowest", "surface_container_low", "surface_container", "surface_container_high", "surface_container_highest",
        "on_surface", "on_surface_variant", "outline", "outline_variant",
        "inverse_surface", "inverse_on_surface", "scrim",
    };

    // ---------------------------------------------------------------------
    // Material You

    @PluginMethod
    public void palette(PluginCall call) {
        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            result.put("available", false);
            call.resolve(result);
            return;
        }
        Context context = getContext();
        JSObject palette = new JSObject();
        palette.put("primary", tones(context, "system_accent1_"));
        palette.put("secondary", tones(context, "system_accent2_"));
        palette.put("tertiary", tones(context, "system_accent3_"));
        palette.put("neutral", tones(context, "system_neutral1_"));
        palette.put("neutralVariant", tones(context, "system_neutral2_"));
        result.put("available", true);
        result.put("palette", palette);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            JSObject roles = new JSObject();
            roles.put("light", roles(context, "_light"));
            roles.put("dark", roles(context, "_dark"));
            result.put("roles", roles);
        }
        call.resolve(result);
    }

    /** The published roles of one theme, keyed as the page names them ("surface-container-high"). */
    private static JSObject roles(Context context, String suffix) {
        JSObject out = new JSObject();
        for (String role : ROLES) {
            int id = context.getResources().getIdentifier("system_" + role + suffix, "color", "android");
            if (id == 0) continue;
            out.put(role.replace('_', '-'), String.format(Locale.ROOT, "#%06x", context.getColor(id) & 0xffffff));
        }
        return out;
    }

    /** One tonal palette, keyed by Material tone (Android's step 100 is tone 90, step 900 tone 10). */
    private static JSObject tones(Context context, String prefix) {
        JSObject out = new JSObject();
        for (int step : STEPS) {
            int id = context.getResources().getIdentifier(prefix + step, "color", "android");
            if (id == 0) continue;
            int color = context.getColor(id);
            int tone = 100 - step / 10;
            out.put(String.valueOf(tone), String.format(Locale.ROOT, "#%06x", color & 0xffffff));
        }
        return out;
    }

    // ---------------------------------------------------------------------
    // Printing

    @PluginMethod
    public void print(PluginCall call) {
        String name = call.getString("name", "Girovo");
        getBridge().executeOnMainThread(() -> {
            try {
                WebView webView = getBridge().getWebView();
                PrintManager manager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                // The WebView prints what @media print shows — the document
                // sheet components/Statement.tsx renders, exactly as on paper.
                PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(name);
                PrintAttributes attributes = new PrintAttributes.Builder()
                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                    .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                    .build();
                PrintJob job = manager.print(name, adapter, attributes);
                // The page keeps the sheet until the job is done: the print
                // dialog lays it out from the live WebView while it is open.
                watch(call, job);
            } catch (Exception e) {
                JSObject result = new JSObject();
                result.put("result", "failed");
                call.resolve(result);
            }
        });
    }

    /** How long a job may sit with a printer before the page lets the sheet go anyway. */
    private static final long PRINT_WATCH_MS = 10 * 60 * 1000;

    private void watch(PluginCall call, PrintJob job) {
        Handler handler = new Handler(Looper.getMainLooper());
        long until = System.currentTimeMillis() + PRINT_WATCH_MS;
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                // Only a finished job lets the sheet go: "Save as PDF" writes
                // the file after the job is queued, from the page as it is then.
                String state = null;
                if (job.isCompleted()) state = "queued";
                else if (job.isCancelled()) state = "canceled";
                else if (job.isFailed()) state = "failed";
                else if (System.currentTimeMillis() > until) state = "queued";
                if (state == null) {
                    handler.postDelayed(this, 400);
                    return;
                }
                JSObject result = new JSObject();
                result.put("result", state);
                call.resolve(result);
            }
        }, 400);
    }

    // ---------------------------------------------------------------------
    // Saving and sharing

    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name", "Girovo");
        String mime = call.getString("mime", "application/octet-stream");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        try {
            startActivityForResult(call, intent, "onSaveLocation");
        } catch (ActivityNotFoundException e) {
            call.reject("no document picker", "UNAVAILABLE");
        }
    }

    @ActivityCallback
    private void onSaveLocation(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject answer = new JSObject();
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            answer.put("result", "canceled");
            call.resolve(answer);
            return;
        }
        byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
        try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null) throw new IllegalStateException("no stream for " + uri);
            out.write(bytes);
            answer.put("result", "saved");
            call.resolve(answer);
        } catch (Exception e) {
            call.reject("could not write the file", "WRITE_FAILED", e);
        }
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        String name = call.getString("name", "Girovo");
        String mime = call.getString("mime", "application/octet-stream");
        String title = call.getString("title", name);
        byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
        try {
            // Only the cache's shared/ folder is handed out (res/xml/file_paths.xml),
            // and each share replaces what the last one left there.
            File dir = new File(getContext().getCacheDir(), "shared");
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) f.delete();
            if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("no cache folder");
            File file = new File(dir, name.replaceAll("[\\\\/:*?\"<>|]", "_"));
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(bytes);
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, title);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("could not share the file", "SHARE_FAILED", e);
        }
    }

    // ---------------------------------------------------------------------
    // The window

    @PluginMethod
    public void setSecure(PluginCall call) {
        boolean secure = Boolean.TRUE.equals(call.getBoolean("secure", true));
        getBridge().executeOnMainThread(() -> {
            if (secure) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            call.resolve();
        });
    }

    // ---------------------------------------------------------------------
    // Approvals in the bank's app

    /** Keeps the network while the user approves in another app (ApprovalService). */
    @PluginMethod
    public void holdForApproval(PluginCall call) {
        JSObject result = new JSObject();
        try {
            ApprovalService.start(getContext(), call.getString("title", "Girovo"), call.getString("text", ""));
            result.put("held", true);
        } catch (Exception e) {
            // Android refuses a foreground service started from the background;
            // the page asks while it is in front, so this is the rare race.
            result.put("held", false);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void releaseApproval(PluginCall call) {
        ApprovalService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith("https://")) {
            call.reject("https only");
            return;
        }
        try {
            Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(view);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("no browser", "UNAVAILABLE");
        }
    }

    /**
     * The bank's approval app (S-pushTAN, SecureGo plus, …: lib/brands.ts
     * APPROVAL_PACKAGES), if one of `packages` is installed. Only packages the
     * manifest names in <queries> can be seen, so the app never learns what
     * else is on the phone.
     */
    @PluginMethod
    public void approvalApp(PluginCall call) {
        JSObject result = new JSObject();
        String found = firstLaunchable(call.getArray("packages"));
        if (found != null) result.put("package", found);
        call.resolve(result);
    }

    /** Opens that app, where the user approves; Back brings them to Girovo, which waits on. */
    @PluginMethod
    public void openApprovalApp(PluginCall call) {
        String found = firstLaunchable(call.getArray("packages"));
        Intent launch = found == null ? null : getContext().getPackageManager().getLaunchIntentForPackage(found);
        if (launch == null) {
            call.reject("not installed", "UNAVAILABLE");
            return;
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(launch);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("not installed", "UNAVAILABLE");
        }
    }

    private String firstLaunchable(JSArray packages) {
        if (packages == null) return null;
        PackageManager pm = getContext().getPackageManager();
        for (int i = 0; i < packages.length(); i++) {
            String name = packages.optString(i, "");
            if (!name.isEmpty() && pm.getLaunchIntentForPackage(name) != null) return name;
        }
        return null;
    }

    /**
     * The phone's attested boot and this copy's signer (DeviceIntegrity);
     * lib/device-integrity.ts says what they mean. Made a key in the secure
     * hardware, so it runs on the plugin thread, never the main one.
     */
    @PluginMethod
    public void integrity(PluginCall call) {
        call.resolve(DeviceIntegrity.check(getContext()));
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject result = new JSObject();
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            result.put("versionName", info.versionName);
            result.put("versionCode", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode);
        } catch (PackageManager.NameNotFoundException e) {
            result.put("versionName", "");
            result.put("versionCode", 0);
        }
        result.put("flavor", BuildConfig.DISTRIBUTION);
        // A debug build (from Android Studio or build-android.mjs without
        // --release): it sends no telemetry (mobile/bridges/telemetry.ts).
        result.put("debug", BuildConfig.DEBUG);
        result.put("sdk", Build.VERSION.SDK_INT);
        result.put("locale", Locale.getDefault().toLanguageTag());
        call.resolve(result);
    }
    // ---------------------------------------------------------------------
    // Haptics

    /**
     * The system's own short touches, so they follow the phone's setting for
     * touch feedback: "confirm" (sent, approved), "reject" (refused, failed),
     * "threshold" (pulled far enough to refresh).
     */
    @PluginMethod
    public void haptic(PluginCall call) {
        String kind = call.getString("kind", "threshold");
        getActivity().runOnUiThread(() -> {
            View view = getActivity().getWindow().getDecorView();
            int effect;
            if ("confirm".equals(kind)) {
                effect = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.LONG_PRESS;
            } else if ("reject".equals(kind)) {
                effect = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS;
            } else {
                effect = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
                    ? HapticFeedbackConstants.GESTURE_THRESHOLD_ACTIVATE
                    : HapticFeedbackConstants.CLOCK_TICK;
            }
            view.performHapticFeedback(effect);
            call.resolve();
        });
    }

    // ---------------------------------------------------------------------
    // Predictive back

    /** Enabled while the page has a layer open (mobile/bridges/back.ts). */
    private OnBackPressedCallback layerBack;

    /**
     * While a sheet, dialog or menu is open the back gesture is the page's,
     * with its progress (Android 14 and later): the sheet follows the finger,
     * and closes when the gesture completes ("backInvoked"). With nothing
     * open, Capacitor's own back handling takes the gesture as before.
     */
    @PluginMethod
    public void setBackLayer(PluginCall call) {
        boolean open = Boolean.TRUE.equals(call.getBoolean("open", false));
        getActivity().runOnUiThread(() -> {
            if (layerBack == null) {
                layerBack = new OnBackPressedCallback(false) {
                    @Override
                    public void handleOnBackStarted(@NonNull BackEventCompat event) {
                        notifyListeners("backProgress", backEvent(event));
                    }

                    @Override
                    public void handleOnBackProgressed(@NonNull BackEventCompat event) {
                        notifyListeners("backProgress", backEvent(event));
                    }

                    @Override
                    public void handleOnBackCancelled() {
                        notifyListeners("backCancelled", new JSObject());
                    }

                    @Override
                    public void handleOnBackPressed() {
                        notifyListeners("backInvoked", new JSObject());
                    }
                };
                // Added after Capacitor's (at the first open layer), so it is
                // asked first while enabled.
                getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), layerBack);
            }
            layerBack.setEnabled(open);
            call.resolve();
        });
    }

    private static JSObject backEvent(BackEventCompat event) {
        JSObject result = new JSObject();
        result.put("progress", event.getProgress());
        result.put("edge", event.getSwipeEdge() == BackEventCompat.EDGE_LEFT ? "left" : "right");
        return result;
    }
}
