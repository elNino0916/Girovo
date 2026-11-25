package de.elnino0916.android.girovo;

import org.junit.Test;
import static org.junit.Assert.*;

import java.io.BufferedReader;
import java.io.StringReader;

public class RuntimeMapsTest {
    // A stock app process, as the owner's S26 maps it: the app and WebView
    // from folders that end in random letters, system libraries, fonts,
    // memory with and without a label.
    private static final String STOCK =
        "5b3e4f1000-5b3e4f3000 r--p 00000000 fe:10 3210    /system/bin/app_process64\n"
        + "70a1c00000-70a1e00000 r--p 00000000 fe:10 4321    /system/lib64/libvndksupport.so\n"
        + "70a2000000-70a2400000 r-xp 00000000 fe:2f 9876    /data/app/~~kSuFrIdA1xposedQ==/de.elnino0916.android.girovo-zYgIsKmagisk0==/base.apk\n"
        + "70a2400000-70a2800000 r-xp 00000000 fe:2f 9877    /data/app/~~Ab3riru9LSPosedX==/com.google.android.webview-Qw8frida77==/lib/arm64/libwebviewchromium.so\n"
        + "70a3000000-70a3200000 rw-p 00000000 00:00 0       [anon:dalvik-main space (region space)]\n"
        + "70a3200000-70a3300000 r--s 00000000 fe:10 555     /system/fonts/Roboto-Regular.ttf\n"
        + "70a3300000-70a3400000 rw-p 00000000 00:00 0 \n"
        + "70a3400000-70a3500000 r-xp 00000000 00:05 1234    /memfd:jit-cache (deleted)\n"
        + "7ffd000000-7ffd021000 rw-p 00000000 00:00 0       [stack]\n";

    private static RuntimeMaps.Scan scan(String text) throws Exception {
        return RuntimeMaps.scan(new BufferedReader(new StringReader(text)));
    }

    @Test public void aStockProcessHasNoFinding() throws Exception {
        RuntimeMaps.Scan scan = scan(STOCK);
        assertTrue(scan.complete);
        assertEquals(9, scan.lines);
        assertTrue(scan.findings.toString(), scan.findings.isEmpty());
    }

    // The folders above a file are random letters on every phone: they spell anything, and say nothing.
    @Test public void randomInstallFoldersAndLookalikeNamesAreNoFinding() {
        assertFalse(RuntimeMaps.suspicious("/data/app/~~kSuFrIdA1xposedQ==/com.example-zYgIsKmagisk0==/base.apk"));
        assertFalse(RuntimeMaps.suspicious("/data/app/~~x==/com.example-y==/lib/arm64/libapp.so"));
        // "ksu" sits inside libvndksupport.so and "journal_checksum"; neither is KernelSU.
        assertFalse(RuntimeMaps.suspicious("/system/lib64/libvndksupport.so"));
        assertFalse(RuntimeMaps.suspicious("/system/lib64/libsubstratum_theme.so"));
        // Words that hold a tool's name: Friday, exposed.
        assertFalse(RuntimeMaps.suspicious("/system/fonts/BlackFriday-Regular.ttf"));
        assertFalse(RuntimeMaps.suspicious("/product/app/Frida/Frida.apk"));
        assertFalse(RuntimeMaps.suspicious("/vendor/lib64/libexposed_camera.so"));
        assertFalse(RuntimeMaps.suspicious("/system/lib64/libmagic.so"));
        assertFalse(RuntimeMaps.suspicious("[anon:dalvik-/system/framework/boot-framework.art]"));
        assertFalse(RuntimeMaps.suspicious("[stack]"));
    }

    @Test public void rootFrameworkCodeInTheProcessIsAFinding() throws Exception {
        for (String name : new String[] {
            "/system/lib64/libzygisk.so",
            "/memfd:jit-zygisk-cache (deleted)",
            "/data/adb/modules/zygisk_lsposed/zygisk/arm64-v8a.so",
            "/data/adb/lspd/framework.dex",
            "/debug_ramdisk/.magisk/modules/x/lib.so",
            "/dev/Ab3/.magisk/zygisk/loader64.so",
            "/sbin/.magisk/busybox/busybox",
            "/system/lib64/liblspd.so",
            "/system/framework/XposedBridge.jar",
            "/system/lib64/libxposed_art.so",
            "/system/lib64/libriruloader.so",
            "/data/local/tmp/re.frida.server/frida-agent-64.so",
            "/memfd:frida-agent-64.so (deleted)",
            "/data/app/~~x==/com.example-y==/lib/arm64/libfrida-gadget.so",
            "/usr/lib/libsubstrate.so",
            "[anon:zygisk_module]",
            "/system/bin/magisk",
        }) {
            assertTrue(name, RuntimeMaps.suspicious(name));
            RuntimeMaps.Scan scan = scan(STOCK + "70b0000000-70b0100000 r-xp 00000000 fe:2f 42      " + name + "\n");
            assertEquals(name, 1, scan.findings.size());
        }
    }

    @Test public void oneLibraryMappedSeveralTimesIsNamedOnce() throws Exception {
        String line = " r-xp 00000000 fe:2f 42      /system/lib64/libzygisk.so\n";
        RuntimeMaps.Scan scan = scan(STOCK + "70b0000000-70b0100000" + line + "70b0100000-70b0200000" + line);
        assertEquals(1, scan.findings.size());
        assertEquals("/system/lib64/libzygisk.so", scan.findings.get(0));
    }

    @Test public void theNameIsTheLastColumnWithItsSpaces() {
        assertEquals("/memfd:jit-cache (deleted)", RuntimeMaps.name("70a3400000-70a3500000 r-xp 00000000 00:05 1234    /memfd:jit-cache (deleted)"));
        assertNull(RuntimeMaps.name("70a3300000-70a3400000 rw-p 00000000 00:00 0 "));
        assertNull(RuntimeMaps.name("70a3300000-70a3400000 rw-p 00000000 00:00 0"));
        assertNull(RuntimeMaps.name(""));
    }

    @Test public void anEmptyReadIsNoCleanAnswer() throws Exception {
        assertFalse(scan("").complete);
    }
}
