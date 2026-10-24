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
            // A partition root or its code remounted writable; vendors keep writable
            // firmware and persist folders under /vendor, which say nothing.
            boolean writableSystem = protectedTree
                && (partitionRoot(target) || codeTree(target))
                && ("," + fields[5] + ",").contains(",rw,")
                && (type.equals("ext4") || type.equals("erofs"));
            boolean rootOverlay = protectedTree && type.equals("overlay") && rootOverlay(filesystem[1], filesystem[2]);
            if (module || hosts || codeCover || rootOverlay || writableSystem) {
                // Bound diagnostic output even when a modified kernel supplies arbitrary names.
                if (result.findings.size() < 8) result.findings.add(shorten(target) + " type=" + shorten(type) + " root=" + shorten(root));
            }
        }
        if (entries == 0) result.complete = false;
        return result;
    }

    private static final String[] PARTITIONS = { "/system", "/system_ext", "/product", "/vendor", "/odm" };

    private static boolean partitionRoot(String path) {
        for (String partition : PARTITIONS) if (path.equals(partition)) return true;
        return false;
    }

    /** Where a root overlay's layers live: writable storage, the root tools' own folders, memory. */
    private static final String[] ROOT_LAYERS = {
        "/data", "/adb", "/debug_ramdisk", "/sbin", "/dev", "/mnt", "/cache", "/tmp",
    };

    /**
     * Where vendor init mounts the maker's own partitions. HyperOS mounts its
     * regional mi_ext partition at /mnt/vendor/mi_ext and stacks
     * /mnt/vendor/mi_ext/product/… onto /product/… — on every stock Xiaomi —
     * so a layer here is the maker's, though /mnt is otherwise a root layer.
     */
    private static final String MAKER_MOUNTS = "/mnt/vendor";

    /** A layer in the maker's own mounts, not one that only climbs out of them (".."). */
    static boolean makerLayer(String layer) {
        return within(layer, MAKER_MOUNTS) && !(layer + "/").contains("/../");
    }

    /**
     * An overlay over a system partition that a root tool made. Phone makers
     * overlay their own read-only partitions too — Xiaomi's HyperOS stacks
     * /mnt/vendor/mi_ext onto /product (and read as rooted until 5.14.1),
     * OPPO and OnePlus their /my_* partitions — so the overlay itself proves
     * nothing. KernelSU, APatch and modules take their layers from writable
     * storage or memory, often name themselves as the source, and may add a
     * writable upper layer; a maker's overlay does none of that. Options it
     * does not show are no evidence either way.
     */
    static boolean rootOverlay(String source, String options) {
        if (source.matches("(?i).*(ksu|magisk|apatch|zygisk).*")) return true;
        for (String option : options.split(",")) {
            int eq = option.indexOf('=');
            if (eq < 0) continue;
            String key = option.substring(0, eq);
            String value = unescape(option.substring(eq + 1));
            if (key.equals("upperdir") || key.equals("workdir")) return true;
            if (!key.equals("lowerdir")) continue;
            for (String layer : value.split(":")) {
                if (makerLayer(layer)) continue;
                for (String place : ROOT_LAYERS) if (within(layer, place)) return true;
            }
        }
        return false;
    }

    /**
     * Executables and libraries only. An app folder under tmpfs
     * (/product/app/YouTube on the owner's S26) hides a preinstalled app —
     * phone makers and debloating do that too — and gives no app root.
     */
    private static boolean codeTree(String path) {
        for (String partition : PARTITIONS) {
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
