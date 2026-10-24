package de.elnino0916.android.girovo;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.common.MlKitException;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

/**
 * "Rechnung ohne GiroCode": the text on an invoice's page, read on the phone
 * by Google's text recognition from Play services. The page hands over the
 * picture (a scanned page, a photo, a PDF page drawn as an image) and gets
 * the text back, line by line, each line with its box on the picture (so
 * the page can mark what it took); lib/invoice-text.ts reads the transfer's
 * fields from it. The picture never leaves the phone.
 *
 * Without Play services (some phones the GitHub APK runs on), or before its
 * model has arrived, the call fails with "unavailable" and the page says so.
 */
@CapacitorPlugin(name = "GirovoText")
public class TextPlugin extends Plugin {

    private TextRecognizer recognizer;

    @PluginMethod
    public void recognize(PluginCall call) {
        String data = call.getString("data", "");
        Bitmap bitmap;
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (IllegalArgumentException e) {
            bitmap = null;
        }
        if (bitmap == null) {
            call.reject("not an image", "failed");
            return;
        }
        if (recognizer == null) recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        final int width = bitmap.getWidth();
        final int height = bitmap.getHeight();
        recognizer.process(InputImage.fromBitmap(bitmap, 0))
            .addOnSuccessListener(text -> {
                JSArray lines = new JSArray();
                for (Text.TextBlock block : text.getTextBlocks()) {
                    for (Text.Line line : block.getLines()) {
                        JSObject entry = new JSObject();
                        entry.put("text", line.getText());
                        Rect r = line.getBoundingBox();
                        if (r != null) {
                            JSArray box = new JSArray();
                            box.put(r.left);
                            box.put(r.top);
                            box.put(r.right);
                            box.put(r.bottom);
                            entry.put("box", box);
                        }
                        lines.put(entry);
                    }
                }
                JSObject result = new JSObject();
                result.put("text", text.getText());
                result.put("lines", lines);
                result.put("width", width);
                result.put("height", height);
                call.resolve(result);
            })
            .addOnFailureListener(e -> {
                int code = e instanceof MlKitException ? ((MlKitException) e).getErrorCode() : -1;
                Log.w("GirovoText", "no text: " + code + " " + e.getMessage());
                call.reject(e.getMessage(), code == MlKitException.UNAVAILABLE ? "unavailable" : "failed", e);
            });
    }

    @Override
    protected void handleOnDestroy() {
        if (recognizer != null) recognizer.close();
        recognizer = null;
    }
}
