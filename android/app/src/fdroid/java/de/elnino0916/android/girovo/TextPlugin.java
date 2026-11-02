package de.elnino0916.android.girovo;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * ML Kit's text recognition is Play services' and not in the F-Droid build.
 * The call fails with "unavailable", and the page reads an invoice with
 * Tesseract instead — the desktop's offline reader, whose files this build
 * carries (components/transfer/GiroCodeDrop.tsx, scripts/build-android.mjs).
 */
@CapacitorPlugin(name = "GirovoText")
public class TextPlugin extends Plugin {

    @PluginMethod
    public void recognize(PluginCall call) {
        call.reject("No ML Kit in the F-Droid build: the page reads with Tesseract", "unavailable");
    }
}
