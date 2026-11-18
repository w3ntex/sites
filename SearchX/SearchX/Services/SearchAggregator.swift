import Foundation
import SwiftUI

/// Fans a query out to every enabled source concurrently, streams results in as each source answers,
/// then normalizes, safety-filters, de-duplicates, filters and sorts them.
@MainActor
final class SearchAggregator: ObservableObject {
    enum SourceState: Equatable {
        case loading
        case done(count: Int)
        case failed(String)
    }

    @Published private(set) var results: [VideoResult] = []
    @Published private(set) var sourceStates: [SourceID: SourceState] = [:]
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMore = false
    @Published private(set) var query = ""
    @Published var errorMessage: String?
    /// Creators found in the current results (after filters, before the creator filter).
    @Published private(set) var creators: [CreatorInfo] = []
    /// Lowercased creator keys the user picked; empty = show everyone.
    @Published private(set) var selectedCreators: Set<String> = []
    /// Sources picked with the chips above the results; empty = show all sources.
    @Published private(set) var visibleSources: Set<SourceID> = []

    struct CreatorInfo: Identifiable, Hashable {
        let key: String
        let name: String
        let count: Int
        let sources: [SourceID]
        let thumbnail: URL?
        var id: String { key }
    }

    static func creatorKey(_ name: String) -> String {
        name.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "@ ").union(.whitespaces))
    }

    private let services: [SourceID: any SearchService]
    private var rawBySource: [SourceID: [VideoResult]] = [:]
    private var exhausted: Set<SourceID> = []
    private var page = 1
    private var filters = SearchFilters()
    private var task: Task<Void, Never>?

    init(services: [any SearchService] = [
        XVideosService(), XHamsterService(), RedTubeService(),
        Rule34Service(), RedGIFsService(), RedditService()
    ]) {
        self.services = Dictionary(uniqueKeysWithValues: services.map { ($0.source, $0) })
    }

    var hasQuery: Bool { !query.isEmpty }
    /// True while any source is still fetching (initial search, newly enabled source, next page).
    var isAnySourceLoading: Bool { sourceStates.values.contains(.loading) }
    /// Chips shown above the results: only sources that are currently enabled.
    var displayedSources: [SourceID] {
        let active = Set(filters.activeSources)
        return SourceID.allCases.filter { sourceStates[$0] != nil && active.contains($0) }
    }
    var canLoadMore: Bool {
        hasQuery && !isLoading && !isLoadingMore && filters.activeSources.contains { !exhausted.contains($0) }
    }
    var failedSources: [(SourceID, String)] {
        sourceStates.compactMap { k, v in if case .failed(let m) = v { return (k, m) } else { return nil } }
            .sorted { $0.0.rawValue < $1.0.rawValue }
    }

    // MARK: Public API

    func search(_ keyword: String, filters: SearchFilters) {
        let q = keyword.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return }
        guard ContentSafety.isQueryAllowed(q) else {
            task?.cancel()
            query = ""
            results = []
            sourceStates = [:]
            errorMessage = "That search isn't allowed. SearchX does not search for content involving minors."
            Haptics.error()
            return
        }
        guard !filters.activeSources.isEmpty else {
            errorMessage = "No sources are enabled for this media type. Turn some on in the Sources filter."
            return
        }
        SuggestionProvider.remember(q)
        start(keyword: q, filters: filters)
    }

    /// Called when the filter bar changes.
    func filtersChanged(_ newFilters: SearchFilters) {
        guard hasQuery else { filters = newFilters; return }
        guard newFilters != filters else { return }
        let old = filters
        filters = newFilters

        // A different media type changes what every source must be asked for → new search.
        if old.media != newFilters.media {
            start(keyword: query, filters: newFilters)
            return
        }

        // Sort / duration / quality: re-order and re-filter what's already loaded (no reload,
        // creator and source selections are kept).
        let oldActive = Set(old.activeSources)
        let newActive = newFilters.activeSources
        for removed in oldActive.subtracting(newActive) {
            sourceStates[removed] = nil
            visibleSources.remove(removed)
        }
        let added = newActive.filter { !oldActive.contains($0) }
        if !added.isEmpty {
            // Only the newly enabled sources are fetched.
            for a in added { sourceStates[a] = .loading; exhausted.remove(a); rawBySource[a] = nil }
            let (q, p) = (query, page)
            Task { [weak self] in
                for pg in 1...max(1, p) { await self?.fetch(keyword: q, filters: newFilters, page: pg, only: added) }
            }
        }
        withAnimation(.easeOut(duration: 0.25)) { rebuild() }
    }

    func refresh() async {
        guard hasQuery else { return }
        await HTTPClient.clearCache()
        start(keyword: query, filters: filters)
        await task?.value
    }

    func loadMoreIfNeeded(current item: VideoResult) {
        guard canLoadMore, let idx = results.firstIndex(where: { $0.id == item.id }),
              idx >= results.count - 6 else { return }
        loadMore()
    }

    func loadMore() {
        guard canLoadMore else { return }
        isLoadingMore = true
        page += 1
        let (q, f, p) = (query, filters, page)
        task = Task { [weak self] in
            await self?.fetch(keyword: q, filters: f, page: p)
            self?.isLoadingMore = false
        }
    }

    // MARK: Source chips

    func toggleVisibleSource(_ src: SourceID) {
        if visibleSources.contains(src) { visibleSources.remove(src) } else { visibleSources.insert(src) }
        Haptics.selection()
        withAnimation(.easeOut(duration: 0.2)) { rebuild() }
    }

    func showAllSources() {
        guard !visibleSources.isEmpty else { return }
        visibleSources = []
        Haptics.selection()
        withAnimation(.easeOut(duration: 0.2)) { rebuild() }
    }

    // MARK: Creators

    func toggleCreator(_ key: String) {
        if selectedCreators.contains(key) { selectedCreators.remove(key) } else { selectedCreators.insert(key) }
        Haptics.selection()
        withAnimation(.easeOut(duration: 0.2)) { rebuild() }
    }

    /// Shows only this creator (used from a result's long-press menu).
    func showOnly(creator name: String) {
        selectedCreators = [Self.creatorKey(name)]
        Haptics.selection()
        withAnimation(.easeOut(duration: 0.2)) { rebuild() }
    }

    func clearCreators() {
        guard !selectedCreators.isEmpty else { return }
        selectedCreators = []
        withAnimation(.easeOut(duration: 0.2)) { rebuild() }
    }

    func clear() {
        task?.cancel()
        selectedCreators = []
        visibleSources = []
        creators = []
        query = ""
        results = []
        rawBySource = [:]
        sourceStates = [:]
        isLoading = false
        isLoadingMore = false
    }

    // MARK: Internals

    private func start(keyword: String, filters: SearchFilters) {
        task?.cancel()
        query = keyword
        self.filters = filters
        page = 1
        rawBySource = [:]
        exhausted = []
        results = []
        errorMessage = nil
        selectedCreators = []
        visibleSources = []
        creators = []
        isLoading = true
        isLoadingMore = false
        sourceStates = Dictionary(uniqueKeysWithValues: filters.activeSources.map { ($0, SourceState.loading) })
        task = Task { [weak self] in
            await self?.fetch(keyword: keyword, filters: filters, page: 1)
            guard let self, !Task.isCancelled else { return }
            self.isLoading = false
            if self.results.isEmpty {
                let failures = self.failedSources.count
                if failures > 0 && failures == filters.activeSources.count {
                    self.errorMessage = "All sources failed. Check your connection or source settings."
                    Haptics.error()
                }
            } else {
                Haptics.light()
            }
        }
    }

    private func fetch(keyword: String, filters: SearchFilters, page: Int, only: [SourceID]? = nil) async {
        let sources = (only ?? filters.activeSources).filter { !exhausted.contains($0) }
        let request = SearchRequest(keyword: keyword, page: page, filters: filters)
        for s in sources where page > 1 { sourceStates[s] = .loading }

        await withTaskGroup(of: (SourceID, Result<[VideoResult], Error>).self) { group in
            for src in sources {
                guard let service = services[src] else { continue }
                group.addTask {
                    do {
                        // Hard cap so a stuck site never leaves its chip spinning forever.
                        let items = try await withTimeout(35, message: "Timed out — \(src.displayName) didn't answer in 35 s.") {
                            try await service.search(request)
                        }
                        return (src, .success(items))
                    } catch {
                        return (src, .failure(error))
                    }
                }
            }
            for await (src, result) in group {
                if Task.isCancelled { group.cancelAll(); return }
                switch result {
                case .success(let items):
                    let safe = items.filter(ContentSafety.isAllowed)
                    if items.isEmpty { exhausted.insert(src) }
                    rawBySource[src, default: []].append(contentsOf: safe)
                    sourceStates[src] = .done(count: rawBySource[src]?.count ?? 0)
                case .failure(let error):
                    if error is CancellationError && Task.isCancelled { continue }
                    exhausted.insert(src)
                    // Keep earlier pages' results visible; only report the error on the first page.
                    if page == 1 {
                        sourceStates[src] = .failed(SearchError.message(for: error))
                    } else {
                        sourceStates[src] = .done(count: rawBySource[src]?.count ?? 0)
                    }
                }
                withAnimation(.easeOut(duration: 0.25)) { rebuild() }
            }
        }
    }

    private func rebuild() {
        let order = SourceID.allCases
        var seenPages = Set<String>()
        let shown = visibleSources
        let active = Set(filters.activeSources)
        let filtered: [[VideoResult]] = order.map { src in
            guard active.contains(src), shown.isEmpty || shown.contains(src) else { return [] }
            return (rawBySource[src] ?? []).filter { filters.matches($0) && seenPages.insert($0.pageURL.absoluteString).inserted }
        }
        updateCreators(from: filtered.flatMap { $0 })
        let selected = selectedCreators
        let perSource: [[VideoResult]] = selected.isEmpty ? filtered : filtered.map { list in
            list.filter { r in r.creators.contains { selected.contains(Self.creatorKey($0)) } }
        }

        switch filters.sort {
        case .relevance:
            // Round-robin interleave keeps each source's own ranking while mixing sources,
            // then results that actually match the query (title, tags, creators) move up.
            var merged: [VideoResult] = []
            var i = 0
            while perSource.contains(where: { i < $0.count }) {
                for list in perSource where i < list.count { merged.append(list[i]) }
                i += 1
            }
            let scorer = RelevanceScorer(query: query)
            let scores = Dictionary(merged.map { ($0.id, scorer.score($0)) }, uniquingKeysWith: { a, _ in a })
            results = merged.stableSorted { (scores[$0.id] ?? 0) > (scores[$1.id] ?? 0) }
        case .mostViewed:
            results = perSource.flatMap { $0 }.stableSorted { ($0.viewCount ?? $0.likes ?? -1) > ($1.viewCount ?? $1.likes ?? -1) }
        case .newest:
            results = perSource.flatMap { $0 }.stableSorted { ($0.publishedAt ?? .distantPast) > ($1.publishedAt ?? .distantPast) }
        case .topRated:
            results = perSource.flatMap { $0 }.stableSorted { ($0.rating ?? -1) > ($1.rating ?? -1) }
        }
    }
}

extension SearchAggregator {
    fileprivate func updateCreators(from items: [VideoResult]) {
        var counts: [String: (name: String, count: Int, sources: Set<SourceID>, thumb: URL?)] = [:]
        for r in items {
            for name in Set(r.creators) {
                let key = Self.creatorKey(name)
                guard !key.isEmpty else { continue }
                var entry = counts[key] ?? (name, 0, [], r.thumbnail)
                entry.count += 1
                if let src = r.sourceID { entry.sources.insert(src) }
                counts[key] = entry
            }
        }
        creators = counts.map { key, v in
            CreatorInfo(key: key, name: v.name, count: v.count,
                        sources: SourceID.allCases.filter(v.sources.contains), thumbnail: v.thumb)
        }
        .sorted { $0.count != $1.count ? $0.count > $1.count : $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }
}

extension Array {
    func stableSorted(by areInIncreasingOrder: (Element, Element) -> Bool) -> [Element] {
        enumerated().sorted { a, b in
            if areInIncreasingOrder(a.element, b.element) { return true }
            if areInIncreasingOrder(b.element, a.element) { return false }
            return a.offset < b.offset
        }.map(\.element)
    }
}

/// How well a result matches the query: whole phrase in the title counts most, then each
/// query word found in title / tags / creators. Integer buckets keep the source mix stable.
struct RelevanceScorer {
    private let phrase: String
    private let words: [String]
    private static let stopwords: Set<String> = ["the", "a", "an", "and", "of", "with", "in", "on", "de", "la", "le", "les", "et", "du", "des"]

    init(query: String) {
        phrase = Self.normalize(query)
        words = phrase.split(separator: " ").map(String.init)
            .filter { $0.count > 1 && !Self.stopwords.contains($0) }
    }

    static func normalize(_ s: String) -> String {
        s.lowercased()
            .folding(options: .diacriticInsensitive, locale: .current)
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    func score(_ r: VideoResult) -> Int {
        guard !words.isEmpty else { return 0 }
        if r.sourceID == .rule34 {
            // Booru posts were fetched by exact tag, so every one matches: score them evenly
            // (by tags, not the truncated title) to keep the site's own ordering.
            let tags = " " + Self.normalize(r.tags.joined(separator: " ")) + " "
            var score = 0
            if words.count > 1, tags.contains(" \(phrase)") { score += 4 }
            for w in words where tags.contains(" \(w)") { score += 2 }
            return score
        }
        let title = " " + Self.normalize(r.title) + " "
        let meta = " " + Self.normalize((r.tags + r.creators).joined(separator: " ")) + " "
        var score = 0
        if words.count > 1, title.contains(" \(phrase) ") { score += 4 }
        else if words.count > 1, meta.contains(" \(phrase) ") { score += 2 }
        for w in words {
            // Whole word, or a simple plural/prefix form ("tit" ↔ "tits").
            if title.contains(" \(w) ") || title.contains(" \(w)s ") { score += 2 }
            else if meta.contains(" \(w) ") || meta.contains(" \(w)s ") { score += 1 }
            else if title.contains(w) { score += 1 }
        }
        return score
    }
}
