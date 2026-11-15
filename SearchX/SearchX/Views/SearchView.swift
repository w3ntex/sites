import SwiftUI

struct SearchView: View {
    @EnvironmentObject private var aggregator: SearchAggregator
    @EnvironmentObject private var filterStore: FilterStore
    @State private var text = ""
    @State private var viewer: ViewerRequest?
    @State private var toast: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                FilterBar(filters: $filterStore.current, onReset: filterStore.resetToDefaults)
                Divider().overlay(Theme.surfaceHigh)
                content
            }
            .background(Theme.background)
            .navigationTitle("SearchX")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $text, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search all sources")
            .searchSuggestions {
                ForEach(SuggestionProvider.suggestions(for: text), id: \.self) { s in
                    Label(s.text, systemImage: s.isRecent ? "clock.arrow.circlepath" : "magnifyingglass")
                        .searchCompletion(s.text)
                }
            }
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .onSubmit(of: .search, submit)
            .onChange(of: filterStore.current) { _, new in aggregator.filtersChanged(new) }
            .onAppear { aggregator.filtersChanged(filterStore.current) }
            .fullScreenCover(item: $viewer) { ViewerHost(request: $0) }
            .alert("Search", isPresented: Binding(get: { aggregator.errorMessage != nil },
                                                  set: { if !$0 { aggregator.errorMessage = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(aggregator.errorMessage ?? "")
            }
            .toast($toast)
        }
    }

    private func submit() {
        Haptics.medium()
        aggregator.search(text, filters: filterStore.current)
    }

    @ViewBuilder
    private var content: some View {
        if !aggregator.hasQuery {
            EmptySearchView { term in
                text = term
                submit()
            }
        } else if aggregator.results.isEmpty && aggregator.isLoading {
            ScrollView {
                SourceStatusBar()
                SkeletonGrid()
            }
            .scrollDisabled(true)
        } else if aggregator.results.isEmpty {
            ScrollView {
                SourceStatusBar()
                ContentUnavailableView {
                    Label("No results", systemImage: "magnifyingglass")
                } description: {
                    Text(filterStore.current.isDefault
                         ? "Nothing found for “\(aggregator.query)”. Try another keyword."
                         : "Nothing matched your filters. Try loosening them.")
                } actions: {
                    if !filterStore.current.isDefault {
                        Button("Reset filters") { filterStore.resetToDefaults() }
                    }
                }
                .padding(.top, 40)
            }
            .refreshable { await aggregator.refresh() }
        } else {
            ResultsGridView(
                results: aggregator.results,
                header: AnyView(VStack(spacing: 0) { SourceStatusBar(); CreatorBar() }),
                footer: AnyView(loadMoreFooter),
                onSelect: { viewer = .make($0, in: aggregator.results) },
                onAppearItem: { aggregator.loadMoreIfNeeded(current: $0) },
                onToast: { toast = $0 },
                onCreator: { aggregator.showOnly(creator: $0) })
            .refreshable { await aggregator.refresh() }
        }
    }

    @ViewBuilder
    private var loadMoreFooter: some View {
        if aggregator.isLoadingMore {
            ProgressView().tint(Theme.accent).padding(24)
        } else if aggregator.canLoadMore {
            Button("Load more") { aggregator.loadMore() }
                .font(.subheadline.weight(.semibold))
                .padding(24)
        } else {
            Text("End of results").font(.footnote).foregroundStyle(Theme.secondaryText).padding(24)
        }
    }
}

// MARK: - Empty state

struct EmptySearchView: View {
    var onPick: (String) -> Void
    @State private var recent = SuggestionProvider.recent

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("One search, every source.")
                        .font(.title2.bold())
                    Text("SearchX queries \(SourceID.allCases.map(\.displayName).joined(separator: ", ")) at once.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.secondaryText)
                }
                if !recent.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text("Recent").font(.headline)
                            Spacer()
                            Button("Clear") {
                                SuggestionProvider.clearRecent()
                                recent = []
                            }
                            .font(.subheadline)
                        }
                        ChipFlow(items: Array(recent.prefix(15)), onPick: onPick)
                    }
                }
                VStack(alignment: .leading, spacing: 10) {
                    Text("Popular").font(.headline)
                    ChipFlow(items: SuggestionProvider.popular, onPick: onPick)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { recent = SuggestionProvider.recent }
    }
}

struct ChipFlow: View {
    let items: [String]
    var onPick: (String) -> Void

    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(items, id: \.self) { item in
                Button { onPick(item) } label: {
                    Text(item)
                        .font(.subheadline)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(Theme.surfaceHigh, in: Capsule())
                        .foregroundStyle(.white)
                }
            }
        }
    }
}

/// Simple wrapping layout for chips.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > width, x > 0 { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            x += s.width + spacing
            maxX = max(maxX, x)
            rowHeight = max(rowHeight, s.height)
        }
        return CGSize(width: proposal.width ?? maxX, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += rowHeight + spacing; rowHeight = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            rowHeight = max(rowHeight, s.height)
        }
    }
}

// MARK: - Per-source status

struct SourceStatusBar: View {
    @EnvironmentObject private var aggregator: SearchAggregator
    @State private var detail: (SourceID, String)?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                if !aggregator.visibleSources.isEmpty {
                    Button {
                        aggregator.showAllSources()
                    } label: {
                        Label("All", systemImage: "xmark")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 9).padding(.vertical, 5)
                            .background(Theme.surfaceHigh, in: Capsule())
                            .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)
                }
                ForEach(SourceID.allCases.filter { aggregator.sourceStates[$0] != nil }) { src in
                    chip(src, aggregator.sourceStates[src]!)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .alert(detail.map { "\($0.0.displayName) failed" } ?? "",
               isPresented: Binding(get: { detail != nil }, set: { if !$0 { detail = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(detail?.1 ?? "")
        }
    }

    @ViewBuilder
    private func chip(_ src: SourceID, _ state: SearchAggregator.SourceState) -> some View {
        let selected = aggregator.visibleSources.contains(src)
        Button {
            // Failed sources explain why; others toggle "show only these sources".
            if case .failed(let m) = state { detail = (src, m); Haptics.light() }
            else { aggregator.toggleVisibleSource(src) }
        } label: {
            HStack(spacing: 4) {
                Circle().fill(src.color).frame(width: 6, height: 6)
                Text(src.displayName)
                switch state {
                case .loading:
                    ProgressView().controlSize(.mini).tint(.white)
                case .done(let count):
                    Text("\(count)").foregroundStyle(Theme.secondaryText)
                case .failed:
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.yellow)
                }
            }
            .font(.caption.weight(.medium))
            .padding(.horizontal, 9).padding(.vertical, 5)
            .background(selected ? src.color.opacity(0.3) : Theme.surface, in: Capsule())
            .overlay(Capsule().stroke(selected ? src.color : .clear, lineWidth: 1.5))
            .foregroundStyle(.white)
            .opacity(aggregator.visibleSources.isEmpty || selected ? 1 : 0.5)
        }
        .buttonStyle(.plain)
    }
}
