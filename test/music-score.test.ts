/** score.json 组装单测（P2）：段落 zip/均分、拍点上限、溯源字段。 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLyricsSections, alignLyrics, beatsFrom, evenSections, assembleScore } from '../src/music/score.ts'

test('parseLyricsSections：[Tag] 段落切分；无标签整段单节', () => {
  const a = parseLyricsSections('[Verse]\n第一句\n第二句\n[Chorus]\n副歌')
  assert.deepEqual(a.map((x) => x.section), ['Verse', 'Chorus'])
  assert.deepEqual(a[1]!.lines, ['副歌'])
  const b = parseLyricsSections('没有标签的歌词')
  assert.equal(b.length, 1)
  assert.equal(b[0]!.section, 'Lyrics')
})

test('alignLyrics：网格段数与歌词段数一致 → zip 对齐；不一致 → 均分', () => {
  const sections = [
    { label: 'S1', startSec: 0, endSec: 10 },
    { label: 'S2', startSec: 10, endSec: 20 },
  ]
  const zip = alignLyrics(sections, '[Verse]\n甲\n[Chorus]\n乙', 20)
  assert.equal(zip[0]!.startSec, 0)
  assert.equal(zip[1]!.endSec, 20)
  const even = alignLyrics(sections, '[Verse]\n甲\n[Chorus]\n乙\n[Bridge]\n丙', 20)
  assert.equal(even.length, 3)
  assert.ok(every(even, (x) => x.endSec >= x.startSec))
  function every<T>(arr: T[], f: (x: T) => boolean): boolean { return arr.every(f) }
})

test('beatsFrom：120bpm/offset0.5 → 0.5s 步进，上限 512', () => {
  const beats = beatsFrom(120, 0.5, 3)
  assert.deepEqual(beats, [0.5, 1.0, 1.5, 2.0, 2.5, 3.0])
  assert.equal(beatsFrom(120, 0, 10000).length, 512, '超长曲截断')
  assert.deepEqual(beatsFrom(null, null, 10), [])
})

test('assembleScore：溯源字段与 grid 如实透传', () => {
  const score = assembleScore({
    kind: 'song', file: 'music/song.mp3', durationSec: 20.456,
    grid: { source: 'local-analysis', bpm: 118, offsetSec: 0.3, sections: evenSections(4, 20.456), beats: [] },
    lyricsText: '[Verse]\n甲',
    model: 'song-model', channelId: 'c1',
  })
  assert.equal(score.grid.source, 'local-analysis')
  assert.equal(score.durationSec, 20.46)
  assert.equal(score.model, 'song-model')
  assert.equal(score.lyrics.length, 1)
})
