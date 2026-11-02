package de.elnino0916.android.girovo;

import android.content.Intent;
import android.util.Log;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanIntentResult;
import com.journeyapps.barcodescanner.ScanOptions;
import java.util.Locale;

/**
 * "GiroCode scannen" in the F-Droid build: ZXing's own camera screen
 * (zxing-android-embedded, Apache 2.0) in place of Google's code scanner,
 * which needs Play services. Unlike Google's, it asks for the camera
 * permission itself, the first time; it hands back the text of the one QR
 * code the user aimed at, which the page reads as a GiroCode
 * (lib/girocode.ts) — the same answers as the Play and GitHub builds'
 * ScannerPlugin (src/gms): the value, or canceled.
 */
@CapacitorPlugin(name = "GirovoScanner")
public class ScannerPlugin extends Plugin {

    @PluginMethod
    public void scan(PluginCall call) {
        boolean german = "de".equals(Locale.getDefault().getLanguage());
        ScanOptions options = new ScanOptions()
            .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt(german ? "Halte den GiroCode in den Rahmen" : "Hold the GiroCode inside the frame")
            .setBeepEnabled(false)
            // Any orientation, as the rest of the app: the manifest lifts the scanner's own lock.
            .setOrientationLocked(false);
        Intent intent = new ScanContract().createIntent(getContext(), options);
        startActivityForResult(call, intent, "scanned");
    }

    @ActivityCallback
    private void scanned(PluginCall call, ActivityResult result) {
        if (call == null) return;
        ScanIntentResult scan = ScanIntentResult.parseActivityResult(result.getResultCode(), result.getData());
        String value = scan.getContents();
        if (value == null) {
            // Back without a code — or no camera permission given: the user's no, not a fault.
            if (scan.getOriginalIntent() != null && scan.getOriginalIntent().hasExtra("MISSING_CAMERA_PERMISSION")) {
                Log.w("GirovoScanner", "scan ended without the camera permission");
            }
            JSObject canceled = new JSObject();
            canceled.put("canceled", true);
            call.resolve(canceled);
            return;
        }
        JSObject out = new JSObject();
        out.put("value", value);
        call.resolve(out);
    }
}
