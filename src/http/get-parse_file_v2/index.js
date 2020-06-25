// learn more about HTTP functions here: https://arc.codes/primitives/http
const Block = require('@ipld/block')
const fixed = require('fixed-chunker')
const bent = require('bent')
const get = bent(200, 206)
const createStore = require('./store')
const limiter = require('./limiter')

const parseFile = async (blockBucket, limit, url, headers, retries = 2) => {
  const store = createStore(Block, blockBucket)
  let stream
  try {
    stream = await get(url, null, headers)
  } catch (e) {
    if (e.statusCode > 400) {
      if (!retries) {
        throw new Error(`Unacceptable error code: ${e.statusCode} for ${url}`)
      }
      return parseFile(limit, url, null, retries - 1)
    } else {
      throw e
    }
  }
  const parts = []
  for await (const chunk of fixed(stream, 1024 * 1024)) {
    const block = Block.encoder(chunk, 'raw')
    await limit(store.put(block))
    if (chunk.length) parts.push(block.cid())
  }
  return Promise.all(parts)
}

exports.handler = async (req) => {
  const blockBucket = req.query.blockBucket
  if (!blockBucket) throw new Error('Must pass blockBucket in options')
  const limit = limiter(100)
  if (req.query.url) {
    const cids = await parseFile(blockBucket, limit, req.query.url, req.query.headers)
    await limit.wait()
    return {
      headers: { 'content-type': 'application/json; charset=utf8' },
      body: JSON.stringify(cids.map(c => c.toString('base64')))
    }
  } else if (req.query.urls) {
    const ret = {}
    for (const url of req.query.urls) {
      const cids = await parseFile(blockBucket, limit, url)
      ret[url] = cids.map(c => c.toString('base64'))
    }
    await limit.wait()
    return {
      headers: { 'content-type': 'application/json; charset=utf8' },
      body: JSON.stringify(ret)
    }
  }
  throw new Error('Must pass either url or urls in query')
}
