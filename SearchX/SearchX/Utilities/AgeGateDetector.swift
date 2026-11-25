import Foundation

/// Detects third-party age verification gates (Yoti, AgeID, AgeVerif, etc.).
enum AgeGateDetector {
    enum Provider: String {
        case yoti = "Yoti", ageID = "AgeID", ageVerif = "AgeVerif", verifyMyAge = "VerifyMyAge",
             goCam = "Go.cam", generic = "the site"
    }

    private static let hostPatterns: [(String, Provider)] = [
        ("yoti.com", .yoti), ("yoti.world", .yoti), ("ageid.com", .ageID), ("age-id.", .ageID),
        ("ageverif.com", .ageVerif), ("ageverify", .ageVerif), ("verifymyage", .verifyMyAge),
        ("go.cam", .goCam), ("agechecked.com", .generic), ("allpasstrust", .generic)
    ]

    private static let pathPatterns = [
        "/age-verification", "/age_verification", "/ageverification", "/verify-age", "/age-gate/verify",
        "age_verification=", "/av/verify"
    ]

    /// Strong signals inside page HTML.
    private static let htmlPatterns: [(String, Provider)] = [
        ("yoti-age-estimation", .yoti), ("cdn.yoti.com", .yoti), ("age.yoti.com", .yoti), ("yoti.com/age", .yoti),
        ("ageid.com", .ageID), ("ageverif.com", .ageVerif), ("verifymyage", .verifyMyAge), ("go.cam/", .goCam),
        ("data-age-verification", .generic), ("id=\"age-verification\"", .generic)
    ]

    static func provider(for url: URL?) -> Provider? {
        guard let url else { return nil }
        let host = url.host?.lowercased() ?? ""
        if let p = hostPatterns.first(where: { host.contains($0.0) }) { return p.1 }
        let full = url.absoluteString.lowercased()
        if pathPatterns.contains(where: full.contains) { return .generic }
        return nil
    }

    static func isAgeGate(url: URL?) -> Bool { provider(for: url) != nil }

    static func provider(inHTML html: String) -> Provider? {
        let lower = html.lowercased()
        return htmlPatterns.first(where: { lower.contains($0.0) })?.1
    }

    /// JS run after page load to return the first verification link found (or an empty string).
    static let detectionScript = #"""
    (function () {
      var html = document.documentElement.outerHTML.slice(0, 400000);
      var link = '';
      var nodes = document.querySelectorAll('a[href], iframe[src], form[action]');
      for (var i = 0; i < nodes.length; i++) {
        var u = nodes[i].href || nodes[i].src || nodes[i].action || '';
        if (/yoti|ageid|ageverif|verifymyage|go\.cam|age-verification/i.test(u)) { link = u; break; }
      }
      return JSON.stringify({ html: html, link: link });
    })();
    """#
}
