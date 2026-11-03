package de.elnino0916.android.girovo;

import android.Manifest;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * The page's side of "Neue Umsätze melden" (lib/background-check.ts): the
 * secret the PINs' box is sealed with, the box itself (lib/background-store.ts
 * reads and writes it here), the six-hourly job, and the permission to notify.
 * See BackgroundState.
 */
@CapacitorPlugin(
        name = "GirovoBackground",
        permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class BackgroundPlugin extends Plugin {
    /** The sealed box is a few kilobytes; far more is not one. */
    private static final int BOX_MAX = 512 * 1024;

    @PluginMethod
    public void secret(PluginCall call) {
        try {
            JSObject out = new JSObject();
            out.put("secret", BackgroundState.secret(getContext()));
            call.resolve(out);
        } catch (Exception e) {
            call.reject("no secret", "unavailable");
        }
    }

    @PluginMethod
    public void read(PluginCall call) {
        JSObject out = new JSObject();
        String text = BackgroundState.readBox(getContext());
        out.put("text", text == null ? JSObject.NULL : text);
        call.resolve(out);
    }

    @PluginMethod
    public void write(PluginCall call) {
        String text = call.getData().has("text") && !call.getData().isNull("text") ? call.getString("text") : null;
        if (text != null && text.length() > BOX_MAX) {
            call.reject("too large", "invalid");
            return;
        }
        BackgroundState.writeBox(getContext(), text);
        call.resolve();
    }

    /** {on}: plans the job every six hours, or cancels it. */
    @PluginMethod
    public void schedule(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        BackgroundState.schedule(getContext(), on);
        JSObject out = new JSObject();
        out.put("scheduled", BackgroundState.scheduled(getContext()));
        call.resolve(out);
    }

    @PluginMethod
    public void notifications(PluginCall call) {
        JSObject out = new JSObject();
        out.put("allowed", BackgroundState.notificationsAllowed(getContext()));
        call.resolve(out);
    }

    /** Android 13 and later ask the user; before that, notifications are on unless turned off. */
    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED) {
            notifications(call);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsAnswered");
    }

    @PermissionCallback
    private void notificationsAnswered(PluginCall call) {
        notifications(call);
    }
}
