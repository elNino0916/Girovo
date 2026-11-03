package de.elnino0916.android.girovo;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The page's side of the home screen widget (BalanceWidget): it hands over the
 * Gesamtsaldo, formatted as the app shows it, and since when it stands.
 * Kept only while a widget is on the home screen — with none, nothing is
 * stored — and cleared when the app forgets the login.
 */
@CapacitorPlugin(name = "GirovoWidget")
public class WidgetPlugin extends Plugin {
    /** A formatted figure and its date line are short; anything longer is not one. */
    private static final int MAX_TEXT = 80;

    @PluginMethod
    public void placed(PluginCall call) {
        JSObject out = new JSObject();
        out.put("placed", BalanceWidget.placed(getContext()).length > 0);
        call.resolve(out);
    }

    @PluginMethod
    public void update(PluginCall call) {
        String amount = call.getString("amount");
        String stamp = call.getString("stamp", "");
        if (amount == null || amount.isEmpty() || amount.length() > MAX_TEXT || stamp == null || stamp.length() > MAX_TEXT) {
            call.reject("not a figure", "invalid");
            return;
        }
        boolean placed = BalanceWidget.placed(getContext()).length > 0;
        if (placed) {
            BalanceWidget.prefs(getContext()).edit()
                    .putString(BalanceWidget.KEY_AMOUNT, amount)
                    .putString(BalanceWidget.KEY_STAMP, stamp)
                    .apply();
            BalanceWidget.renderAll(getContext());
        }
        JSObject out = new JSObject();
        out.put("stored", placed);
        call.resolve(out);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        BalanceWidget.prefs(getContext()).edit().clear().apply();
        BalanceWidget.renderAll(getContext());
        call.resolve();
    }
}
