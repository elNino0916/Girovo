package de.elnino0916.android.girovo;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.security.spec.ECGenParameterSpec;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Whether this phone and this copy of Girovo are what they claim to be,
 * found out on the phone alone — no server of Girovo's and no request to
 * Google (Play Integrity's verdict can only be read on a server, and Girovo
 * has none). Three inputs:
 *
 *   - Key attestation. A fresh key made in the phone's secure hardware comes
 *     with a certificate chain that hardware signs, ending at one of Google's
 *     attestation roots. Its leaf records the boot the secure hardware itself
 *     saw: whether the bootloader is locked, and whether the system it
 *     started was the maker's (verified), another one signed by its own key
 *     (self-signed: a custom system such as GrapheneOS), or one nobody
 *     vouches for. Rooting or flashing a phone cannot rewrite that record
 *     without the hardware's key.
 *   - Read-only runtime observations in this app's own sandbox. A verified
 *     boot does not exclude a kernel compromised after boot.
 *   - The certificate this copy of the app is signed with, and who installed it.
 *
 * Neither stops a modified copy of Girovo — it would simply drop this check.
 * What they do is let the genuine app tell its user when the phone under it
 * is no longer one a PIN is safe on. The facts go to the page as they are;
 * lib/device-integrity.ts decides what they mean.
 *
 * Not checked: Google's list of revoked attestation keys, which would be a
 * request to Google on every start. A phone whose attestation key has leaked
 * can pass as unmodified.
 */
final class DeviceIntegrity {

    /** SHA-256 of the public key of each of Google's hardware attestation roots (android.googleapis.com/attestation/root). */
    private static final String[] GOOGLE_ROOTS = {
        // The RSA root, until 2042.
        "feb2ea7551ee316ed4bb443c8293b884dbfdea40b603ee3e4f4a897e4580fbae",
        // "Key Attestation CA1", the EC root of remotely provisioned keys, until 2035.
        "3ee44512a1af2beb39c889490c60ea3f82e43f5d5a5532f5ab9419f676cd07ec",
    };

    /** The attestation record's extension in the leaf certificate (KeyDescription). */
    private static final String KEY_DESCRIPTION_OID = "1.3.6.1.4.1.11129.2.1.17";
    /** AuthorizationList's rootOfTrust, [704] EXPLICIT. */
    private static final int ROOT_OF_TRUST_TAG = 704;
    private static final String ALIAS = "girovo-integrity";

    private DeviceIntegrity() {}

    static JSObject check(Context context) {
        JSObject result = new JSObject();
        JSArray runtime = RuntimeIntegrity.check(context);
        result.put("runtime", runtime);
        // No banking data, hosts content or installed-app inventory. This is
        // emitted by the app process, including release builds, for ADB verification.
        String process = "pid=" + android.os.Process.myPid() + " uid=" + android.os.Process.myUid();
        for (int i = 0; i < runtime.length(); i++) {
            Log.i("GirovoIntegrity", process + " runtime=" + runtime.optJSONObject(i));
        }
        attest(result);
        Log.i("GirovoIntegrity", process + " boot=" + result.optString("bootState", "unavailable")
            + " locked=" + result.opt("deviceLocked") + " attestation=" + result.optString("attestation", "unavailable"));
        signing(context, result);
        result.put("debug", BuildConfig.DEBUG);
        result.put("flavor", BuildConfig.DISTRIBUTION);
        result.put("sdk", Build.VERSION.SDK_INT);
        return result;
    }

    // ---------------------------------------------------------------------
    // Key attestation

    private static void attest(JSObject result) {
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            byte[] challenge = new byte[32];
            new SecureRandom().nextBytes(challenge);
            KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
            generator.initialize(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setAttestationChallenge(challenge)
                .build());
            generator.generateKeyPair();
            Certificate[] raw;
            try {
                raw = keyStore.getCertificateChain(ALIAS);
            } finally {
                // The key was only ever made to be attested.
                keyStore.deleteEntry(ALIAS);
            }
            if (raw == null || raw.length < 2) {
                result.put("attestation", "unavailable");
                return;
            }
            X509Certificate[] chain = new X509Certificate[raw.length];
            for (int i = 0; i < raw.length; i++) chain[i] = (X509Certificate) raw[i];
            result.put("chain", chainVerdict(chain));
            readKeyDescription(chain[0], challenge, result);
        } catch (Exception e) {
            // No attestation on this phone, or one that answers with nonsense:
            // nothing can be said about it either way.
            result.put("attestation", "error");
            result.put("error", e.getClass().getSimpleName());
        }
    }

    /** "google" when every certificate is signed by the next and the last is one of Google's roots. */
    private static String chainVerdict(X509Certificate[] chain) {
        try {
            for (int i = 0; i < chain.length - 1; i++) chain[i].verify(chain[i + 1].getPublicKey());
            X509Certificate root = chain[chain.length - 1];
            root.verify(root.getPublicKey());
            String key = sha256(root.getPublicKey().getEncoded());
            for (String google : GOOGLE_ROOTS) if (google.equals(key)) return "google";
            return "other";
        } catch (Exception e) {
            return "broken";
        }
    }

    private static void readKeyDescription(X509Certificate leaf, byte[] challenge, JSObject result) {
        byte[] ext = leaf.getExtensionValue(KEY_DESCRIPTION_OID);
        if (ext == null) {
            result.put("attestation", "unavailable");
            return;
        }
        // getExtensionValue hands the extension as an OCTET STRING around the KeyDescription.
        Der description = Der.read(Der.read(ext, 0).bytes(), 0);
        List<Der> fields = description.children();
        result.put("attestationVersion", fields.get(0).integer());
        int level = (int) fields.get(1).integer();
        result.put("securityLevel", level == 2 ? "strongbox" : level == 1 ? "tee" : "software");
        result.put("attestation", level == 0 ? "software" : "hardware");
        result.put("challengeOk", Arrays.equals(fields.get(4).bytes(), challenge));

        // The boot as the secure hardware saw it — in the list it enforces itself.
        Der rootOfTrust = find(fields.get(7), ROOT_OF_TRUST_TAG);
        if (rootOfTrust == null) rootOfTrust = find(fields.get(6), ROOT_OF_TRUST_TAG);
        if (rootOfTrust == null) return;
        List<Der> root = rootOfTrust.children().get(0).children();
        result.put("deviceLocked", root.get(1).bool());
        int state = (int) root.get(2).integer();
        result.put("bootState", state == 0 ? "verified" : state == 1 ? "self-signed" : state == 2 ? "unverified" : "failed");
    }

    /** The tagged [tag] EXPLICIT entry of an AuthorizationList, or null. */
    private static Der find(Der list, int tag) {
        for (Der entry : list.children()) if (entry.tagClass == 2 && entry.tag == tag) return entry;
        return null;
    }

    // ---------------------------------------------------------------------
    // The app's own signature

    private static void signing(Context context, JSObject result) {
        PackageManager pm = context.getPackageManager();
        String pkg = context.getPackageName();
        JSArray signers = new JSArray();
        try {
            Signature[] signatures;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                PackageInfo info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES);
                signatures = info.signingInfo == null ? new Signature[0] : info.signingInfo.getApkContentsSigners();
            } else {
                @SuppressWarnings("deprecation")
                PackageInfo info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES);
                signatures = info.signatures;
            }
            for (Signature s : signatures) signers.put(sha256(s.toByteArray()));
        } catch (Exception e) {
            // Left empty: the page then knows nothing about the signer.
        }
        result.put("signers", signers);
        String installer = null;
        try {
            installer = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? pm.getInstallSourceInfo(pkg).getInstallingPackageName()
                : pm.getInstallerPackageName(pkg);
        } catch (Exception e) {
            // Unknown installer.
        }
        result.put("installer", installer);
    }

    private static String sha256(byte[] data) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder hex = new StringBuilder(digest.length * 2);
        for (byte b : digest) hex.append(String.format("%02x", b));
        return hex.toString();
    }

    // ---------------------------------------------------------------------
    // Just enough DER to read a KeyDescription: tags (the high form too —
    // rootOfTrust is [704]), definite lengths, and the few primitives in it.

    static final class Der {
        /** 0 universal, 1 application, 2 context-specific, 3 private. */
        final int tagClass;
        final int tag;
        final byte[] buf;
        final int start;
        final int length;

        private Der(int tagClass, int tag, byte[] buf, int start, int length) {
            this.tagClass = tagClass;
            this.tag = tag;
            this.buf = buf;
            this.start = start;
            this.length = length;
        }

        static Der read(byte[] b, int offset) {
            int p = offset;
            int first = b[p++] & 0xff;
            int tagClass = first >> 6;
            int tag = first & 0x1f;
            if (tag == 0x1f) {
                tag = 0;
                int c;
                do {
                    c = b[p++] & 0xff;
                    tag = (tag << 7) | (c & 0x7f);
                } while ((c & 0x80) != 0);
            }
            int length = b[p++] & 0xff;
            if ((length & 0x80) != 0) {
                int n = length & 0x7f;
                if (n == 0 || n > 4) throw new IllegalArgumentException("unsupported length");
                length = 0;
                for (int i = 0; i < n; i++) length = (length << 8) | (b[p++] & 0xff);
            }
            if (length < 0 || p + length > b.length) throw new IllegalArgumentException("truncated");
            return new Der(tagClass, tag, b, p, length);
        }

        List<Der> children() {
            List<Der> out = new ArrayList<>();
            int p = start;
            while (p < start + length) {
                Der child = read(buf, p);
                out.add(child);
                p = child.start + child.length;
            }
            return out;
        }

        byte[] bytes() {
            return Arrays.copyOfRange(buf, start, start + length);
        }

        long integer() {
            if (length == 0 || length > 8) throw new IllegalArgumentException("integer size");
            long value = buf[start];
            for (int i = 1; i < length; i++) value = (value << 8) | (buf[start + i] & 0xff);
            return value;
        }

        boolean bool() {
            return length == 1 && buf[start] != 0;
        }
    }
}
