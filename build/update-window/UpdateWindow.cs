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
// The same window, with --error-title and --error-text, is how the app says
// it cannot go on — it could not start, or its server stopped — in its own
// look rather than in Windows' plain message box: the title, the message, and
// "Girovo neu starten" when --app-exe names the app to start again.
//
// Built by scripts/build-update-window.mjs with the C# compiler that ships with
// Windows (.NET Framework 4.x): C# 5, WPF built in code, no XAML. It carries
// the app's interface face inside it (Faces, below).

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

namespace Girovo.UpdateWindow
{
    sealed class Options
    {
        public int InstallerPid;
        public string InstallDir = "";
        public int Files = 1600;
        public string Version = "";
        public string AppExe = "";
        public string AppName = "Girovo";
        public string ReleasesUrl = "";
        public string Log = "";
        public bool Dark;
        public Rect? Around;
        public string Demo = "";
        /// <summary>The app's interface language: "en" for English, anything else German.</summary>
        public bool English;
        /// <summary>An error to show instead of an update (electron/main.cjs, showErrorWindow).</summary>
        public string ErrorTitle = "";
        public string ErrorText = "";
        /// <summary>For development: render the card to this PNG and exit, no window shown.</summary>
        public string Snapshot = "";

        public bool IsError
        {
            get { return ErrorTitle.Length > 0; }
        }

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
                    case "--lang": o.English = value == "en"; break;
                    case "--error-title": o.ErrorTitle = value; break;
                    case "--error-text": o.ErrorText = value; break;
                    case "--snapshot": o.Snapshot = value; break;
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

    /// <summary>
    /// The app's Material roles (app/material.css, DESIGN.md), light and dark:
    /// the card is the app's basic dialog (surface container high), the
    /// progress and the buttons its primary, the track its secondary container.
    /// electron/splash.html draws with the same values.
    /// </summary>
    sealed class Palette
    {
        public Color Surface, Ink, Ink2, Track, Accent, AccentInk;
        public bool Dark;

        /// <summary>The G€ plate: Girovo's navy, a logo's literal colour, the same in either theme.</summary>
        public static readonly Color Plate = Color.FromRgb(0x0a, 0x2c, 0x5e);

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
                    Surface = Hex("#252a33"),
                    Ink = Hex("#dde3ee"),
                    Ink2 = Hex("#bfc7d5"),
                    Track = Hex("#3c4665"),
                    Accent = Hex("#a2c9ff"),
                    AccentInk = Hex("#00315b"),
                };
            }
            return new Palette
            {
                Surface = Hex("#e3e8f4"),
                Ink = Hex("#161c24"),
                Ink2 = Hex("#404753"),
                Track = Hex("#dae1ff"),
                Accent = Hex("#0060a8"),
                AccentInk = Hex("#ffffff"),
            };
        }
    }

    /// <summary>
    /// The app's interface face, Google Sans Flex, carried inside this program as
    /// fixed instances (build/update-window/fonts, from scripts/make-window-fonts.py):
    /// the installation it could read the app's copy from is what an update
    /// replaces. WPF sets fonts from files only, so they are written to a folder
    /// of their own under %TEMP% — rewritten wherever they differ from these
    /// bytes, so only this program's own fonts are ever read from there — and set
    /// from it. Without them, Segoe UI Variable, as before.
    /// </summary>
    static class Faces
    {
        static readonly string[] Files =
        {
            "GirovoSans-Regular.ttf",
            "GirovoSans-Medium.ttf",
            "GirovoSans-Bold.ttf",
            "GirovoSansDisplay-Medium.ttf",
        };

        /// <summary>Text: Regular, Medium and Bold at the text's optical size.</summary>
        public static FontFamily Text = new FontFamily("Segoe UI Variable Text, Segoe UI");
        /// <summary>The headline: Medium at the headline's optical size.</summary>
        public static FontFamily Display = new FontFamily("Segoe UI Variable Display, Segoe UI");

        public static void Load()
        {
            try
            {
                var assembly = Assembly.GetExecutingAssembly();
                var dir = Path.Combine(Path.GetTempPath(), "Girovo", "update-window-fonts");
                Directory.CreateDirectory(dir);
                foreach (var file in Files)
                {
                    byte[] bytes;
                    using (var stream = assembly.GetManifestResourceStream("fonts." + file))
                    {
                        if (stream == null) return;
                        bytes = new byte[stream.Length];
                        int read = 0;
                        while (read < bytes.Length)
                        {
                            int n = stream.Read(bytes, read, bytes.Length - read);
                            if (n <= 0) return;
                            read += n;
                        }
                    }
                    var target = Path.Combine(dir, file);
                    if (Same(target, bytes)) continue;
                    // Another copy of this window may have the file open; a
                    // fresh name, then swapped in, never a half-written font.
                    var temp = target + "." + Process.GetCurrentProcess().Id + ".tmp";
                    File.WriteAllBytes(temp, bytes);
                    if (File.Exists(target)) File.Delete(target);
                    File.Move(temp, target);
                }
                var folder = new Uri(dir + Path.DirectorySeparatorChar);
                Text = new FontFamily(folder, "./#Girovo Sans, Segoe UI Variable Text, Segoe UI");
                Display = new FontFamily(folder, "./#Girovo Sans Display, Segoe UI Variable Display, Segoe UI");
            }
            catch
            {
                // Segoe UI Variable, then: a window in the system's face beats none.
            }
        }

        static bool Same(string path, byte[] bytes)
        {
            try
            {
                if (!File.Exists(path)) return false;
                var existing = File.ReadAllBytes(path);
                if (existing.Length != bytes.Length) return false;
                for (int i = 0; i < bytes.Length; i++)
                {
                    if (existing[i] != bytes[i]) return false;
                }
                return true;
            }
            catch
            {
                return false;
            }
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
                Faces.Load();
                if (options.Snapshot.Length > 0) return Snapshot(options);
                var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
                return app.Run(new UpdateWindow(options));
            }
            catch
            {
                // A window that cannot show itself has nothing to say.
                return 0;
            }
        }

        /// <summary>The card as the window would show it, drawn into a PNG — never on screen.</summary>
        static int Snapshot(Options options)
        {
            var window = new UpdateWindow(options);
            var card = (FrameworkElement)window.Content;
            window.Content = null;
            card.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
            card.Arrange(new Rect(card.DesiredSize));
            card.UpdateLayout();
            const double scale = 2;
            var bitmap = new RenderTargetBitmap(
                (int)Math.Ceiling(card.ActualWidth * scale + card.Margin.Left * scale + card.Margin.Right * scale),
                (int)Math.Ceiling(card.ActualHeight * scale + card.Margin.Top * scale + card.Margin.Bottom * scale),
                96 * scale, 96 * scale, PixelFormats.Pbgra32);
            bitmap.Render(card);
            var encoder = new PngBitmapEncoder();
            encoder.Frames.Add(BitmapFrame.Create(bitmap));
            using (var file = File.Create(options.Snapshot)) encoder.Save(file);
            return 0;
        }
    }

    sealed class UpdateWindow : Window
    {
        readonly Options options;
        readonly Palette palette;
        readonly DateTime started = DateTime.UtcNow;
        readonly TextBlock title = new TextBlock();
        readonly TextBlock description = new TextBlock();
        readonly TextBlock phase = new TextBlock();
        readonly TextBlock percent = new TextBlock();
        readonly Border track = new Border();
        readonly Border fill = new Border();
        readonly Border rest = new Border();
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

            Say.English = options.English;
            Title = options.IsError ? "Girovo" : Say.Pick("Update wird installiert – ", "Installing update – ") + options.AppName;
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            ResizeMode = ResizeMode.NoResize;
            SizeToContent = SizeToContent.WidthAndHeight;
            ShowInTaskbar = true;
            // Above other windows, so the update cannot get lost behind them.
            // The admin prompt is unaffected: Windows shows it on its own desktop.
            Topmost = true;
            UseLayoutRounding = true;
            SnapsToDevicePixels = true;
            TextOptions.SetTextFormattingMode(this, TextFormattingMode.Ideal);
            var icon = LoadIcon();
            if (icon != null) Icon = icon;

            Content = BuildCard();
            // Before the first frame, so the card is laid out once, with its buttons.
            if (options.IsError) ShowError();
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

        // The G€ mark, as in lib/brand-mark.ts: the same 512-grid paths and
        // stroke widths, scaled down to whatever holds it.
        UIElement Mark(Color ink)
        {
            var canvas = new Canvas { Width = 512, Height = 512 };
            canvas.Children.Add(MarkStroke("M361.4 151.8A136 136 0 1 0 405.1 292H280", 46, ink));
            canvas.Children.Add(MarkStroke("M100 222H244M100 292H208", 40, ink));
            return new Viewbox { Child = canvas, Stretch = Stretch.Uniform };
        }

        System.Windows.Shapes.Path MarkStroke(string data, double width, Color ink)
        {
            return new System.Windows.Shapes.Path
            {
                Data = Geometry.Parse(data),
                Stroke = Brush(ink),
                StrokeThickness = width,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round,
                StrokeLineJoin = PenLineJoin.Round,
            };
        }

        UIElement BuildCard()
        {
            // Material's basic dialog: 28px corners, 24px in, one soft shadow.
            // The margin leaves the shadow room inside the transparent window.
            var card = new Border
            {
                Width = 440,
                Margin = new Thickness(28, 20, 28, 36),
                CornerRadius = new CornerRadius(28),
                Background = Brush(palette.Surface),
                Padding = new Thickness(24),
                Effect = new DropShadowEffect
                {
                    Color = Colors.Black,
                    BlurRadius = 24,
                    ShadowDepth = 6,
                    Direction = 270,
                    Opacity = palette.Dark ? 0.5 : 0.25,
                },
            };

            var stack = new StackPanel();
            card.Child = stack;

            // The app's mark: the G€ plate and the wordmark.
            var brand = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 16) };
            var plate = new Border
            {
                Width = 28,
                Height = 28,
                CornerRadius = new CornerRadius(8),
                Background = Brush(Palette.Plate),
                Child = Mark(Colors.White),
            };
            brand.Children.Add(plate);
            brand.Children.Add(new TextBlock
            {
                Text = "Girovo",
                FontFamily = Faces.Text,
                FontWeight = FontWeights.Bold,
                FontSize = 15,
                Foreground = Brush(palette.Ink),
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(10, 0, 0, 1),
            });
            stack.Children.Add(brand);

            // Headline small.
            title.FontFamily = Faces.Display;
            title.FontWeight = FontWeights.Medium;
            title.FontSize = 24;
            title.LineHeight = 32;
            title.Foreground = Brush(palette.Ink);
            title.TextWrapping = TextWrapping.Wrap;
            title.Text = options.Version.Length > 0
                ? Say.Pick("Update auf " + options.Version + " wird installiert", "Installing update to " + options.Version)
                : Say.Pick("Update wird installiert", "Installing update");
            stack.Children.Add(title);

            description.FontFamily = Faces.Text;
            description.FontSize = 14;
            description.LineHeight = 20;
            description.Foreground = Brush(palette.Ink2);
            description.TextWrapping = TextWrapping.Wrap;
            description.Margin = new Thickness(0, 8, 0, 0);
            description.Text = Say.Pick("Girovo startet danach von selbst wieder.", "Girovo restarts on its own afterwards.");
            stack.Children.Add(description);

            // The progress row, as in the update dialog: what is happening on
            // the left, how far on the right, and Material's linear progress
            // indicator — 4px of primary, 4px clear, the rest of the track,
            // the stop dot at its end.
            progressBlock.Margin = new Thickness(0, 24, 0, 0);
            var row = new DockPanel { LastChildFill = true };
            percent.FontFamily = Faces.Text;
            percent.FontSize = 14;
            percent.Foreground = Brush(palette.Ink2);
            System.Windows.Documents.Typography.SetNumeralAlignment(percent, FontNumeralAlignment.Tabular);
            DockPanel.SetDock(percent, Dock.Right);
            row.Children.Add(percent);
            phase.FontFamily = Faces.Text;
            phase.FontWeight = FontWeights.Medium;
            phase.FontSize = 14;
            phase.Foreground = Brush(palette.Ink);
            phase.Text = Say.Pick("Wird vorbereitet …", "Preparing…");
            row.Children.Add(phase);
            progressBlock.Children.Add(row);

            track.Height = 4;
            track.Margin = new Thickness(0, 10, 0, 0);
            track.ClipToBounds = true;
            rest.CornerRadius = new CornerRadius(2);
            rest.Background = Brush(palette.Track);
            fill.HorizontalAlignment = HorizontalAlignment.Left;
            fill.Width = 0;
            fill.CornerRadius = new CornerRadius(2);
            fill.Background = Brush(palette.Accent);
            // The track starts 4px after the fill, wherever the fill has got to.
            fill.SizeChanged += delegate
            {
                rest.Margin = new Thickness(fill.ActualWidth > 0 ? fill.ActualWidth + 4 : 0, 0, 0, 0);
            };
            var bar = new Grid();
            bar.Children.Add(rest);
            bar.Children.Add(fill);
            bar.Children.Add(new System.Windows.Shapes.Ellipse
            {
                Width = 4,
                Height = 4,
                HorizontalAlignment = HorizontalAlignment.Right,
                Fill = Brush(palette.Accent),
            });
            track.Child = bar;
            progressBlock.Children.Add(track);
            stack.Children.Add(progressBlock);

            // The actions at the end of one row, as in the app's dialogs.
            buttons.Orientation = Orientation.Horizontal;
            buttons.HorizontalAlignment = HorizontalAlignment.Right;
            buttons.Margin = new Thickness(0, 24, 0, 0);
            buttons.Visibility = Visibility.Collapsed;
            stack.Children.Add(buttons);

            return card;
        }

        Button Pill(string text, bool primary, Action onClick)
        {
            // Material's buttons, as in the app: the one to go on with filled
            // in primary, the other a text button; 40px, fully round. A state
            // layer in the label's colour answers the pointer and the press, and
            // the keyboard's focus adds a ring outside the button.
            var face = new FrameworkElementFactory(typeof(Grid));
            var ground = new FrameworkElementFactory(typeof(Border));
            ground.SetValue(Border.CornerRadiusProperty, new CornerRadius(20));
            ground.SetValue(Border.BackgroundProperty, new TemplateBindingExtension(BackgroundProperty));
            face.AppendChild(ground);
            var layer = new FrameworkElementFactory(typeof(Border), "layer");
            layer.SetValue(Border.CornerRadiusProperty, new CornerRadius(20));
            layer.SetValue(Border.BackgroundProperty, new TemplateBindingExtension(ForegroundProperty));
            layer.SetValue(OpacityProperty, 0.0);
            face.AppendChild(layer);
            var ring = new FrameworkElementFactory(typeof(Border), "ring");
            ring.SetValue(Border.CornerRadiusProperty, new CornerRadius(23));
            ring.SetValue(Border.BorderBrushProperty, new TemplateBindingExtension(BorderBrushProperty));
            ring.SetValue(Border.BorderThicknessProperty, new Thickness(2));
            ring.SetValue(MarginProperty, new Thickness(-3));
            ring.SetValue(VisibilityProperty, Visibility.Collapsed);
            face.AppendChild(ring);
            var label = new FrameworkElementFactory(typeof(ContentPresenter));
            label.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
            label.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            label.SetValue(ContentPresenter.MarginProperty, new TemplateBindingExtension(PaddingProperty));
            face.AppendChild(label);
            var template = new ControlTemplate(typeof(Button)) { VisualTree = face };
            template.Triggers.Add(new Trigger { Property = IsMouseOverProperty, Value = true, Setters = { new Setter(OpacityProperty, 0.08, "layer") } });
            template.Triggers.Add(new Trigger
            {
                Property = IsKeyboardFocusedProperty,
                Value = true,
                Setters = { new Setter(OpacityProperty, 0.1, "layer"), new Setter(VisibilityProperty, Visibility.Visible, "ring") },
            });
            template.Triggers.Add(new Trigger { Property = Button.IsPressedProperty, Value = true, Setters = { new Setter(OpacityProperty, 0.1, "layer") } });
            var button = new Button
            {
                Content = text,
                Height = 40,
                MinWidth = 64,
                Margin = new Thickness(8, 0, 0, 0),
                Padding = new Thickness(primary ? 24 : 12, 0, primary ? 24 : 12, 0),
                FontFamily = Faces.Text,
                FontWeight = FontWeights.Medium,
                FontSize = 14,
                Cursor = Cursors.Hand,
                Background = primary ? Brush(palette.Accent) : Brushes.Transparent,
                BorderBrush = Brush(palette.Accent),
                Foreground = primary ? Brush(palette.AccentInk) : Brush(palette.Accent),
                Template = template,
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
            var whole = ((int)Math.Floor(target * 100)).ToString(CultureInfo.InvariantCulture);
            percent.Text = Say.Pick(whole + " %", whole + "%");
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
            // An error has nothing to watch.
            if (options.IsError) return;
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
                    text = Say.Pick("Dateien werden kopiert …", "Copying files…");
                    target = 0.72 + 0.24 * Math.Min(1.0, (double)inInstall / n);
                }
                else if (unpacked > 0)
                {
                    text = Say.Pick("Neue Version wird entpackt …", "Unpacking the new version…");
                    target = 0.12 + 0.60 * Math.Min(1.0, (double)unpacked / n);
                }
                else if (removed)
                {
                    // The unpacking is not visible from here (another TEMP):
                    // creep on, slower and slower.
                    text = Say.Pick("Neue Version wird entpackt …", "Unpacking the new version…");
                    double t = (DateTime.UtcNow - removedAt.Value).TotalSeconds;
                    target = 0.12 + 0.55 * (1 - Math.Exp(-t / 15));
                }
                else if (inInstall >= 0 && inInstall < n)
                {
                    text = Say.Pick("Alte Version wird entfernt …", "Removing the old version…");
                    target = 0.12 * Math.Max(0.0, (double)(n - inInstall) / n);
                }
                else
                {
                    text = Say.Pick("Wird vorbereitet …", "Preparing…");
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
                        Ui(delegate { SetPhase(Say.Pick("Wird gestartet …", "Starting…")); SetProgress(0.97); });
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
            title.Text = Say.Pick("Update nicht abgeschlossen", "Update not completed");
            description.Text = appThere
                ? Say.Pick("Die Installation wurde abgebrochen – zum Beispiel, weil die Frage nach Administratorrechten abgelehnt wurde. Die bisherige Version ist noch da.", "The installation was cancelled — for example because the request for administrator rights was declined. The previous version is still there.")
                : Say.Pick("Die Installation wurde abgebrochen, und Girovo ist nicht mehr vollständig installiert. Lade die neue Version von GitHub herunter und installiere sie.", "The installation was cancelled, and Girovo is no longer fully installed. Download the new version from GitHub and install it.");
            progressBlock.Visibility = Visibility.Collapsed;
            buttons.Children.Add(Pill(Say.Pick("Schließen", "Close"), false, Close));
            if (appThere)
            {
                buttons.Children.Add(Pill(Say.Pick("Girovo öffnen", "Open Girovo"), true, delegate
                {
                    StartQuietly(options.AppExe);
                    Close();
                }));
            }
            else if (options.ReleasesUrl.StartsWith("https://github.com/", StringComparison.Ordinal))
            {
                buttons.Children.Add(Pill(Say.Pick("Download-Seite öffnen", "Open download page"), true, delegate
                {
                    StartQuietly(options.ReleasesUrl);
                    Close();
                }));
            }
            buttons.Visibility = Visibility.Visible;
            Activate();
            Log("failure shown (code " + code + ")");
        }

        /// <summary>
        /// The app cannot go on: what it said (already in its language), and the
        /// way out — close, or start it again when it is installed.
        /// </summary>
        void ShowError()
        {
            finished = true;
            title.Text = options.ErrorTitle;
            description.Text = options.ErrorText;
            progressBlock.Visibility = Visibility.Collapsed;
            bool canRestart = !string.IsNullOrEmpty(options.AppExe) && File.Exists(options.AppExe);
            buttons.Children.Add(Pill(Say.Pick("Schließen", "Close"), !canRestart, Close));
            if (canRestart)
            {
                buttons.Children.Add(Pill(Say.Pick("Girovo neu starten", "Restart Girovo"), true, delegate
                {
                    StartQuietly(options.AppExe);
                    Close();
                }));
            }
            buttons.Visibility = Visibility.Visible;
            Log("error shown");
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
                Tuple.Create(Say.Pick("Alte Version wird entfernt …", "Removing the old version…"), 0.06),
                Tuple.Create(Say.Pick("Alte Version wird entfernt …", "Removing the old version…"), 0.12),
                Tuple.Create(Say.Pick("Neue Version wird entpackt …", "Unpacking the new version…"), 0.31),
                Tuple.Create(Say.Pick("Neue Version wird entpackt …", "Unpacking the new version…"), 0.55),
                Tuple.Create(Say.Pick("Dateien werden kopiert …", "Copying files…"), 0.81),
                Tuple.Create(Say.Pick("Wird gestartet …", "Starting…"), 0.97),
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

    /// <summary>
    /// The window's words in the app's language: electron/main.cjs passes
    /// --lang with the language the app is shown in (lib/i18n), and German
    /// is the default, as in the app.
    /// </summary>
    static class Say
    {
        public static bool English;

        public static string Pick(string german, string english)
        {
            return English ? english : german;
        }
    }
}
