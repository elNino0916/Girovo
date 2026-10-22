package de.elnino0916.android.girovo;

import org.junit.Test;
import static org.junit.Assert.*;

public class RuntimeMountsTest {
    private static final String STOCK =
        "42 41 254:14 / / ro,relatime shared:1 - erofs /dev/block/dm-14 ro,seclabel\n"
        + "53 42 254:16 / /product ro,relatime shared:10 - erofs /dev/block/dm-16 ro,seclabel\n"
        + "60 42 0:24 / /apex rw,nosuid,nodev,noexec - tmpfs tmpfs rw,seclabel\n"
        + "161 60 7:0 / /apex/com.android.runtime ro,nodev - ext4 /dev/block/loop0 ro,seclabel\n"
        + "281 43 0:44 / /dev/usb-ffs/adb rw,relatime shared:51 - functionfs adb rw,seclabel\n";

    @Test public void normalReadOnlyPartitionsApexAndAdbAreNotFindings() {
        RuntimeMounts.Scan scan = RuntimeMounts.scan(STOCK, true);
        assertTrue(scan.complete);
        assertTrue(scan.findings.isEmpty());
    }

    @Test public void capturedDeletedHostsIsAFindingButStackedYoutubeCoversAreNot() {
        // A preinstalled app hidden under tmpfs (the owner's S26) gives no app root.
        String modified = STOCK
            + "299 53 0:53 / /product/app/YouTube rw,relatime shared:66 - tmpfs none rw,seclabel\n"
            + "301 42 254:81 /adb/modules/bindhosts/system/etc/hosts//deleted /system/etc/hosts rw,nosuid,nodev,noatime shared:48 - f2fs /dev/block/dm-81 rw,seclabel\n"
            + "303 299 0:54 / /product/app/YouTube rw,relatime shared:67 - tmpfs none rw,seclabel\n"
            + "305 303 0:55 / /product/app/YouTube rw,relatime shared:68 - tmpfs none rw,seclabel\n";
        RuntimeMounts.Scan scan = RuntimeMounts.scan(modified, true);
        assertTrue(scan.complete);
        assertEquals(1, scan.findings.size());
        assertTrue(scan.findings.get(0).contains("hosts//deleted"));
    }

    @Test public void tmpfsOverExecutablesOrLibrariesIsAFinding() {
        RuntimeMounts.Scan scan = RuntimeMounts.scan(STOCK
            + "310 42 0:60 / /system/bin/app_process64 rw - tmpfs none rw\n"
            + "311 53 0:61 / /vendor/lib64/libfoo.so rw - tmpfs none rw\n"
            + "312 53 0:62 / /system/priv-app/Bloat rw - tmpfs none rw\n", true);
        assertTrue(scan.complete);
        assertEquals(2, scan.findings.size());
    }

    @Test public void malformedEmptyAndTruncatedReadsAreNotCompleteNegatives() {
        assertFalse(RuntimeMounts.scan("", true).complete);
        assertFalse(RuntimeMounts.scan("not mountinfo", true).complete);
        assertFalse(RuntimeMounts.scan(STOCK, false).complete);
        RuntimeMounts.Scan partial = RuntimeMounts.scan(STOCK
            + "299 53 0:53 / /system/bin/su rw - tmpfs none rw\nmalformed", false);
        assertFalse(partial.complete);
        assertEquals(1, partial.findings.size());
    }

    @Test public void escapedModuleRootsAndOptionalFieldsAreParsed() {
        RuntimeMounts.Scan scan = RuntimeMounts.scan(
            "301 42 254:81 /adb/modules/custom\\040module/hosts//deleted /system/etc/hosts rw shared:48 master:1 - f2fs /dev/block/dm-81 rw\n", true);
        assertTrue(scan.complete);
        assertTrue(scan.findings.get(0).contains("custom module"));
    }

    @Test public void similarlyNamedNormalPathsAreNotRootModules() {
        RuntimeMounts.Scan scan = RuntimeMounts.scan(
            "301 42 254:81 /adb/modules-backup/file /data/local/tmp/file rw - f2fs /dev/block/dm-81 rw\n", true);
        assertTrue(scan.complete);
        assertTrue(scan.findings.isEmpty());
    }

    @Test public void overlayAndWritableSystemAreFindingsButWritableDataIsNot() {
        RuntimeMounts.Scan scan = RuntimeMounts.scan(
            "1 0 0:1 / /system ro - overlay overlay ro,lowerdir=/lower\n"
            + "2 1 254:1 / /vendor rw - ext4 /dev/block/dm-1 rw\n"
            + "3 1 254:2 / /data rw - f2fs /dev/block/dm-2 rw\n", true);
        assertTrue(scan.complete);
        assertEquals(2, scan.findings.size());
    }
}
