import Foundation
import Capacitor
import MapKit

/**
 * MapKit-backed place autocomplete for iOS.
 *
 * Uses `MKLocalSearchCompleter` for suggestions and `MKLocalSearch` to resolve
 * a selected completion into a label and coordinates.
 */
@objc(PlaceSearchPlugin)
public class PlaceSearchPlugin: CAPPlugin, CAPBridgedPlugin, MKLocalSearchCompleterDelegate {
    public let identifier = "PlaceSearchPlugin"
    public let jsName = "PlaceSearch"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "autocomplete", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resolve", returnType: CAPPluginReturnPromise)
    ]

    private let completer = MKLocalSearchCompleter()
    private var pendingAutocomplete: CAPPluginCall?
    private var completions: [MKLocalSearchCompletion] = []

    public override func load() {
        completer.delegate = self
        completer.resultTypes = [.address, .pointOfInterest]
    }

    @objc func autocomplete(_ call: CAPPluginCall) {
        guard let query = call.getString("query")?.trimmingCharacters(in: .whitespacesAndNewlines),
              !query.isEmpty else {
            call.resolve(["suggestions": []])
            return
        }

        pendingAutocomplete?.resolve(["suggestions": []])
        pendingAutocomplete = call
        completer.queryFragment = query
    }

    @objc func resolve(_ call: CAPPluginCall) {
        guard let id = call.getString("id"),
              let index = Int(id),
              index >= 0,
              index < completions.count else {
            call.reject("unknown_suggestion")
            return
        }

        let completion = completions[index]
        let request = MKLocalSearch.Request(completion: completion)
        let search = MKLocalSearch(request: request)
        search.start { [weak self] response, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }
            guard let item = response?.mapItems.first else {
                call.reject("place_not_found")
                return
            }

            let placemark = item.placemark
            let coordinate = placemark.coordinate
            let label = self?.displayLabel(for: item) ?? completion.title
            call.resolve([
                "label": label,
                "latitude": coordinate.latitude,
                "longitude": coordinate.longitude
            ])
        }
    }

    public func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
        completions = completer.results
        let suggestions: [[String: String]] = completions.enumerated().map { index, item in
            var row: [String: String] = [
                "id": String(index),
                "primaryText": item.title
            ]
            if !item.subtitle.isEmpty {
                row["secondaryText"] = item.subtitle
            }
            return row
        }
        pendingAutocomplete?.resolve(["suggestions": suggestions])
        pendingAutocomplete = nil
    }

    public func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
        pendingAutocomplete?.reject(error.localizedDescription)
        pendingAutocomplete = nil
    }

    /**
     * Builds a human-readable label from a map item.
     *
     * @param item - The MapKit map item from a local search.
     * @returns A name and address joined when both are present.
     */
    private func displayLabel(for item: MKMapItem) -> String {
        let name = item.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let address = [
            item.placemark.thoroughfare,
            item.placemark.locality,
            item.placemark.administrativeArea,
            item.placemark.postalCode
        ]
            .compactMap { $0 }
            .joined(separator: ", ")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        if !name.isEmpty && !address.isEmpty {
            // Addresses often already include the place name — keep the address.
            if address.contains(name) {
                return address
            }
            return "\(name), \(address)"
        }
        if !address.isEmpty {
            return address
        }
        if !name.isEmpty {
            return name
        }
        return "Selected place"
    }
}
