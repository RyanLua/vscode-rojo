import * as childProcess from "child_process"
import * as fs from "fs"
import { lstat } from "fs/promises"
import fetch from "node-fetch"
import * as os from "os"
import * as path from "path"
import { Duplex, pipeline } from "stream"
import * as unzipper from "unzipper"
import { promisify } from "util"
import * as vscode from "vscode"
import * as which from "which"

const exec = promisify(childProcess.exec)

// Generated by https://quicktype.io

export interface GitHubRelease {
  url: string
  assets_url: string
  upload_url: string
  html_url: string
  id: number
  node_id: string
  tag_name: string
  target_commitish: string
  name: string
  draft: boolean
  prerelease: boolean
  created_at: string
  published_at: string
  assets: Asset[]
  tarball_url: string
  zipball_url: string
  body: string
}

export interface Asset {
  url: string
  id: number
  node_id: string
  name: string
  label: string
  content_type: string
  state: string
  size: number
  download_count: number
  created_at: string
  updated_at: string
  browser_download_url: string
}

export function promisifyStream(
  stream: fs.ReadStream | fs.WriteStream | Duplex
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    stream.on("close", resolve)
    stream.on("finish", resolve)
    stream.on("end", resolve)
    stream.on("error", reject)
  })
}

async function isAftmanInstalled() {
  const aftmanPath = await which("aftman").catch(() => null)

  return !!aftmanPath
}

const nodePlatforms: { [index: string]: string | undefined } = {
  darwin: "macos",
  linux: "linux",
  win32: "windows",
}

const nodeArches: { [index: string]: string | undefined } = {
  arm64: "aarch64",
  x64: "x86_64",
}

// Release name example: "aftman-v0.2.2-windows-x86_64.zip",
// Arch examples: x86_64, aarch64
// Platforms: linux, macos, windows
function findCompatibleAsset(assets: Asset[]): Asset | null {
  const currentPlatform = nodePlatforms[os.platform()]
  const currentArch = nodeArches[os.arch()]

  if (!currentPlatform || !currentArch) {
    throw new Error(
      `Your current platform is unknown. Platform: ${os.platform()}, Architecture: ${os.arch()}`
    )
  }

  for (const asset of assets) {
    const match = asset.name.match(/-(?<platform>\w+)-(?<arch>\w+)\.zip$/)

    if (!match) {
      continue
    }

    const { platform, arch } = match.groups!

    if (platform === currentPlatform && arch === currentArch) {
      return asset
    }
  }

  return null
}

export async function installRojo(folder: string) {
  if (!(await isAftmanInstalled())) {
    console.log("Aftman not installed")
    const latestReleaseResponse = await fetch(
      "https://latest-github-release.eryn.io/lpghatguy/aftman"
    )

    if (!latestReleaseResponse.ok) {
      return Promise.reject("Could not fetch latest release from GitHub.")
    }

    const latestRelease: GitHubRelease | null =
      (await latestReleaseResponse.json()) as any

    if (!latestRelease) {
      return Promise.reject("Latest release of Aftman was not found")
    }

    const asset = findCompatibleAsset(latestRelease.assets)

    if (!asset) {
      return Promise.reject(
        `We couldn't find a compatible Aftman release for your platform/architecture: ${os.arch()} ${os.platform()}`
      )
    }

    const download = await fetch(asset.browser_download_url)

    if (!download.ok) {
      return Promise.reject(
        `Response from GitHub binary download not ok: ${download.status} ${download.statusText}`
      )
    }

    const tempPath = path.join(
      os.tmpdir(),
      "aftman" + (os.platform() === "win32" ? ".exe" : "")
    )
    const writeStream = fs.createWriteStream(tempPath)

    const unzip = pipeline(download.body!, unzipper.ParseOne(), () => {})

    const file = unzip.pipe(writeStream)

    await promisifyStream(unzip)

    if (file.bytesWritten === 0) {
      file.close()

      return Promise.reject("Could not extract aftman.exe from zip release!")
    }

    await promisifyStream(file)
    file.close()

    if (os.platform() !== "win32") {
      await fs.promises.chmod(tempPath, 0o755)
    }

    await exec(`"${tempPath}" self-install`)

    vscode.window.showInformationMessage(
      "Successfully installed Aftman on your system. " +
        "It has been added to your system PATH, and is usable from the command line if needed. "
    )

    if ("PATH" in process.env) {
      const envPath = process.env.PATH!.split(path.delimiter)
      envPath.push(path.join(os.homedir(), ".aftman", "bin"))
      process.env.PATH = envPath.join(path.delimiter)
    }
  }

  await exec("aftman trust rojo-rbx/rojo", {
    cwd: folder,
  })

  const aftmanToml = await lstat(path.join(folder, "aftman.toml")).catch(
    () => null
  )

  if (aftmanToml) {
    await exec("aftman install --skip-untrusted", {
      cwd: folder,
    })

    const output = await exec("rojo --version", {
      cwd: folder,
    }).catch(() => null)

    if (!output) {
      await exec("aftman add rojo-rbx/rojo", {
        cwd: folder,
      })
    }
  } else {
    await exec("aftman init", {
      cwd: folder,
    })

    await exec("aftman add rojo-rbx/rojo", {
      cwd: folder,
    })
  }
}
