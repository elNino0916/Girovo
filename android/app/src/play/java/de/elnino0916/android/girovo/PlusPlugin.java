package de.elnino0916.android.girovo;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.util.Log;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Girovo Plus in the Google Play build (docs/plus-plan.md, lib/plus.ts): one
 * subscription, `girovo_plus`, with a monthly and a yearly base plan and a
 * 3-day trial. It unlocks more than one bank and the month-end forecast, and
 * lets a subscriber switch the app icon to the gold one.
 *
 * Girovo has no server, so Play Billing's own purchase state on the phone is
 * the proof. The last answer is kept: a phone briefly without Play (no
 * network, Play updating) keeps what was paid for, for up to GRACE_MS.
 *
 * An owner key (scripts/owner-key.mjs) opens Plus on one installation without
 * a purchase: the developer's own phone, so they need neither pay for their
 * own app nor run licence-test subscriptions that lapse within the hour.
 *
 * The GitHub build has its own PlusPlugin (src/github): free, nothing locked.
 */
@CapacitorPlugin(name = "GirovoPlus")
public class PlusPlugin extends Plugin implements PurchasesUpdatedListener {

    private static final String TAG = "GirovoPlus";
    static final String PRODUCT = "girovo_plus";
    private static final String PREFS = "girovo_plus";
    /** How long a confirmed subscription stands while Play cannot be asked. */
    private static final long GRACE_MS = 7L * 24 * 60 * 60 * 1000;

    /** The two launcher entries (AndroidManifest.xml): the app's icon and the gold one. */
    static final String LAUNCHER_STANDARD = ".LauncherStandard";
    static final String LAUNCHER_PLUS = ".LauncherPlus";

    private BillingClient client;
    private ProductDetails details;
    private final Map<String, String> offerTokens = new HashMap<>();
    /** active · inactive · unavailable; null until Play has answered once this start. */
    private volatile String state;
    private volatile String plan;

    /**
     * The owner's public key (scripts/owner-key.mjs). A key is the owner's
     * ECDSA P-256 signature over OWNER_MESSAGE + this installation's ID; only
     * the public half is here, so no key can be made from this source.
     */
    private static final String OWNER_PUBLIC_KEY = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7IhFdTIGU6bU97Eo5BtezUiaeM4rxURUKLbsTIrbcLsZVcSgXX/0KijC2aZBy4DIapCllAvaTm/hw+sW3Z//8Q==";
    private static final String OWNER_MESSAGE = "girovo-plus-owner:";
    private static final String OWNER_KEY_PREFIX = "GPO1.";
    /** Crockford's base32: no I, L, O or U, so an ID read off the screen is typed right. */
    private static final String ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    /** Whether the kept owner key fits this installation; null until checked. */
    private volatile Boolean ownerFits;

    @Override
    public void load() {
        client = BillingClient.newBuilder(getContext())
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection()
            .build();
        connect();
    }

    @Override
    protected void handleOnResume() {
        // Back from Play's own subscription page: whatever changed there counts now.
        if (client != null && client.isReady()) refresh();
    }

    @Override
    protected void handleOnDestroy() {
        if (client != null) client.endConnection();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** A connection on its way: a second one would be refused (DEVELOPER_ERROR, 5). */
    private final java.util.concurrent.atomic.AtomicBoolean connecting = new java.util.concurrent.atomic.AtomicBoolean(false);

    private void connect() {
        if (!connecting.compareAndSet(false, true)) return;
        client.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {
                connecting.set(false);
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    refresh();
                } else {
                    Log.w(TAG, "billing setup: " + result.getResponseCode());
                    settle(unreachable(result.getResponseCode()), null);
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                // enableAutoServiceReconnection reconnects on the next call.
                connecting.set(false);
            }
        });
    }

    /** No billing on this phone at all, or only not right now. */
    private static String unreachable(int code) {
        return code == BillingClient.BillingResponseCode.BILLING_UNAVAILABLE
            || code == BillingClient.BillingResponseCode.FEATURE_NOT_SUPPORTED ? "unavailable" : null;
    }

    /** Asks Play for the offers and the purchases, then says what it found. */
    private void refresh() {
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
            .setProductList(Collections.singletonList(QueryProductDetailsParams.Product.newBuilder()
                .setProductId(PRODUCT)
                .setProductType(BillingClient.ProductType.SUBS)
                .build()))
            .build();
        client.queryProductDetailsAsync(params, (result, found) -> {
            if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && found != null) {
                List<ProductDetails> list = found.getProductDetailsList();
                details = list.isEmpty() ? null : list.get(0);
            }
            queryPurchases();
        });
    }

    private void queryPurchases() {
        client.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build(),
            (result, purchases) -> {
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    settle(unreachable(result.getResponseCode()), null);
                    return;
                }
                handle(purchases);
            });
    }

    /** The purchases Play reports: acknowledged where new, and the state they make. */
    private void handle(List<Purchase> purchases) {
        boolean active = false;
        for (Purchase p : purchases) {
            if (!p.getProducts().contains(PRODUCT) || p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) continue;
            active = true;
            if (!p.isAcknowledged()) {
                // Unacknowledged for three days, Play refunds it.
                client.acknowledgePurchase(
                    AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(),
                    r -> Log.i(TAG, "acknowledged: " + r.getResponseCode()));
            }
        }
        // A purchase does not name its base plan; the one bought here is remembered (null if bought elsewhere).
        settle(active ? "active" : "inactive", active ? prefs().getString("plan", null) : null);
    }

    /**
     * Takes Play's answer and tells the page. Only Play's own "no purchase"
     * ends Plus: where Play could not be asked (`now` null) or takes no
     * purchases right now ("unavailable" — signed out, updating), a
     * subscription confirmed within GRACE_MS stands.
     */
    private void settle(String now, String nowPlan) {
        SharedPreferences.Editor edit = prefs().edit();
        long at = prefs().getLong("activeAt", 0);
        boolean recent = at > 0 && System.currentTimeMillis() - at < GRACE_MS;
        if ("active".equals(now)) {
            edit.putLong("activeAt", System.currentTimeMillis());
            if (nowPlan != null) edit.putString("plan", nowPlan);
        } else if (now == null || "unavailable".equals(now)) {
            if (recent) {
                now = "active";
                nowPlan = prefs().getString("plan", null);
            } else if (now == null) {
                now = "inactive";
            }
        } else {
            edit.remove("activeAt");
        }
        edit.apply();
        state = now;
        plan = nowPlan;
        // The gold icon is a Plus subscriber's: it goes when Plus does (an owner key keeps it).
        if (!"active".equals(now) && !ownerKeyHere() && "plus".equals(currentIcon())) switchIcon("standard");
        notifyListeners("change", statusNow());
    }

    private JSObject statusNow() {
        JSObject out = new JSObject();
        String s = state;
        if (s == null) {
            // Play has not answered yet this start: the last answer, so a subscriber sees no lock flash by.
            long at = prefs().getLong("activeAt", 0);
            s = at > 0 && System.currentTimeMillis() - at < GRACE_MS ? "active" : "inactive";
        }
        // An owner key opens Plus whatever Play says; the plan stays Play's own.
        boolean own = ownerKeyHere();
        out.put("state", own ? "active" : s);
        if ("active".equals(s)) out.put("plan", plan != null ? plan : prefs().getString("plan", null));
        if (own) out.put("owner", true);
        out.put("icon", currentIcon());
        out.put("offers", offersNow());
        return out;
    }

    /** The monthly and yearly base plan, each with its trial where Play offers this user one. */
    private JSArray offersNow() {
        JSArray out = new JSArray();
        offerTokens.clear();
        if (details == null || details.getSubscriptionOfferDetails() == null) return out;
        for (String basePlan : new String[] { "monthly", "yearly" }) {
            ProductDetails.SubscriptionOfferDetails base = null;
            ProductDetails.SubscriptionOfferDetails trial = null;
            for (ProductDetails.SubscriptionOfferDetails o : details.getSubscriptionOfferDetails()) {
                if (!basePlan.equals(o.getBasePlanId())) continue;
                if (o.getOfferId() == null) base = o;
                else if (trial == null && freeFirst(o)) trial = o;
            }
            ProductDetails.SubscriptionOfferDetails use = trial != null ? trial : base;
            if (use == null) continue;
            List<ProductDetails.PricingPhase> phases = use.getPricingPhases().getPricingPhaseList();
            ProductDetails.PricingPhase recurring = phases.get(phases.size() - 1);
            JSObject offer = new JSObject();
            offer.put("plan", basePlan);
            offer.put("price", recurring.getFormattedPrice());
            if (trial != null) offer.put("trialDays", days(phases.get(0).getBillingPeriod()));
            out.put(offer);
            offerTokens.put(basePlan, use.getOfferToken());
        }
        return out;
    }

    private static boolean freeFirst(ProductDetails.SubscriptionOfferDetails o) {
        List<ProductDetails.PricingPhase> phases = o.getPricingPhases().getPricingPhaseList();
        return !phases.isEmpty() && phases.get(0).getPriceAmountMicros() == 0;
    }

    /** "P3D" → 3, "P1W" → 7. */
    private static int days(String period) {
        try {
            if (period.startsWith("P") && period.endsWith("D")) return Integer.parseInt(period.substring(1, period.length() - 1));
            if (period.startsWith("P") && period.endsWith("W")) return 7 * Integer.parseInt(period.substring(1, period.length() - 1));
        } catch (NumberFormatException ignored) {
            // An unusual period: no trial days to name.
        }
        return 0;
    }

    // ---------------------------------------------------------------------

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusNow());
        // Not yet connected: the start's own connection answers with a "change" once it is up.
        if (client.isReady()) refresh();
        else if (!connecting.get()) connect();
    }

    /** { plan: 'monthly' | 'yearly' } → Play's purchase sheet; the outcome arrives as a "change". */
    @PluginMethod
    public void buy(PluginCall call) {
        String chosen = call.getString("plan", "monthly");
        String token = offerTokens.get(chosen);
        if (details == null || token == null || getActivity() == null) {
            call.reject("not offered", "UNAVAILABLE");
            return;
        }
        prefs().edit().putString("pendingPlan", chosen).apply();
        BillingFlowParams params = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(Collections.singletonList(BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(details)
                .setOfferToken(token)
                .build()))
            .build();
        BillingResult result = client.launchBillingFlow(getActivity(), params);
        JSObject out = new JSObject();
        out.put("launched", result.getResponseCode() == BillingClient.BillingResponseCode.OK);
        call.resolve(out);
    }

    @Override
    public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) {
            String pending = prefs().getString("pendingPlan", null);
            if (pending != null) prefs().edit().putString("plan", pending).remove("pendingPlan").apply();
            handle(purchases);
        } else if (result.getResponseCode() == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
            queryPurchases();
        } else {
            // Cancelled, or Play refused: nothing changed; say so all the same.
            notifyListeners("change", statusNow());
        }
    }

    /** Play's own page for the subscription: change the plan, cancel. */
    @PluginMethod
    public void manage(PluginCall call) {
        String pkg = getContext().getPackageName();
        Intent view = new Intent(Intent.ACTION_VIEW,
            Uri.parse("https://play.google.com/store/account/subscriptions?sku=" + PRODUCT + "&package=" + pkg));
        view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(view);
            call.resolve();
        } catch (Exception e) {
            call.reject("no Play", "UNAVAILABLE");
        }
    }

    /** { icon: 'standard' | 'plus' } — the gold one only while Plus is active. */
    @PluginMethod
    public void setIcon(PluginCall call) {
        String icon = call.getString("icon", "standard");
        if ("plus".equals(icon) && !"active".equals(statusNow().getString("state"))) {
            call.reject("needs Plus", "LOCKED");
            return;
        }
        switchIcon(icon);
        call.resolve(statusNow());
    }

    private String currentIcon() {
        int s = getContext().getPackageManager().getComponentEnabledSetting(component(LAUNCHER_PLUS));
        return s == PackageManager.COMPONENT_ENABLED_STATE_ENABLED ? "plus" : "standard";
    }

    /**
     * Swaps the launcher entry. The new one is enabled before the old one goes,
     * so the app always has an icon; DONT_KILL_APP keeps this screen open.
     */
    private void switchIcon(String icon) {
        PackageManager pm = getContext().getPackageManager();
        boolean plus = "plus".equals(icon);
        ComponentName on = component(plus ? LAUNCHER_PLUS : LAUNCHER_STANDARD);
        ComponentName off = component(plus ? LAUNCHER_STANDARD : LAUNCHER_PLUS);
        pm.setComponentEnabledSetting(on, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
        pm.setComponentEnabledSetting(off,
            plus ? PackageManager.COMPONENT_ENABLED_STATE_DISABLED : PackageManager.COMPONENT_ENABLED_STATE_DEFAULT,
            PackageManager.DONT_KILL_APP);
        if (!plus) {
            // Back to the manifest's own default: the standard entry enabled.
            pm.setComponentEnabledSetting(on, PackageManager.COMPONENT_ENABLED_STATE_DEFAULT, PackageManager.DONT_KILL_APP);
        }
    }

    // --- The owner key ---------------------------------------------------

    /** This installation's ID ("K7Q2-9XMA-4HTB"), made once; an owner key is bound to it. */
    private String installId() {
        String id = prefs().getString("installId", null);
        if (id == null) {
            SecureRandom random = new SecureRandom();
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < 12; i++) {
                if (i > 0 && i % 4 == 0) b.append('-');
                b.append(ID_ALPHABET.charAt(random.nextInt(ID_ALPHABET.length())));
            }
            id = b.toString();
            prefs().edit().putString("installId", id).apply();
        }
        return id;
    }

    /** Whether a kept owner key opens Plus here. */
    private boolean ownerKeyHere() {
        Boolean known = ownerFits;
        if (known == null) {
            String key = prefs().getString("ownerKey", null);
            known = key != null && ownerKeyFits(key, installId());
            ownerFits = known;
        }
        return known;
    }

    /** Whether a key is the owner's signature over this installation's ID. */
    private static boolean ownerKeyFits(String key, String id) {
        if (!key.startsWith(OWNER_KEY_PREFIX)) return false;
        try {
            byte[] signature = Base64.getUrlDecoder().decode(key.substring(OWNER_KEY_PREFIX.length()));
            Signature check = Signature.getInstance("SHA256withECDSA");
            check.initVerify(KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(Base64.getDecoder().decode(OWNER_PUBLIC_KEY))));
            check.update((OWNER_MESSAGE + id).getBytes(StandardCharsets.UTF_8));
            return check.verify(signature);
        } catch (Exception e) {
            // Not base64, not a signature: not a key.
            return false;
        }
    }

    /** This installation's ID, and whether an owner key opens Plus on it. */
    @PluginMethod
    public void owner(PluginCall call) {
        JSObject out = new JSObject();
        out.put("installId", installId());
        out.put("owner", ownerKeyHere());
        call.resolve(out);
    }

    /** { key } → kept and Plus is on, when it is this installation's; INVALID otherwise. */
    @PluginMethod
    public void setOwnerKey(PluginCall call) {
        String key = call.getString("key", "").replaceAll("\\s+", "");
        if (!ownerKeyFits(key, installId())) {
            call.reject("not this installation's key", "INVALID");
            return;
        }
        prefs().edit().putString("ownerKey", key).apply();
        ownerFits = true;
        JSObject now = statusNow();
        notifyListeners("change", now);
        call.resolve(now);
    }

    /** Forgets the owner key: Plus is what Play says again, and the gold icon goes with it. */
    @PluginMethod
    public void clearOwnerKey(PluginCall call) {
        prefs().edit().remove("ownerKey").apply();
        ownerFits = false;
        if (!"active".equals(statusNow().getString("state")) && "plus".equals(currentIcon())) switchIcon("standard");
        JSObject now = statusNow();
        notifyListeners("change", now);
        call.resolve(now);
    }

    /** A launcher entry: the app's package, the class named in the manifest's namespace (MainActivity's). */
    private ComponentName component(String alias) {
        return new ComponentName(getContext().getPackageName(), MainActivity.class.getPackage().getName() + alias);
    }
}
