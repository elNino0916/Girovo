package de.elnino0916.android.girovo;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Map;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Fingerprint unlock (opt-in, Sitzung panel): the PIN of one login, sealed with
 * an AES key in the Android Keystore that only a strong biometric opens.
 *
 *  - The key never leaves the Keystore (hardware-backed, StrongBox where the
 *    phone has one), and every use needs a fresh fingerprint — no time window.
 *  - Enrolling a new finger destroys the key (setInvalidatedByBiometricEnrollment),
 *    so someone who adds their own fingerprint cannot open the PIN.
 *  - What is stored is the GCM ciphertext and its IV, in the app's private
 *    preferences, which no backup carries (data_extraction_rules.xml).
 *
 * Without this switch on, nothing here holds anything and the PIN lives only
 * in memory, as on the desktop.
 */
@CapacitorPlugin(name = "GirovoBiometric")
public class BiometricPlugin extends Plugin {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String PREFS = "girovo_biometric";
    private static final String ALIAS_PREFIX = "girovo.pin.";
    private static final int AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_STRONG;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String alias(String id) {
        return ALIAS_PREFIX + id;
    }

    // ---------------------------------------------------------------------

    @PluginMethod
    public void state(PluginCall call) {
        JSObject result = new JSObject();
        int can = BiometricManager.from(getContext()).canAuthenticate(AUTHENTICATORS);
        result.put("available", can == BiometricManager.BIOMETRIC_SUCCESS);
        switch (can) {
            case BiometricManager.BIOMETRIC_SUCCESS: break;
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED: result.put("reason", "none-enrolled"); break;
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE: result.put("reason", "no-hardware"); break;
            case BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED: result.put("reason", "security-update"); break;
            default: result.put("reason", "unavailable"); break;
        }
        call.resolve(result);
    }

    @PluginMethod
    public void has(PluginCall call) {
        String id = call.getString("id");
        JSObject result = new JSObject();
        result.put("enrolled", id != null && prefs().contains(id) && keyExists(alias(id)));
        call.resolve(result);
    }

    @PluginMethod
    public void enroll(PluginCall call) {
        String id = call.getString("id");
        String secret = call.getString("secret");
        if (id == null || secret == null || secret.isEmpty()) {
            call.reject("id and secret are required");
            return;
        }
        Cipher cipher;
        try {
            deleteKey(alias(id));
            SecretKey key = createKey(alias(id));
            cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key);
        } catch (Exception e) {
            call.reject("could not create the key", "KEY_FAILED", e);
            return;
        }
        prompt(call, cipher, new Done() {
            @Override
            public void ok(Cipher unlocked) throws Exception {
                byte[] sealed = unlocked.doFinal(secret.getBytes(StandardCharsets.UTF_8));
                prefs().edit()
                    .putString(id, Base64.encodeToString(unlocked.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(sealed, Base64.NO_WRAP))
                    .apply();
                JSObject result = new JSObject();
                result.put("result", "enrolled");
                call.resolve(result);
            }

            @Override
            public void canceled() {
                deleteKey(alias(id));
                JSObject result = new JSObject();
                result.put("result", "canceled");
                call.resolve(result);
            }
        });
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        String id = call.getString("id");
        String stored = id == null ? null : prefs().getString(id, null);
        if (stored == null || !keyExists(alias(id))) {
            forget(id);
            JSObject result = new JSObject();
            result.put("result", "missing");
            call.resolve(result);
            return;
        }
        String[] parts = stored.split(":", 2);
        byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
        byte[] sealed = Base64.decode(parts[1], Base64.NO_WRAP);
        Cipher cipher;
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE);
            ks.load(null);
            SecretKey key = (SecretKey) ks.getKey(alias(id), null);
            cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
        } catch (KeyPermanentlyInvalidatedException e) {
            // A fingerprint was added (or all removed): the key is gone for good.
            forget(id);
            JSObject result = new JSObject();
            result.put("result", "invalidated");
            call.resolve(result);
            return;
        } catch (Exception e) {
            forget(id);
            JSObject result = new JSObject();
            result.put("result", "invalidated");
            call.resolve(result);
            return;
        }
        prompt(call, cipher, new Done() {
            @Override
            public void ok(Cipher unlocked) throws Exception {
                JSObject result = new JSObject();
                result.put("result", "unlocked");
                result.put("secret", new String(unlocked.doFinal(sealed), StandardCharsets.UTF_8));
                call.resolve(result);
            }

            @Override
            public void canceled() {
                JSObject result = new JSObject();
                result.put("result", "canceled");
                call.resolve(result);
            }
        });
    }

    @PluginMethod
    public void remove(PluginCall call) {
        forget(call.getString("id"));
        call.resolve();
    }

    @PluginMethod
    public void removeAll(PluginCall call) {
        for (Map.Entry<String, ?> entry : prefs().getAll().entrySet()) deleteKey(alias(entry.getKey()));
        prefs().edit().clear().apply();
        call.resolve();
    }

    // ---------------------------------------------------------------------

    private interface Done {
        void ok(Cipher unlocked) throws Exception;
        void canceled();
    }

    private void prompt(PluginCall call, Cipher cipher, Done done) {
        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
            .setTitle(call.getString("title", "Girovo"))
            .setSubtitle(call.getString("subtitle", ""))
            .setNegativeButtonText(call.getString("cancel", "Abbrechen"))
            .setAllowedAuthenticators(AUTHENTICATORS)
            .setConfirmationRequired(false)
            .build();
        getBridge().executeOnMainThread(() -> {
            FragmentActivity activity = getActivity();
            BiometricPrompt biometricPrompt = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                    BiometricPrompt.CryptoObject crypto = result.getCryptoObject();
                    try {
                        if (crypto == null || crypto.getCipher() == null) throw new IllegalStateException("no cipher");
                        done.ok(crypto.getCipher());
                    } catch (Exception e) {
                        call.reject("could not use the key", "KEY_FAILED", e);
                    }
                }

                @Override
                public void onAuthenticationError(int code, @NonNull CharSequence message) {
                    // Cancelled, timed out, locked out after too many tries:
                    // the user types the PIN instead.
                    done.canceled();
                }
                // onAuthenticationFailed (a finger not recognised) is not final:
                // the prompt stays and says so itself.
            });
            biometricPrompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
        });
    }

    private SecretKey createKey(String alias) throws Exception {
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                return generate(spec.setIsStrongBoxBacked(true).build());
            } catch (Exception noStrongBox) {
                spec.setIsStrongBoxBacked(false);
            }
        }
        return generate(spec.build());
    }

    private static SecretKey generate(KeyGenParameterSpec spec) throws Exception {
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(spec);
        return generator.generateKey();
    }

    private static boolean keyExists(String alias) {
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE);
            ks.load(null);
            return ks.containsAlias(alias);
        } catch (Exception e) {
            return false;
        }
    }

    private static void deleteKey(String alias) {
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE);
            ks.load(null);
            if (ks.containsAlias(alias)) ks.deleteEntry(alias);
        } catch (Exception ignored) {
            // nothing to delete
        }
    }

    private void forget(String id) {
        if (id == null) return;
        deleteKey(alias(id));
        prefs().edit().remove(id).apply();
    }
}
