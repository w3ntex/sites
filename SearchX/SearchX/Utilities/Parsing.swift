import Foundation

// MARK: - Lenient JSON helpers

/// Decodes a number that may arrive as Int, Double or String ("1,234", "85.5").
struct FlexNumber: Decodable, Sendable {
    let value: Double?

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let d = try? c.decode(Double.self) {
            value = d
        } else if let s = try? c.decode(String.self) {
            value = Double(s.replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespaces))
        } else {
            value = nil
        }
    }

    var int: Int? { value.map { Int($0) } }
}

/// Decodes an identifier that may arrive as String or number.
struct FlexString: Decodable, Sendable {
    let value: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) {
            value = s
        } else if let i = try? c.decode(Int64.self) {
            value = String(i)
        } else if let d = try? c.decode(Double.self) {
            value = String(Int64(d))
        } else {
            value = nil
        }
    }
}

/// Array that skips elements failing to decode instead of failing the whole response.
struct LossyArray<T: Decodable>: Decodable {
    let items: [T]

    private struct Skip: Decodable { init(from decoder: Decoder) throws {} }

    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        var out: [T] = []
        while !c.isAtEnd {
            if let v = try? c.decode(T.self) {
                out.append(v)
            } else {
                _ = try? c.decode(Skip.self)
            }
        }
        items = out
    }
}

// MARK: - Text helpers

enum Parse {
    /// "10:23" / "1:02:03" → seconds
    static func clockDuration(_ s: String?) -> Int? {
        guard let s, !s.isEmpty else { return nil }
        let parts = s.split(separator: ":").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
        guard !parts.isEmpty else { return nil }
        return parts.reduce(0) { $0 * 60 + $1 }
    }

    /// "10 min", "1 h 5 min", "45 sec", "1h 02min" → seconds
    static func wordDuration(_ s: String?) -> Int? {
        guard let s = s?.lowercased() else { return nil }
        if s.contains(":") { return clockDuration(s.trimmingCharacters(in: .whitespaces)) }
        var total = 0
        var found = false
        let pattern = #"(\d+)\s*(h|min|m|sec|s)"#
        for m in Rx.matches(pattern, in: s) where m.count >= 3 {
            guard let n = Int(m[1]) else { continue }
            found = true
            switch m[2] {
            case "h": total += n * 3600
            case "min", "m": total += n * 60
            default: total += n
            }
        }
        return found ? total : nil
    }

    /// "1.2M", "345K", "12,345" → Int
    static func compactNumber(_ s: String?) -> Int? {
        guard var t = s?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(), !t.isEmpty else { return nil }
        t = t.replacingOccurrences(of: ",", with: "")
        var mult = 1.0
        if t.hasSuffix("B") { mult = 1e9; t.removeLast() }
        else if t.hasSuffix("M") { mult = 1e6; t.removeLast() }
        else if t.hasSuffix("K") { mult = 1e3; t.removeLast() }
        guard let v = Double(t.trimmingCharacters(in: .whitespaces)) else { return nil }
        return Int(v * mult)
    }

    /// "720p", "1080p", "4K", "HD" → vertical resolution
    static func resolution(_ s: String?) -> Int? {
        guard let s = s?.lowercased() else { return nil }
        if s.contains("4k") || s.contains("2160") || s.contains("uhd") { return 2160 }
        if s.contains("1440") { return 1440 }
        if s.contains("1080") { return 1080 }
        if s.contains("720") || s.contains("hd") { return 720 }
        if let n = Int(s.filter(\.isNumber)), n > 100 { return n }
        return nil
    }

    private static let sqlDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f
    }()

    static func sqlDate(_ s: String?) -> Date? {
        guard let s else { return nil }
        return sqlDateFormatter.date(from: s)
    }

    static func url(_ s: String?, relativeTo base: URL? = nil) -> URL? {
        guard var s = s?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        s = HTML.decodeEntities(s)
        if s.hasPrefix("//") { s = "https:" + s }
        if let u = URL(string: s, relativeTo: base)?.absoluteURL, u.scheme?.hasPrefix("http") == true { return u }
        if let enc = s.addingPercentEncoding(withAllowedCharacters: .urlFragmentAllowed),
           let u = URL(string: enc, relativeTo: base)?.absoluteURL, u.scheme?.hasPrefix("http") == true {
            return u
        }
        return nil
    }
}

enum Rx {
    /// All matches, each as [full match, group1, group2, ...] ("" for missing groups).
    static func matches(_ pattern: String, in text: String, options: NSRegularExpression.Options = [.caseInsensitive]) -> [[String]] {
        guard let re = try? NSRegularExpression(pattern: pattern, options: options) else { return [] }
        let ns = text as NSString
        return re.matches(in: text, range: NSRange(location: 0, length: ns.length)).map { m in
            (0..<m.numberOfRanges).map { i in
                let r = m.range(at: i)
                return r.location == NSNotFound ? "" : ns.substring(with: r)
            }
        }
    }

    static func first(_ pattern: String, in text: String, group: Int = 1,
                      options: NSRegularExpression.Options = [.caseInsensitive, .dotMatchesLineSeparators]) -> String? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: options) else { return nil }
        let ns = text as NSString
        guard let m = re.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)),
              group < m.numberOfRanges else { return nil }
        let r = m.range(at: group)
        return r.location == NSNotFound ? nil : ns.substring(with: r)
    }
}

enum HTML {
    private static let named: [String: String] = [
        "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": " ", "#39": "'", "#039": "'",
        "hellip": "…", "ndash": "–", "mdash": "—", "rsquo": "’", "lsquo": "‘", "rdquo": "”", "ldquo": "“"
    ]

    static func decodeEntities(_ s: String) -> String {
        guard s.contains("&") else { return s }
        var out = ""
        var i = s.startIndex
        while i < s.endIndex {
            if s[i] == "&", let semi = s[i...].prefix(10).firstIndex(of: ";") {
                let entity = String(s[s.index(after: i)..<semi])
                if let rep = named[entity] {
                    out += rep; i = s.index(after: semi); continue
                }
                if entity.hasPrefix("#") {
                    let num = entity.dropFirst()
                    let code = num.hasPrefix("x") || num.hasPrefix("X") ? UInt32(num.dropFirst(), radix: 16) : UInt32(num)
                    if let code, let scalar = Unicode.Scalar(code) {
                        out.unicodeScalars.append(scalar); i = s.index(after: semi); continue
                    }
                }
            }
            out.append(s[i])
            i = s.index(after: i)
        }
        return out
    }

    static func stripTags(_ s: String) -> String {
        let noTags = s.replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
        return decodeEntities(noTags)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
