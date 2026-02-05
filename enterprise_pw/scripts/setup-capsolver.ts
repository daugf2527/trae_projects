import fs from 'fs'
import path from 'path'
import axios from 'axios'
import AdmZip from 'adm-zip'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const FALLBACK_DOWNLOAD_URL =
  'https://github.com/capsolver/capsolver-browser-extension/releases/download/v.1.17.0/CapSolver.Browser.Extension-chrome-v1.17.0.zip'
const GITHUB_API_URL = 'https://api.github.com/repos/capsolver/capsolver-browser-extension/releases/latest'
const EXTENSION_DIR = path.resolve(__dirname, '../extensions/capsolver')

async function downloadAndUnzip() {
  try {
    console.log('Fetching latest release info from GitHub...')
    let downloadUrl = FALLBACK_DOWNLOAD_URL
    try {
      const release = await axios.get(GITHUB_API_URL)
      const asset = release.data.assets.find((a: any) => typeof a?.name === 'string' && a.name.endsWith('.zip'))
      if (asset?.browser_download_url) {
        downloadUrl = asset.browser_download_url
        console.log(`Found latest version: ${release.data.tag_name}`)
      }
    } catch (e) {
      console.warn('Failed to fetch latest release from GitHub API, falling back to hardcoded URL.')
    }

    console.log(`Downloading CapSolver extension from ${downloadUrl}...`)

    const response = await axios({
      url: downloadUrl,
      method: 'GET',
      responseType: 'arraybuffer'
    })

    const zip = new AdmZip(response.data)

    if (fs.existsSync(EXTENSION_DIR)) {
      console.log('Removing existing extension...')
      fs.rmSync(EXTENSION_DIR, { recursive: true, force: true })
    }

    fs.mkdirSync(EXTENSION_DIR, { recursive: true })

    console.log(`Extracting to ${EXTENSION_DIR}...`)
    zip.extractAllTo(EXTENSION_DIR, true)

    const configPath = path.join(EXTENSION_DIR, 'assets', 'config.js')
    if (fs.existsSync(configPath)) {
      console.log('Config file found. It will be updated at runtime by the test fixture if needed.')
    } else {
      console.warn('Warning: assets/config.js not found in extracted extension.')
    }

    console.log('CapSolver extension setup complete.')
  } catch (error) {
    console.error('Error setting up CapSolver extension:', error)
    process.exit(1)
  }
}

downloadAndUnzip()
