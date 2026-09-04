// Proves that a change to the recommend pipeline or its two endpoints changed
// nothing: runs `run.mjs` against a baseline commit and against this working
// tree (as it is, uncommitted edits included - that is what would ship), then
// compares the two output directories file by file.
//
// Usage: node scripts/recommend-parity/compare.mjs [baselineRef]
//        npm run parity:recommend -- [baselineRef]
//
// `baselineRef` defaults to the merge-base with `main`. The baseline is a
// throwaway `git worktree` with this checkout's `node_modules` symlinked in
// (no install), removed again on the way out whatever happens. The two sides
// run one after the other, never in parallel - each is a few minutes of
// simulation and this project's usual dev box does not have the memory for
// two at once, let alone a build alongside.
//
// Exit code 0 means every case is byte-identical; 1 means something differed,
// and both output directories are left in place for a closer look.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()

const baselineRef = process.argv[2] ?? git('merge-base', 'main', 'HEAD')
const baselineSha = git('rev-parse', '--short', baselineRef)

const workDir = mkdtempSync(path.join(os.tmpdir(), 'recommend-parity-'))
const baselineTree = path.join(workDir, 'baseline')
const outBaseline = path.join(workDir, 'out-baseline')
const outCurrent = path.join(workDir, 'out-current')

function runSide(label, tree, outDir) {
  console.log(`\n== ${label}: ${tree}`)
  const result = spawnSync(process.execPath, [path.join(here, 'run.mjs'), outDir, tree], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`${label} run failed (exit ${result.status})`)
}

/** Lists differing cases; each entry names the file and the first line that differs. */
function compareDirs(a, b) {
  const names = [...new Set([...readdirSync(a), ...readdirSync(b)])].sort()
  const findings = []
  for (const name of names) {
    const inA = existsSync(path.join(a, name))
    const inB = existsSync(path.join(b, name))
    if (!inA || !inB) {
      findings.push(`${name}: only in ${inA ? 'baseline' : 'current'}`)
      continue
    }
    const linesA = readFileSync(path.join(a, name), 'utf8').split('\n')
    const linesB = readFileSync(path.join(b, name), 'utf8').split('\n')
    const limit = Math.max(linesA.length, linesB.length)
    for (let i = 0; i < limit; i++) {
      if (linesA[i] !== linesB[i]) {
        findings.push(`${name}: line ${i + 1}\n    baseline: ${linesA[i] ?? '<end>'}\n    current:  ${linesB[i] ?? '<end>'}`)
        break
      }
    }
  }
  return { cases: names.length, findings }
}

let exitCode = 1
try {
  console.log(`baseline: ${baselineRef} (${baselineSha})`)
  git('worktree', 'add', '--detach', baselineTree, baselineRef)
  symlinkSync(path.join(repoRoot, 'node_modules'), path.join(baselineTree, 'node_modules'), 'dir')

  runSide('baseline', baselineTree, outBaseline)
  runSide('current', repoRoot, outCurrent)

  const { cases, findings } = compareDirs(outBaseline, outCurrent)
  console.log(`\n== ${cases} cases compared against ${baselineSha}`)
  if (findings.length === 0) {
    console.log('0 diffs - the two trees answer every case identically')
    exitCode = 0
  } else {
    console.log(`${findings.length} case(s) differ:`)
    for (const finding of findings) console.log(`  ${finding}`)
    console.log(`\nfull outputs: ${outBaseline}\n              ${outCurrent}`)
  }
} finally {
  // Best effort: a worktree that survives here is still listed by
  // `git worktree list` and removable by hand.
  spawnSync('git', ['worktree', 'remove', '--force', baselineTree], { cwd: repoRoot, stdio: 'ignore' })
}
process.exit(exitCode)
