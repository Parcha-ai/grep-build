import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Document types we support
export type DocumentType = 'docx' | 'xlsx' | 'pptx' | 'slides' | 'unknown';

export interface DocumentInfo {
  type: DocumentType;
  name: string;
  path: string;
  size: number;
  lastModified: Date;
}

export interface DocumentContent {
  html: string;
  css?: string;
  scripts?: string[];
}

export interface CreateDocumentOptions {
  type: DocumentType;
  name: string;
  directory: string;
  content?: unknown;
}

export interface SpreadsheetCell {
  row: number;
  col: number;
  value: string | number | boolean | null;
  formula?: string;
}

export interface SpreadsheetData {
  sheets: Array<{
    name: string;
    data: SpreadsheetCell[][];
  }>;
}

export interface SlideContent {
  title?: string;
  content: string;
  notes?: string;
  background?: string;
  transition?: string;
}

export interface PresentationData {
  title: string;
  author?: string;
  theme?: string;
  slides: SlideContent[];
}

/**
 * Service for handling document operations (DOCX, XLSX, PPTX, HTML slides)
 */
export class DocumentService {
  private tempDir: string;
  private renderedDocuments: Map<string, DocumentContent> = new Map();

  constructor() {
    this.tempDir = path.join(os.tmpdir(), 'grep-documents');
    this.ensureTempDir();
  }

  private async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (e) {
      console.error('[DocumentService] Failed to create temp directory:', e);
    }
  }

  /**
   * Detect document type from file extension
   */
  getDocumentType(filePath: string): DocumentType {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.docx':
      case '.doc':
        return 'docx';
      case '.xlsx':
      case '.xls':
      case '.csv':
        return 'xlsx';
      case '.pptx':
      case '.ppt':
        return 'pptx';
      case '.html':
      case '.htm':
        // Check if it's a slide deck by looking for reveal.js markers
        return 'slides';
      default:
        return 'unknown';
    }
  }

  /**
   * Get document info
   */
  async getDocumentInfo(filePath: string): Promise<DocumentInfo | null> {
    try {
      const stats = await fs.stat(filePath);
      return {
        type: this.getDocumentType(filePath),
        name: path.basename(filePath),
        path: filePath,
        size: stats.size,
        lastModified: stats.mtime,
      };
    } catch (e) {
      console.error('[DocumentService] Failed to get document info:', e);
      return null;
    }
  }

  /**
   * Render DOCX document to HTML
   * Uses mammoth.js for conversion (simpler, more reliable in Node.js)
   */
  async renderDocx(filePath: string): Promise<DocumentContent> {
    try {
      // Dynamic import to avoid bundling issues
      const mammoth = await import('mammoth');

      const buffer = await fs.readFile(filePath);
      const result = await mammoth.convertToHtml({ buffer });

      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${path.basename(filePath)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      background: #fff;
      color: #333;
      line-height: 1.6;
    }
    h1, h2, h3, h4, h5, h6 { color: #2c3e50; margin-top: 1.5em; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; }
    img { max-width: 100%; height: auto; }
    blockquote { border-left: 4px solid #5D5FEF; margin: 1em 0; padding-left: 1em; color: #666; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
    pre { background: #f4f4f4; padding: 16px; border-radius: 8px; overflow-x: auto; }
    .document-header {
      background: linear-gradient(135deg, #5D5FEF 0%, #4A4BD9 100%);
      color: white;
      padding: 20px;
      margin: -40px -20px 30px -20px;
      border-radius: 0 0 8px 8px;
    }
    .document-header h1 { color: white; margin: 0; font-size: 1.5em; }
    .document-header .type-badge {
      display: inline-block;
      background: rgba(255,255,255,0.2);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.8em;
      margin-top: 8px;
    }
  </style>
</head>
<body>
  <div class="document-header">
    <h1>${path.basename(filePath)}</h1>
    <span class="type-badge">Word Document</span>
  </div>
  <div class="document-content">
    ${result.value}
  </div>
  ${result.messages.length > 0 ? `<div class="warnings" style="color: #856404; background: #fff3cd; padding: 10px; margin-top: 20px; border-radius: 4px;">
    <strong>Conversion notes:</strong>
    <ul>${result.messages.map(m => `<li>${m.message}</li>`).join('')}</ul>
  </div>` : ''}
</body>
</html>`;

      this.renderedDocuments.set(filePath, { html });
      return { html };
    } catch (e) {
      console.error('[DocumentService] Failed to render DOCX:', e);
      throw e;
    }
  }

  /**
   * Render XLSX spreadsheet to HTML
   */
  async renderXlsx(filePath: string): Promise<DocumentContent> {
    try {
      const XLSX = await import('xlsx');

      const buffer = await fs.readFile(filePath);
      const workbook = XLSX.read(buffer, { type: 'buffer' });

      let tabsHtml = '';
      let sheetsHtml = '';

      workbook.SheetNames.forEach((sheetName, index) => {
        const sheet = workbook.Sheets[sheetName];
        const sheetHtml = XLSX.utils.sheet_to_html(sheet, { editable: false });

        tabsHtml += `<button class="tab-btn ${index === 0 ? 'active' : ''}" onclick="showSheet(${index})">${sheetName}</button>`;
        sheetsHtml += `<div class="sheet" id="sheet-${index}" style="${index === 0 ? '' : 'display:none'}">${sheetHtml}</div>`;
      });

      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${path.basename(filePath)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 0;
      background: #f5f5f5;
    }
    .document-header {
      background: linear-gradient(135deg, #2ecc71 0%, #27ae60 100%);
      color: white;
      padding: 20px;
    }
    .document-header h1 { margin: 0; font-size: 1.5em; }
    .document-header .type-badge {
      display: inline-block;
      background: rgba(255,255,255,0.2);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.8em;
      margin-top: 8px;
    }
    .tabs {
      background: #fff;
      border-bottom: 1px solid #ddd;
      padding: 0 10px;
      display: flex;
      gap: 4px;
    }
    .tab-btn {
      padding: 10px 20px;
      border: none;
      background: transparent;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      font-size: 14px;
      color: #666;
    }
    .tab-btn:hover { background: #f0f0f0; }
    .tab-btn.active {
      border-bottom-color: #2ecc71;
      color: #2ecc71;
      font-weight: 500;
    }
    .sheets-container {
      padding: 20px;
      overflow: auto;
    }
    .sheet table {
      border-collapse: collapse;
      background: white;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      width: max-content;
      min-width: 100%;
    }
    .sheet td, .sheet th {
      border: 1px solid #e0e0e0;
      padding: 8px 12px;
      text-align: left;
      min-width: 80px;
      white-space: nowrap;
    }
    .sheet th, .sheet tr:first-child td {
      background: #f8f9fa;
      font-weight: 600;
      color: #333;
    }
    .sheet tr:hover td { background: #f0f7ff; }
  </style>
</head>
<body>
  <div class="document-header">
    <h1>${path.basename(filePath)}</h1>
    <span class="type-badge">Spreadsheet</span>
  </div>
  <div class="tabs">${tabsHtml}</div>
  <div class="sheets-container">${sheetsHtml}</div>
  <script>
    function showSheet(index) {
      document.querySelectorAll('.sheet').forEach((s, i) => {
        s.style.display = i === index ? 'block' : 'none';
      });
      document.querySelectorAll('.tab-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i === index);
      });
    }
  </script>
</body>
</html>`;

      this.renderedDocuments.set(filePath, { html });
      return { html };
    } catch (e) {
      console.error('[DocumentService] Failed to render XLSX:', e);
      throw e;
    }
  }

  /**
   * Render presentation slides using reveal.js
   */
  async renderSlides(data: PresentationData): Promise<DocumentContent> {
    const slidesHtml = data.slides.map((slide) => {
      const bgStyle = slide.background ? `data-background="${slide.background}"` : '';
      const transition = slide.transition ? `data-transition="${slide.transition}"` : '';

      return `
        <section ${bgStyle} ${transition}>
          ${slide.title ? `<h2>${slide.title}</h2>` : ''}
          ${slide.content}
          ${slide.notes ? `<aside class="notes">${slide.notes}</aside>` : ''}
        </section>`;
    }).join('\n');

    const theme = data.theme || 'black';

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${data.title}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reset.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/theme/${theme}.css">
  <style>
    .reveal h1, .reveal h2, .reveal h3 { text-transform: none; }
    .reveal pre { box-shadow: none; }
    .reveal code { font-family: 'Fira Code', 'Consolas', monospace; }
    .reveal .slides section { text-align: left; }
    .reveal .slides section h1,
    .reveal .slides section h2 { text-align: center; }
  </style>
</head>
<body>
  <div class="reveal">
    <div class="slides">
      ${slidesHtml}
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script>
  <script>
    Reveal.initialize({
      hash: true,
      slideNumber: true,
      transition: 'slide',
      backgroundTransition: 'fade',
    });
  </script>
</body>
</html>`;

    return { html };
  }

  /**
   * Create a new DOCX document
   */
  async createDocx(options: {
    path: string;
    title?: string;
    content: Array<{ type: 'paragraph' | 'heading' | 'table' | 'list'; text?: string; level?: number; rows?: string[][]; items?: string[] }>;
  }): Promise<string> {
    try {
      const { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun } = await import('docx');

      const children: any[] = [];

      for (const item of options.content) {
        switch (item.type) {
          case 'heading':
            children.push(new Paragraph({
              text: item.text || '',
              heading: item.level === 1 ? HeadingLevel.HEADING_1
                     : item.level === 2 ? HeadingLevel.HEADING_2
                     : HeadingLevel.HEADING_3,
            }));
            break;
          case 'paragraph':
            children.push(new Paragraph({
              children: [new TextRun(item.text || '')],
            }));
            break;
          case 'table':
            if (item.rows && item.rows.length > 0) {
              children.push(new Table({
                rows: item.rows.map(row => new TableRow({
                  children: row.map(cell => new TableCell({
                    children: [new Paragraph(cell)],
                  })),
                })),
              }));
            }
            break;
          case 'list':
            if (item.items) {
              for (const listItem of item.items) {
                children.push(new Paragraph({
                  text: listItem,
                  bullet: { level: 0 },
                }));
              }
            }
            break;
        }
      }

      const doc = new Document({
        title: options.title,
        sections: [{
          children,
        }],
      });

      const buffer = await Packer.toBuffer(doc);
      await fs.writeFile(options.path, buffer);

      return options.path;
    } catch (e) {
      console.error('[DocumentService] Failed to create DOCX:', e);
      throw e;
    }
  }

  /**
   * Create a new XLSX spreadsheet
   */
  async createXlsx(options: {
    path: string;
    sheets: Array<{
      name: string;
      data: (string | number | boolean | null)[][];
      columnWidths?: number[];
    }>;
  }): Promise<string> {
    try {
      const XLSX = await import('xlsx');

      const workbook = XLSX.utils.book_new();

      for (const sheet of options.sheets) {
        const worksheet = XLSX.utils.aoa_to_sheet(sheet.data);

        // Set column widths if provided
        if (sheet.columnWidths) {
          worksheet['!cols'] = sheet.columnWidths.map(w => ({ wch: w }));
        }

        XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
      }

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      await fs.writeFile(options.path, buffer);

      return options.path;
    } catch (e) {
      console.error('[DocumentService] Failed to create XLSX:', e);
      throw e;
    }
  }

  /**
   * Read XLSX data
   */
  async readXlsx(filePath: string): Promise<SpreadsheetData> {
    try {
      const XLSX = await import('xlsx');

      const buffer = await fs.readFile(filePath);
      const workbook = XLSX.read(buffer, { type: 'buffer' });

      const sheets = workbook.SheetNames.map(name => {
        const sheet = workbook.Sheets[name];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as (string | number | boolean | null)[][];

        const data: SpreadsheetCell[][] = jsonData.map((row, rowIndex) =>
          (row as (string | number | boolean | null)[]).map((cell, colIndex) => ({
            row: rowIndex,
            col: colIndex,
            value: cell,
          }))
        );

        return { name, data };
      });

      return { sheets };
    } catch (e) {
      console.error('[DocumentService] Failed to read XLSX:', e);
      throw e;
    }
  }

  /**
   * Update cells in an XLSX file
   */
  async updateXlsxCells(filePath: string, updates: Array<{
    sheet: string | number;
    cell: string; // e.g., "A1", "B2"
    value: string | number | boolean | null;
    formula?: string;
  }>): Promise<void> {
    try {
      const XLSX = await import('xlsx');

      const buffer = await fs.readFile(filePath);
      const workbook = XLSX.read(buffer, { type: 'buffer' });

      for (const update of updates) {
        const sheetName = typeof update.sheet === 'number'
          ? workbook.SheetNames[update.sheet]
          : update.sheet;

        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) {
          console.warn(`[DocumentService] Sheet "${sheetName}" not found`);
          continue;
        }

        if (update.formula) {
          worksheet[update.cell] = { f: update.formula };
        } else {
          const cellType = typeof update.value === 'number' ? 'n'
                        : typeof update.value === 'boolean' ? 'b'
                        : 's';
          worksheet[update.cell] = { v: update.value, t: cellType };
        }
      }

      const newBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      await fs.writeFile(filePath, newBuffer);
    } catch (e) {
      console.error('[DocumentService] Failed to update XLSX:', e);
      throw e;
    }
  }

  /**
   * Create HTML slide presentation file
   */
  async createPresentation(options: {
    path: string;
    title: string;
    author?: string;
    theme?: string;
    slides: SlideContent[];
  }): Promise<string> {
    const content = await this.renderSlides({
      title: options.title,
      author: options.author,
      theme: options.theme,
      slides: options.slides,
    });

    await fs.writeFile(options.path, content.html);
    return options.path;
  }

  /**
   * Render any supported document to HTML for preview
   */
  async renderDocument(filePath: string): Promise<DocumentContent> {
    const type = this.getDocumentType(filePath);

    switch (type) {
      case 'docx':
        return this.renderDocx(filePath);
      case 'xlsx':
        return this.renderXlsx(filePath);
      case 'pptx':
        // For PPTX, we'd need additional libraries - for now, show unsupported message
        return {
          html: this.createUnsupportedHtml(filePath, 'PowerPoint files (.pptx) preview coming soon. Use HTML slides for presentations.'),
        };
      case 'slides': {
        // HTML files - read directly
        const html = await fs.readFile(filePath, 'utf-8');
        return { html };
      }
      default:
        return {
          html: this.createUnsupportedHtml(filePath, `Unsupported file type: ${path.extname(filePath)}`),
        };
    }
  }

  /**
   * Create HTML for unsupported file types
   */
  private createUnsupportedHtml(filePath: string, message: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${path.basename(filePath)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #1a1a2e;
      color: #eee;
    }
    .message {
      text-align: center;
      padding: 40px;
    }
    .icon { font-size: 64px; margin-bottom: 20px; }
    h2 { margin: 0 0 10px 0; }
    p { color: #999; }
  </style>
</head>
<body>
  <div class="message">
    <div class="icon">📄</div>
    <h2>${path.basename(filePath)}</h2>
    <p>${message}</p>
  </div>
</body>
</html>`;
  }

  /**
   * Save rendered HTML to a temp file for preview
   */
  async saveForPreview(content: DocumentContent, originalPath: string): Promise<string> {
    const filename = `preview-${Date.now()}-${path.basename(originalPath, path.extname(originalPath))}.html`;
    const previewPath = path.join(this.tempDir, filename);
    await fs.writeFile(previewPath, content.html);
    return previewPath;
  }

  /**
   * Clean up temp files older than 1 hour
   */
  async cleanupTempFiles(): Promise<void> {
    try {
      const files = await fs.readdir(this.tempDir);
      const oneHourAgo = Date.now() - 60 * 60 * 1000;

      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        const stats = await fs.stat(filePath);
        if (stats.mtimeMs < oneHourAgo) {
          await fs.unlink(filePath);
        }
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

export const documentService = new DocumentService();
