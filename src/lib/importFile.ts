// Turns an uploaded file into plain text so it can be dropped into a draft.
// Plain-text and code files are read as-is; PDFs and .docx are run through
// real extractors (pdf.js / mammoth) because reading them as text is garbage.
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// A friendly error whose message is safe to show the user.
export class ImportError extends Error {}

// Code / prose formats that are already plain text and just need reading.
// (Not exhaustive — anything not matched here still falls through to text.)
const TEXT_EXT = new Set([
  'txt', 'text', 'md', 'markdown', 'rst', 'org', 'tex',
  'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'yaml', 'yml', 'toml', 'ini', 'env', 'cfg', 'conf',
  'xml', 'html', 'htm', 'svg', 'css', 'scss', 'sass', 'less',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'vue', 'svelte',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'swift', 'c', 'h', 'cpp', 'cc', 'hpp',
  'cs', 'php', 'pl', 'lua', 'r', 'jl', 'dart', 'ex', 'exs', 'erl', 'clj', 'hs', 'elm',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'sql', 'graphql', 'gql', 'proto',
  'dockerfile', 'makefile', 'gitignore', 'log',
])

function extname(name: string): string {
  const base = name.toLowerCase().split('/').pop() ?? name.toLowerCase()
  const dot = base.lastIndexOf('.')
  // Extensionless config files (Dockerfile, Makefile) key off the whole name.
  return dot === -1 ? base : base.slice(dot + 1)
}

async function extractPdf(file: File): Promise<string> {
  // Loaded on demand so pdf.js (~1 MB) stays out of the app's entry bundle.
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = PdfWorker
  const data = new Uint8Array(await file.arrayBuffer())
  let pdf
  try {
    pdf = await pdfjs.getDocument({ data }).promise
  } catch {
    throw new ImportError("Couldn't read that PDF — it may be corrupted or password-protected.")
  }
  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const line = content.items
      .map(it => ('str' in it ? it.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (line) pages.push(line)
  }
  const text = pages.join('\n\n').trim()
  if (!text) {
    throw new ImportError('That PDF has no selectable text (it looks scanned). Try a text-based PDF or paste the text.')
  }
  return text
}

async function extractDocx(file: File): Promise<string> {
  // Loaded on demand so mammoth stays out of the app's entry bundle.
  const mammoth = (await import('mammoth')).default
  const arrayBuffer = await file.arrayBuffer()
  try {
    const { value } = await mammoth.extractRawText({ arrayBuffer })
    const text = value.trim()
    if (!text) throw new ImportError('That Word document appears to be empty.')
    return text
  } catch (e) {
    if (e instanceof ImportError) throw e
    throw new ImportError("Couldn't read that Word document — save it as .docx and try again.")
  }
}

// Extracts plain text from a supported upload. Throws ImportError with a
// user-safe message for anything that can't be turned into text.
export async function extractText(file: File): Promise<string> {
  const ext = extname(file.name)

  if (ext === 'pdf') return extractPdf(file)
  if (ext === 'docx') return extractDocx(file)
  if (ext === 'doc' || ext === 'rtf' || ext === 'pages') {
    throw new ImportError('Legacy .doc/.rtf/.pages isn’t supported — export to .docx or PDF, or paste the text.')
  }

  // Reject obvious binaries early so we don't dump gibberish into a draft.
  const BINARY = /\.(png|jpe?g|gif|webp|bmp|ico|tiff?|heic|mp[34]|m4a|wav|mov|avi|mkv|webm|zip|gz|tar|rar|7z|exe|dmg|bin|so|dll|woff2?|ttf|otf|eot|xlsx?|pptx?)$/i
  if (BINARY.test(file.name) && !TEXT_EXT.has(ext)) {
    throw new ImportError(`Can’t import ${file.name} — upload text, PDF, Word (.docx), or a code/data file.`)
  }

  // Everything else (known text/code ext, or unknown-but-probably-text) reads as text.
  const text = await file.text()
  if (!text.trim()) throw new ImportError('That file is empty.')
  return text
}

// The accept="" list for the hidden file input. Kept here so the picker and the
// extractor stay in sync.
export const IMPORT_ACCEPT = [
  '.json',
  '.txt', '.text', '.md', '.markdown', '.rst', '.tex',
  '.pdf', '.docx',
  '.csv', '.tsv', '.yaml', '.yml', '.toml', '.ini', '.xml', '.html', '.htm',
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.rb', '.go', '.rs', '.java',
  '.c', '.h', '.cpp', '.cc', '.hpp', '.cs', '.php', '.swift', '.kt', '.sh', '.sql',
  'text/plain', 'text/markdown', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
].join(',')
