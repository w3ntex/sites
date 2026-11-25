import SwiftUI
import SwiftData

struct HistoryView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \HistoryEntry.openedAt, order: .reverse) private var entries: [HistoryEntry]
    @State private var confirmClear = false
    @State private var selected: VideoResult?

    private struct DayGroup: Identifiable {
        let day: Date
        let entries: [HistoryEntry]
        var id: Date { day }
    }

    private var groups: [DayGroup] {
        let cal = Calendar.current
        let grouped = Dictionary(grouping: entries) { cal.startOfDay(for: $0.openedAt) }
        return grouped.keys.sorted(by: >).map { DayGroup(day: $0, entries: grouped[$0] ?? []) }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(groups) { group in
                    Section {
                        ForEach(group.entries) { entry in
                            Button {
                                if let r = entry.asResult { Haptics.light(); selected = r }
                            } label: {
                                MediaRow(snapshot: entry, subtitle: subtitle(for: entry))
                            }
                        }
                        .onDelete { idx in
                            for i in idx { context.delete(group.entries[i]) }
                            try? context.save()
                            Haptics.light()
                        }
                    } header: {
                        Text(title(for: group.day))
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .overlay {
                if entries.isEmpty {
                    ContentUnavailableView("No history", systemImage: "clock",
                                           description: Text("Everything you open shows up here."))
                }
            }
            .navigationTitle("History")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !entries.isEmpty {
                    Button("Clear all", role: .destructive) { confirmClear = true }
                        .foregroundStyle(Theme.accent)
                }
            }
            .confirmationDialog("Clear all history?", isPresented: $confirmClear, titleVisibility: .visible) {
                Button("Clear \(entries.count) item\(entries.count == 1 ? "" : "s")", role: .destructive) {
                    Library.clearHistory(in: context)
                    Haptics.success()
                }
            } message: {
                Text("This can't be undone.")
            }
            .fullScreenCover(item: $selected) { MediaViewer(result: $0) }
        }
    }

    private func title(for day: Date) -> String {
        let cal = Calendar.current
        if cal.isDateInToday(day) { return "Today" }
        if cal.isDateInYesterday(day) { return "Yesterday" }
        return day.formatted(.dateTime.weekday(.wide).month().day().year())
    }

    private func subtitle(for e: HistoryEntry) -> String {
        var parts = [e.sourceID?.displayName ?? e.source, e.openedAt.formatted(date: .omitted, time: .shortened)]
        if e.watchDuration >= 1 { parts.append("watched \(Format.duration(e.watchDuration))") }
        return parts.joined(separator: " · ")
    }
}
