package de.elnino0916.android.girovo;

import android.content.Context;
import android.content.pm.PackageManager;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** Read-only observations in Girovo's own UID, SELinux domain and mount namespace. */
final class RuntimeIntegrity {
    private static final int MAX_MOUNT_BYTES = 256 * 1024;
    // Keep these exact queries in sync with AndroidManifest.xml. No installed-app inventory.
    // KernelSU and its forks (KernelSU Next, SukiSU Ultra), Magisk and its forks (Alpha, Kitsune),
    // APatch, SuperSU, and the manager of LSPosed, which needs root to hook apps.
    private static final String[] MANAGERS = {
        "me.weishu.kernelsu", "com.rifsxd.ksunext", "com.sukisu.ultra",
        "com.topjohnwu.magisk", "io.github.vvb2060.magisk", "io.github.huskydg.magisk",
        "me.bmax.apatch", "eu.chainfire.supersu", "org.lsposed.manager",
    };
    private static final String[] ROOT_PATHS = {
        "/system/bin/su", "/system/xbin/su", "/sbin/su", "/su/bin/su",
        "/system/bin/magisk", "/data/adb/ksu/bin/ksud",
    };
    /** What a rooted phone's shell can run and a stock one's cannot, by the name each tool installs itself under. */
    private static final String[] ROOT_TOOLS = { "su", "magisk", "resetprop", "magiskpolicy", "supolicy", "ksud", "apd" };
    /** The system's own program folders, beside whatever this process's PATH names. */
    private static final String[] TOOL_FOLDERS = {
        "/system/bin", "/system/xbin", "/system_ext/bin", "/product/bin", "/vendor/bin", "/vendor/xbin", "/odm/bin",
    };

    private RuntimeIntegrity() {}

    static JSArray check(Context context) {
        JSArray checks = new JSArray();
        mounts(checks);
        checks.put(hosts());
        checks.put(maps());
        checks.put(tools());
        checks.put(selinux());
        for (String path : ROOT_PATHS) checks.put(path(path));
        for (String name : MANAGERS) checks.put(manager(context.getPackageManager(), name));
        return checks;
    }

    /** The mount table's two answers: what a root tool mounted ("mounts"), and covers that only count beside another sign ("covers"). */
    private static void mounts(JSArray checks) {
        try (FileInputStream input = new FileInputStream("/proc/self/mountinfo")) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            while (bytes.size() < MAX_MOUNT_BYTES
                && (read = input.read(buffer, 0, Math.min(buffer.length, MAX_MOUNT_BYTES - bytes.size()))) != -1) {
                bytes.write(buffer, 0, read);
            }
            boolean complete = bytes.size() < MAX_MOUNT_BYTES || input.read() == -1;
            RuntimeMounts.Scan scan = RuntimeMounts.scan(bytes.toString(StandardCharsets.UTF_8.name()), complete);
            String detail = scan.complete ? "own mount table read" : "incomplete or malformed mount table";
            checks.put(listed("mounts", scan.findings, scan.complete, detail));
            checks.put(listed("covers", scan.covers, scan.complete, detail));
        } catch (Exception e) {
            checks.put(result("mounts", "unavailable", error(e)));
            checks.put(result("covers", "unavailable", error(e)));
        }
    }

    private static JSObject hosts() {
        StructStat file;
        try {
            file = Os.stat("/system/etc/hosts");
        } catch (Exception e) {
            // No hosts object to compare is an unavailable metadata check, not a clean hosts file.
            return result("hosts", "unavailable", error(e));
        }
        String detail = "dev=" + file.st_dev + " ino=" + file.st_ino + " links=" + file.st_nlink
            + " size=" + file.st_size + " mode=" + Integer.toOctalString(file.st_mode & 07777);
        boolean found = file.st_nlink == 0;
        try {
            StructStat parent = Os.stat("/system/etc");
            found |= file.st_dev != parent.st_dev;
            return result("hosts", found ? "found" : "nothing seen", detail + " parentDev=" + parent.st_dev);
        } catch (Exception e) {
            return result("hosts", found ? "found" : "unavailable", detail + "; parent " + error(e));
        }
    }

    /** Code a root framework loaded into this very process (RuntimeMaps). Names only; nothing mapped is read. */
    private static JSObject maps() {
        try (BufferedReader reader = new BufferedReader(
            new InputStreamReader(new FileInputStream("/proc/self/maps"), StandardCharsets.UTF_8))) {
            RuntimeMaps.Scan scan = RuntimeMaps.scan(reader);
            return listed("maps", scan.findings, scan.complete, scan.lines + " mappings read" + (scan.complete ? "" : ", incomplete"));
        } catch (Exception e) {
            return result("maps", "unavailable", error(e));
        }
    }

    /**
     * su and the root tools' own programs in every folder a shell would look
     * in. Metadata only (lstat), as for ROOT_PATHS: nothing is opened or run.
     * A folder this app may not look into answers "refused", which is no
     * answer, and counts as nothing.
     */
    private static JSObject tools() {
        Set<String> folders = new LinkedHashSet<>(Arrays.asList(TOOL_FOLDERS));
        String search = System.getenv("PATH");
        if (search != null) {
            for (String folder : search.split(":")) {
                String clean = folder.replaceAll("/+$", "");
                if (clean.startsWith("/") && clean.length() <= 128 && folders.size() < 32) folders.add(clean);
            }
        }
        JSArray evidence = new JSArray();
        int absent = 0;
        int refused = 0;
        for (String folder : folders) {
            for (String tool : ROOT_TOOLS) {
                String path = folder + "/" + tool;
                try {
                    Os.lstat(path);
                    if (evidence.length() < 8) evidence.put(path);
                } catch (ErrnoException e) {
                    if (e.errno == OsConstants.ENOENT || e.errno == OsConstants.ENOTDIR) absent++;
                    else refused++;
                } catch (Exception e) {
                    refused++;
                }
            }
        }
        JSObject check = result("tools", evidence.length() > 0 ? "found" : absent > 0 ? "nothing seen" : "unavailable",
            folders.size() + " folders: " + absent + " absent, " + refused + " refused");
        check.put("evidence", evidence);
        return check;
    }

    /**
     * Whether the kernel enforces its access rules (SELinux). Those very
     * rules keep an app from reading the answer (the owner's S26, Android 17:
     * refused), so "unavailable" is the normal result and says nothing. Only
     * a kernel that enforces none lets the read through, and answers "0":
     * root tools and custom kernels switch it off, and then little keeps one
     * app out of another's data.
     */
    private static JSObject selinux() {
        try (FileInputStream input = new FileInputStream("/sys/fs/selinux/enforce")) {
            int value = input.read();
            if (value == '0') return result("selinux", "found", "permissive");
            return result("selinux", value == '1' ? "nothing seen" : "unavailable", value == '1' ? "enforcing" : "unexpected answer");
        } catch (Exception e) {
            return result("selinux", "unavailable", error(e));
        }
    }

    private static JSObject path(String path) {
        try {
            // Unlike File.exists(), lstat retains EACCES/EPERM. Never open or execute the interface.
            StructStat metadata = Os.lstat(path);
            return result("path:" + path, "found", "mode=" + Integer.toOctalString(metadata.st_mode & 07777));
        } catch (ErrnoException e) {
            boolean absent = e.errno == OsConstants.ENOENT || e.errno == OsConstants.ENOTDIR;
            return result("path:" + path, absent ? "nothing seen" : "unavailable", error(e));
        } catch (Exception e) {
            return result("path:" + path, "unavailable", error(e));
        }
    }

    private static JSObject manager(PackageManager pm, String name) {
        try {
            pm.getPackageInfo(name, 0);
            return result("package:" + name, "found", "exact declared package query");
        } catch (PackageManager.NameNotFoundException e) {
            // Scoped to this query/profile. It is not a claim that no root manager exists anywhere.
            return result("package:" + name, "nothing seen", "not returned by exact declared query");
        } catch (Exception e) {
            return result("package:" + name, "unavailable", error(e));
        }
    }

    private static String error(Exception e) {
        // Exception messages can contain paths or platform details; a type and errno suffice.
        return e.getClass().getSimpleName() + (e instanceof ErrnoException ? " errno=" + ((ErrnoException) e).errno : "");
    }

    /** A check whose findings are a short list of names; an incomplete read with none is no clean answer. */
    private static JSObject listed(String id, List<String> findings, boolean complete, String detail) {
        JSArray evidence = new JSArray();
        for (String finding : findings) evidence.put(finding);
        JSObject check = result(id, !findings.isEmpty() ? "found" : complete ? "nothing seen" : "unavailable", detail);
        check.put("evidence", evidence);
        return check;
    }

    private static JSObject result(String id, String status, String detail) {
        JSObject result = new JSObject();
        result.put("id", id);
        result.put("status", status);
        result.put("detail", detail);
        return result;
    }
}
