package de.elnino0916.android.girovo;

import org.junit.Test;
import static org.junit.Assert.*;

import java.io.File;
import java.io.FileInputStream;
import java.io.StringReader;
import java.math.BigInteger;

public class RevokedKeysTest {
    private static final String LIST =
        "# fetched 2026-11-24\n"
        + "# 4 certificate serial numbers\n"
        + "\n"
        + "5014131950868983053\n"       // digits only, and hex all the same
        + "2c8cdddfd5e03bfc\n"
        + "1100CACD4407FB6302D6C96C1C14C004\r\n"
        + "000c8966fcb2fbb0d7a\n"
        // Too short for a serial number: what a broken list would hold.
        + "1\n"
        + "00ab\n"
        + "<html>not a list</html>\n";

    private static RevokedKeys keys() throws Exception {
        return RevokedKeys.read(new StringReader(LIST));
    }

    @Test public void commentsBlankLinesAndRubbishAreNoEntries() throws Exception {
        assertEquals(4, keys().size());
        assertEquals(0, RevokedKeys.read(new StringReader("")).size());
    }

    @Test public void aSerialIsLookedUpInHexAlsoWhereItIsDigitsOnly() throws Exception {
        RevokedKeys keys = keys();
        assertTrue(keys.lists(new BigInteger("2c8cdddfd5e03bfc", 16)));
        assertTrue(keys.lists(new BigInteger("5014131950868983053", 16)));
        // The number those digits would be in decimal is another certificate's.
        assertFalse(keys.lists(new BigInteger("5014131950868983053")));
        // Upper case, a Windows line ending and leading zeros in the file do not hide an entry.
        assertTrue(keys.lists(new BigInteger("1100cacd4407fb6302d6c96c1c14c004", 16)));
        assertTrue(keys.lists(new BigInteger("c8966fcb2fbb0d7a", 16)));
    }

    // The key a phone makes for the check has the serial number 1, on every
    // phone. A list that named it would call them all unprovable.
    @Test public void shortNumbersAreNoEntries() throws Exception {
        RevokedKeys keys = keys();
        assertFalse(keys.lists(BigInteger.ONE));
        assertFalse(keys.lists(new BigInteger("ab", 16)));
        assertFalse(keys.lists(BigInteger.ZERO));
        assertEquals(0, RevokedKeys.read(new StringReader("0\n1\n2\n3\n")).size());
    }

    @Test public void otherSerialsAreNotListed() throws Exception {
        RevokedKeys keys = keys();
        assertFalse(keys.lists(new BigInteger("2c8cdddfd5e03bfd", 16)));
        assertFalse(keys.lists(BigInteger.ONE));
        assertFalse(keys.lists(BigInteger.valueOf(-171)));
        assertFalse(keys.lists(null));
    }

    // The copy the app ships (scripts/attestation-revoked.mjs writes it).
    @Test public void theShippedCopyIsReadable() throws Exception {
        File copy = new File("src/main/res/raw/attestation_revoked.txt");
        assertTrue(copy.getAbsolutePath(), copy.isFile());
        try (FileInputStream in = new FileInputStream(copy)) {
            RevokedKeys keys = RevokedKeys.read(in);
            assertTrue(keys.size() + " serials", keys.size() > 1000);
            assertFalse(keys.lists(BigInteger.ONE));
        }
    }
}
