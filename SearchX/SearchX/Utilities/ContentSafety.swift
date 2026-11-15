import Foundation

/// Hard safety rail: SearchX never searches for or shows content that sexualizes minors.
/// Blocks matching queries outright and drops any result whose title or tags match.
enum ContentSafety {
    /// Whole-word terms (compared against lowercase tokens).
    private static let blockedTokens: Set<String> = [
        "child", "children", "childs", "kid", "kids", "kiddie", "kiddy", "underage", "underaged", "minor", "minors",
        "preteen", "preteens", "pre-teen", "loli", "lolis", "lolicon", "shota", "shotacon", "shotas", "toddler",
        "toddlers", "infant", "infants", "jailbait", "pedo", "pedophile", "paedo", "cp", "cub", "cubs",
        "elementary", "middleschool", "prepubescent", "tween", "tweens", "youngling"
    ]

    /// Phrases checked as substrings of the normalized text.
    private static let blockedPhrases: [String] = [
        "under age", "under 18", "middle school", "grade school", "little girl", "little boy",
        "young girl", "young boy", "barely legal child", "school age"
    ]

    /// Tags only meaningful on booru-style sites (Rule34), where "young" etc. denote minors.
    static let booruNegativeTags = ["loli", "shota", "child", "young", "toddler", "cub", "underage"]

    /// Ages 1–17 written as "12yo", "15 y/o", "16 years old", "aged 14".
    private static let agePatterns = [
        #"\b(?:[1-9]|1[0-7])\s*(?:yo|y\/o|yrs?|years?[\s-]*old)\b"#,
        #"\baged?\s*(?:[1-9]|1[0-7])\b"#
    ]

    private static func normalize(_ s: String) -> String {
        s.lowercased()
            .folding(options: [.diacriticInsensitive, .widthInsensitive], locale: .current)
            .replacingOccurrences(of: "_", with: " ")
    }

    private static func tokens(_ s: String) -> [String] {
        s.components(separatedBy: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-")).inverted)
            .filter { !$0.isEmpty }
    }

    static func isBlocked(text: String) -> Bool {
        let n = normalize(text)
        if tokens(n).contains(where: blockedTokens.contains) { return true }
        if blockedPhrases.contains(where: n.contains) { return true }
        for p in agePatterns where n.range(of: p, options: .regularExpression) != nil { return true }
        return false
    }

    static func isQueryAllowed(_ query: String) -> Bool { !isBlocked(text: query) }

    static func isAllowed(_ r: VideoResult) -> Bool {
        if isBlocked(text: r.title) { return false }
        if r.sourceID == .rule34 {
            let tagSet = Set(r.tags.map { $0.lowercased() })
            if booruNegativeTags.contains(where: tagSet.contains) { return false }
        }
        return !r.tags.contains(where: { isBlocked(text: $0) })
    }
}
