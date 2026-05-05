const fs = require('node:fs')
const https = require('node:https')
const path = require('node:path')
const crypto = require('node:crypto')

const manifest = require('./privacy-filter-model-manifest.json')
const repo = manifest.repo
const revision = process.env.CLAROIA_PRIVACY_MODEL_REVISION || manifest.revision
const outputRoot = path.resolve('privacy-filter-model', repo)

const files = Object.keys(manifest.files)

const resolveUrl = (file) =>
  `https://huggingface.co/${repo}/resolve/${revision}/${file}?download=true`

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'unknown size'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

const download = (url, destination, redirects = 0, resumeFrom = null) =>
  new Promise((resolve, reject) => {
    if (redirects > 8) {
      reject(new Error(`Too many redirects for ${url}`))
      return
    }

    const temp = `${destination}.tmp`
    const startAt = resumeFrom ?? (fs.existsSync(temp) ? fs.statSync(temp).size : 0)
    const requestOptions = startAt > 0 ? { headers: { Range: `bytes=${startAt}-` } } : {}

    https.get(url, requestOptions, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
        const location = response.headers.location
        response.resume()
        if (!location) {
          reject(new Error(`Redirect without Location for ${url}`))
          return
        }
        download(new URL(location, url).toString(), destination, redirects + 1, startAt)
          .then(resolve, reject)
        return
      }

      if (![200, 206].includes(response.statusCode || 0)) {
        response.resume()
        reject(new Error(`Download failed (${response.statusCode}) for ${url}`))
        return
      }

      const supportsResume = response.statusCode === 206
      if (startAt > 0 && !supportsResume) {
        fs.rmSync(temp, { force: true })
      }

      const contentLength = Number(response.headers['content-length'] || 0)
      const total = supportsResume ? startAt + contentLength : contentLength
      let received = supportsResume ? startAt : 0
      let lastLog = 0
      const file = fs.createWriteStream(temp, { flags: supportsResume ? 'a' : 'w' })

      response.on('data', chunk => {
        received += chunk.length
        const now = Date.now()
        if (now - lastLog > 5000) {
          process.stdout.write(`  ${path.basename(destination)}: ${formatBytes(received)} / ${formatBytes(total)}\n`)
          lastLog = now
        }
      })

      response.pipe(file)
      response.on('error', error => {
        file.destroy()
        reject(error)
      })
      file.on('finish', () => {
        file.close(() => {
          fs.renameSync(temp, destination)
          resolve()
        })
      })
      file.on('error', error => {
        fs.rmSync(temp, { force: true })
        reject(error)
      })
    }).on('error', reject)
  })

const sha256File = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })

const verifyFile = async (file) => {
  const destination = path.join(outputRoot, file)
  const expected = manifest.files[file]
  if (!expected) {
    throw new Error(`No manifest entry for ${file}`)
  }

  const stat = fs.statSync(destination)
  if (stat.size !== expected.bytes) {
    throw new Error(`Size mismatch for ${file}: expected ${expected.bytes}, got ${stat.size}`)
  }

  const actualHash = await sha256File(destination)
  if (actualHash !== expected.sha256) {
    throw new Error(`SHA-256 mismatch for ${file}: expected ${expected.sha256}, got ${actualHash}`)
  }
}

const main = async () => {
  fs.mkdirSync(outputRoot, { recursive: true })

  for (const file of files) {
    const destination = path.join(outputRoot, file)
    fs.mkdirSync(path.dirname(destination), { recursive: true })

    if (fs.existsSync(destination) && fs.statSync(destination).size > 0) {
      console.log(`present ${file}`)
      await verifyFile(file)
      continue
    }

    console.log(`download ${file}`)
    await download(resolveUrl(file), destination)
    await verifyFile(file)
  }

  console.log(`Privacy Filter model bundle ready at ${path.resolve('privacy-filter-model')}`)
  console.log(`Verified ${repo} at ${revision}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
