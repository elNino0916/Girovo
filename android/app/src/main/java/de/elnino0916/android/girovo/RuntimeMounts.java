package de.elnino0916.android.girovo;

import java.util.ArrayList;
import java.util.List;

/** Parses only the calling process's mountinfo. No filesystem or Android API access. */
final class RuntimeMounts {
    static final class Scan {
        final List<String> findings = new ArrayList<>();
        boolean complete;

        Scan(boolean complete) { this.complete = complete; }
    }

    private RuntimeMounts() {}

    static Scan scan(String text, boolean complete) {
        Scan result = new Scan(complete);
        int entries = 0;
        for (String line : text.split("\n")) {
            if (line.isEmpty()) continue;
            int separator = line.indexOf(" - ");
            if (separator < 0) {
                result.complete = false;
                continue;
            }
            String[] fields = line.substring(0, separator).split(" +");
            String[] filesystem = line.substring(separator + 3).split(" +");
            if (fields.length < 6 || filesystem.length < 3
                || !fields[0].matches("[0-9]+") || !fields[1].matches("[0-9]+")
                || !fields[2].matches("[0-9]+:[0-9]+")
                || !fields[3].startsWith("/") || !fields[4].startsWith("/")) {
                result.complete = false;
                continue;
            }
            entries++;
            String root = unescape(fields[3]);
            String target = unescape(fields[4]);
            String type = filesystem[0];
            boolean protectedTree = within(target, "/system") || within(target, "/system_ext")
                || within(target, "/product") || within(target, "/vendor") || within(target, "/odm");
            boolean module = within(root, "/adb/modules") || within(root, "/data/adb/modules")
                || within(root, "/adb/ksu") || within(root, "/data/adb/ksu")
                || within(root, "/adb/magisk") || within(root, "/data/adb/magisk")
                || within(root, "/sbin/.magisk") || within(root, "/debug_ramdisk/.magisk");
            boolean hosts = target.equals("/system/etc/hosts") || target.equals("/etc/hosts");
            boolean codeCover = type.equals("tmpfs") && protectedTree && codeTree(target);
            boolean writableSystem = protectedTree
                && ("," + fields[5] + ",").contains(",rw,")
                && (type.equals("ext4") || type.equals("erofs"));
            if (module || hosts || codeCover || (protectedTree && type.equals("overlay")) || writableSystem) {
                // Bound diagnostic output even when a modified kernel supplies arbitrary names.
                if (result.findings.size() < 8) result.findings.add(shorten(target) + " type=" + shorten(type) + " root=" + shorten(root));
            }
        }
        if (entries == 0) result.complete = false;
        return result;
    }

    /**
     * Executables and libraries only. An app folder under tmpfs
     * (/product/app/YouTube on the owner's S26) hides a preinstalled app —
     * phone makers and debloating do that too — and gives no app root.
     */
    private static boolean codeTree(String path) {
        for (String partition : new String[] { "/system", "/system_ext", "/product", "/vendor", "/odm" }) {
            for (String dir : new String[] { "/bin", "/xbin", "/lib", "/lib64" }) {
                if (within(path, partition + dir)) return true;
            }
        }
        return false;
    }

    private static boolean within(String path, String directory) {
        return path.equals(directory) || path.startsWith(directory + "/");
    }

    private static String unescape(String path) {
        return path.replace("\\040", " ").replace("\\011", "\t")
            .replace("\\012", "\n").replace("\\134", "\\");
    }

    private static String shorten(String value) {
        return value.length() <= 160 ? value : value.substring(0, 160) + "…";
    }
}
