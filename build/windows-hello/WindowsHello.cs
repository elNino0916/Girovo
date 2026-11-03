// Windows Hello for Girovo's desktop shell. electron/windows-hello.cjs starts
// this program, writes one JSON line to its stdin and reads one JSON line
// back; it keeps nothing itself.
//
// It works with this user account's Windows Hello key for Girovo (a
// KeyCredential, held by the TPM where there is one): creating the key and
// signing with it both ask for the face, the fingerprint or the Windows Hello
// PIN. The shell derives its key from the signature, which only that gesture
// brings about.
//
//   {"op":"probe"}                         → {"supported":true}
//   {"op":"create","name","challenge"}     → {"status","publicKey","signature"}
//   {"op":"sign","name","challenge"}       → {"status","signature"}
//   {"op":"delete","name"}                 → {"status"}
//
// What Windows throws instead comes back as {"error","code"}, the code its
// HRESULT ("0x80090011"), so the page can say what Windows reported.
//
// Windows opens its prompt on its own, often behind Girovo; it is brought to
// the front by its window class, as Chromium does
// (crypto/user_verifying_key_win.cc), which also makes the same calls.
//
// Built by scripts/build-windows-hello.mjs with the C# compiler that ships
// with Windows (.NET Framework 4.x), against Windows' own API descriptions
// (System32\WinMetadata): nothing to install, nothing extra to ship.

using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Windows.Foundation;
using Windows.Security.Credentials;
using Windows.Security.Cryptography;
using Windows.Security.Cryptography.Core;
using Windows.Storage.Streams;

[assembly: AssemblyTitle("Girovo")]
[assembly: AssemblyProduct("Girovo")]
[assembly: AssemblyDescription("Windows Hello für Girovo")]

namespace Girovo.WindowsHello
{
    /// <summary>Filled in by the JSON reader, never by this code.</summary>
    [DataContract]
    sealed class Request
    {
        [DataMember(Name = "op")] public string Op = null;
        [DataMember(Name = "name")] public string Name = null;
        [DataMember(Name = "challenge")] public string Challenge = null;
    }

    [DataContract]
    sealed class Answer
    {
        [DataMember(Name = "supported", EmitDefaultValue = false)] public bool? Supported;
        [DataMember(Name = "status", EmitDefaultValue = false)] public string Status;
        [DataMember(Name = "publicKey", EmitDefaultValue = false)] public string PublicKey;
        [DataMember(Name = "signature", EmitDefaultValue = false)] public string Signature;
        [DataMember(Name = "error", EmitDefaultValue = false)] public string Error;
        [DataMember(Name = "code", EmitDefaultValue = false)] public string Code;
    }

    static class Program
    {
        /// <summary>Only Girovo's own keys: nothing else this user account holds is named here.</summary>
        static readonly Regex KeyName = new Regex("^Girovo-[A-Za-z0-9]{1,64}$");

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr FindWindow(string className, string title);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool SetForegroundWindow(IntPtr window);

        static int Main()
        {
            Answer answer;
            try
            {
                answer = Handle(ReadRequest());
            }
            catch (Exception e)
            {
                Exception thrown = e.GetBaseException();
                answer = new Answer { Error = thrown.Message, Code = "0x" + thrown.HResult.ToString("X8") };
            }
            WriteAnswer(answer);
            return 0;
        }

        static Answer Handle(Request request)
        {
            if (request == null || request.Op == null) return new Answer { Error = "no request" };
            if (request.Op == "probe") return new Answer { Supported = Wait(KeyCredentialManager.IsSupportedAsync(), false) };
            if (request.Name == null || !KeyName.IsMatch(request.Name)) return new Answer { Error = "bad name" };
            switch (request.Op)
            {
                case "create":
                {
                    KeyCredentialRetrievalResult created = Wait(
                        KeyCredentialManager.RequestCreateAsync(request.Name, KeyCredentialCreationOption.ReplaceExisting), true);
                    if (created.Status != KeyCredentialStatus.Success) return new Answer { Status = created.Status.ToString() };
                    Answer answer = Sign(created.Credential, request.Challenge);
                    answer.PublicKey = Base64(created.Credential.RetrievePublicKey(CryptographicPublicKeyBlobType.X509SubjectPublicKeyInfo));
                    return answer;
                }
                case "sign":
                {
                    KeyCredentialRetrievalResult opened = Wait(KeyCredentialManager.OpenAsync(request.Name), false);
                    if (opened.Status != KeyCredentialStatus.Success) return new Answer { Status = opened.Status.ToString() };
                    return Sign(opened.Credential, request.Challenge);
                }
                case "delete":
                {
                    try
                    {
                        Wait(KeyCredentialManager.DeleteAsync(request.Name));
                    }
                    catch (Exception)
                    {
                        // Already gone, or never made.
                    }
                    return new Answer { Status = "Success" };
                }
                default:
                    return new Answer { Error = "unknown op" };
            }
        }

        static Answer Sign(KeyCredential credential, string challenge)
        {
            IBuffer data = CryptographicBuffer.CreateFromByteArray(Convert.FromBase64String(challenge ?? ""));
            KeyCredentialOperationResult signed = Wait(credential.RequestSignAsync(data), true);
            Answer answer = new Answer { Status = signed.Status.ToString() };
            if (signed.Status == KeyCredentialStatus.Success) answer.Signature = Base64(signed.Result);
            return answer;
        }

        static string Base64(IBuffer buffer)
        {
            byte[] bytes;
            CryptographicBuffer.CopyToByteArray(buffer, out bytes);
            return Convert.ToBase64String(bytes);
        }

        /// <summary>The operation's result; a prompt it shows is brought to the front once.</summary>
        static T Wait<T>(IAsyncOperation<T> operation, bool prompts)
        {
            using (ManualResetEvent done = new ManualResetEvent(false))
            {
                operation.Completed = delegate { done.Set(); };
                bool raised = !prompts;
                while (!done.WaitOne(100))
                {
                    if (raised) continue;
                    IntPtr prompt = FindWindow("Credential Dialog Xaml Host", null);
                    if (prompt == IntPtr.Zero) continue;
                    SetForegroundWindow(prompt);
                    raised = true;
                }
            }
            return operation.GetResults();
        }

        static void Wait(IAsyncAction action)
        {
            using (ManualResetEvent done = new ManualResetEvent(false))
            {
                action.Completed = delegate { done.Set(); };
                done.WaitOne();
            }
            action.GetResults();
        }

        static Request ReadRequest()
        {
            string line = Console.In.ReadLine();
            if (string.IsNullOrEmpty(line)) return null;
            using (MemoryStream stream = new MemoryStream(Encoding.UTF8.GetBytes(line)))
            {
                return (Request)new DataContractJsonSerializer(typeof(Request)).ReadObject(stream);
            }
        }

        static void WriteAnswer(Answer answer)
        {
            using (MemoryStream stream = new MemoryStream())
            {
                new DataContractJsonSerializer(typeof(Answer)).WriteObject(stream, answer);
                stream.WriteByte((byte)'\n');
                using (Stream output = Console.OpenStandardOutput())
                {
                    output.Write(stream.GetBuffer(), 0, (int)stream.Length);
                }
            }
        }
    }
}
