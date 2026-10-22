package de.elnino0916.android.girovo;

import android.content.Context;
import android.content.pm.PackageManager;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;

/** Read-only observations in Girovo's own UID, SELinux domain and mount namespace. */
final class RuntimeIntegrity {
    private static final int MAX_MOUNT_BYTES = 256 * 1024;
    // Keep these exact queries in sync with AndroidManifest.xml. No installed-app inventory.
    private static final String[] MANAGERS = {
        "me.weishu.kernelsu", "com.topjohnwu.magisk", "me.bmax.apatch", "eu.chainfire.supersu",
    };
    private static final String[] ROOT_PATHS = {
        "/system/bin/su", "/system/xbin/su", "/sbin/su", "/su/bin/su",
        "/system/bin/magisk", "/data/adb/ksu/bin/ksud",
    };

    private RuntimeIntegrity() {}

    static JSArray check(Context context) {
        JSArray checks = new JSArray();
        checks.put(mounts());
        checks.put(hosts());
        for (String path : ROOT_PATHS) checks.put(path(path));
        for (String name : MANAGERS) checks.put(manager(context.getPackageManager(), name));
        return checks;
    }

    private static JSObject mounts() {
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
            JSArray evidence = new JSArray();
            for (String finding : scan.findings) evidence.put(finding);
            JSObject check = result("mounts", !scan.findings.isEmpty() ? "found" : scan.complete ? "nothing seen" : "unavailable",
                scan.complete ? "own mount table read" : "incomplete or malformed mount table");
            check.put("evidence", evidence);
            return check;
        } catch (Exception e) {
            return result("mounts", "unavailable", error(e));
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

    private static JSObject result(String id, String status, String detail) {
        JSObject result = new JSObject();
        result.put("id", id);
        result.put("status", status);
        result.put("detail", detail);
        return result;
    }
}
