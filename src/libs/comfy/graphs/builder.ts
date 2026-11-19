import type { ComfyGraph } from "../client"

/**
 * An output of a node: the node's id and the output's index.
 */
export type NodeRef = [id: string, output: number]

/**
 * A node that saves files, and what those files are to the job.
 */
export type GraphOutput = {
  nodeId: string
  role: Media.AssetRole
  kind: Media.AssetKind
}

export type BuiltGraph = {
  graph: ComfyGraph
  /**
   * What to show while a node runs, by node id. Nodes without a label keep the previous one.
   */
  labels: Record<string, string>
  outputs: GraphOutput[]
}

/**
 * A reference image as `LoadImage` names it (see `comfyImageName`).
 */
export type GraphReference = {
  imageName: string
}

/**
 * Assembles a ComfyUI workflow in API format, numbering the nodes as they are added.
 *
 * @example
 * const builder = new GraphBuilder()
 * const image = builder.add("LoadImage", { image: "frozen/a.png" }, "Reading the image")
 * const saved = builder.add("SaveImage", { images: image, filename_prefix: "frozen/x/image" })
 * builder.output(saved, "output", "image")
 * const { graph, labels, outputs } = builder.build()
 */
export class GraphBuilder {
  private readonly graph: ComfyGraph = {}
  private readonly labels: Record<string, string> = {}
  private readonly outputs: GraphOutput[] = []
  private nextId = 1

  /**
   * Adds a node.
   *
   * @param classType - The ComfyUI node class
   * @param inputs - Its inputs: plain values, or a `NodeRef` to wire another node's output in
   * @param label - Progress text for the user while this node runs
   * @returns A reference to the node's first output; use `output(ref, n)` for the others
   */
  add(classType: string, inputs: Record<string, unknown>, label?: string): NodeRef {
    const id = String(this.nextId++)
    this.graph[id] = { class_type: classType, inputs }
    if (label) this.labels[id] = label

    return [id, 0]
  }

  /**
   * Marks a save node's files as results of the job.
   */
  output(node: NodeRef, role: Media.AssetRole, kind: Media.AssetKind) {
    this.outputs.push({ nodeId: node[0], role, kind })
  }

  build(): BuiltGraph {
    return { graph: this.graph, labels: this.labels, outputs: this.outputs }
  }
}

/**
 * Another output of the same node, e.g. `output(loaded, 1)` for the mask `LoadImage` returns second.
 */
export function output(node: NodeRef, index: number): NodeRef {
  return [node[0], index]
}
