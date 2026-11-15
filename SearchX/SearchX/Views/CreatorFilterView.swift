import SwiftUI

/// Row under the source chips: opens the creator picker and shows the active creator filters.
struct CreatorBar: View {
    @EnvironmentObject private var aggregator: SearchAggregator
    @State private var showPicker = false

    var body: some View {
        if !aggregator.creators.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    Button {
                        Haptics.light()
                        showPicker = true
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "person.2.fill")
                            Text(aggregator.selectedCreators.isEmpty
                                 ? "Creators (\(aggregator.creators.count))"
                                 : "Creators · \(aggregator.selectedCreators.count)")
                            Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
                        }
                        .font(.footnote.weight(.semibold))
                        .padding(.horizontal, 11).padding(.vertical, 7)
                        .background(aggregator.selectedCreators.isEmpty ? Theme.surface : Theme.accent.opacity(0.22), in: Capsule())
                        .overlay(Capsule().stroke(aggregator.selectedCreators.isEmpty ? .clear : Theme.accent, lineWidth: 1))
                        .foregroundStyle(aggregator.selectedCreators.isEmpty ? .white : Theme.accent)
                    }

                    if aggregator.selectedCreators.isEmpty {
                        // Quick picks: the most frequent creators.
                        ForEach(aggregator.creators.prefix(8)) { c in
                            Button { aggregator.toggleCreator(c.key) } label: {
                                Text("\(c.name) \(c.count)")
                                    .font(.caption.weight(.medium))
                                    .padding(.horizontal, 10).padding(.vertical, 6)
                                    .background(Theme.surface, in: Capsule())
                                    .foregroundStyle(.white)
                            }
                        }
                    } else {
                        ForEach(selectedInfos) { c in
                            Button { aggregator.toggleCreator(c.key) } label: {
                                HStack(spacing: 4) {
                                    Text(c.name)
                                    Image(systemName: "xmark").font(.system(size: 9, weight: .bold))
                                }
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .background(Theme.accent, in: Capsule())
                                .foregroundStyle(.white)
                            }
                        }
                        Button("Clear") { aggregator.clearCreators() }
                            .font(.caption.weight(.semibold))
                    }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 6)
            }
            .sheet(isPresented: $showPicker) {
                CreatorPickerSheet().presentationDetents([.medium, .large])
            }
        }
    }

    private var selectedInfos: [SearchAggregator.CreatorInfo] {
        let infos = aggregator.creators.filter { aggregator.selectedCreators.contains($0.key) }
        // Keep chips for selected creators even if a filter change hid all their results.
        let missing = aggregator.selectedCreators.subtracting(infos.map(\.key))
        return infos + missing.sorted().map { SearchAggregator.CreatorInfo(key: $0, name: $0, count: 0, sources: [], thumbnail: nil) }
    }
}

struct CreatorPickerSheet: View {
    @EnvironmentObject private var aggregator: SearchAggregator
    @EnvironmentObject private var filterStore: FilterStore
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    private var filtered: [SearchAggregator.CreatorInfo] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return aggregator.creators }
        return aggregator.creators.filter { $0.key.contains(q) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(filtered) { c in
                        let selected = aggregator.selectedCreators.contains(c.key)
                        Button { aggregator.toggleCreator(c.key) } label: {
                            HStack(spacing: 12) {
                                ThumbnailView(url: c.thumbnail)
                                    .frame(width: 40, height: 40)
                                    .clipShape(Circle())
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(c.name).foregroundStyle(.white).lineLimit(1)
                                    HStack(spacing: 4) {
                                        ForEach(c.sources) { SourceBadge(source: $0, compact: true) }
                                        Text("\(c.count) result\(c.count == 1 ? "" : "s")")
                                            .font(.caption)
                                            .foregroundStyle(Theme.secondaryText)
                                    }
                                }
                                Spacer()
                                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                                    .font(.title3)
                                    .foregroundStyle(selected ? Theme.accent : Theme.secondaryText)
                            }
                        }
                        .swipeActions(edge: .trailing) {
                            Button {
                                dismiss()
                                aggregator.search(c.name.trimmingCharacters(in: CharacterSet(charactersIn: "@")),
                                                  filters: filterStore.current)
                            } label: { Label("Search", systemImage: "magnifyingglass") }
                            .tint(Theme.accent)
                        }
                    }
                } footer: {
                    Text("Tap to filter results by creator (pick several to combine). Swipe left on a creator to run a new search for them.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Find a creator")
            .overlay {
                if filtered.isEmpty {
                    ContentUnavailableView.search(text: search)
                }
            }
            .navigationTitle("Creators")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if !aggregator.selectedCreators.isEmpty {
                        Button("Clear") { aggregator.clearCreators() }
                    }
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}
