// The window that stands in for the app while an update installs.
//
// The app quits before the installer may touch its files, and the installer
// runs silently (its own progress page is plain Win32), so without this the
// screen stays empty for half a minute — long enough to look like a crash.
// electron/main.cjs copies this program out of the installation (which the
// installer is about to delete) into the updater's cache folder and starts it
// right after the installer; it closes itself once the new version's window
// is up.
//
// It only watches, it never steers: whether it starts, crashes or is closed
// makes no difference to the update. Progress is read off the disk —
//   1. the old version's files disappearing (its uninstaller),
//   2. the new files appearing in the installer's temp folder (%TEMP%\ns*.tmp\7z-out),
//   3. the new files appearing in the installation (copied from there),
// then the installer's exit and the app's window.
//
// Built by scripts/build-update-window.mjs with the C# compiler that ships with
// Windows (.NET Framework 4.x): C# 5, WPF built in code, no XAML.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;

namespace Sooskasse.UpdateWindow
{
    sealed class Options
    {
        public int InstallerPid;
        public string InstallDir = "";
        public int Files = 1600;
        public string Version = "";
        public string AppExe = "";
        public string AppName = "Sooskasse-FinTS";
        public string ReleasesUrl = "";
        public string Log = "";
        public bool Dark;
        public Rect? Around;
        public string Demo = "";

        public static Options Parse(string[] args)
        {
            var o = new Options();
            for (int i = 0; i + 1 < args.Length; i += 2)
            {
                string key = args[i], value = args[i + 1];
                switch (key)
                {
                    case "--installer-pid": int.TryParse(value, out o.InstallerPid); break;
                    case "--install-dir": o.InstallDir = value; break;
                    case "--files": int.TryParse(value, out o.Files); break;
                    case "--version": o.Version = value; break;
                    case "--app-exe": o.AppExe = value; break;
                    case "--releases-url": o.ReleasesUrl = value; break;
                    case "--log": o.Log = value; break;
                    case "--theme": o.Dark = value == "dark"; break;
                    case "--demo": o.Demo = value; break;
                    case "--around":
                        var p = value.Split(',');
                        double x, y, w, h;
                        if (p.Length == 4
                            && double.TryParse(p[0], NumberStyles.Float, CultureInfo.InvariantCulture, out x)
                            && double.TryParse(p[1], NumberStyles.Float, CultureInfo.InvariantCulture, out y)
                            && double.TryParse(p[2], NumberStyles.Float, CultureInfo.InvariantCulture, out w)
                            && double.TryParse(p[3], NumberStyles.Float, CultureInfo.InvariantCulture, out h))
                        {
                            o.Around = new Rect(x, y, w, h);
                        }
                        break;
                }
            }
            if (o.Files < 1) o.Files = 1;
            if (!string.IsNullOrEmpty(o.AppExe)) o.AppName = Path.GetFileNameWithoutExtension(o.AppExe);
            return o;
        }
    }

    /// <summary>The app's tokens (app/globals.css, DESIGN.md), light and dark.</summary>
    sealed class Palette
    {
        public Color Surface, Ink, Ink2, Inset, Headline, PlateInk, Accent, AccentInk, Edge;
        public bool Dark;

        static Color Hex(string hex)
        {
            return (Color)ColorConverter.ConvertFromString(hex);
        }

        public static Palette For(bool dark)
        {
            if (dark)
            {
                return new Palette
                {
                    Dark = true,
                    Surface = Hex("#0a1b2d"),
                    Ink = Hex("#e3e9ef"),
                    Ink2 = Hex("#a9b6c4"),
                    Inset = Hex("#0e2236"),
                    // At night the headline navy turns to ink, progress with it.
                    Headline = Hex("#e3e9ef"),
                    PlateInk = Hex("#0a1b2d"),
                    Accent = Hex("#3ba4ef"),
                    AccentInk = Hex("#04121f"),
                    // The Night Edge Rule: depth from a faint white edge, not shadow.
                    Edge = Color.FromArgb(0x14, 0xff, 0xff, 0xff),
                };
            }
            return new Palette
            {
                Surface = Hex("#ffffff"),
                Ink = Hex("#1b1f24"),
                Ink2 = Hex("#4f5761"),
                Inset = Hex("#edf0f4"),
                Headline = Hex("#0a2c5e"),
                PlateInk = Hex("#ffffff"),
                Accent = Hex("#0864ad"),
                AccentInk = Hex("#ffffff"),
                Edge = Colors.Transparent,
            };
        }
    }

    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            try
            {
                var options = Options.Parse(args);
                var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
                return app.Run(new UpdateWindow(options));
            }
            catch
            {
                // A window that cannot show itself has nothing to say.
                return 0;
            }
        }
    }

    sealed class UpdateWindow : Window
    {
        const string UiFont = "Segoe UI Variable Text, Segoe UI";
        const string DisplayFont = "Segoe UI Variable Display, Segoe UI";

        readonly Options options;
        readonly Palette palette;
        readonly DateTime started = DateTime.UtcNow;
        readonly TextBlock title = new TextBlock();
        readonly TextBlock description = new TextBlock();
        readonly TextBlock phase = new TextBlock();
        readonly TextBlock percent = new TextBlock();
        readonly Border track = new Border();
        readonly Border fill = new Border();
        readonly StackPanel progressBlock = new StackPanel();
        readonly StackPanel buttons = new StackPanel();
        readonly bool animate = SystemParameters.ClientAreaAnimation;
        double shown;
        bool finished;
        StreamWriter log;

        public UpdateWindow(Options options)
        {
            this.options = options;
            palette = Palette.For(options.Dark);
            OpenLog();

            Title = "Update wird installiert – " + options.AppName;
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            ResizeMode = ResizeMode.NoResize;
            SizeToContent = SizeToContent.WidthAndHeight;
            ShowInTaskbar = true;
            Topmost = false;
            UseLayoutRounding = true;
            SnapsToDevicePixels = true;
            TextOptions.SetTextFormattingMode(this, TextFormattingMode.Ideal);
            var icon = LoadIcon();
            if (icon != null) Icon = icon;

            Content = BuildCard();
            MouseLeftButtonDown += delegate { try { DragMove(); } catch (InvalidOperationException) { } };
            Loaded += delegate { Place(); };
            ContentRendered += delegate { Start(); };
            KeyDown += (s, e) => { if (e.Key == Key.Escape && finished) Close(); };
        }

        // ---- look -----------------------------------------------------------

        static BitmapFrame LoadIcon()
        {
            try
            {
                var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("icon.png");
                return stream == null ? null : BitmapFrame.Create(stream);
            }
            catch
            {
                return null;
            }
        }

        SolidColorBrush Brush(Color c)
        {
            var b = new SolidColorBrush(c);
            b.Freeze();
            return b;
        }

        UIElement BuildCard()
        {
            // The dialog: 16px corners, lifted by the Pop shadow (light) or the
            // night edge plus a deep shadow (dark). The margin leaves the
            // shadow room inside the transparent window.
            var card = new Border
            {
                Width = 440,
                Margin = new Thickness(28, 20, 28, 36),
                CornerRadius = new CornerRadius(16),
                Background = Brush(palette.Surface),
                BorderBrush = Brush(palette.Edge),
                BorderThickness = new Thickness(palette.Dark ? 1 : 0),
                Padding = new Thickness(28, 24, 28, 28),
                Effect = new DropShadowEffect
                {
                    Color = palette.Dark ? Colors.Black : Color.FromRgb(10, 30, 60),
                    BlurRadius = 36,
                    ShadowDepth = 10,
                    Direction = 270,
                    Opacity = palette.Dark ? 0.55 : 0.22,
                },
            };

            var stack = new StackPanel();
            card.Child = stack;

            // The masthead's mark: the "€" plate and the wordmark.
            var brand = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 18) };
            var plate = new Border
            {
                Width = 28,
                Height = 28,
                CornerRadius = new CornerRadius(8),
                Background = Brush(palette.Headline),
                Child = new TextBlock
                {
                    Text = "€",
                    FontFamily = new FontFamily(UiFont),
                    FontWeight = FontWeights.Bold,
                    FontSize = 16,
                    Foreground = Brush(palette.PlateInk),
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                },
            };
            brand.Children.Add(plate);
            brand.Children.Add(new TextBlock
            {
                Text = "Sooskasse-FinTS",
                FontFamily = new FontFamily(UiFont),
                FontWeight = FontWeights.Bold,
                FontSize = 15,
                Foreground = Brush(palette.Ink2),
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(10, 0, 0, 1),
            });
            stack.Children.Add(brand);

            title.FontFamily = new FontFamily(DisplayFont);
            title.FontWeight = FontWeights.Bold;
            title.FontSize = 22;
            title.Foreground = Brush(palette.Headline);
            title.TextWrapping = TextWrapping.Wrap;
            title.Text = options.Version.Length > 0 ? "Update auf " + options.Version + " wird installiert" : "Update wird installiert";
            stack.Children.Add(title);

            description.FontFamily = new FontFamily(UiFont);
            description.FontSize = 15;
            description.LineHeight = 22;
            description.Foreground = Brush(palette.Ink2);
            description.TextWrapping = TextWrapping.Wrap;
            description.Margin = new Thickness(0, 6, 0, 0);
            description.Text = "Sooskasse-FinTS startet danach von selbst wieder.";
            stack.Children.Add(description);

            // The progress row, as in the update dialog: what is happening on
            // the left, how far on the right, an 8px navy fill on the inset.
            progressBlock.Margin = new Thickness(0, 22, 0, 0);
            var row = new DockPanel { LastChildFill = true };
            percent.FontFamily = new FontFamily(UiFont);
            percent.FontSize = 14;
            percent.Foreground = Brush(palette.Ink2);
            System.Windows.Documents.Typography.SetNumeralAlignment(percent, FontNumeralAlignment.Tabular);
            DockPanel.SetDock(percent, Dock.Right);
            row.Children.Add(percent);
            phase.FontFamily = new FontFamily(UiFont);
            phase.FontWeight = FontWeights.SemiBold;
            phase.FontSize = 14;
            phase.Foreground = Brush(palette.Ink);
            phase.Text = "Wird vorbereitet …";
            row.Children.Add(phase);
            progressBlock.Children.Add(row);

            track.Height = 8;
            track.CornerRadius = new CornerRadius(4);
            track.Background = Brush(palette.Inset);
            track.Margin = new Thickness(0, 8, 0, 0);
            track.ClipToBounds = true;
            fill.HorizontalAlignment = HorizontalAlignment.Left;
            fill.Width = 0;
            fill.CornerRadius = new CornerRadius(4);
            fill.Background = Brush(palette.Headline);
            track.Child = fill;
            progressBlock.Children.Add(track);
            stack.Children.Add(progressBlock);

            buttons.Orientation = Orientation.Horizontal;
            buttons.HorizontalAlignment = HorizontalAlignment.Right;
            buttons.Margin = new Thickness(0, 22, 0, 0);
            buttons.Visibility = Visibility.Collapsed;
            stack.Children.Add(buttons);

            return card;
        }

        Button Pill(string text, bool primary, Action onClick)
        {
            // Every button is a pill; Signal Blue is what can be pressed.
            var face = new FrameworkElementFactory(typeof(Border));
            face.SetValue(Border.CornerRadiusProperty, new CornerRadius(18));
            face.SetValue(Border.BackgroundProperty, new TemplateBindingExtension(BackgroundProperty));
            face.SetValue(Border.BorderBrushProperty, new TemplateBindingExtension(BorderBrushProperty));
            face.SetValue(Border.BorderThicknessProperty, new Thickness(1.5));
            face.SetValue(Border.PaddingProperty, new Thickness(18, 0, 18, 0));
            var label = new FrameworkElementFactory(typeof(ContentPresenter));
            label.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
            label.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            face.AppendChild(label);
            var button = new Button
            {
                Content = text,
                Height = 36,
                MinWidth = 96,
                Margin = new Thickness(10, 0, 0, 0),
                FontFamily = new FontFamily(UiFont),
                FontWeight = FontWeights.SemiBold,
                FontSize = 14,
                Cursor = Cursors.Hand,
                Background = primary ? Brush(palette.Accent) : Brushes.Transparent,
                BorderBrush = Brush(palette.Accent),
                Foreground = primary ? Brush(palette.AccentInk) : Brush(palette.Accent),
                Template = new ControlTemplate(typeof(Button)) { VisualTree = face },
                FocusVisualStyle = null,
            };
            button.Click += delegate { onClick(); };
            return button;
        }

        void Place()
        {
            // Where the app's window was, if that is on screen; else centred.
            var around = options.Around;
            var screen = new Rect(SystemParameters.VirtualScreenLeft, SystemParameters.VirtualScreenTop,
                SystemParameters.VirtualScreenWidth, SystemParameters.VirtualScreenHeight);
            double cx, cy;
            if (around.HasValue && screen.Contains(new Point(around.Value.X + around.Value.Width / 2, around.Value.Y + around.Value.Height / 2)))
            {
                cx = around.Value.X + around.Value.Width / 2;
                cy = around.Value.Y + around.Value.Height / 2;
            }
            else
            {
                var work = SystemParameters.WorkArea;
                cx = work.Left + work.Width / 2;
                cy = work.Top + work.Height / 2;
            }
            Left = cx - ActualWidth / 2;
            Top = cy - ActualHeight / 2;
        }

        void SetProgress(double target)
        {
            target = Math.Max(0, Math.Min(1, target));
            // Never backwards: a reading that dips does not move the bar.
            if (target < shown) return;
            shown = target;
            percent.Text = ((int)Math.Floor(target * 100)).ToString(CultureInfo.InvariantCulture) + " %";
            double width = track.ActualWidth * target;
            if (!animate)
            {
                fill.BeginAnimation(WidthProperty, null);
                fill.Width = width;
                return;
            }
            var anim = new DoubleAnimation(width, TimeSpan.FromMilliseconds(250))
            {
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
            };
            fill.BeginAnimation(WidthProperty, anim);
        }

        void SetPhase(string text)
        {
            if (phase.Text == text) return;
            phase.Text = text;
            Log("phase: " + text);
        }

        // ---- watching ---------------------------------------------------------

        void Start()
        {
            if (options.Demo.Length > 0)
            {
                RunDemo();
                return;
            }
            var worker = new Thread(Watch) { IsBackground = true, Name = "watch" };
            worker.Start();
        }

        void Ui(Action action)
        {
            try
            {
                Dispatcher.BeginInvoke(action);
            }
            catch
            {
                // The window is closing.
            }
        }

        static int CountFiles(string dir)
        {
            if (string.IsNullOrEmpty(dir)) return 0;
            try
            {
                if (!Directory.Exists(dir)) return 0;
                int n = 0;
                foreach (var f in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories)) n++;
                return n;
            }
            catch
            {
                // Files vanish under the enumeration while the uninstaller works.
                return -1;
            }
        }

        string FindUnpackFolder()
        {
            // The installer's plug-in folder: %TEMP%\nsXXXX.tmp, created after we started.
            try
            {
                foreach (var dir in Directory.EnumerateDirectories(Path.GetTempPath(), "ns*.tmp"))
                {
                    var outDir = Path.Combine(dir, "7z-out");
                    if (Directory.Exists(outDir) && Directory.GetCreationTimeUtc(dir) > started.AddSeconds(-30)) return outDir;
                }
            }
            catch
            {
            }
            return null;
        }

        void Watch()
        {
            Process installer = null;
            try
            {
                installer = Process.GetProcessById(options.InstallerPid);
                // Opens the handle now: the exit code stays readable after it ends.
                var unused = installer.Handle;
            }
            catch
            {
                installer = null;
            }
            Log("watching installer " + options.InstallerPid + (installer == null ? " (already gone)" : "")
                + ", " + options.Files + " files expected in " + options.InstallDir);

            int n = options.Files;
            int lowest = int.MaxValue;
            bool removed = false;
            int unpacked = 0;
            string unpackDir = null;
            DateTime? removedAt = null;
            var deadline = started.AddMinutes(10);

            while (DateTime.UtcNow < deadline)
            {
                bool exited = installer == null || installer.HasExited;
                int inInstall = CountFiles(options.InstallDir);
                if (inInstall >= 0)
                {
                    if (inInstall < lowest) lowest = inInstall;
                    if (!removed && inInstall <= n / 2)
                    {
                        removed = true;
                        removedAt = DateTime.UtcNow;
                        Log("old version removed");
                    }
                }
                if (unpackDir == null) unpackDir = FindUnpackFolder();
                if (unpackDir != null)
                {
                    int u = CountFiles(unpackDir);
                    if (u > unpacked) unpacked = u;
                }

                string text;
                double target;
                if (removed && inInstall > lowest + 3)
                {
                    text = "Dateien werden kopiert …";
                    target = 0.72 + 0.24 * Math.Min(1.0, (double)inInstall / n);
                }
                else if (unpacked > 0)
                {
                    text = "Neue Version wird entpackt …";
                    target = 0.12 + 0.60 * Math.Min(1.0, (double)unpacked / n);
                }
                else if (removed)
                {
                    // The unpacking is not visible from here (another TEMP):
                    // creep on, slower and slower.
                    text = "Neue Version wird entpackt …";
                    double t = (DateTime.UtcNow - removedAt.Value).TotalSeconds;
                    target = 0.12 + 0.55 * (1 - Math.Exp(-t / 15));
                }
                else if (inInstall >= 0 && inInstall < n)
                {
                    text = "Alte Version wird entfernt …";
                    target = 0.12 * Math.Max(0.0, (double)(n - inInstall) / n);
                }
                else
                {
                    text = "Wird vorbereitet …";
                    target = 0;
                }

                if (exited)
                {
                    int code = -1;
                    try
                    {
                        if (installer != null) code = installer.ExitCode;
                    }
                    catch
                    {
                    }
                    Log("installer exited, code " + code);
                    if (code == 0 || installer == null)
                    {
                        Ui(delegate { SetPhase("Wird gestartet …"); SetProgress(0.97); });
                        WaitForApp();
                    }
                    else
                    {
                        Ui(delegate { ShowFailure(code); });
                    }
                    return;
                }

                Ui(delegate { SetPhase(text); SetProgress(target); });
                Thread.Sleep(250);
            }
            Log("gave up waiting");
            Ui(Close);
        }

        void WaitForApp()
        {
            // The new version's window: the installer starts the app, which
            // takes a moment to bring its server and window up.
            var until = DateTime.UtcNow.AddSeconds(45);
            while (DateTime.UtcNow < until)
            {
                try
                {
                    foreach (var p in Process.GetProcessesByName(options.AppName))
                    {
                        if (p.MainWindowHandle != IntPtr.Zero && p.StartTime.ToUniversalTime() > started)
                        {
                            Log("app window is up");
                            Ui(delegate
                            {
                                SetProgress(1);
                                var close = new DispatcherTimerOnce(TimeSpan.FromMilliseconds(450), Close);
                            });
                            return;
                        }
                    }
                }
                catch
                {
                }
                Thread.Sleep(250);
            }
            Log("no app window after 45 s");
            Ui(Close);
        }

        void ShowFailure(int code)
        {
            finished = true;
            bool appThere = !string.IsNullOrEmpty(options.AppExe) && File.Exists(options.AppExe);
            title.Text = "Update nicht abgeschlossen";
            description.Text = appThere
                ? "Die Installation wurde abgebrochen – zum Beispiel, weil die Frage nach Administratorrechten abgelehnt wurde. Die bisherige Version ist noch da."
                : "Die Installation wurde abgebrochen, und Sooskasse-FinTS ist nicht mehr vollständig installiert. Lade die neue Version von GitHub herunter und installiere sie.";
            progressBlock.Visibility = Visibility.Collapsed;
            buttons.Children.Add(Pill("Schließen", false, Close));
            if (appThere)
            {
                buttons.Children.Add(Pill("Sooskasse-FinTS öffnen", true, delegate
                {
                    StartQuietly(options.AppExe);
                    Close();
                }));
            }
            else if (options.ReleasesUrl.StartsWith("https://github.com/", StringComparison.Ordinal))
            {
                buttons.Children.Add(Pill("Download-Seite öffnen", true, delegate
                {
                    StartQuietly(options.ReleasesUrl);
                    Close();
                }));
            }
            buttons.Visibility = Visibility.Visible;
            Activate();
            Log("failure shown (code " + code + ")");
        }

        static void StartQuietly(string target)
        {
            try
            {
                Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
            }
            catch
            {
            }
        }

        void RunDemo()
        {
            // For looking at it: node scripts/build-update-window.mjs --demo [light|dark|failure]
            if (options.Demo == "failure")
            {
                ShowFailure(1);
                return;
            }
            var steps = new List<Tuple<string, double>>
            {
                Tuple.Create("Alte Version wird entfernt …", 0.06),
                Tuple.Create("Alte Version wird entfernt …", 0.12),
                Tuple.Create("Neue Version wird entpackt …", 0.31),
                Tuple.Create("Neue Version wird entpackt …", 0.55),
                Tuple.Create("Dateien werden kopiert …", 0.81),
                Tuple.Create("Wird gestartet …", 0.97),
            };
            int i = 0;
            var timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(900) };
            timer.Tick += delegate
            {
                if (i >= steps.Count)
                {
                    timer.Stop();
                    return;
                }
                SetPhase(steps[i].Item1);
                SetProgress(steps[i].Item2);
                i++;
            };
            timer.Start();
        }

        // ---- log --------------------------------------------------------------

        void OpenLog()
        {
            if (string.IsNullOrEmpty(options.Log)) return;
            try
            {
                log = new StreamWriter(options.Log, false) { AutoFlush = true };
            }
            catch
            {
                log = null;
            }
        }

        void Log(string line)
        {
            var w = log;
            if (w == null) return;
            try
            {
                lock (w) w.WriteLine(((DateTime.UtcNow - started).TotalSeconds).ToString("0.00", CultureInfo.InvariantCulture) + "s " + line);
            }
            catch
            {
            }
        }

        protected override void OnClosed(EventArgs e)
        {
            Log("closed");
            base.OnClosed(e);
            var w = log;
            log = null;
            if (w != null)
            {
                try { w.Dispose(); } catch { }
            }
        }
    }

    /// <summary>Runs `action` once after `delay` on the UI thread.</summary>
    sealed class DispatcherTimerOnce
    {
        readonly System.Windows.Threading.DispatcherTimer timer;

        public DispatcherTimerOnce(TimeSpan delay, Action action)
        {
            timer = new System.Windows.Threading.DispatcherTimer { Interval = delay };
            timer.Tick += delegate
            {
                timer.Stop();
                action();
            };
            timer.Start();
        }
    }
}
