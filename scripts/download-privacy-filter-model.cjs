const fs = require('node:fs')
const https = require('node:https')
const path = require('node:path')

const repo = 'openai/privacy-filter'
const revision = process.env.CLAROIA_PRIVACY_MODEL_REVISION || 'main'
const outputRoot = path.resolve('privacy-filter-model', repo)

const files = [
  'README.md',
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'viterbi_calibration.json',
  'onnx/model_q4.onnx',
  'onnx/model_q4.onnx_data'
]

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

const main = async () => {
  fs.mkdirSync(outputRoot, { recursive: true })

  for (const file of files) {
    const destination = path.join(outputRoot, file)
    fs.mkdirSync(path.dirname(destination), { recursive: true })

    if (fs.existsSync(destination) && fs.statSync(destination).size > 0) {
      console.log(`present ${file}`)
      continue
    }

    console.log(`download ${file}`)
    await download(resolveUrl(file), destination)
  }

  console.log(`Privacy Filter model bundle ready at ${path.resolve('privacy-filter-model')}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
