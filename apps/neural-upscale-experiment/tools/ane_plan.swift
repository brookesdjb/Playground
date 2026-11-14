// Per-op compute device assignment for Core ML models (stand-in for Xcode's Performance report, which has no CLI).
//   swiftc -O tools/ane_plan.swift -o /tmp/ane_plan && /tmp/ane_plan models/*.mlpackage
// Prints, per model, the count of non-const ops by preferred device under .cpuAndNeuralEngine, and any op not on the ANE.

import CoreML
import Foundation
func dev(_ d: MLComputeDevice?) -> String {
  switch d { case .neuralEngine?: return "ANE"; case .gpu?: return "GPU"; case .cpu?: return "CPU"; default: return "?" } }
for p in CommandLine.arguments.dropFirst() {
  let u = try MLModel.compileModel(at: URL(fileURLWithPath: p))
  let cfg = MLModelConfiguration(); cfg.computeUnits = .cpuAndNeuralEngine
  let plan = try await MLComputePlan.load(contentsOf: u, configuration: cfg)
  guard case .program(let prog) = plan.modelStructure, let main = prog.functions["main"] else { print(p, "not a program"); continue }
  var counts: [String: Int] = [:]; var off: [String] = []; var costOff = 0.0; var costAll = 0.0
  for op in main.block.operations {
    let usage = plan.deviceUsage(for: op)
    let d = dev(usage?.preferred)
    let c = plan.estimatedCost(of: op)?.weight ?? 0
    costAll += c
    if ["const"].contains(op.operatorName) { continue }
    counts[d, default: 0] += 1
    if d != "ANE" { off.append("\(op.operatorName)->\(d) supported=\(usage?.supported.map(dev) ?? [])"); costOff += c }
  }
  print(URL(fileURLWithPath: p).lastPathComponent, counts, String(format: "cost off-ANE %.4f of %.4f", costOff, costAll))
  for o in off { print("   ", o) }
}
