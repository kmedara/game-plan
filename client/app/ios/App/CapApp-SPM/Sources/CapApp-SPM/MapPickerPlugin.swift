import Foundation
import UIKit
import MapKit
import Capacitor

/**
 * MapKit location picker presented as a modal for iOS.
 *
 * Autocomplete and reverse geocode stay on the product API; this plugin only
 * returns coordinates from an interactive MapKit map.
 */
@objc(MapPickerPlugin)
public class MapPickerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MapPickerPlugin"
    public let jsName = "MapPicker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickOnMap", returnType: CAPPluginReturnPromise)
    ]

    /**
     * Presents a MapKit map so the user can tap or drag a pin.
     *
     * @param call - Optional {@code latitude}/{@code longitude} to seed the pin.
     */
    @objc func pickOnMap(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let bridge = self.bridge,
                  let presenter = bridge.viewController else {
                call.reject("map_picker_unavailable")
                return
            }

            let latitude = call.getDouble("latitude")
            let longitude = call.getDouble("longitude")
            let seed: CLLocationCoordinate2D? = {
                guard let latitude, let longitude else { return nil }
                return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
            }()

            let picker = MapPickerViewController(seed: seed) { result in
                switch result {
                case .cancelled:
                    call.reject("cancelled")
                case .picked(let coordinate):
                    call.resolve([
                        "latitude": coordinate.latitude,
                        "longitude": coordinate.longitude
                    ])
                }
            }
            let nav = UINavigationController(rootViewController: picker)
            nav.modalPresentationStyle = .pageSheet
            presenter.present(nav, animated: true)
        }
    }
}

private enum MapPickerResult {
    case cancelled
    case picked(CLLocationCoordinate2D)
}

/**
 * Full-screen MapKit map with a draggable pin and Done / Cancel actions.
 */
private final class MapPickerViewController: UIViewController, MKMapViewDelegate {
    private let mapView = MKMapView()
    private var pin: MKPointAnnotation?
    private let onFinish: (MapPickerResult) -> Void
    private let seed: CLLocationCoordinate2D?

    init(seed: CLLocationCoordinate2D?, onFinish: @escaping (MapPickerResult) -> Void) {
        self.seed = seed
        self.onFinish = onFinish
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Set location"
        view.backgroundColor = .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .cancel,
            target: self,
            action: #selector(cancelTapped)
        )
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .done,
            target: self,
            action: #selector(doneTapped)
        )

        mapView.translatesAutoresizingMaskIntoConstraints = false
        mapView.delegate = self
        view.addSubview(mapView)
        NSLayoutConstraint.activate([
            mapView.topAnchor.constraint(equalTo: view.topAnchor),
            mapView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            mapView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            mapView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        let tap = UITapGestureRecognizer(target: self, action: #selector(mapTapped(_:)))
        mapView.addGestureRecognizer(tap)

        let center = seed ?? CLLocationCoordinate2D(latitude: 39.8283, longitude: -98.5795)
        let zoom = seed == nil ? MKCoordinateSpan(latitudeDelta: 30, longitudeDelta: 30)
            : MKCoordinateSpan(latitudeDelta: 0.05, longitudeDelta: 0.05)
        mapView.setRegion(MKCoordinateRegion(center: center, span: zoom), animated: false)
        if seed != nil {
            placePin(at: center)
        }
    }

    func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
        if annotation is MKUserLocation {
            return nil
        }
        let reuseId = "location-pin"
        let view = mapView.dequeueReusableAnnotationView(withIdentifier: reuseId) as? MKMarkerAnnotationView
            ?? MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: reuseId)
        view.annotation = annotation
        view.isDraggable = true
        view.canShowCallout = false
        return view
    }

    @objc private func mapTapped(_ gesture: UITapGestureRecognizer) {
        let point = gesture.location(in: mapView)
        let coordinate = mapView.convert(point, toCoordinateFrom: mapView)
        placePin(at: coordinate)
    }

    @objc private func cancelTapped() {
        dismiss(animated: true) {
            self.onFinish(.cancelled)
        }
    }

    @objc private func doneTapped() {
        guard let coordinate = pin?.coordinate else {
            dismiss(animated: true) {
                self.onFinish(.cancelled)
            }
            return
        }
        dismiss(animated: true) {
            self.onFinish(.picked(coordinate))
        }
    }

    private func placePin(at coordinate: CLLocationCoordinate2D) {
        if let pin {
            pin.coordinate = coordinate
        } else {
            let annotation = MKPointAnnotation()
            annotation.coordinate = coordinate
            mapView.addAnnotation(annotation)
            pin = annotation
        }
        mapView.setCenter(coordinate, animated: true)
    }
}
