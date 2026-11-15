import Foundation
import SwiftData

/// Background URLSession downloads into the app's private Documents/Downloads folder.
final class DownloadManager: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    static let shared = DownloadManager()
    static let sessionIdentifier = "com.searchx.app.downloads"

    /// Set by the app delegate when iOS relaunches us to finish background transfers.
    var backgroundCompletionHandler: (() -> Void)?

    private var lastProgressUpdate: [String: Date] = [:]
    private let lock = NSLock()

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.allowsCellularAccess = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    static var downloadsDirectory: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        var dir = docs.appendingPathComponent("Downloads", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true      // keep private media out of iCloud backups
            try? dir.setResourceValues(values)
        }
        return dir
    }

    /// Re-attaches to the background session so in-flight downloads keep reporting after relaunch.
    func activate() { _ = session }

    // MARK: Public API

    @MainActor
    @discardableResult
    func start(remoteURL: URL, result: VideoResult, referer: URL?, cookies: [HTTPCookie] = []) -> Bool {
        let context = Persistence.context
        let remote = remoteURL.absoluteString
        let existing = (try? context.fetch(FetchDescriptor<DownloadItem>(predicate: #Predicate { $0.remoteURL == remote }))) ?? []
        if existing.contains(where: { $0.status == .downloading || $0.status == .queued || $0.status == .completed }) {
            return false
        }

        let item = DownloadItem(result: result, remoteURL: remoteURL)
        context.insert(item)
        try? context.save()

        var request = URLRequest(url: remoteURL)
        request.setValue(HTTPClient.mobileUA, forHTTPHeaderField: "User-Agent")
        if let referer {
            request.setValue(referer.absoluteString, forHTTPHeaderField: "Referer")
            if let scheme = referer.scheme, let host = referer.host {
                request.setValue("\(scheme)://\(host)", forHTTPHeaderField: "Origin")
            }
        }
        let relevant = cookies.filter { c in
            guard let host = remoteURL.host else { return false }
            let domain = c.domain.hasPrefix(".") ? String(c.domain.dropFirst()) : c.domain
            return host == domain || host.hasSuffix("." + domain)
        }
        for (k, v) in HTTPCookie.requestHeaderFields(with: relevant) { request.setValue(v, forHTTPHeaderField: k) }

        let task = session.downloadTask(with: request)
        task.taskDescription = item.id.uuidString
        task.resume()
        item.status = .downloading
        try? context.save()
        return true
    }

    @MainActor
    func retry(_ item: DownloadItem) {
        guard let url = URL(string: item.remoteURL), let result = snapshot(of: item) else { return }
        let referer = URL(string: item.pageURL)
        let context = Persistence.context
        context.delete(item)
        try? context.save()
        start(remoteURL: url, result: result, referer: referer)
    }

    @MainActor
    func delete(_ item: DownloadItem) {
        let id = item.id.uuidString
        session.getAllTasks { tasks in tasks.filter { $0.taskDescription == id }.forEach { $0.cancel() } }
        if let url = item.localURL { try? FileManager.default.removeItem(at: url) }
        Persistence.context.delete(item)
        try? Persistence.context.save()
    }

    @MainActor
    func deleteAll() {
        session.getAllTasks { tasks in tasks.forEach { $0.cancel() } }
        try? FileManager.default.removeItem(at: Self.downloadsDirectory)
        try? Persistence.context.delete(model: DownloadItem.self)
        try? Persistence.context.save()
    }

    @MainActor
    private func snapshot(of item: DownloadItem) -> VideoResult? {
        guard let page = URL(string: item.pageURL), let thumb = URL(string: item.thumbnailURL) else { return nil }
        return VideoResult(source: SourceID(rawValue: item.source) ?? .pornhub, rawID: item.id.uuidString,
                           title: item.title, duration: nil, thumbnail: thumb, viewCount: nil, rating: nil,
                           pageURL: page, mediaType: MediaType(rawValue: item.mediaTypeRaw) ?? .video)
    }

    // MARK: Persistence updates

    private func update(_ idString: String?, _ change: @escaping @MainActor (DownloadItem) -> Void) {
        guard let idString, let id = UUID(uuidString: idString) else { return }
        Task { @MainActor in
            let context = Persistence.context
            guard let item = try? context.fetch(FetchDescriptor<DownloadItem>(predicate: #Predicate { $0.id == id })).first else { return }
            change(item)
            try? context.save()
        }
    }

    // MARK: URLSessionDownloadDelegate

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        let key = downloadTask.taskDescription ?? ""
        let now = Date()
        lock.lock()
        let last = lastProgressUpdate[key] ?? .distantPast
        let shouldUpdate = now.timeIntervalSince(last) > 0.4
        if shouldUpdate { lastProgressUpdate[key] = now }
        lock.unlock()
        guard shouldUpdate else { return }
        let progress = totalBytesExpectedToWrite > 0 ? Double(totalBytesWritten) / Double(totalBytesExpectedToWrite) : 0
        update(downloadTask.taskDescription) { item in
            item.status = .downloading
            item.progress = progress
            item.totalBytes = max(totalBytesExpectedToWrite, totalBytesWritten)
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let http = downloadTask.response as? HTTPURLResponse
        let status = http?.statusCode ?? 200
        let mime = http?.mimeType?.lowercased() ?? ""
        guard (200..<300).contains(status), !mime.hasPrefix("text/") else {
            let message = (200..<300).contains(status) ? "Link expired or not a media file." : "Server returned \(status)."
            update(downloadTask.taskDescription) { $0.status = .failed; $0.errorMessage = message }
            return
        }

        // The temp file is deleted when this method returns, so move it synchronously.
        var ext = downloadTask.originalRequest?.url?.pathExtension.lowercased() ?? ""
        if ext.isEmpty || ext.count > 4 {
            if mime.contains("mp4") { ext = "mp4" }
            else if mime.contains("quicktime") { ext = "mov" }
            else if mime.contains("jpeg") { ext = "jpg" }
            else if mime.contains("png") { ext = "png" }
            else if mime.contains("gif") { ext = "gif" }
            else if mime.contains("webp") { ext = "webp" }
            else { ext = "mp4" }
        }
        let filename = "\(downloadTask.taskDescription ?? UUID().uuidString).\(ext)"
        let destination = Self.downloadsDirectory.appendingPathComponent(filename)
        do {
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: location, to: destination)
            let attrs = try? FileManager.default.attributesOfItem(atPath: destination.path)
            let size = (attrs?[.size] as? NSNumber)?.int64Value ?? 0
            update(downloadTask.taskDescription) { item in
                item.localFilename = filename
                item.status = .completed
                item.progress = 1
                if size > 0 { item.totalBytes = size }
            }
        } catch {
            let message = error.localizedDescription
            update(downloadTask.taskDescription) { $0.status = .failed; $0.errorMessage = message }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        if (error as? URLError)?.code == .cancelled { return }
        let message = SearchError.message(for: error)
        update(task.taskDescription) { item in
            if item.status != .completed { item.status = .failed; item.errorMessage = message }
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async { [weak self] in
            self?.backgroundCompletionHandler?()
            self?.backgroundCompletionHandler = nil
        }
    }
}
