package de.elnino0916.android.girovo;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Fingerprint unlock (opt-in, Einstellungen): the PIN of one login and the
 * PINs of the further banks logged in beside it, behind an AES key in the
 * Android Keystore that only a strong biometric opens.
 *
 *  - The key never leaves the Keystore (hardware-backed, StrongBox where the
 *    phone has one), and every use needs a fresh fingerprint — no time window.
 *  - Enrolling a new finger destroys the key (setInvalidatedByBiometricEnrollment),
 *    so someone who adds their own fingerprint cannot open the PINs.
 *  - The key seals a random data key, and the data key each PIN on its own
 *    (AES-256-GCM, bound to its name): one fingerprint opens them all, and
 *    one bank's PIN can be deleted without one. The data key is in memory
 *    only while a fingerprint has just opened it, never kept.
 *  - What is stored is ciphertexts and IVs, in the app's private
 *    preferences, which no backup carries (data_extraction_rules.xml), under
 *    hashed names.
 *
 * The layout: "<id>" is a login's entry, its data key sealed with the key
 * ("k2:iv:sealed"); "<id>/<item>" is one PIN sealed with that data key
 * ("iv:sealed"), "<id>/<id>" the login's own. An entry from before further
 * banks were kept ("iv:sealed") is the login's PIN sealed with the key
 * itself; it takes the new form the first time a further bank is sealed.
 *
 * Without this switch on, nothing here holds anything and the PINs live only
 * in memory, as on the desktop.
 */
@CapacitorPlugin(name = "GirovoBiometric")
public class BiometricPlugin extends Plugin {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String PREFS = "girovo_biometric";
    private static final String ALIAS_PREFIX = "girovo.pin.";
    private static final String DATA_KEY = "k2";
    private static final int AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_STRONG;
    /** A login's name: the bridge's hash (mobile/bridges/biometric.ts) — never a "/" that would read as an item. */
    private static final Pattern ID = Pattern.compile("[0-9a-f]{32}");
    /** The login itself and the further banks beside it (lib/linked-banks.ts LINKED_BANK_LIMITS). */
    private static final int MAX_ITEMS = 9;
    private static final SecureRandom RANDOM = new SecureRandom();

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String alias(String id) {
        return ALIAS_PREFIX + id;
    }

    private static String itemName(String id, String item) {
        return id + "/" + item;
    }

    private static boolean validId(String id) {
        return id != null && ID.matcher(id).matches();
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

    /** `enrolled`: the login has an entry of its own; `held`: its PIN is kept beside another login's. */
    @PluginMethod
    public void has(PluginCall call) {
        String id = call.getString("id");
        JSObject result = new JSObject();
        result.put("enrolled", validId(id) && isEntry(id));
        result.put("held", validId(id) && holderOf(id) != null);
        call.resolve(result);
    }

    /** A new entry for `id`, after a fingerprint: a new key, a new data key, and `items` sealed with it — `id`'s own among them. */
    @PluginMethod
    public void enroll(PluginCall call) {
        String id = call.getString("id");
        Map<String, String> items = items(call);
        if (!validId(id) || items == null || !items.containsKey(id)) {
            call.reject("id and its own item are required");
            return;
        }
        Cipher cipher;
        try {
            forget(id);
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
                byte[] dataKey = newDataKey();
                try {
                    storeEntry(id, unlocked, dataKey, items);
                } finally {
                    Arrays.fill(dataKey, (byte) 0);
                }
                JSObject result = new JSObject();
                result.put("result", "enrolled");
                call.resolve(result);
            }

            @Override
            public void canceled() {
                forget(id);
                JSObject result = new JSObject();
                result.put("result", "canceled");
                call.resolve(result);
            }
        });
    }

    /**
     * Adds (or renews) `items` beside `id`'s own PIN, after a fingerprint.
     * An entry of the old form takes the new one here: `items` then must
     * hold `id`'s own PIN, which becomes an item like the others.
     */
    @PluginMethod
    public void seal(PluginCall call) {
        String id = call.getString("id");
        Map<String, String> items = items(call);
        if (!validId(id) || items == null || items.isEmpty()) {
            call.reject("id and items are required");
            return;
        }
        String stored = isEntry(id) ? prefs().getString(id, null) : null;
        if (stored == null) {
            JSObject result = new JSObject();
            result.put("result", "missing");
            call.resolve(result);
            return;
        }
        boolean upgrade = !stored.startsWith(DATA_KEY + ":");
        if (upgrade && !items.containsKey(id)) {
            call.reject("the old form needs the login's own PIN");
            return;
        }
        Cipher cipher;
        try {
            cipher = upgrade ? openKey(id, Cipher.ENCRYPT_MODE, null) : openKey(id, Cipher.DECRYPT_MODE, parts(stored)[0]);
        } catch (Exception e) {
            invalidated(call, id);
            return;
        }
        prompt(call, cipher, new Done() {
            @Override
            public void ok(Cipher unlocked) throws Exception {
                if (upgrade) {
                    byte[] dataKey = newDataKey();
                    try {
                        storeEntry(id, unlocked, dataKey, items);
                    } finally {
                        Arrays.fill(dataKey, (byte) 0);
                    }
                } else {
                    byte[] dataKey = unlocked.doFinal(parts(stored)[1]);
                    try {
                        SharedPreferences.Editor edit = prefs().edit();
                        for (Map.Entry<String, String> item : items.entrySet()) {
                            edit.putString(itemName(id, item.getKey()), sealItem(dataKey, itemName(id, item.getKey()), item.getValue()));
                        }
                        edit.apply();
                    } finally {
                        Arrays.fill(dataKey, (byte) 0);
                    }
                }
                JSObject result = new JSObject();
                result.put("result", "sealed");
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

    /**
     * After a fingerprint, `secret` is `id`'s PIN — and `items` every other
     * PIN kept beside it. A login kept only beside another one (a further
     * bank of it) is opened through that one, and alone.
     */
    @PluginMethod
    public void unlock(PluginCall call) {
        String id = call.getString("id");
        String holder = !validId(id) ? null : isEntry(id) ? id : holderOf(id);
        String stored = holder == null ? null : prefs().getString(holder, null);
        if (stored == null) {
            if (validId(id)) forget(id);
            JSObject result = new JSObject();
            result.put("result", "missing");
            call.resolve(result);
            return;
        }
        boolean v2 = stored.startsWith(DATA_KEY + ":");
        byte[][] sealed = parts(stored);
        Cipher cipher;
        try {
            cipher = openKey(holder, Cipher.DECRYPT_MODE, sealed[0]);
        } catch (Exception e) {
            invalidated(call, holder);
            return;
        }
        prompt(call, cipher, new Done() {
            @Override
            public void ok(Cipher unlocked) throws Exception {
                JSObject result = new JSObject();
                if (!v2) {
                    result.put("result", "unlocked");
                    result.put("secret", new String(unlocked.doFinal(sealed[1]), StandardCharsets.UTF_8));
                    call.resolve(result);
                    return;
                }
                byte[] dataKey = unlocked.doFinal(sealed[1]);
                try {
                    String own = openItem(dataKey, holder, id);
                    if (own == null) {
                        prefs().edit().remove(itemName(holder, id)).apply();
                        result.put("result", "missing");
                        call.resolve(result);
                        return;
                    }
                    JSArray others = new JSArray();
                    if (holder.equals(id)) {
                        String prefix = itemName(id, "");
                        for (String name : prefs().getAll().keySet()) {
                            if (!name.startsWith(prefix) || name.equals(itemName(id, id))) continue;
                            String item = name.substring(prefix.length());
                            String secret = openItem(dataKey, id, item);
                            if (secret == null) {
                                prefs().edit().remove(name).apply();
                                continue;
                            }
                            JSObject entry = new JSObject();
                            entry.put("id", item);
                            entry.put("secret", secret);
                            others.put(entry);
                        }
                    }
                    result.put("result", "unlocked");
                    result.put("secret", own);
                    result.put("items", others);
                    call.resolve(result);
                } finally {
                    Arrays.fill(dataKey, (byte) 0);
                }
            }

            @Override
            public void canceled() {
                JSObject result = new JSObject();
                result.put("result", "canceled");
                call.resolve(result);
            }
        });
    }

    /**
     * With `item`: that one PIN kept beside `id` ("Bank entfernen"). Without:
     * `id`'s entry with everything beside it, and `id`'s PIN wherever it is
     * kept beside another login — a PIN the bank refused, or the switch off.
     */
    @PluginMethod
    public void remove(PluginCall call) {
        String id = call.getString("id");
        String item = call.getString("item");
        if (!validId(id)) {
            call.resolve();
            return;
        }
        if (item != null) {
            if (validId(item)) prefs().edit().remove(itemName(id, item)).apply();
            call.resolve();
            return;
        }
        forget(id);
        SharedPreferences.Editor edit = prefs().edit();
        for (String name : prefs().getAll().keySet()) {
            if (name.endsWith("/" + id)) edit.remove(name);
        }
        edit.apply();
        call.resolve();
    }

    @PluginMethod
    public void removeAll(PluginCall call) {
        for (String name : prefs().getAll().keySet()) {
            if (!name.contains("/")) deleteKey(alias(name));
        }
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

    /** The PINs a call hands in, by their names; null when they are not as expected. */
    private static Map<String, String> items(PluginCall call) {
        JSArray list = call.getArray("items");
        if (list == null || list.length() > MAX_ITEMS) return null;
        Map<String, String> out = new LinkedHashMap<>();
        try {
            for (int i = 0; i < list.length(); i++) {
                JSONObject item = list.getJSONObject(i);
                String id = item.optString("id", null);
                String secret = item.optString("secret", null);
                if (!validId(id) || secret == null || secret.isEmpty()) return null;
                out.put(id, secret);
            }
        } catch (Exception e) {
            return null;
        }
        return out;
    }

    /** Stores `id`'s new entry: `dataKey` sealed with the fingerprint's `cipher`, and `items` with `dataKey`. */
    private void storeEntry(String id, Cipher cipher, byte[] dataKey, Map<String, String> items) throws Exception {
        byte[] sealedKey = cipher.doFinal(dataKey);
        SharedPreferences.Editor edit = prefs().edit();
        String prefix = itemName(id, "");
        for (String name : prefs().getAll().keySet()) {
            if (name.startsWith(prefix)) edit.remove(name);
        }
        edit.putString(id, DATA_KEY + ":" + b64(cipher.getIV()) + ":" + b64(sealedKey));
        for (Map.Entry<String, String> item : items.entrySet()) {
            edit.putString(itemName(id, item.getKey()), sealItem(dataKey, itemName(id, item.getKey()), item.getValue()));
        }
        edit.apply();
    }

    private static byte[] newDataKey() {
        byte[] key = new byte[32];
        RANDOM.nextBytes(key);
        return key;
    }

    /** One PIN under the data key, bound to its name so it cannot pass for another login's. */
    private static String sealItem(byte[] dataKey, String name, String secret) throws Exception {
        byte[] iv = new byte[12];
        RANDOM.nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(dataKey, "AES"), new GCMParameterSpec(128, iv));
        cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
        return b64(iv) + ":" + b64(cipher.doFinal(secret.getBytes(StandardCharsets.UTF_8)));
    }

    /** `item`'s PIN beside `id`; null when there is none or it does not open. */
    private String openItem(byte[] dataKey, String id, String item) {
        String stored = prefs().getString(itemName(id, item), null);
        if (stored == null) return null;
        try {
            byte[][] sealed = parts(stored);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(dataKey, "AES"), new GCMParameterSpec(128, sealed[0]));
            cipher.updateAAD(itemName(id, item).getBytes(StandardCharsets.UTF_8));
            return new String(cipher.doFinal(sealed[1]), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    /** The IV and the ciphertext of a stored value, either form. */
    private static byte[][] parts(String stored) {
        String body = stored.startsWith(DATA_KEY + ":") ? stored.substring(DATA_KEY.length() + 1) : stored;
        String[] parts = body.split(":", 2);
        return new byte[][] { Base64.decode(parts[0], Base64.NO_WRAP), Base64.decode(parts[1], Base64.NO_WRAP) };
    }

    private static String b64(byte[] bytes) {
        return Base64.encodeToString(bytes, Base64.NO_WRAP);
    }

    /** The fingerprint's key for `id`, ready for one operation once a finger opens it. */
    private static Cipher openKey(String id, int mode, byte[] iv) throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);
        SecretKey key = (SecretKey) ks.getKey(alias(id), null);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        if (iv == null) cipher.init(mode, key);
        else cipher.init(mode, key, new GCMParameterSpec(128, iv));
        return cipher;
    }

    /**
     * A fingerprint was added (or all removed), or the key will not open for
     * another reason: it is gone for good, and everything sealed under it.
     */
    private void invalidated(PluginCall call, String id) {
        forget(id);
        JSObject result = new JSObject();
        result.put("result", "invalidated");
        call.resolve(result);
    }

    /** Whether `id` has an entry of its own whose key is still there. */
    private boolean isEntry(String id) {
        return prefs().contains(id) && keyExists(alias(id));
    }

    /** The login whose entry keeps `item`'s PIN beside its own; null when none does. */
    private String holderOf(String item) {
        for (String name : prefs().getAll().keySet()) {
            int slash = name.indexOf('/');
            if (slash < 0 || !name.substring(slash + 1).equals(item)) continue;
            String id = name.substring(0, slash);
            if (!id.equals(item) && isEntry(id)) return id;
        }
        return null;
    }

    private SecretKey createKey(String alias) throws Exception {
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
            .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        try {
            return generate(spec.setIsStrongBoxBacked(true).build());
        } catch (Exception noStrongBox) {
            spec.setIsStrongBoxBacked(false);
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

    /** `id`'s entry: its key, its sealed data key and every PIN kept beside it. */
    private void forget(String id) {
        if (id == null) return;
        deleteKey(alias(id));
        SharedPreferences.Editor edit = prefs().edit();
        edit.remove(id);
        String prefix = itemName(id, "");
        for (String name : prefs().getAll().keySet()) {
            if (name.startsWith(prefix)) edit.remove(name);
        }
        edit.apply();
    }
}
