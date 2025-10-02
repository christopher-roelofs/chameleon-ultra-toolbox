/**
 * FileSystemManager - Virtual filesystem with IndexedDB storage
 *
 * Provides a standardized API for file operations:
 * - fs.writeFile(path, content, type)
 * - fs.readFile(path)
 * - fs.deleteFile(path)
 * - fs.listFiles(directory)
 * - fs.mkdir(path)
 * - fs.exists(path)
 */

class FileSystemManager {
    constructor(dbName = 'UltraToolboxFS', version = 1) {
        this.dbName = dbName;
        this.version = version;
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Files store
                if (!db.objectStoreNames.contains('files')) {
                    const fileStore = db.createObjectStore('files', { keyPath: 'path' });
                    fileStore.createIndex('directory', 'directory', { unique: false });
                    fileStore.createIndex('name', 'name', { unique: false });
                    fileStore.createIndex('type', 'type', { unique: false });
                }

                // Directories store
                if (!db.objectStoreNames.contains('directories')) {
                    db.createObjectStore('directories', { keyPath: 'path' });
                }
            };
        });
    }

    /**
     * Write a file to the virtual filesystem
     * @param {string} path - Full path like '/helpers/ntag215.js'
     * @param {string|Uint8Array} content - File content
     * @param {string} type - MIME type (default: auto-detect from extension)
     */
    async writeFile(path, content, type = null) {
        if (!this.db) throw new Error('FileSystemManager not initialized');

        // Normalize path
        path = this._normalizePath(path);

        // Auto-detect type from extension
        if (!type) {
            type = this._detectMimeType(path);
        }

        // Extract directory and filename
        const { directory, name } = this._parsePath(path);

        // Ensure directory exists
        if (directory !== '/') {
            await this._ensureDirectory(directory);
        }

        // Convert content to storable format
        let storedContent = content;
        if (content instanceof Uint8Array) {
            storedContent = Array.from(content);
        }

        const fileEntry = {
            path,
            directory,
            name,
            content: storedContent,
            type,
            size: typeof content === 'string' ? content.length : content.length,
            created: Date.now(),
            modified: Date.now()
        };

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['files'], 'readwrite');
            const store = transaction.objectStore('files');
            const request = store.put(fileEntry);

            request.onsuccess = () => resolve(path);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Read a file from the virtual filesystem
     * @param {string} path - Full path to file
     * @param {string} encoding - 'text' (default) or 'binary'
     */
    async readFile(path, encoding = 'text') {
        if (!this.db) throw new Error('FileSystemManager not initialized');

        path = this._normalizePath(path);

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['files'], 'readonly');
            const store = transaction.objectStore('files');
            const request = store.get(path);

            request.onsuccess = () => {
                if (!request.result) {
                    reject(new Error(`File not found: ${path}`));
                    return;
                }

                const content = request.result.content;

                if (encoding === 'binary') {
                    // Convert back to Uint8Array if it was stored as array
                    if (Array.isArray(content)) {
                        resolve(new Uint8Array(content));
                    } else {
                        resolve(content);
                    }
                } else {
                    resolve(content);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Delete a file
     */
    async deleteFile(path) {
        if (!this.db) throw new Error('FileSystemManager not initialized');

        path = this._normalizePath(path);

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['files'], 'readwrite');
            const store = transaction.objectStore('files');
            const request = store.delete(path);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Delete a directory and all its contents
     * @param {string} path - Directory path
     */
    async deleteDirectory(path) {
        if (!this.db) throw new Error('FileSystemManager not initialized');

        path = this._normalizePath(path);

        // Get all files in this directory and subdirectories
        const allFiles = await this._getAllFiles();
        const filesToDelete = allFiles.filter(f =>
            f.path.startsWith(path + '/') || f.directory === path
        );

        // Delete all files
        for (const file of filesToDelete) {
            await this.deleteFile(file.path);
        }

        // Get all subdirectories
        const allDirs = await this.listDirectories();
        const dirsToDelete = allDirs.filter(d =>
            d.path.startsWith(path + '/') || d.path === path
        );

        // Delete all directory entries
        const transaction = this.db.transaction(['directories'], 'readwrite');
        const store = transaction.objectStore('directories');

        for (const dir of dirsToDelete) {
            await new Promise((resolve, reject) => {
                const request = store.delete(dir.path);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }

        return path;
    }

    /**
     * Delete a file or directory (auto-detects type)
     * @param {string} path - Path to delete
     */
    async remove(path) {
        // Check if it's a directory
        const isDir = await new Promise((resolve) => {
            const transaction = this.db.transaction(['directories'], 'readonly');
            const store = transaction.objectStore('directories');
            const request = store.get(this._normalizePath(path));
            request.onsuccess = () => resolve(!!request.result);
            request.onerror = () => resolve(false);
        });

        if (isDir) {
            return await this.deleteDirectory(path);
        } else {
            return await this.deleteFile(path);
        }
    }

    /**
     * Move/rename a file
     * @param {string} oldPath - Current file path
     * @param {string} newPath - New file path
     */
    async moveFile(oldPath, newPath) {
        if (!this.db) throw new Error('FileSystemManager not initialized');

        oldPath = this._normalizePath(oldPath);
        newPath = this._normalizePath(newPath);

        // Read the old file
        const content = await this.readFile(oldPath, 'text');

        // Get the old file metadata
        const oldFile = await new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['files'], 'readonly');
            const store = transaction.objectStore('files');
            const request = store.get(oldPath);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        if (!oldFile) {
            throw new Error(`File not found: ${oldPath}`);
        }

        // Write to new location with same content and type
        await this.writeFile(newPath, content, oldFile.type);

        // Delete old file
        await this.deleteFile(oldPath);

        return newPath;
    }

    /**
     * Copy a file
     * @param {string} srcPath - Source file path
     * @param {string} destPath - Destination file path
     */
    async copyFile(srcPath, destPath) {
        if (!this.db) throw new Error('FileSystemManager not initialized');

        srcPath = this._normalizePath(srcPath);
        destPath = this._normalizePath(destPath);

        // Read source file
        const content = await this.readFile(srcPath, 'text');

        // Get source file metadata
        const srcFile = await new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['files'], 'readonly');
            const store = transaction.objectStore('files');
            const request = store.get(srcPath);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        if (!srcFile) {
            throw new Error(`File not found: ${srcPath}`);
        }

        // Write to destination
        await this.writeFile(destPath, content, srcFile.type);

        return destPath;
    }

    /**
     * Move/rename a directory and all its contents
     * @param {string} oldPath - Current directory path
     * @param {string} newPath - New directory path
     */
    async moveDirectory(oldPath, newPath) {
        if (!this.db) throw new Error('FileSystemManager not initialized');

        oldPath = this._normalizePath(oldPath);
        newPath = this._normalizePath(newPath);

        // Get all files in the old directory and subdirectories
        const allFiles = await this._getAllFiles();
        const filesToMove = allFiles.filter(f =>
            f.path.startsWith(oldPath + '/') || f.directory === oldPath
        );

        // Move each file
        for (const file of filesToMove) {
            const relativePath = file.path.substring(oldPath.length);
            const newFilePath = newPath + relativePath;
            await this.moveFile(file.path, newFilePath);
        }

        // Get all subdirectories
        const allDirs = await this.listDirectories();
        const dirsToMove = allDirs.filter(d =>
            d.path.startsWith(oldPath + '/') || d.path === oldPath
        );

        // Update directory entries
        const transaction = this.db.transaction(['directories'], 'readwrite');
        const store = transaction.objectStore('directories');

        for (const dir of dirsToMove) {
            // Delete old directory entry
            await new Promise((resolve, reject) => {
                const request = store.delete(dir.path);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });

            // Create new directory entry
            const relativePath = dir.path.substring(oldPath.length);
            const newDirPath = newPath + relativePath;
            const { name } = this._parsePath(newDirPath);

            await new Promise((resolve, reject) => {
                const request = store.put({
                    path: newDirPath,
                    name: name,
                    created: dir.created
                });
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }

        return newPath;
    }

    /**
     * Move a file or directory (auto-detects type)
     * @param {string} oldPath - Current path
     * @param {string} newPath - New path
     */
    async move(oldPath, newPath) {
        // Check if it's a directory
        const isDir = await new Promise((resolve) => {
            const transaction = this.db.transaction(['directories'], 'readonly');
            const store = transaction.objectStore('directories');
            const request = store.get(this._normalizePath(oldPath));
            request.onsuccess = () => resolve(!!request.result);
            request.onerror = () => resolve(false);
        });

        if (isDir) {
            return await this.moveDirectory(oldPath, newPath);
        } else {
            return await this.moveFile(oldPath, newPath);
        }
    }

    /**
     * List all files in a directory
     * @param {string} directory - Directory path (default: '/')
     * @param {boolean} recursive - Include subdirectories (default: false)
     */
    async listFiles(directory = '/', recursive = false) {
        if (!this.db) throw new Error('FileSystemManager not initialized');

        directory = this._normalizePath(directory);

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['files'], 'readonly');
            const store = transaction.objectStore('files');
            const index = store.index('directory');
            const request = index.getAll(directory);

            request.onsuccess = () => {
                let files = request.result.map(f => ({
                    path: f.path,
                    name: f.name,
                    type: f.type,
                    size: f.size,
                    created: f.created,
                    modified: f.modified
                }));

                if (recursive) {
                    // TODO: Implement recursive listing
                }

                resolve(files);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * List all directories
     */
    async listDirectories() {
        if (!this.db) throw new Error('FileSystemManager not initialized');

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['directories'], 'readonly');
            const store = transaction.objectStore('directories');
            const request = store.getAll();

            request.onsuccess = () => {
                const dirs = request.result.map(d => ({
                    path: d.path,
                    name: d.name,
                    created: d.created
                }));
                resolve(dirs);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Create a directory
     */
    async mkdir(path) {
        if (!this.db) throw new Error('FileSystemManager not initialized');

        path = this._normalizePath(path);

        // Create all parent directories
        const parts = path.split('/').filter(p => p);
        let currentPath = '';

        for (const part of parts) {
            currentPath += '/' + part;
            await this._ensureDirectory(currentPath);
        }

        return path;
    }

    /**
     * Check if a file or directory exists
     */
    async exists(path) {
        if (!this.db) throw new Error('FileSystemManager not initialized');

        path = this._normalizePath(path);

        // Check files
        const fileExists = await new Promise((resolve) => {
            const transaction = this.db.transaction(['files'], 'readonly');
            const store = transaction.objectStore('files');
            const request = store.get(path);
            request.onsuccess = () => resolve(!!request.result);
            request.onerror = () => resolve(false);
        });

        if (fileExists) return true;

        // Check directories
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['directories'], 'readonly');
            const store = transaction.objectStore('directories');
            const request = store.get(path);
            request.onsuccess = () => resolve(!!request.result);
            request.onerror = () => resolve(false);
        });
    }

    /**
     * Get file tree structure for UI
     */
    async getTree() {
        const [files, directories] = await Promise.all([
            this._getAllFiles(),
            this.listDirectories()
        ]);

        // Build tree structure
        const tree = {
            path: '/',
            name: 'root',
            type: 'directory',
            children: []
        };

        // Add directories
        const dirMap = { '/': tree };
        directories.sort((a, b) => a.path.localeCompare(b.path));

        for (const dir of directories) {
            const parentPath = dir.path.substring(0, dir.path.lastIndexOf('/')) || '/';
            const parent = dirMap[parentPath];

            const dirNode = {
                path: dir.path,
                name: dir.name,
                type: 'directory',
                children: []
            };

            parent.children.push(dirNode);
            dirMap[dir.path] = dirNode;
        }

        // Add files
        for (const file of files) {
            const parent = dirMap[file.directory];
            if (parent) {
                parent.children.push({
                    path: file.path,
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    modified: file.modified
                });
            }
        }

        return tree;
    }

    // Private helper methods

    _normalizePath(path) {
        // Ensure path starts with /
        if (!path.startsWith('/')) {
            path = '/' + path;
        }
        // Remove trailing slash (except for root)
        if (path !== '/' && path.endsWith('/')) {
            path = path.slice(0, -1);
        }
        return path;
    }

    _parsePath(path) {
        const lastSlash = path.lastIndexOf('/');
        const directory = path.substring(0, lastSlash) || '/';
        const name = path.substring(lastSlash + 1);
        return { directory, name };
    }

    _detectMimeType(path) {
        const ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase();
        const mimeTypes = {
            'js': 'application/javascript',
            'json': 'application/json',
            'txt': 'text/plain',
            'md': 'text/markdown',
            'html': 'text/html',
            'css': 'text/css',
            'bin': 'application/octet-stream',
            'wasm': 'application/wasm'
        };
        return mimeTypes[ext] || 'application/octet-stream';
    }

    async _ensureDirectory(path) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['directories'], 'readwrite');
            const store = transaction.objectStore('directories');
            const checkRequest = store.get(path);

            checkRequest.onsuccess = () => {
                if (!checkRequest.result) {
                    const { name } = this._parsePath(path);
                    const dirEntry = {
                        path,
                        name,
                        created: Date.now()
                    };
                    const addRequest = store.put(dirEntry);
                    addRequest.onsuccess = () => resolve();
                    addRequest.onerror = () => reject(addRequest.error);
                } else {
                    resolve();
                }
            };
            checkRequest.onerror = () => reject(checkRequest.error);
        });
    }

    async _getAllFiles() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['files'], 'readonly');
            const store = transaction.objectStore('files');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

// Export for use in app
window.FileSystemManager = FileSystemManager;
