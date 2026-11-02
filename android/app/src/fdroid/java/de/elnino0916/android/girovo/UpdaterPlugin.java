package de.elnino0916.android.girovo;

import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The F-Droid build brings no updater of its own: the repository it came
 * from (Girovo's own, girovo.de/fdroid/repo) checks and installs the next
 * version, and a repository's app must not download executable code past it.
 * mobile/bridges/updates.ts sets up GitHub's updater for the "github" build
 * and Play's in-app update for the "play" build only, so nothing asks here.
 */
@CapacitorPlugin(name = "GirovoUpdater")
public class UpdaterPlugin extends Plugin {}
