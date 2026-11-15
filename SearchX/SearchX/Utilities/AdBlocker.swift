import Foundation
import WebKit

/// Network-level ad blocking (WKContentRuleList) + cosmetic/popup JS injected into every page.
@MainActor
enum AdBlocker {
    /// Known ad / popunder / tracking networks common on adult sites.
    static let adHosts: [String] = [
        "exoclick.com", "exosrv.com", "exdynsrv.com", "realsrv.com", "magsrv.com", "trafficjunky.com",
        "trafficjunky.net", "trafficfactory.biz", "trafficstars.com", "tsyndicate.com", "juicyads.com",
        "juicyads.me", "popads.net", "popcash.net", "propellerads.com", "propellerclick.com", "adsterra.com",
        "adsterratools.com", "hilltopads.net", "hilltopads.com", "clickadu.com", "onclickads.net",
        "onclkds.com", "a-ads.com", "ero-advertising.com", "plugrush.com", "twinrdsrv.com", "bngpt.com",
        "adspyglass.com", "adxpansion.com", "adnium.com", "eroadvertising.com", "crakrevenue.com",
        "mobiright.com", "doubleclick.net", "googlesyndication.com", "googleadservices.com", "adnxs.com",
        "taboola.com", "outbrain.com", "mgid.com", "revcontent.com", "zeydoo.com", "pemsrv.com",
        "dtscout.com", "adtng.com", "adultadworld.com", "hotjar.com", "scorecardresearch.com",
        "lovense-api.com", "chaturbate.com", "stripchat.com", "bongacams.com", "livejasmin.com",
        "imlive.com", "camsoda.com", "xlovecam.com", "streamate.com", "flirt4free.com", "jerkmate.com",
        "a.realsrv.com", "syndication.exosrv.com", "ads.trafficjunky.net", "hw-cdn2.adtng.com",
        "xhamsterlive.com", "xvideos-ads.com", "ads.xvideos.com", "static.ads-twitter.com"
    ]

    static let cosmeticSelectors = [
        "iframe[src*='ads']", "iframe[src*='exoclick']", "iframe[src*='trafficjunky']", "iframe[src*='juicyads']",
        "iframe[data-src*='ads']", "[id^='ad_']", "[id^='ads_']", "[class*='adsbytrafficjunky']",
        "[class*='ad-banner']", "[class*='adBanner']", ".ad-container", ".ads-container", ".adsbox",
        ".video-ad", ".ad_video", ".remove-ads", ".exo-native-widget", "[data-ad-zone]", "[data-exo-zone]",
        ".right-ad", ".abovePlayer", "#pb_template", ".mgp_ad", ".adhesive", ".sponsor", "#ad-footer",
        ".premium-promo", ".cam-promo", ".livecams", "#livecams", ".js-live-cams"
    ]

    static func isAdHost(_ url: URL?) -> Bool {
        guard let host = url?.host?.lowercased() else { return false }
        return adHosts.contains { host == $0 || host.hasSuffix("." + $0) }
    }

    static var rulesJSON: String {
        var rules: [[String: Any]] = adHosts.map { host in
            let escaped = host.replacingOccurrences(of: ".", with: "\\.")
            return ["trigger": ["url-filter": "^https?://+([^:/]+\\.)?\(escaped)[:/]"],
                    "action": ["type": "block"]]
        }
        rules.append([
            "trigger": ["url-filter": ".*"],
            "action": ["type": "css-display-none", "selector": cosmeticSelectors.joined(separator: ", ")]
        ])
        let data = (try? JSONSerialization.data(withJSONObject: rules)) ?? Data("[]".utf8)
        return String(decoding: data, as: UTF8.self)
    }

    private static var cached: WKContentRuleList?

    static func ruleList() async -> WKContentRuleList? {
        if let cached { return cached }
        let json = rulesJSON
        let list: WKContentRuleList? = await withCheckedContinuation { cont in
            WKContentRuleListStore.default().compileContentRuleList(
                forIdentifier: "SearchXAdBlock-v1", encodedContentRuleList: json) { list, error in
                if let error { print("AdBlocker compile failed: \(error)") }
                cont.resume(returning: list)
            }
        }
        cached = list
        return list
    }

    /// Runs in the page world: neutralizes popunders and removes overlay ads that load late.
    static let pageScript = WKUserScript(source: #"""
    (function () {
      if (window.__sxAdBlock) return; window.__sxAdBlock = true;
      try {
        var noop = function () { return null; };
        Object.defineProperty(window, 'open', { value: noop, writable: false, configurable: false });
      } catch (e) { window.open = function () { return null; }; }
      var sel = "__SELECTORS__";
      function sweep() {
        try { document.querySelectorAll(sel).forEach(function (el) { el.remove(); }); } catch (e) {}
        // Full-screen click-jacking overlays (transparent anchors over the player)
        document.querySelectorAll('a[target="_blank"]').forEach(function (a) {
          var s = getComputedStyle(a);
          if ((s.position === 'fixed' || s.position === 'absolute') && parseFloat(s.opacity || '1') < 0.1) a.remove();
        });
      }
      sweep();
      new MutationObserver(function () { sweep(); }).observe(document.documentElement, { childList: true, subtree: true });
    })();
    """#.replacingOccurrences(of: "__SELECTORS__", with: cosmeticSelectors.joined(separator: ", ")),
        injectionTime: .atDocumentEnd, forMainFrameOnly: false)
}
