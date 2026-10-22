# R8 for Girovo's release builds (build.gradle, buildTypes.release).
#
# What the page reaches by name is kept by the libraries' own rules:
# Capacitor keeps every @CapacitorPlugin class with its @PluginMethods
# (node_modules/@capacitor/android/capacitor/proguard-rules.pro), and the
# default optimize rules keep @JavascriptInterface methods. Everything else —
# Girovo's own helpers, AndroidX, ML Kit, Play services — is shrunk and renamed.

# Line numbers for the stack traces in Play's crash reports (de-obfuscated with
# the mapping Play receives with the bundle); the file name itself is hidden.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Capacitor reads @CapacitorPlugin(name, permissions) and @PluginMethod at run time.
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault

# MainActivity's EdgeToEdge.enable() under its own name: renamed or inlined,
# Play's scan no longer recognises it and reports the app as not edge to edge
# for Android 14 and older (5.8.0 was).
-keep class androidx.activity.EdgeToEdge { public static *; }
# …and its parameters' types, so the call keeps its whole public signature
# (EdgeToEdge.enable(ComponentActivity, SystemBarStyle, SystemBarStyle)).
-keepnames class androidx.activity.ComponentActivity
-keepnames class androidx.activity.SystemBarStyle
