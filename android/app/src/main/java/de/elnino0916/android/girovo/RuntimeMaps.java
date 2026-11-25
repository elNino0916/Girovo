package de.elnino0916.android.girovo;

import java.io.BufferedReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * What is loaded into Girovo's own process, read from /proc/self/maps: code
 * a root framework put there to hook the app (Zygisk and its modules,
 * LSPosed, Xposed, Riru, Frida, Substrate). That is the attack a banking app
 * has to fear from root: a hook in this process reads the PIN as it is typed.
 *
 * Only names no stock phone has count. A framework that renames or unmaps
 * itself is not seen; "nothing seen" is this read, not a clean process.
 *
 * No filesystem or Android API access: plain Java, tested in RuntimeMapsTest.
 */
final class RuntimeMaps {
    static final class Scan {
        final List<String> findings = new ArrayList<>();
        int lines;
        boolean complete = true;
    }

    /** Enough for any app (a WebView app maps a few thousand regions); a longer table is cut and says so. */
    private static final int MAX_LINES = 200_000;

    /**
     * Looked for in a mapping's own name only (see suspicious()). Each is the
     * tool's name as it writes it itself: libzygisk.so, zygisk-ld,
     * /memfd:jit-zygisk-cache, magisk, liblspd.so, XposedBridge.jar,
     * libxposed_art.so, libriru.so, libriruloader.so, frida-agent-64.so,
     * libfrida-gadget.so, libsubstrate.so, kernelsu.
     *
     * Whole names, not the shortest part that would do: "frida" is in
     * "friday", "xposed" in "exposed", "riru" and "substrate" in who knows
     * what a phone maker ships.
     */
    private static final String[] MARKS = {
        "zygisk", "magisk", "lsposed", "edxposed", "liblspd", "xposedbridge", "libxposed", "libriru",
        "frida-agent", "frida-gadget", "frida-helper", "libfrida", "libsubstrate", "kernelsu",
    };

    /** Where root tools keep their files; nothing of a stock phone's is loaded from there. */
    private static final String[] ROOT_FOLDERS = { "/data/adb", "/debug_ramdisk", "/sbin/.magisk" };

    private RuntimeMaps() {}

    static Scan scan(BufferedReader reader) throws IOException {
        Scan result = new Scan();
        String line;
        while ((line = reader.readLine()) != null) {
            if (++result.lines > MAX_LINES) {
                result.complete = false;
                break;
            }
            String name = name(line);
            if (name == null || !suspicious(name)) continue;
            String finding = shorten(name);
            // One library is mapped several times (code, data, relocations): named once.
            if (result.findings.size() < 8 && !result.findings.contains(finding)) result.findings.add(finding);
        }
        if (result.lines == 0) result.complete = false;
        return result;
    }

    /** A line's last column: "address perms offset dev inode  name", the name with its spaces ("… (deleted)"). */
    static String name(String line) {
        String[] fields = line.trim().split(" +", 6);
        return fields.length < 6 || fields[5].isEmpty() ? null : fields[5];
    }

    static boolean suspicious(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        if (lower.contains("/.magisk/")) return true;
        for (String folder : ROOT_FOLDERS) if (lower.startsWith(folder + "/")) return true;
        // The last part alone: a file's name, a "/memfd:…" or an "[anon:…]"
        // label. Never the folders above it. An installed app lives in
        // /data/app/~~<random>==/<package>-<random>==/, and random letters
        // spell "ksu" or "frida" on some phone sooner or later.
        String own = lower.substring(lower.lastIndexOf('/') + 1);
        for (String mark : MARKS) if (own.contains(mark)) return true;
        return false;
    }

    private static String shorten(String value) {
        return value.length() <= 160 ? value : value.substring(0, 160) + "…";
    }
}
