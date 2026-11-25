package de.elnino0916.android.girovo;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Google's list of revoked attestation keys (android.googleapis.com/attestation/status),
 * as the copy the app ships: res/raw/attestation_revoked.txt, one certificate
 * serial number a line, written by scripts/attestation-revoked.mjs before a
 * release. Read from the package, so the phone asks Google nothing.
 *
 * A key lands on that list when it has leaked, mostly: such a key signs any
 * boot state its holder likes, so a chain through it proves nothing. Factory
 * keys are shared by a whole batch of phones, though, and a revoked batch
 * takes its honest phones with it: listed means "cannot prove", not "rooted".
 *
 * The copy is as old as the release. A key revoked since passes until the next one.
 *
 * No Android API: plain Java, tested in RevokedKeysTest.
 */
final class RevokedKeys {
    private final Set<String> serials = new HashSet<>();

    private RevokedKeys() {}

    static RevokedKeys read(InputStream in) throws IOException {
        return read(new InputStreamReader(in, StandardCharsets.UTF_8));
    }

    static RevokedKeys read(Reader in) throws IOException {
        RevokedKeys keys = new RevokedKeys();
        BufferedReader reader = new BufferedReader(in);
        String line;
        while ((line = reader.readLine()) != null) {
            String serial = line.trim().toLowerCase(Locale.ROOT);
            if (serial.isEmpty() || serial.startsWith("#")) continue;
            // Anything that is no number is no entry; a damaged file must not match by accident.
            if (!serial.matches("[0-9a-f]{1,64}")) continue;
            serial = serial.replaceFirst("^0+(?=.)", "");
            // Nor a short one. Google's shortest is 17 digits; a "1" in a broken list would
            // match the same certificate on every phone and call them all unprovable.
            if (serial.length() < SHORTEST) continue;
            keys.serials.add(serial);
        }
        return keys;
    }

    /** Fewer hex digits than this is no attestation key's serial number (64 bits and up). */
    static final int SHORTEST = 16;

    int size() {
        return serials.size();
    }

    /**
     * A certificate's serial number as Google lists it: lowercase hex without
     * leading zeros. Close to half the entries are digits only
     * (5014131950868983053) and look decimal. They are hex all the same, as
     * Google's documentation says outright ("in base 16, not base 10") and
     * its own verifier does.
     */
    boolean lists(BigInteger serial) {
        return serial != null && serial.signum() > 0 && serials.contains(serial.toString(16));
    }
}
