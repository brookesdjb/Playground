// Neural Engine vs GPU upscaler benchmark (macOS 13+, Apple Silicon).
//
//   swift run -c release bench latency ../models/*.mlpackage          per-model latency on the ANE and on the GPU
//   swift run -c release bench contention ../models/small.mlpackage   GPU time a model costs while the GPU is busy
//   swift run -c release bench metalfx                                MetalFX temporal + spatial upscale cost (GPU)
//   swift run -c release bench metalfx-images <lowdir> <outdir>       MetalFX spatial 2x upscale of PNGs (for quality)
//
// Options: --iters N (latency, default 500), --seconds S (contention phases, default 8), --load-ms MS (GPU load per
// frame, default 10), --unpaced (run inference back to back instead of once per 16.7 ms frame).
import CoreGraphics
import CoreML
import Foundation
import ImageIO
import Metal
import MetalFX
import MetalKit

// ---------------------------------------------------------------- small helpers
func now() -> Double { Double(DispatchTime.now().uptimeNanoseconds) / 1e6 }

struct Stats {
    let n: Int, median: Double, p99: Double, mean: Double, max: Double
    init(_ v: [Double]) {
        let s = v.sorted(); n = s.count
        median = s.isEmpty ? 0 : s[s.count / 2]
        p99 = s.isEmpty ? 0 : s[min(s.count - 1, Int(Double(s.count) * 0.99))]
        mean = s.isEmpty ? 0 : s.reduce(0, +) / Double(s.count)
        max = s.last ?? 0
    }
    var text: String { String(format: "median %6.2f  p99 %6.2f  mean %6.2f  max %6.2f ms  (n=%d)", median, p99, mean, max, n) }
}

var args = Array(CommandLine.arguments.dropFirst())
func option(_ name: String, _ def: Double) -> Double {
    if let i = args.firstIndex(of: name), i + 1 < args.count, let v = Double(args[i + 1]) { args.removeSubrange(i...i + 1); return v }
    return def
}
func flag(_ name: String) -> Bool { if let i = args.firstIndex(of: name) { args.remove(at: i); return true }; return false }
let ITERS = Int(option("--iters", 500)), SECONDS = option("--seconds", 8), LOAD_MS = option("--load-ms", 10)
let PACED = !flag("--unpaced"), FRAME_MS = 1000.0 / 60.0

let device = MTLCreateSystemDefaultDevice()!
let queue = device.makeCommandQueue()!

// ---------------------------------------------------------------- Core ML
var compiledCache: [String: URL] = [:]
func loadModel(_ path: String, _ units: MLComputeUnits) throws -> MLModel {
    let url: URL
    if let c = compiledCache[path] { url = c } else { url = try MLModel.compileModel(at: URL(fileURLWithPath: path)); compiledCache[path] = url }
    let cfg = MLModelConfiguration()
    cfg.computeUnits = units
    return try MLModel(contentsOf: url, configuration: cfg)
}

// one input tensor filled with smooth-ish values, and a reusable output buffer so the loop allocates nothing
struct Job { let model: MLModel; let input: MLFeatureProvider; let options: MLPredictionOptions }
func makeJob(_ model: MLModel) throws -> Job {
    let c = model.modelDescription.inputDescriptionsByName["x"]!.multiArrayConstraint!
    let a = try MLMultiArray(shape: c.shape, dataType: .float16)
    let p = a.dataPointer.bindMemory(to: Float16.self, capacity: a.count)
    for i in 0..<a.count { p[i] = Float16(Float(i % 257) / 257) }
    let input = try MLDictionaryFeatureProvider(dictionary: ["x": MLFeatureValue(multiArray: a)])
    let opts = MLPredictionOptions()
    if let oc = model.modelDescription.outputDescriptionsByName["y"]?.multiArrayConstraint, !oc.shape.isEmpty {
        opts.outputBackings = ["y": try MLMultiArray(shape: oc.shape, dataType: .float16)]
    }
    return Job(model: model, input: input, options: opts)
}
func infer(_ j: Job) -> Double { let t = now(); _ = try? j.model.prediction(from: j.input, options: j.options); return now() - t }

let UNITS: [(String, MLComputeUnits)] = [("ANE", .cpuAndNeuralEngine), ("GPU", .cpuAndGPU)]

// ---------------------------------------------------------------- a stand-in for the renderer: a compute load on the GPU
// Each dispatch streams a 256 MB buffer (memory traffic, like a renderer) and does a calibrated amount of math.
final class GPULoad {
    let pso: MTLComputePipelineState, buf: MTLBuffer, n = 1 << 24
    var iters: UInt32 = 32
    init() {
        let src = """
        #include <metal_stdlib>
        using namespace metal;
        kernel void load(device float4 *a [[buffer(0)]], constant uint &iters [[buffer(1)]], uint id [[thread_position_in_grid]]) {
          float4 v = a[id];
          for (uint i = 0; i < iters; i++) v = fma(v, float4(0.99991), float4(0.00007));
          a[id] = v;
        }
        """
        let lib = try! device.makeLibrary(source: src, options: nil)
        pso = try! device.makeComputePipelineState(function: lib.makeFunction(name: "load")!)
        buf = device.makeBuffer(length: n * 16, options: .storageModePrivate)!
    }
    func run() -> Double {
        let cb = queue.makeCommandBuffer()!, e = cb.makeComputeCommandEncoder()!
        e.setComputePipelineState(pso); e.setBuffer(buf, offset: 0, index: 0)
        var it = iters; e.setBytes(&it, length: 4, index: 1)
        e.dispatchThreads(MTLSize(width: n, height: 1, depth: 1), threadsPerThreadgroup: MTLSize(width: 256, height: 1, depth: 1))
        e.endEncoding(); cb.commit(); cb.waitUntilCompleted()
        return (cb.gpuEndTime - cb.gpuStartTime) * 1000
    }
    func calibrate(_ ms: Double) {
        var t = run()
        for _ in 0..<8 { iters = max(1, UInt32(Double(iters) * ms / max(t, 0.05))); t = run() }
        print(String(format: "GPU load calibrated to %.2f ms per frame (%d iterations)", t, iters))
    }
}

final class Box { var gpu: [Double] = []; var stop = false; let lock = NSLock() }

// Runs the GPU load continuously on its own thread while `body` runs here; returns the GPU frame times.
func withGPULoad(_ load: GPULoad, _ body: () -> Void) -> [Double] {
    let box = Box()
    let t = Thread {
        while true {
            box.lock.lock(); let s = box.stop; box.lock.unlock()
            if s { break }
            let ms = load.run()
            box.lock.lock(); box.gpu.append(ms); box.lock.unlock()
        }
    }
    t.start()
    body()
    box.lock.lock(); box.stop = true; box.lock.unlock()
    while !t.isFinished { Thread.sleep(forTimeInterval: 0.005) }
    return box.gpu
}

// Inference for `seconds`, once per 60 Hz frame (or back to back with --unpaced); returns the latencies.
func inferFor(_ j: Job, _ seconds: Double) -> [Double] {
    var out: [Double] = []; let t0 = now(); var k = 0.0
    while now() - t0 < seconds * 1000 {
        if PACED { let next = t0 + k * FRAME_MS; let w = next - now(); if w > 0 { Thread.sleep(forTimeInterval: w / 1000) }; k += 1 }
        out.append(infer(j))
    }
    return out
}

// ---------------------------------------------------------------- commands
func latency(_ paths: [String]) throws {
    for p in paths {
        print("\n\(URL(fileURLWithPath: p).lastPathComponent)")
        for (name, units) in UNITS {
            let j = try makeJob(try loadModel(p, units))
            for _ in 0..<30 { _ = infer(j) } // warm up (the first runs compile and load onto the device)
            var v: [Double] = []
            for _ in 0..<ITERS { v.append(infer(j)) }
            print("  \(name)  " + Stats(v).text)
        }
    }
    print("\nCheck that every layer really ran on the ANE: open the .mlpackage in Xcode -> Performance -> Create Report (Neural Engine).")
}

func contention(_ path: String) throws {
    let load = GPULoad(); load.calibrate(LOAD_MS)
    let base = Stats(withGPULoad(load) { Thread.sleep(forTimeInterval: SECONDS) })
    print("\nGPU frame, load alone:            " + base.text)
    var rows: [(String, Stats, Stats)] = []
    for (name, units) in UNITS {
        let j = try makeJob(try loadModel(path, units))
        for _ in 0..<30 { _ = infer(j) }
        var lat: [Double] = []
        let gpu = Stats(withGPULoad(load) { lat = inferFor(j, SECONDS) })
        rows.append((name, gpu, Stats(lat)))
        print("GPU frame, load + model on \(name): " + gpu.text)
        print("  model latency under load:       " + Stats(lat).text)
    }
    print("\nSummary for \(URL(fileURLWithPath: path).lastPathComponent) (\(PACED ? "one inference per 60 Hz frame" : "back to back")):")
    for (name, gpu, lat) in rows {
        print(String(format: "  %@: adds %+.2f ms to the GPU frame (median), %+.2f ms (p99); model p99 %.2f ms", name, gpu.median - base.median, gpu.p99 - base.p99, lat.p99))
    }
    print("  The ANE pays off if its p99 fits the budget (~8 ms with one frame of pipelining) and it adds clearly less GPU time than the GPU run.")
}

func tex(_ f: MTLPixelFormat, _ w: Int, _ h: Int, _ usage: MTLTextureUsage, _ mode: MTLStorageMode = .private) -> MTLTexture {
    let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: f, width: w, height: h, mipmapped: false)
    d.usage = usage; d.storageMode = mode
    return device.makeTexture(descriptor: d)!
}

func gpuTime(_ n: Int, _ encode: (MTLCommandBuffer, Int) -> Void) -> Stats {
    var v: [Double] = []
    for i in 0..<n {
        let cb = queue.makeCommandBuffer()!; encode(cb, i); cb.commit(); cb.waitUntilCompleted()
        if i >= 10 { v.append((cb.gpuEndTime - cb.gpuStartTime) * 1000) }
    }
    return Stats(v)
}

func metalfx() {
    let (iw, ih, ow, oh) = (1280, 720, 2560, 1440)
    let td = MTLFXTemporalScalerDescriptor()
    td.inputWidth = iw; td.inputHeight = ih; td.outputWidth = ow; td.outputHeight = oh
    td.colorTextureFormat = .rgba16Float; td.depthTextureFormat = .depth32Float; td.motionTextureFormat = .rg16Float; td.outputTextureFormat = .rgba16Float
    if let ts = td.makeTemporalScaler(device: device) {
        ts.colorTexture = tex(.rgba16Float, iw, ih, ts.colorTextureUsage)
        ts.depthTexture = tex(.depth32Float, iw, ih, ts.depthTextureUsage)
        ts.motionTexture = tex(.rg16Float, iw, ih, ts.motionTextureUsage)
        ts.outputTexture = tex(.rgba16Float, ow, oh, ts.outputTextureUsage)
        ts.inputContentWidth = iw; ts.inputContentHeight = ih
        ts.motionVectorScaleX = Float(iw); ts.motionVectorScaleY = Float(ih)
        let s = gpuTime(300) { cb, i in
            ts.jitterOffsetX = Float(i % 8) / 8 - 0.5; ts.jitterOffsetY = Float((i * 3) % 8) / 8 - 0.5; ts.reset = i == 0
            ts.encode(commandBuffer: cb)
        }
        print("MetalFX temporal 1280x720 -> 2560x1440 (GPU): " + s.text)
    } else { print("MetalFX temporal scaler not supported on this device") }
    let sd = MTLFXSpatialScalerDescriptor()
    sd.inputWidth = iw; sd.inputHeight = ih; sd.outputWidth = ow; sd.outputHeight = oh
    sd.colorTextureFormat = .rgba16Float; sd.outputTextureFormat = .rgba16Float; sd.colorProcessingMode = .perceptual
    if let ss = sd.makeSpatialScaler(device: device) {
        ss.colorTexture = tex(.rgba16Float, iw, ih, ss.colorTextureUsage)
        ss.outputTexture = tex(.rgba16Float, ow, oh, ss.outputTextureUsage)
        ss.inputContentWidth = iw; ss.inputContentHeight = ih
        print("MetalFX spatial  1280x720 -> 2560x1440 (GPU): " + gpuTime(300) { cb, _ in ss.encode(commandBuffer: cb) }.text)
    }
}

func writePNG(_ t: MTLTexture, _ url: URL) {
    let w = t.width, h = t.height
    var bytes = [UInt8](repeating: 0, count: w * h * 4)
    t.getBytes(&bytes, bytesPerRow: w * 4, from: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0)
    let info = t.pixelFormat == .bgra8Unorm
        ? CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        : CGImageAlphaInfo.noneSkipLast.rawValue
    bytes.withUnsafeMutableBytes { p in
        let ctx = CGContext(data: p.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: info)!
        let dst = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil)!
        CGImageDestinationAddImage(dst, ctx.makeImage()!, nil)
        CGImageDestinationFinalize(dst)
    }
}

// MetalFX spatial 2x of every PNG in `inDir` (the experiment's low-res test images), for the quality comparison
func metalfxImages(_ inDir: String, _ outDir: String) throws {
    let loader = MTKTextureLoader(device: device)
    try FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
    let files = try FileManager.default.contentsOfDirectory(atPath: inDir).filter { $0.hasSuffix(".png") }.sorted()
    for f in files {
        let src = try loader.newTexture(URL: URL(fileURLWithPath: inDir).appendingPathComponent(f), options: [
            .SRGB: false, .textureUsage: MTLTextureUsage.shaderRead.rawValue, .textureStorageMode: MTLStorageMode.private.rawValue])
        let (iw, ih) = (src.width, src.height), (ow, oh) = (iw * 2, ih * 2)
        let sd = MTLFXSpatialScalerDescriptor()
        sd.inputWidth = iw; sd.inputHeight = ih; sd.outputWidth = ow; sd.outputHeight = oh
        sd.colorTextureFormat = src.pixelFormat; sd.outputTextureFormat = src.pixelFormat; sd.colorProcessingMode = .perceptual
        guard let ss = sd.makeSpatialScaler(device: device) else { print("MetalFX spatial not supported for \(src.pixelFormat.rawValue)"); return }
        let out = tex(src.pixelFormat, ow, oh, ss.outputTextureUsage), shared = tex(src.pixelFormat, ow, oh, .shaderRead, .shared)
        ss.colorTexture = src; ss.outputTexture = out; ss.inputContentWidth = iw; ss.inputContentHeight = ih
        let cb = queue.makeCommandBuffer()!
        ss.encode(commandBuffer: cb)
        let b = cb.makeBlitCommandEncoder()!; b.copy(from: out, to: shared); b.endEncoding()
        cb.commit(); cb.waitUntilCompleted()
        writePNG(shared, URL(fileURLWithPath: outDir).appendingPathComponent(f))
        print("upscaled", f)
    }
}

// ---------------------------------------------------------------- main
let cmd = args.first ?? ""
let rest = Array(args.dropFirst())
print("Device: \(device.name)")
do {
    let usage = "usage: bench latency <model.mlpackage...> | contention <model.mlpackage> | metalfx | metalfx-images <lowdir> <outdir>"
    if cmd == "latency" && !rest.isEmpty { try latency(rest) }
    else if cmd == "contention" && rest.count == 1 { try contention(rest[0]) }
    else if cmd == "metalfx" { metalfx() }
    else if cmd == "metalfx-images" && rest.count == 2 { try metalfxImages(rest[0], rest[1]) }
    else { print(usage) }
} catch { print("error:", error) }
