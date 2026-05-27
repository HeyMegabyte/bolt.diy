//
//  ProjectSitesWidget.swift
//  ProjectSites
//
//  iOS Home-Screen widget + Live Activity for ProjectSites.
//
//  Data flow:
//    The app writes to `UserDefaults(suiteName: "group.space.megabyte.projectsites")`
//    on every relevant event (booking-created, earnings-tick,
//    job-status-change). The widget timeline provider reads from the
//    same App Group container so updates show without re-launching.
//
//  Live Activity:
//    `JobActivityAttributes` + `JobActivityContentState` back the
//    `@capacitor-community/live-activity` plugin invoked from
//    `LiveActivityService` in `@org/util-platform`.
//

import WidgetKit
import SwiftUI
import ActivityKit

// MARK: - App Group keys

private enum AppGroup {
    static let suite = "group.space.megabyte.projectsites"
    static let earningsToday = "earningsTodayCents"
    static let nextBookingTitle = "nextBookingTitle"
    static let nextBookingTime = "nextBookingTime"
    static let role = "role" // "crew" | "customer"
}

// MARK: - Entry

struct EarningsEntry: TimelineEntry {
    let date: Date
    let role: String
    let earningsCents: Int
    let nextBookingTitle: String
    let nextBookingTime: String
}

// MARK: - Provider

struct EarningsProvider: TimelineProvider {
    func placeholder(in context: Context) -> EarningsEntry {
        EarningsEntry(
            date: Date(),
            role: "crew",
            earningsCents: 0,
            nextBookingTitle: "—",
            nextBookingTime: "—"
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (EarningsEntry) -> Void) {
        completion(loadEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<EarningsEntry>) -> Void) {
        let entry = loadEntry()
        // Refresh every 15 minutes; app pushes via `WidgetCenter.shared.reloadAllTimelines()` on writes.
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private func loadEntry() -> EarningsEntry {
        let defaults = UserDefaults(suiteName: AppGroup.suite)
        return EarningsEntry(
            date: Date(),
            role: defaults?.string(forKey: AppGroup.role) ?? "customer",
            earningsCents: defaults?.integer(forKey: AppGroup.earningsToday) ?? 0,
            nextBookingTitle: defaults?.string(forKey: AppGroup.nextBookingTitle) ?? "No upcoming bookings",
            nextBookingTime: defaults?.string(forKey: AppGroup.nextBookingTime) ?? ""
        )
    }
}

// MARK: - View

struct ProjectSitesWidgetView: View {
    let entry: EarningsEntry

    var body: some View {
        ZStack {
            Color(red: 6 / 255, green: 6 / 255, blue: 16 / 255) // brand bg #060610
            VStack(alignment: .leading, spacing: 6) {
                if entry.role == "crew" {
                    Text("Today")
                        .font(.caption2.monospaced())
                        .foregroundColor(.gray)
                    Text(formatUSD(cents: entry.earningsCents))
                        .font(.title2.bold())
                        .foregroundColor(Color(red: 0, green: 0.9, blue: 1)) // brand accent
                    Spacer()
                    Text("Earnings")
                        .font(.caption2)
                        .foregroundColor(.white.opacity(0.7))
                } else {
                    Text("Next booking")
                        .font(.caption2.monospaced())
                        .foregroundColor(.gray)
                    Text(entry.nextBookingTitle)
                        .font(.headline)
                        .foregroundColor(.white)
                        .lineLimit(2)
                    Spacer()
                    Text(entry.nextBookingTime)
                        .font(.caption2)
                        .foregroundColor(Color(red: 0, green: 0.9, blue: 1))
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private func formatUSD(cents: Int) -> String {
        let dollars = Double(cents) / 100.0
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "USD"
        f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: dollars)) ?? "$0.00"
    }
}

// MARK: - Widget

@main
struct ProjectSitesWidget: Widget {
    let kind: String = "ProjectSitesWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: EarningsProvider()) { entry in
            ProjectSitesWidgetView(entry: entry)
        }
        .configurationDisplayName("ProjectSites")
        .description("Today's earnings (crew) or next booking (customer).")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: - Live Activity

public struct JobActivityAttributes: ActivityAttributes {
    public typealias ContentState = JobActivityContentState

    public struct JobActivityContentState: Codable, Hashable {
        public var eta: Int
        public var statusText: String
        public var lat: Double?
        public var lng: Double?

        public init(eta: Int, statusText: String, lat: Double? = nil, lng: Double? = nil) {
            self.eta = eta
            self.statusText = statusText
            self.lat = lat
            self.lng = lng
        }
    }

    public var jobId: String

    public init(jobId: String) {
        self.jobId = jobId
    }
}
