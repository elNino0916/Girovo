package de.elnino0916.android.girovo;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.Assert.*;

/**
 * What the fingerprint login deletes for a PIN the bank turned down in the
 * check for new Umsätze (BiometricPlugin.refusedCopies): every copy of a
 * noted login's PIN, whenever it was stored, and nothing of anyone else's.
 */
public class BiometricNotesTest {
    // Three logins, by the names the page's bridge gives them (32 hex digits).
    private static final String A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private static final String C = "cccccccccccccccccccccccccccccccc";

    private static Set<String> names(String... all) {
        return new HashSet<>(Arrays.asList(all));
    }

    private static Set<String> gone(Set<String> stored, Set<String> refused) {
        List<String> out = BiometricPlugin.refusedCopies(stored, refused);
        assertEquals("each name once", out.size(), new HashSet<>(out).size());
        return new HashSet<>(out);
    }

    @Test public void withoutANoteNothingGoes() {
        Set<String> stored = names(A, A + "/" + A, A + "/" + B, B, B + "/" + B);
        assertTrue(gone(stored, Collections.<String>emptySet()).isEmpty());
        // A note about a login nothing is kept for.
        assertTrue(gone(stored, names(C)).isEmpty());
    }

    @Test public void theLoginsOwnEntryGoesAsOnePiece() {
        Set<String> stored = names(A, A + "/" + A, A + "/" + B);
        // Named once: its own PIN and the further banks beside it go with it (forget), not one by one.
        assertEquals(names(A), gone(stored, names(A)));
    }

    @Test public void aFurtherBanksPinBesideOtherLoginsGoesAndThoseLoginsStay() {
        // B is kept beside A and beside C, and has an entry of its own.
        Set<String> stored = names(A, A + "/" + A, A + "/" + B, C, C + "/" + C, C + "/" + B, B, B + "/" + B);
        assertEquals(names(B, A + "/" + B, C + "/" + B), gone(stored, names(B)));
    }

    @Test public void noClockDecidesIt() {
        // An entry of the old form (the PIN itself, no items) and copies from any version alike: a note takes them all.
        Set<String> stored = names(A, B, B + "/" + B, C, C + "/" + C, C + "/" + A);
        assertEquals(names(A, C + "/" + A), gone(stored, names(A)));
        assertEquals(names(B), gone(stored, names(B)));
    }

    @Test public void severalNotesAtOnce() {
        Set<String> stored = names(A, A + "/" + A, A + "/" + B, A + "/" + C, C, C + "/" + C);
        // C's own entry, and its PIN beside A; A's entry and its own PIN stay.
        assertEquals(names(A + "/" + B, A + "/" + C, C), gone(stored, names(B, C)));
    }

    @Test public void everyLoginThatLosesItsFingerprintLoginIsTold() {
        Set<String> stored = names(A, A + "/" + A, A + "/" + B, A + "/" + C, C, C + "/" + C, C + "/" + B);
        // A's entry goes: A, and the further banks B and C kept beside it.
        assertEquals(names(A, B, C), BiometricPlugin.loginsLosing(A, stored));
        // One PIN beside another login: that login alone.
        assertEquals(names(B), BiometricPlugin.loginsLosing(C + "/" + B, stored));
        // An entry of the old form, with nothing beside it.
        assertEquals(names(B), BiometricPlugin.loginsLosing(B, names(B, A)));
    }

    @Test public void aStoredNameSaysWhoseLoginItKeeps() {
        assertEquals(A, BiometricPlugin.loginOfName(A));
        assertEquals(B, BiometricPlugin.loginOfName(A + "/" + B));
        assertEquals(A, BiometricPlugin.loginOfName(A + "/" + A));
    }
}
