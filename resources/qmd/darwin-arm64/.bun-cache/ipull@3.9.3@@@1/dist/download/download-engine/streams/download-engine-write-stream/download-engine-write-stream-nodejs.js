import fs from "fs/promises";
import fsExtra from "fs-extra";
import retry from "async-retry";
import { withLock } from "lifecycle-utils";
import BaseDownloadEngineWriteStream from "./base-download-engine-write-stream.js";
import WriterIsClosedError from "./errors/writer-is-closed-error.js";
const DEFAULT_OPTIONS = {
    mode: "r+"
};
const NOT_ENOUGH_SPACE_ERROR_CODE = "ENOSPC";
export default class DownloadEngineWriteStreamNodejs extends BaseDownloadEngineWriteStream {
    path;
    finalPath;
    _fd = null;
    _fileWriteFinished = false;
    options;
    fileSize = 0;
    constructor(path, finalPath, options = {}) {
        super();
        this.path = path;
        this.finalPath = finalPath;
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }
    async _ensureFileOpen() {
        return await withLock(this, "_lock", async () => {
            if (this._fd) {
                return this._fd;
            }
            return await retry(async () => {
                await fsExtra.ensureFile(this.path);
                return this._fd = await fs.open(this.path, this.options.mode);
            }, this.options.retry);
        });
    }
    async write(cursor, buffer) {
        let throwError = false;
        await retry(async () => {
            try {
                return await this._writeWithoutRetry(cursor, buffer);
            }
            catch (error) {
                if (error?.code === NOT_ENOUGH_SPACE_ERROR_CODE) {
                    throwError = error;
                    return;
                }
                throw error;
            }
        }, this.options.retry);
        if (throwError) {
            throw throwError;
        }
    }
    async ftruncate(size = this.fileSize) {
        this._fileWriteFinished = true;
        await retry(async () => {
            const fd = await this._ensureFileOpen();
            await fd.truncate(size);
        }, this.options.retry);
    }
    async saveMedataAfterFile(data) {
        if (this._fileWriteFinished) {
            throw new WriterIsClosedError();
        }
        const jsonString = JSON.stringify(data);
        const encoder = new TextEncoder();
        const uint8Array = encoder.encode(jsonString);
        await this.write(this.fileSize, uint8Array);
    }
    async loadMetadataAfterFileWithoutRetry() {
        if (!await fsExtra.pathExists(this.path)) {
            return;
        }
        const fd = await this._ensureFileOpen();
        try {
            const state = await fd.stat();
            const metadataSize = state.size - this.fileSize;
            if (metadataSize <= 0) {
                return;
            }
            const metadataBuffer = Buffer.alloc(metadataSize);
            await fd.read(metadataBuffer, 0, metadataSize, this.fileSize);
            const decoder = new TextDecoder();
            const metadataString = decoder.decode(metadataBuffer);
            try {
                return JSON.parse(metadataString);
            }
            catch { }
        }
        finally {
            this._fd = null;
            await fd.close();
        }
    }
    async _writeWithoutRetry(cursor, buffer) {
        const fd = await this._ensureFileOpen();
        const { bytesWritten } = await fd.write(buffer, 0, buffer.length, cursor);
        return bytesWritten;
    }
    async close() {
        await this._fd?.close();
        this._fd = null;
    }
}
//# sourceMappingURL=download-engine-write-stream-nodejs.js.map