// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as tf from '@tensorflow/tfjs'
import { frameToPatch } from './features'
import { parseClassMapCsv } from './yamnetClassifier'

const reference=JSON.parse(readFileSync('src/ai/fixtures/yamnet-reference.json','utf8')) as {pcm:number[];patch:number[];scores:number[];source:string}
describe('pretrained YAMNet parity with official TensorFlow and recorded audio',()=>{
  it('matches STFT/mel features, all 521 scores and class map',async()=>{
    const patch=frameToPatch(new Float32Array(reference.pcm))
    const delta=Math.max(...patch.map((v,i)=>Math.abs(v-reference.patch[i])))
    expect(delta).toBeLessThan(0.001)
    await tf.setBackend('cpu');await tf.ready()
    const manifest=JSON.parse(readFileSync('public/models/yamnet/model.json','utf8'))
    const binary=readFileSync('public/models/yamnet/weights.bin')
    const model=await tf.loadLayersModel(tf.io.fromMemory({modelTopology:manifest.modelTopology,weightSpecs:manifest.weightsManifest[0].weights,weightData:binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength)}))
    const input=tf.tensor(patch,[1,96,64]);const output=model.predict(input) as tf.Tensor
    try {
      const scores=await output.data()
      expect(scores.length).toBe(521)
      expect(Math.max(...scores.map((v,i)=>Math.abs(v-reference.scores[i])))).toBeLessThan(0.001)
      expect(parseClassMapCsv(readFileSync('public/models/yamnet/yamnet_class_map.csv','utf8'))).toHaveLength(521)
    } finally {input.dispose();output.dispose();model.dispose()}
  },30000)
})
