import SwiftUI

/// Persistent filter bar shown under the search field. Also reused for "Default filters" in Settings.
struct FilterBar: View {
    @Binding var filters: SearchFilters
    var onReset: (() -> Void)?
    @State private var showSources = false

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                menuChip(icon: "square.stack", title: filters.media.title, active: filters.media != .all) {
                    Picker("Media type", selection: $filters.media) {
                        ForEach(SearchFilters.MediaFilter.allCases) { Text($0.title).tag($0) }
                    }
                }
                menuChip(icon: "timer", title: filters.durationApplies ? filters.duration.title : "Any length",
                         active: filters.duration != .any && filters.durationApplies) {
                    Picker("Duration", selection: $filters.duration) {
                        ForEach(SearchFilters.DurationFilter.allCases) { Text($0.title).tag($0) }
                    }
                }
                .disabled(!filters.durationApplies)
                .opacity(filters.durationApplies ? 1 : 0.4)

                menuChip(icon: "sparkles.tv", title: filters.quality.title, active: filters.quality != .any) {
                    Picker("Quality", selection: $filters.quality) {
                        ForEach(SearchFilters.QualityFilter.allCases) { Text($0.title).tag($0) }
                    }
                }
                menuChip(icon: "arrow.up.arrow.down", title: filters.sort.title, active: filters.sort != .relevance) {
                    Picker("Sort", selection: $filters.sort) {
                        ForEach(SearchFilters.SortOrder.allCases) { Text($0.title).tag($0) }
                    }
                }
                Button {
                    Haptics.selection()
                    showSources = true
                } label: {
                    chipLabel(icon: "checklist",
                              title: "Sources \(filters.enabledSources.count)/\(SourceID.allCases.count)",
                              active: filters.enabledSources.count != SourceID.allCases.count)
                }
                if let onReset, !filters.isDefault {
                    Button {
                        Haptics.light()
                        onReset()
                    } label: {
                        Image(systemName: "arrow.counterclockwise")
                            .font(.caption.weight(.bold))
                            .padding(8)
                            .background(Theme.surface, in: Circle())
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(Theme.background)
        .onChange(of: filters) { _, _ in Haptics.selection() }
        .sheet(isPresented: $showSources) {
            SourcesPicker(enabled: $filters.enabledSources)
                .presentationDetents([.medium, .large])
        }
    }

    private func menuChip<Content: View>(icon: String, title: String, active: Bool,
                                         @ViewBuilder content: () -> Content) -> some View {
        Menu {
            content()
        } label: {
            chipLabel(icon: icon, title: title, active: active)
        }
    }

    private func chipLabel(icon: String, title: String, active: Bool) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon)
            Text(title)
            Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
        }
        .font(.footnote.weight(.semibold))
        .padding(.horizontal, 11).padding(.vertical, 7)
        .background(active ? Theme.accent.opacity(0.22) : Theme.surface, in: Capsule())
        .overlay(Capsule().stroke(active ? Theme.accent : Color.clear, lineWidth: 1))
        .foregroundStyle(active ? Theme.accent : .white)
    }
}

struct SourcesPicker: View {
    @Binding var enabled: Set<SourceID>
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(SourceID.allCases) { src in
                        Button {
                            Haptics.selection()
                            if enabled.contains(src) { enabled.remove(src) } else { enabled.insert(src) }
                        } label: {
                            HStack {
                                SourceBadge(source: src)
                                Text(src.displayName).foregroundStyle(.white)
                                Spacer()
                                Image(systemName: enabled.contains(src) ? "checkmark.square.fill" : "square")
                                    .foregroundStyle(enabled.contains(src) ? Theme.accent : Theme.secondaryText)
                                    .font(.title3)
                            }
                        }
                    }
                } footer: {
                    Text("Configure credentials and instances in Settings → Sources.")
                }
                Section {
                    Button("Enable all") { enabled = Set(SourceID.allCases) }
                    Button("Disable all", role: .destructive) { enabled = [] }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Sources")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

struct SourceBadge: View {
    let source: SourceID
    var compact = false

    var body: some View {
        Text(source.badge)
            .font(.system(size: compact ? 9 : 11, weight: .heavy, design: .rounded))
            .foregroundStyle(.black)
            .padding(.horizontal, compact ? 5 : 6)
            .padding(.vertical, compact ? 2 : 3)
            .background(source.color, in: RoundedRectangle(cornerRadius: 4))
    }
}
