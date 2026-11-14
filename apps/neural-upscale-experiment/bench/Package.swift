// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "bench",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "bench",
            path: "Sources/bench",
            linkerSettings: [.linkedFramework("CoreML"), .linkedFramework("Metal"), .linkedFramework("MetalFX"), .linkedFramework("MetalKit")]
        )
    ]
)
