package de.elnino0916.android.girovo;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.Assert.*;

/**
 * What the fingerprint login deletes for a PIN the bank turned down in the
 * check for new Umsätze (BiometricPlugin.refusedCopies): the copies stored
 * before the note, and nothing stored since.
 */
public class BiometricNotesTest {
    // Three logins, by the names the page's bridge gives them (32 hex digits).
    private static final String A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private static final String C = "cccccccccccccccccccccccccccccccc";

    private static Set<String> names(String... all) {
        return new HashSet<>(Arrays.asList(all));
    }

    private static Map<String, Long> times(Object... pairs) {
        Map<String, Long> out = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) out.put((String) pairs[i], ((Number) pairs[i + 1]).longValue());
        return out;
    }

    private static Set<String> gone(Set<String> names, Map<String, Long> storedAt, Map<String, Long> refusedAt) {
        List<String> out = BiometricPlugin.refusedCopies(names, storedAt, refusedAt);
        assertEquals("each name once", out.size(), new HashSet<>(out).size());
        return new HashSet<>(out);
    }

    @Test public void aCopyIsOlderThanTheNoteOnlyWhenStoredBeforeIt() {
        assertTrue(BiometricPlugin.storedBefore(100L, 200));
        assertFalse("stored after the note: the PIN the bank took since", BiometricPlugin.storedBefore(300L, 200));
        assertFalse("the same moment is not before", BiometricPlugin.storedBefore(200L, 200));
        assertTrue("from before the times were kept: older than any note", BiometricPlugin.storedBefore(null, 1));
    }

    @Test public void withoutANoteNothingGoes() {
        Set<String> stored = names(A, A + "/" + A, A + "/" + B, B, B + "/" + B);
        assertTrue(gone(stored, times(), Collections.<String, Long>emptyMap()).isEmpty());
        // A note about a login nothing is kept for.
        assertTrue(gone(stored, times(), times(C, 500)).isEmpty());
    }

    @Test public void theLoginsOwnEntryGoesWhenItsOwnPinIsOlderThanTheNote() {
        Set<String> stored = names(A, A + "/" + A, A + "/" + B);
        Map<String, Long> storedAt = times(A + "/" + A, 100, A + "/" + B, 100);
        // The entry is one piece: named once, and its other PINs go with it (forget), not one by one.
        assertEquals(names(A), gone(stored, storedAt, times(A, 200)));
        // Stored after the note: it stays.
        assertTrue(gone(stored, storedAt, times(A, 50)).isEmpty());
    }

    @Test public void aFurtherBanksPinBesideAnotherLoginGoesAndThatLoginStays() {
        // B is kept beside A and beside C, and has an entry of its own.
        Set<String> stored = names(A, A + "/" + A, A + "/" + B, C, C + "/" + C, C + "/" + B, B, B + "/" + B);
        Map<String, Long> storedAt = times(
            A + "/" + A, 100, A + "/" + B, 100, C + "/" + C, 100, C + "/" + B, 100, B + "/" + B, 100);
        assertEquals(names(B, A + "/" + B, C + "/" + B), gone(stored, storedAt, times(B, 200)));

        // The user typed B's new PIN and it was sealed beside A after the note: only the older copies go.
        storedAt.put(A + "/" + B, 300L);
        assertEquals(names(B, C + "/" + B), gone(stored, storedAt, times(B, 200)));
    }

    @Test public void copiesFromBeforeTheTimesWereKeptAreOlderThanAnyNote() {
        // An entry of the old form holds the PIN itself and has no items; a newer one from an earlier version has no times.
        Set<String> stored = names(A, B, B + "/" + B, C, C + "/" + C, C + "/" + A);
        assertEquals(names(A, C + "/" + A), gone(stored, times(), times(A, 1)));
        assertEquals(names(B), gone(stored, times(), times(B, 1)));
    }

    @Test public void severalNotesAreEachTakenByTheirOwnTime() {
        Set<String> stored = names(A, A + "/" + A, A + "/" + B, A + "/" + C);
        Map<String, Long> storedAt = times(A + "/" + A, 100, A + "/" + B, 100, A + "/" + C, 400);
        // B refused after its copy was stored, C before: B's goes, C's and A's stay.
        assertEquals(names(A + "/" + B), gone(stored, storedAt, times(B, 200, C, 300)));
    }
}
